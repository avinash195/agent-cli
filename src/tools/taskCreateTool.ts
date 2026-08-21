import { createTask } from "../tasks/taskGraph.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

export const taskCreateTool: Tool = {
  name: "TaskCreate",

  description:
    "Create a persistent task in the project task graph. " +
    "Optionally pass blockedBy (task IDs this task depends on). " +
    "IDs are auto-assigned and never reused.",

  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Imperative sentence describing the task",
      },
      blockedBy: {
        type: "array",
        items: { type: "number" },
        description: "IDs of tasks that must complete before this one can start",
      },
      owner: {
        type: "string",
        description: "Optional owner label for multi-agent handoff",
      },
    },
    required: ["content"],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const content = input.content as string;
    if (!content?.trim()) {
      return { content: "content is required", isError: true };
    }

    const blockedBy = Array.isArray(input.blockedBy)
      ? input.blockedBy.filter((id): id is number => typeof id === "number")
      : undefined;
    const owner = typeof input.owner === "string" ? input.owner : undefined;

    try {
      const task = createTask(context.sessionId ?? "default", content.trim(), {
        blockedBy,
        owner,
      });
      return { content: JSON.stringify(task, null, 2) };
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  },

  isReadOnly(): boolean {
    return false;
  },

  isEnabled(): boolean {
    return true;
  },
};
