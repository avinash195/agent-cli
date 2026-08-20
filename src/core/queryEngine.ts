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
}

export class QueryEngine {
  private messages: Message[] = [];
  private totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  private defaultModel: string;
  private sessionModelOverride: string | null = null;
  private abortController: AbortController | null = null;
  private readonly cwd: string;
  private readonly permissionPrompt?: PermissionPromptFn;
  private readonly sessionRules = new SessionRules();

  constructor(options: QueryEngineOptions = {}) {
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.cwd = options.cwd ?? process.cwd();
    this.permissionPrompt = options.permissionPrompt;
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

  abort(): void {
    this.abortController?.abort();
  }

  async *submitMessage(input: string): AsyncGenerator<QueryEngineEvent> {
    if (input.startsWith("/")) {
      yield this.handleSlashCommand(input);
      return;
    }

    this.messages.push({ role: "user", content: input });
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
      } else if (event.type === "tool_result_message") {
        this.messages.push(event.message as UserMessage);
      }

      yield event;
      result = await loop.next();
    }

    const loopResult: LoopResult = result.value;
    this.totalUsage.inputTokens += loopResult.usage.inputTokens;
    this.totalUsage.outputTokens += loopResult.usage.outputTokens;
    this.abortController = null;
  }

  private handleSlashCommand(input: string): QueryEngineEvent {
    const [command, ...args] = input.trim().split(/\s+/);
    const arg = args.join(" ");

    switch (command) {
      case "/help":
        return {
          type: "slash_command_result",
          output: [
            "Available commands:",
            "  /help           Show this message",
            "  /clear          Reset conversation history",
            "  /cost           Show cumulative token usage",
            "  /model [name]   View or change model",
            "  /history        Show message count",
          ].join("\n"),
        };

      case "/clear":
        this.messages = [];
        this.totalUsage = { inputTokens: 0, outputTokens: 0 };
        return { type: "session_cleared" };

      case "/cost":
        return {
          type: "slash_command_result",
          output: [
            `Input tokens:  ${this.totalUsage.inputTokens.toLocaleString()}`,
            `Output tokens: ${this.totalUsage.outputTokens.toLocaleString()}`,
            `Total tokens:  ${(this.totalUsage.inputTokens + this.totalUsage.outputTokens).toLocaleString()}`,
          ].join("\n"),
        };

      case "/model":
        return this.handleModelCommand(arg);

      case "/history":
        return {
          type: "slash_command_result",
          output: `${this.messages.length} messages in conversation`,
        };

      default:
        return {
          type: "slash_command_result",
          output: `Unknown command: ${command}. Type /help for available commands.`,
        };
    }
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
