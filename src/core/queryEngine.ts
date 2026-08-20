import crypto from "crypto";

import { formatSessionList, listSessions } from "../commands/history.js";
import { appendTranscriptEntry } from "../persistence/transcript.js";
import type { TranscriptEntry } from "../persistence/types.js";
import { renderSystemPrompt } from "./context/systemPrompt.js";
import { query, type LoopEvent, type LoopResult } from "./agenticLoop.js";
import { getAllTools } from "../tools/index.js";
import { DEFAULT_MODEL } from "../services/api/client.js";
import { SessionRules } from "../permissions/permissions.js";
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from "../types/message.js";
import type { PermissionPromptFn } from "../ui/confirmationPrompt.js";

interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type QueryEngineEvent =
  | LoopEvent
  | { type: "slash_command_result"; output: string }
  | { type: "session_cleared" };

export interface QueryEngineOptions {
  defaultModel?: string;
  cwd?: string;
  permissionPrompt?: PermissionPromptFn;
  initialMessages?: Message[];
  initialUsage?: Usage;
  sessionId?: string;
  persist?: boolean;
}

export class QueryEngine {
  private messages: Message[];
  private totalUsage: Usage;
  private defaultModel: string;
  private sessionModelOverride: string | null = null;
  private abortController: AbortController | null = null;
  private readonly cwd: string;
  private readonly permissionPrompt?: PermissionPromptFn;
  private readonly sessionRules = new SessionRules();
  private readonly sessionId: string;
  private readonly persistenceEnabled: boolean;

  constructor(options: QueryEngineOptions = {}) {
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.cwd = options.cwd ?? process.cwd();
    this.permissionPrompt = options.permissionPrompt;
    this.messages = options.initialMessages ?? [];
    this.totalUsage = options.initialUsage ?? {
      inputTokens: 0,
      outputTokens: 0,
    };
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.persistenceEnabled = options.persist ?? true;
  }

  getActiveModel(): string {
    return this.sessionModelOverride ?? this.defaultModel;
  }

  getUsage(): Usage {
    return { ...this.totalUsage };
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  abort(): void {
    this.abortController?.abort();
  }

  async *submitMessage(input: string): AsyncGenerator<QueryEngineEvent> {
    if (input.startsWith("/")) {
      const result = await this.handleSlashCommand(input);
      yield result;
      return;
    }

    const userMessage: Message = { role: "user", content: input };
    this.messages.push(userMessage);

    await this.writeEntry({
      type: "message",
      timestamp: new Date().toISOString(),
      role: "user",
      message: userMessage,
    });

    this.abortController = new AbortController();

    const systemPrompt = renderSystemPrompt({ cwd: this.cwd });
    const tools = getAllTools();

    const loop = query({
      messages: this.messages,
      tools,
      systemPrompt,
      model: this.getActiveModel(),
      maxTurns: 50,
      abortSignal: this.abortController.signal,
      cwd: this.cwd,
      permissionPrompt: this.permissionPrompt,
      sessionRules: this.sessionRules,
    });

    let result = await loop.next();
    while (!result.done) {
      const event = result.value;

      if (event.type === "assistant_message") {
        this.messages.push(event.message as AssistantMessage);
        await this.writeEntry({
          type: "message",
          timestamp: new Date().toISOString(),
          role: "assistant",
          message: event.message,
        });
      } else if (event.type === "tool_result_message") {
        this.messages.push(event.message as UserMessage);
        await this.writeEntry({
          type: "message",
          timestamp: new Date().toISOString(),
          role: "user",
          message: event.message,
        });
      } else if (event.type === "tool_use_start") {
        await this.writeEntry({
          type: "tool_event",
          timestamp: new Date().toISOString(),
          name: event.name,
          phase: "start",
        });
      } else if (event.type === "tool_use_done") {
        await this.writeEntry({
          type: "tool_event",
          timestamp: new Date().toISOString(),
          name: event.name,
          phase: "done",
          resultLength: event.result.length,
          isError: event.isError,
        });
      } else if (event.type === "turn_complete" && event.reason === "aborted") {
        await this.writeEntry({
          type: "system",
          timestamp: new Date().toISOString(),
          level: "info",
          event: "aborted",
        });
      }

      yield event;
      result = await loop.next();
    }

    const loopResult: LoopResult = result.value;
    this.totalUsage.inputTokens += loopResult.usage.inputTokens;
    this.totalUsage.outputTokens += loopResult.usage.outputTokens;

    await this.writeEntry({
      type: "usage",
      timestamp: new Date().toISOString(),
      turn: loopResult.usage,
      cumulative: { ...this.totalUsage },
    });

    if (loopResult.terminationReason === "model_error") {
      await this.writeEntry({
        type: "system",
        timestamp: new Date().toISOString(),
        level: "error",
        event: "model_error",
        detail: loopResult.terminationReason,
      });
    }

    this.abortController = null;
  }

  private async writeEntry(entry: TranscriptEntry): Promise<void> {
    if (!this.persistenceEnabled) return;
    await appendTranscriptEntry(this.cwd, this.sessionId, entry);
  }

  private async handleSlashCommand(
    input: string
  ): Promise<QueryEngineEvent> {
    const [command, ...args] = input.trim().split(/\s+/);
    const arg = args.join(" ");

    let result: QueryEngineEvent;

    switch (command) {
      case "/help":
        result = {
          type: "slash_command_result",
          output: [
            "Available commands:",
            "  /help           Show this message",
            "  /clear          Reset conversation history",
            "  /cost           Show cumulative token usage",
            "  /model [name]   View or change model",
            "  /history        List past sessions for this project",
          ].join("\n"),
        };
        break;

      case "/clear":
        this.messages = [];
        this.totalUsage = { inputTokens: 0, outputTokens: 0 };
        await this.writeEntry({
          type: "system",
          timestamp: new Date().toISOString(),
          level: "info",
          event: "session_cleared",
        });
        result = { type: "session_cleared" };
        break;

      case "/cost":
        result = {
          type: "slash_command_result",
          output: [
            `Input tokens:  ${this.totalUsage.inputTokens.toLocaleString()}`,
            `Output tokens: ${this.totalUsage.outputTokens.toLocaleString()}`,
            `Total tokens:  ${(this.totalUsage.inputTokens + this.totalUsage.outputTokens).toLocaleString()}`,
          ].join("\n"),
        };
        break;

      case "/model":
        result = this.handleModelCommand(arg);
        break;

      case "/history": {
        const sessions = await listSessions(this.cwd);
        result = {
          type: "slash_command_result",
          output: formatSessionList(sessions),
        };
        break;
      }

      default:
        result = {
          type: "slash_command_result",
          output: `Unknown command: ${command}. Type /help for available commands.`,
        };
    }

    await this.writeEntry({
      type: "system",
      timestamp: new Date().toISOString(),
      level: "info",
      event: "slash_command",
      detail: input,
    });

    return result;
  }

  private handleModelCommand(arg: string): QueryEngineEvent {
    if (!arg) {
      const active = this.getActiveModel();
      const source = this.sessionModelOverride ? "session override" : "default";
      return {
        type: "slash_command_result",
        output: `Current model: ${active} (${source})`,
      };
    }

    if (arg === "default") {
      this.sessionModelOverride = null;
      return {
        type: "slash_command_result",
        output: `Reverted to default model: ${this.defaultModel}`,
      };
    }

    this.sessionModelOverride = arg;
    return {
      type: "slash_command_result",
      output: `Model set to: ${arg} (session override)`,
    };
  }
}
