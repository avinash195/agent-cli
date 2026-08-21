import {
  DEFAULT_MAX_RESULT_SIZE_CHARS,
  truncateToolResult,
} from "../tokens/truncation.js";
import type { Tool, ToolContext } from "../tools/Tool.js";
import type {
  AssistantMessage,
  ToolResultBlock,
  ToolUseBlock,
  UserMessage,
} from "../types/message.js";

export async function executeSingleTool(
  toolUse: ToolUseBlock,
  tools: Tool[],
  context: ToolContext
): Promise<ToolResultBlock> {
  const tool = tools.find((t) => t.name === toolUse.name);

  if (!tool) {
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: `Error: unknown tool "${toolUse.name}"`,
      is_error: true,
    };
  }

  try {
    const output = await tool.call(toolUse.input, context);
    const maxChars = tool.maxResultSizeChars ?? DEFAULT_MAX_RESULT_SIZE_CHARS;
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: truncateToolResult(output.content, maxChars),
      is_error: output.isError,
    };
  } catch (error) {
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: `Error: ${
        error instanceof Error ? error.message : String(error)
      }`,
      is_error: true,
    };
  }
}

export async function executeTools(
  assistantMessage: AssistantMessage,
  tools: Tool[],
  context: ToolContext
): Promise<UserMessage> {
  const toolUseBlocks = assistantMessage.content.filter(
    (block): block is ToolUseBlock => block.type === "tool_use"
  );

  const results: ToolResultBlock[] = [];

  for (const toolUse of toolUseBlocks) {
    results.push(await executeSingleTool(toolUse, tools, context));
  }

  return {
    role: "user",
    content: results,
  };
}
