import { addDependency, updateTask } from "../tasks/taskGraph.js";
import type { TaskStatus } from "../tasks/taskTypes.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

const STATUSES: TaskStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
];

export const taskUpdateTool: Tool = {
  name: "TaskUpdate",

  description:
    "Update a persistent task by ID. Set status and/or content, " +
    "or add a dependency with addBlockedBy.",

  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "number",
        description: "Task ID",
      },
      content: {
        type: "string",
        description: "Updated imperative description",
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "blocked"],
      },
      addBlockedBy: {
        type: "number",
        description: "ID of a task this one should wait on",
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

    try {
      if (typeof input.addBlockedBy === "number") {
        addDependency(sessionId, id, input.addBlockedBy);
      }

      const status = input.status as TaskStatus | undefined;
      if (status && !STATUSES.includes(status)) {
        return { content: "Invalid status", isError: true };
      }

      const task = updateTask(sessionId, id, {
        content: typeof input.content === "string" ? input.content : undefined,
        status,
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
