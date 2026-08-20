import { loadRules } from "../config/settings.js";
import { executeSingleTool } from "./executeTool.js";
import { streamMessage } from "../services/api/streaming.js";
import {
  evaluatePermission,
  SessionRules,
  type AgentMode,
  type PermissionRules,
} from "../permissions/permissions.js";
import type { Tool, ToolContext } from "../tools/Tool.js";
import type {
  AssistantMessage,
  Message,
  ToolResultBlock,
  UserMessage,
} from "../types/message.js";
import {
  createTerminalPermissionPrompt,
  inferPattern,
  summarizeToolCall,
  type ConfirmationPrompt,
  type PermissionPromptFn,
  type PermissionResponse,
} from "../ui/confirmationPrompt.js";

export type LoopTerminationReason =
  | "completed"
  | "aborted"
  | "model_error"
  | "max_turns";

export type LoopEvent =
  | { type: "text"; text: string }
  | {
      type: "tool_use_start";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_use_done";
      id: string;
      name: string;
      result: string;
      isError: boolean;
    }
  | {
      type: "tool_denied";
      id: string;
      name: string;
      reason: string;
    }
  | { type: "assistant_message"; message: AssistantMessage }
  | { type: "tool_result_message"; message: UserMessage }
  | { type: "turn_complete"; turnCount: number; reason: string }
  | { type: "error"; error: Error };

export interface LoopResult {
  messages: Message[];
  terminationReason: LoopTerminationReason;
  turnCount: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface QueryOptions {
  messages: Message[];
  tools: Tool[];
  systemPrompt?: string;
  maxTurns?: number;
  abortSignal?: { aborted: boolean };
  cwd?: string;
  mode?: AgentMode;
  rules?: PermissionRules;
  sessionRules?: SessionRules;
  permissionPrompt?: PermissionPromptFn;
}

interface LoopState {
  messages: Message[];
  turnCount: number;
  aborted: boolean;
}

export async function* query(
  options: QueryOptions
): AsyncGenerator<LoopEvent, LoopResult> {
  const {
    tools,
    systemPrompt,
    maxTurns = 50,
    abortSignal,
    cwd = process.cwd(),
    mode,
    rules = loadRules(),
    sessionRules = new SessionRules(),
    permissionPrompt = createTerminalPermissionPrompt(),
  } = options;

  const effectiveMode = mode ?? rules.mode;

  const state: LoopState = {
    messages: [...options.messages],
    turnCount: 0,
    aborted: false,
  };

  const toolContext: ToolContext = { cwd };
  let totalUsage = { inputTokens: 0, outputTokens: 0 };

  const toolsApiParams = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  while (state.turnCount < maxTurns) {
    if (abortSignal?.aborted) {
      state.aborted = true;
      yield {
        type: "turn_complete",
        turnCount: state.turnCount,
        reason: "aborted",
      };
      return {
        messages: state.messages,
        terminationReason: "aborted",
        turnCount: state.turnCount,
        usage: totalUsage,
      };
    }

    state.turnCount++;

    let assistantMessage: AssistantMessage;
    let stopReason: string;

    try {
      const stream = streamMessage(state.messages, {
        systemPrompt,
        cwd,
        tools: toolsApiParams,
      });

      let streamResult = await stream.next();

      while (!streamResult.done) {
        const event = streamResult.value;

        if (event.type === "text") {
          yield { type: "text", text: event.text };
        } else if (event.type === "tool_use_start") {
          yield {
            type: "tool_use_start",
            id: event.id,
            name: event.name,
            input: event.input,
          };
        }

        streamResult = await stream.next();
      }

      assistantMessage = streamResult.value.assistantMessage;
      stopReason = streamResult.value.stopReason;
      totalUsage.inputTokens += streamResult.value.usage.inputTokens;
      totalUsage.outputTokens += streamResult.value.usage.outputTokens;
    } catch (error) {
      yield { type: "error", error: error as Error };
      return {
        messages: state.messages,
        terminationReason: "model_error",
        turnCount: state.turnCount,
        usage: totalUsage,
      };
    }

    state.messages.push(assistantMessage);
    yield { type: "assistant_message", message: assistantMessage };

    if (stopReason !== "tool_use") {
      yield {
        type: "turn_complete",
        turnCount: state.turnCount,
        reason: "completed",
      };
      return {
        messages: state.messages,
        terminationReason: "completed",
        turnCount: state.turnCount,
        usage: totalUsage,
      };
    }

    const toolUseBlocks = assistantMessage.content.filter(
      (block) => block.type === "tool_use"
    );

    const toolResults: ToolResultBlock[] = [];

    for (const toolCall of toolUseBlocks) {
      if (toolCall.type !== "tool_use") continue;

      const decision = evaluatePermission(
        toolCall.name,
        toolCall.input,
        rules,
        effectiveMode,
        sessionRules
      );

      if (decision.decision === "deny") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: `Permission denied: ${decision.reason}`,
          is_error: true,
        });
        continue;
      }

      if (decision.decision === "ask") {
        const response = await permissionPrompt({
          toolName: toolCall.name,
          summary: summarizeToolCall(toolCall.name, toolCall.input),
          risk: decision.reason,
        });

        if (response === "deny") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: "User denied this operation.",
            is_error: true,
          });
          continue;
        }

        if (response === "always_allow") {
          const pattern = inferPattern(toolCall.name, toolCall.input);
          sessionRules.add(pattern);
        }
      }

      const result = await executeSingleTool(
        toolCall,
        tools,
        toolContext
      );
      toolResults.push(result);
    }

    const toolResultMessage: UserMessage = {
      role: "user",
      content: toolResults,
    };

    for (const block of assistantMessage.content) {
      if (block.type === "tool_use") {
        const result = toolResults.find(
          (r): r is ToolResultBlock =>
            r.type === "tool_result" && r.tool_use_id === block.id
        );

        if (result) {
          const wasDenied =
            result.content.startsWith("Permission denied:") ||
            result.content === "User denied this operation.";

          if (wasDenied) {
            yield {
              type: "tool_denied",
              id: block.id,
              name: block.name,
              reason: result.content,
            };
          }

          yield {
            type: "tool_use_done",
            id: block.id,
            name: block.name,
            result: result.content,
            isError: result.is_error ?? false,
          };
        }
      }
    }

    state.messages.push(toolResultMessage);
    yield { type: "tool_result_message", message: toolResultMessage };
    yield {
      type: "turn_complete",
      turnCount: state.turnCount,
      reason: "tool_use",
    };
  }

  return {
    messages: state.messages,
    terminationReason: "max_turns",
    turnCount: state.turnCount,
    usage: totalUsage,
  };
}
