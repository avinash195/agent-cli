import type { Tool, ToolContext } from "../tools/Tool.js";
import type {
  AssistantMessage,
  ToolResultBlock,
  ToolUseBlock,
  UserMessage,
} from "../types/message.js";

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
    const tool = tools.find((t) => t.name === toolUse.name);

    if (!tool) {
      results.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: `Error: unknown tool "${toolUse.name}"`,
        is_error: true,
      });
      continue;
    }

    try {
      const output = await tool.call(toolUse.input, context);
      results.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: output.content,
        is_error: output.isError,
      });
    } catch (error) {
      results.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        is_error: true,
      });
    }
  }

  return {
    role: "user",
    content: results,
  };
}
