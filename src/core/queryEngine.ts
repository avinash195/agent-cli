import crypto from "crypto";

import {
  formatCompactResult,
  parseCompactCommand,
  performCompaction,
} from "../compression/index.js";
import { tokenCountWithEstimation } from "../compression/tokens.js";
import { formatSessionList, listSessions } from "../commands/history.js";
import {
  appendCompactionToTranscript,
  appendTranscriptEntry,
} from "../persistence/transcript.js";
import type { TranscriptEntry } from "../persistence/types.js";
import { renderSystemPrompt } from "../context/systemPrompt.js";
import { query, type LoopEvent, type LoopResult } from "./agenticLoop.js";
import { getAllTools } from "../tools/index.js";
import { getModel } from "../services/api/client.js";
import { SessionRules } from "../permissions/permissions.js";
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from "../types/message.js";
import type { PermissionPromptFn } from "../ui/confirmationPrompt.js";
import {
  checkBudget,
  createCircuitBreaker,
  getEffectiveWindow,
  handleBudgetStatus,
  recordCompressionFailure,
  recordCompressionSuccess,
} from "../tokens/index.js";

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
  private ignoreMemory = false;
  private lastCallUsage?: { inputTokens: number };
  private usageAnchorIndex?: number;
  private readonly circuitBreaker = createCircuitBreaker();

  constructor(options: QueryEngineOptions = {}) {
    this.defaultModel = options.defaultModel ?? getModel();
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

  isMemoryIgnored(): boolean {
    return this.ignoreMemory;
  }

  abort(): void {
    this.abortController?.abort();
  }

  private estimateContextTokens(): number {
    return tokenCountWithEstimation(this.messages, {
      lastUsage: this.lastCallUsage,
      usageAnchorIndex: this.usageAnchorIndex,
    });
  }

  async *submitMessage(input: string): AsyncGenerator<QueryEngineEvent> {
    if (input.startsWith("/")) {
      const result = await this.handleSlashCommand(input);
      yield result;
      return;
    }

    const userMessage: Message = { role: "user", content: input };
    const model = this.getActiveModel();

    const preCount = this.estimateContextTokens();
    if (checkBudget(preCount, model) === "blocking") {
      yield {
        type: "token_warning",
        level: "blocking",
        tokenCount: preCount,
        message: "Context window limit reached. Use /compact to continue.",
      };
      return;
    }

    this.messages.push(userMessage);

    await this.writeEntry({
      type: "message",
      timestamp: new Date().toISOString(),
      role: "user",
      message: userMessage,
    });

    this.abortController = new AbortController();

    const systemPrompt = renderSystemPrompt({
      cwd: this.cwd,
      ignoreMemory: this.ignoreMemory,
    });
    const tools = getAllTools();

    const tokenCount = this.estimateContextTokens();
    const budgetStatus = checkBudget(tokenCount, model);

    if (budgetStatus === "blocking") {
      yield {
        type: "token_warning",
        level: "blocking",
        tokenCount,
        message: "Context window limit reached. Use /compact to continue.",
      };
      this.abortController = null;
      return;
    }

    if (budgetStatus === "warning") {
      yield {
        type: "token_warning",
        level: "warning",
        tokenCount,
        message: "Context is getting large. Consider running /compact.",
      };
    }

    if (budgetStatus === "error") {
      const budgetResult = await handleBudgetStatus(
        budgetStatus,
        this.circuitBreaker,
        this.messages,
        "user",
        model
      );

      if (budgetResult.action === "compress" && budgetResult.compaction) {
        this.messages = budgetResult.messages;
        this.lastCallUsage = undefined;
        this.usageAnchorIndex = undefined;
        if (this.persistenceEnabled) {
          await appendCompactionToTranscript(
            this.cwd,
            this.sessionId,
            budgetResult.compaction
          );
        }
        yield {
          type: "compaction",
          tokensBefore: budgetResult.compaction.tokensBefore,
          tokensAfter: budgetResult.compaction.tokensAfter,
          result: budgetResult.compaction,
        };
        yield {
          type: "token_warning",
          level: "info",
          tokenCount: this.estimateContextTokens(),
          message: "Auto-compressed conversation to stay within budget.",
        };
      }
    }

    const loop = query({
      messages: this.messages,
      tools,
      systemPrompt,
      model,
      maxTurns: 50,
      abortSignal: this.abortController.signal,
      cwd: this.cwd,
      permissionPrompt: this.permissionPrompt,
      sessionRules: this.sessionRules,
      lastCallUsage: this.lastCallUsage,
      usageAnchorIndex: this.usageAnchorIndex,
      circuitBreaker: this.circuitBreaker,
      querySource: "user",
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
      } else if (event.type === "compaction") {
        this.messages = [...event.result.messages];
        this.lastCallUsage = undefined;
        this.usageAnchorIndex = undefined;
        if (this.persistenceEnabled) {
          await appendCompactionToTranscript(
            this.cwd,
            this.sessionId,
            event.result
          );
        }
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
    this.messages = loopResult.messages;
    this.lastCallUsage = loopResult.lastCallUsage;
    this.usageAnchorIndex = loopResult.usageAnchorIndex;
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

    if (loopResult.terminationReason === "blocking_limit") {
      await this.writeEntry({
        type: "system",
        timestamp: new Date().toISOString(),
        level: "info",
        event: "blocking_limit",
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
            "  /compact [focus] Compress conversation history",
            "  /model [name]   View or change model",
            "  /history        List past sessions for this project",
            "  /memory on|off  Enable or disable memory injection",
          ].join("\n"),
        };
        break;

      case "/memory":
        if (arg === "off") {
          this.ignoreMemory = true;
          result = {
            type: "slash_command_result",
            output: "Memory injection disabled for this session.",
          };
        } else if (arg === "on") {
          this.ignoreMemory = false;
          result = {
            type: "slash_command_result",
            output: "Memory injection re-enabled.",
          };
        } else {
          result = {
            type: "slash_command_result",
            output: this.ignoreMemory
              ? "Memory injection is off. Use /memory on to re-enable."
              : "Memory injection is on. Use /memory off to disable.",
          };
        }
        break;

      case "/clear":
        this.messages = [];
        this.totalUsage = { inputTokens: 0, outputTokens: 0 };
        this.lastCallUsage = undefined;
        this.usageAnchorIndex = undefined;
        this.circuitBreaker.consecutiveFailures = 0;
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

      case "/compact":
        result = await this.handleCompactCommand(input);
        break;

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

  private async handleCompactCommand(input: string): Promise<QueryEngineEvent> {
    const command = parseCompactCommand(input);
    if (!command) {
      return {
        type: "slash_command_result",
        output: 'Usage: /compact [focus]  or  /compact "focus directive"',
      };
    }

    if (this.messages.length === 0) {
      return {
        type: "slash_command_result",
        output: "Nothing to compact.",
      };
    }

    try {
      const result = await performCompaction(this.messages, {
        maxContextTokens: getEffectiveWindow(this.getActiveModel()),
        focusDirective: command.focusDirective,
        force: true,
        lastUsage: this.lastCallUsage,
        usageAnchorIndex: this.usageAnchorIndex,
        model: this.getActiveModel(),
      });

      this.messages = result.messages;
      this.lastCallUsage = undefined;
      this.usageAnchorIndex = undefined;

      if (result.summary !== "") {
        recordCompressionSuccess(this.circuitBreaker);
        if (this.persistenceEnabled) {
          await appendCompactionToTranscript(this.cwd, this.sessionId, result);
        }
      }

      return {
        type: "slash_command_result",
        output: formatCompactResult(result),
      };
    } catch (error) {
      recordCompressionFailure(this.circuitBreaker);
      return {
        type: "slash_command_result",
        output: `Compression failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
