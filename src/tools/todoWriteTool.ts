import { todoStore } from "../tasks/todoStore.js";
import {
  TODO_STATUSES,
  type TodoItem,
  type TodoStatus,
} from "../tasks/todoTypes.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

function parseTodos(input: Record<string, unknown>): TodoItem[] | string {
  if (!Array.isArray(input.todos)) {
    return "todos must be an array. Send the COMPLETE list every time.";
  }

  const todos: TodoItem[] = [];

  for (const item of input.todos) {
    if (!item || typeof item !== "object") {
      return "Each todo must be an object with content and status.";
    }

    const raw = item as Record<string, unknown>;
    if (typeof raw.content !== "string" || raw.content.trim() === "") {
      return "Each todo needs a non-empty content string (imperative sentence).";
    }

    if (
      typeof raw.status !== "string" ||
      !TODO_STATUSES.includes(raw.status as TodoStatus)
    ) {
      return 'status must be "pending", "in_progress", or "completed".';
    }

    todos.push({
      content: raw.content.trim(),
      status: raw.status as TodoStatus,
    });
  }

  return todos;
}

function formatChecklist(todos: TodoItem[]): string {
  return todos
    .map((t) => {
      const icon =
        t.status === "completed"
          ? "[x]"
          : t.status === "in_progress"
            ? "[>]"
            : "[ ]";
      return `${icon} ${t.content}`;
    })
    .join("\n");
}

export const todoWriteTool: Tool = {
  name: "TodoWrite",

  description:
    "Write or update the session task checklist. Send the COMPLETE list every time — " +
    "do not send partial updates or IDs. Use imperative sentences. " +
    "Statuses: pending, in_progress, completed. " +
    "Use this for multi-step work so you track progress instead of relying on memory.",

  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "Imperative sentence describing the task",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
            },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const parsed = parseTodos(input);
    if (typeof parsed === "string") {
      return { content: parsed, isError: true };
    }

    const sessionId = context.sessionId ?? "default";
    const allDone =
      parsed.length > 0 && parsed.every((t) => t.status === "completed");

    if (allDone) {
      todoStore.set(sessionId, []);
      return { content: "All tasks completed. Checklist cleared." };
    }

    todoStore.set(sessionId, parsed);
    return { content: `Checklist updated:\n${formatChecklist(parsed)}` };
  },

  isReadOnly(): boolean {
    return true;
  },

  isEnabled(): boolean {
    return true;
  },
};
