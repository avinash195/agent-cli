import type { TodoItem } from "./todoTypes.js";

export type TodoSubscriber = (todos: TodoItem[]) => void;

export class TodoStore {
  private state = new Map<string, TodoItem[]>();
  private subscribers = new Map<string, Set<TodoSubscriber>>();

  get(sessionId: string): TodoItem[] {
    return this.state.get(sessionId) ?? [];
  }

  set(sessionId: string, todos: TodoItem[]): void {
    this.state.set(sessionId, todos);
    this.notify(sessionId, todos);
  }

  subscribe(sessionId: string, fn: TodoSubscriber): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
    }
    this.subscribers.get(sessionId)!.add(fn);
    return () => {
      this.subscribers.get(sessionId)?.delete(fn);
    };
  }

  private notify(sessionId: string, todos: TodoItem[]): void {
    const subs = this.subscribers.get(sessionId);
    if (!subs) return;
    for (const fn of subs) fn(todos);
  }
}

export const todoStore = new TodoStore();
