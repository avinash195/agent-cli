export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export const TODO_STATUSES: TodoStatus[] = [
  "pending",
  "in_progress",
  "completed",
];
