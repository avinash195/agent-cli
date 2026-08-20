import type {
  StreamEvent,
  StreamResult,
  AssistantMessage,
  TextBlock,
  ToolUseBlock,
  ContentBlock,
  Message,
} from "../../types/message.js";

import {
  getClient,
  getModel,
  DEFAULT_MAX_TOKENS,
} from "./client.js";
import { renderSystemPrompt } from "../../core/context/systemPrompt.js";

export interface StreamMessageOptions {
  signal?: AbortSignal;
  systemPrompt?: string;
  model?: string;
  cwd?: string;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}

export async function* streamMessage(
  messages: Message[],
  options: StreamMessageOptions = {}
): AsyncGenerator<StreamEvent, StreamResult> {
  const { signal, systemPrompt, model, cwd, tools } = options;
  const client = getClient();

  const resolvedSystemPrompt =
    systemPrompt ??
    renderSystemPrompt({ cwd: cwd ?? process.cwd() });

  const requestParams: Parameters<typeof client.messages.stream>[0] = {
    model: model ?? getModel(),
    max_tokens: DEFAULT_MAX_TOKENS,
    system: resolvedSystemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  if (tools && tools.length > 0) {
    // SDK InputSchema is stricter than our Tool.inputSchema type
    requestParams.tools = tools as never;
  }

  const stream = client.messages.stream(requestParams, { signal });

  const contentBlocks: ContentBlock[] = [];

  let currentText = "";
  let currentToolId = "";
  let currentToolName = "";
  let currentToolInput = "";

  let usage = {
    inputTokens: 0,
    outputTokens: 0,
  };

  let stopReason = "end_turn";

  yield { type: "message_start" };

  for await (const event of stream) {
    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "text") {
          currentText = "";
        } else if (event.content_block.type === "tool_use") {
          currentToolId = event.content_block.id;
          currentToolName = event.content_block.name;
          currentToolInput = "";
        }
        break;
      }

      case "content_block_delta": {
        if (event.delta.type === "text_delta") {
          currentText += event.delta.text;

          yield {
            type: "text",
            text: event.delta.text,
          };
        } else if (event.delta.type === "input_json_delta") {
          currentToolInput += event.delta.partial_json;

          yield {
            type: "tool_use_input",
            delta: event.delta.partial_json,
          };
        }
        break;
      }

      case "content_block_stop": {
        if (currentText) {
          contentBlocks.push({
            type: "text",
            text: currentText,
          } as TextBlock);

          currentText = "";
        }

        if (currentToolName) {
          const input = currentToolInput
            ? JSON.parse(currentToolInput)
            : {};

          contentBlocks.push({
            type: "tool_use",
            id: currentToolId,
            name: currentToolName,
            input,
          } as ToolUseBlock);

          yield {
            type: "tool_use_start",
            id: currentToolId,
            name: currentToolName,
            input,
          };

          currentToolId = "";
          currentToolName = "";
          currentToolInput = "";
        }
        break;
      }

      case "message_delta": {
        if (event.delta.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
        if (event.usage) {
          usage.outputTokens = event.usage.output_tokens;
        }
        break;
      }

      case "message_start": {
        if (event.message?.usage) {
          usage.inputTokens = event.message.usage.input_tokens;
        }
        break;
      }
    }
  }

  yield {
    type: "message_done",
  };

  const assistantMessage: AssistantMessage = {
    role: "assistant",
    content: contentBlocks,
  };

  return {
    assistantMessage,
    usage,
    stopReason,
  };
}
