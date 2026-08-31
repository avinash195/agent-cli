import type {
  StreamEvent,
  StreamResult,
  AssistantMessage,
  TextBlock,
  ToolUseBlock,
  ContentBlock,
  Message,
} from "../../types/message.js";

import { getOutputTokenLimit } from "../../tokens/outputLimits.js";
import { getClient, getModel } from "./client.js";
import {
  buildSystemPromptBlocks,
  type SystemPromptBlock,
} from "../../context/systemPrompt.js";

export interface StreamMessageOptions {
  signal?: AbortSignal;
  systemPrompt?: SystemPromptBlock[];
  model?: string;
  cwd?: string;
  maxTokens?: number;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}

function applyApiUsage(
  usage: StreamResult["usage"],
  api: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }
): void {
  if (api.input_tokens != null) {
    const cacheRead = api.cache_read_input_tokens ?? 0;
    const cacheCreate = api.cache_creation_input_tokens ?? 0;
    usage.inputTokens = api.input_tokens + cacheCreate + cacheRead;
    usage.cacheReadTokens = cacheRead;
  }
  if (api.output_tokens != null) {
    usage.outputTokens = api.output_tokens;
  }
}

export async function* streamMessage(
  messages: Message[],
  options: StreamMessageOptions = {}
): AsyncGenerator<StreamEvent, StreamResult> {
  const { signal, systemPrompt, model, cwd, tools, maxTokens } = options;
  const client = getClient();

  const resolvedSystemPrompt =
    systemPrompt ??
    buildSystemPromptBlocks({ cwd: cwd ?? process.cwd() });

  const requestParams: Parameters<typeof client.messages.stream>[0] = {
    model: model ?? getModel(),
    max_tokens: maxTokens ?? getOutputTokenLimit("default"),
    system: resolvedSystemPrompt.map((block) => ({
      type: "text" as const,
      text: block.text,
      ...(block.cache
        ? { cache_control: { type: "ephemeral" as const } }
        : {}),
    })),
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  if (tools && tools.length > 0) {
    requestParams.tools = tools.map((tool, index) =>
      index === tools.length - 1
        ? { ...tool, cache_control: { type: "ephemeral" as const } }
        : tool
    ) as never;
  }

  const stream = client.messages.stream(requestParams, { signal });

  const contentBlocks: ContentBlock[] = [];

  let currentText = "";
  let currentToolId = "";
  let currentToolName = "";
  let currentToolInput = "";

  const usage: StreamResult["usage"] = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
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
          applyApiUsage(usage, event.usage);
        }
        break;
      }

      case "message_start": {
        if (event.message?.usage) {
          applyApiUsage(usage, event.message.usage);
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
