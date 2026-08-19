import type {
  ToolUseBlock,
  ToolResultBlock,
  UserMessage,
} from "../types/message.js";

import type { ToolContext } from "../tools/Tool.js";

import { findToolByName } from "../tools/index.js";

export async function executeTools(
  toolUseBlocks: ToolUseBlock[],
  context: ToolContext
): Promise<UserMessage> {
  const results: ToolResultBlock[] =
    await Promise.all(
      toolUseBlocks.map(async (block) => {
        const tool = findToolByName(block.name);

        if (!tool) {
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: `Unknown tool: ${block.name}`,
            is_error: true,
          };
        }

        try {
          const result = await tool.call(
            block.input,
            context
          );

          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: result.content,
            is_error: result.isError,
          };
        } catch (error) {
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content:
              `Tool execution failed: ${
                error instanceof Error
                  ? error.message
                  : String(error)
              }`,
            is_error: true,
          };
        }
      })
    );

  return {
    role: "user",
    content: results,
  };
}