import {
  effectiveStatus,
  isReady,
  readTask,
  tasksById,
} from "../tasks/taskGraph.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

export const taskGetTool: Tool = {
  name: "TaskGet",

  description: "Get a single persistent task by ID, including dependency edges.",

  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "Task ID",
      },
    },
    required: ["id"],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const id = input.id as number;
    if (typeof id !== "number") {
      return { content: "id is required", isError: true };
    }

    const sessionId = context.sessionId ?? "default";
    const task = readTask(sessionId, id);
    if (!task) {
      return { content: `Task not found: ${id}`, isError: true };
    }

    const all = tasksById(sessionId);
    return {
      content: JSON.stringify(
        {
          ...task,
          status: effectiveStatus(task, all),
          ready: isReady(task, all),
        },
        null,
        2
      ),
    };
  },

  isReadOnly(): boolean {
    return true;
  },

  isEnabled(): boolean {
    return true;
  },
};
