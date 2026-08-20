import { executeTools } from "./executeTool.js";
import { streamMessage } from "../services/api/streaming.js";
import type { Tool, ToolContext } from "../tools/Tool.js";
import type {
  AssistantMessage,
  Message,
  ToolResultBlock,
  UserMessage,
} from "../types/message.js";

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
  } = options;

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

    const toolResultMessage = await executeTools(
      assistantMessage,
      tools,
      toolContext
    );

    const toolResultContent = toolResultMessage.content;
    const toolResultBlocks = Array.isArray(toolResultContent)
      ? toolResultContent
      : [];

    for (const block of assistantMessage.content) {
      if (block.type === "tool_use") {
        const result = toolResultBlocks.find(
          (r): r is ToolResultBlock =>
            r.type === "tool_result" && r.tool_use_id === block.id
        );

        if (result) {
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
