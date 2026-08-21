import {
  effectiveStatus,
  isReady,
  listTasks,
  tasksById,
} from "../tasks/taskGraph.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

export const taskListTool: Tool = {
  name: "TaskList",

  description:
    "List persistent tasks for this session. " +
    "Pass readyOnly=true to get only tasks that can start now " +
    "(pending, with all dependencies completed).",

  inputSchema: {
    type: "object",
    properties: {
      readyOnly: {
        type: "boolean",
        description: "If true, only return tasks that are ready to start",
      },
    },
    required: [],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const sessionId = context.sessionId ?? "default";
    const all = tasksById(sessionId);
    let tasks = listTasks(sessionId).map((task) => ({
      ...task,
      status: effectiveStatus(task, all),
      ready: isReady(task, all),
    }));

    if (input.readyOnly === true) {
      tasks = tasks.filter((task) => task.ready);
    }

    if (tasks.length === 0) {
      return { content: "No tasks." };
    }

    return { content: JSON.stringify(tasks, null, 2) };
  },

  isReadOnly(): boolean {
    return true;
  },

  isEnabled(): boolean {
    return true;
  },
};
