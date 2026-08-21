import type { Tool, ToolContext, ToolResult } from "./Tool.js";

export const exitPlanModeTool: Tool = {
  name: "ExitPlanMode",

  description:
    "Submit the plan for user approval. Call this after writing your complete " +
    "plan to the plan file. Optionally provide allowedPrompts - patterns that " +
    "the user can auto-approve (e.g. 'write_file(src/**)' to auto-allow writes in src/).",

  inputSchema: {
    type: "object",
    properties: {
      allowedPrompts: {
        type: "array",
        items: { type: "string" },
        description:
          "Permission patterns to auto-allow during plan execution " +
          "(e.g. ['write_file(src/**)', 'edit_file(src/**)', 'bash(npm test*)'])",
      },
    },
    required: [],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const allowedPrompts = Array.isArray(input.allowedPrompts)
      ? (input.allowedPrompts as unknown[]).filter(
          (p): p is string => typeof p === "string"
        )
      : [];

    const planPath = context.getPlanFilePath?.();
    if (planPath) {
      context.requestPlanApproval?.({
        planPath,
        allowedPrompts,
      });
    }

    return {
      content: "Plan submitted for user approval. Waiting for response.",
    };
  },

  isReadOnly(): boolean {
    return true;
  },

  isEnabled(): boolean {
    return true;
  },
};
