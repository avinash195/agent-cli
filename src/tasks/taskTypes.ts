export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface Task {
  id: number;
  content: string;
  status: TaskStatus;
  blocks: number[];
  blockedBy: number[];
  createdAt: string;
  updatedAt: string;
  owner?: string;
}
