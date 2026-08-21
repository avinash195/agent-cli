import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import { lockSync } from "proper-lockfile";

import { tasksDir } from "../persistence/paths.js";
import type { Task } from "./taskTypes.js";

export function getTaskDir(sessionId: string): string {
  const dir = tasksDir(sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function taskPath(sessionId: string, id: number): string {
  return path.join(getTaskDir(sessionId), `${id}.json`);
}

function highwatermarkPath(sessionId: string): string {
  return path.join(getTaskDir(sessionId), ".highwatermark");
}

export function allocateId(sessionId: string): number {
  const hwmPath = highwatermarkPath(sessionId);

  if (!existsSync(hwmPath)) {
    writeFileSync(hwmPath, "0", "utf-8");
  }

  const release = lockSync(hwmPath);
  try {
    const current = parseInt(readFileSync(hwmPath, "utf-8").trim(), 10) || 0;
    const next = current + 1;
    writeFileSync(hwmPath, String(next), "utf-8");
    return next;
  } finally {
    release();
  }
}

export function writeTask(sessionId: string, task: Task): void {
  const dir = getTaskDir(sessionId);
  const filePath = taskPath(sessionId, task.id);
  const release = lockSync(dir, { lockfilePath: `${filePath}.lock` });
  try {
    writeFileSync(filePath, JSON.stringify(task, null, 2), "utf-8");
  } finally {
    release();
  }
}

export function readTask(sessionId: string, id: number): Task | null {
  const filePath = taskPath(sessionId, id);
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Task;
  } catch {
    return null;
  }
}

export function listTasks(sessionId: string): Task[] {
  const dir = getTaskDir(sessionId);
  const files = readdirSync(dir).filter((name) => /^\d+\.json$/.test(name));
  const tasks: Task[] = [];

  for (const file of files) {
    const id = parseInt(file.replace(/\.json$/, ""), 10);
    const task = readTask(sessionId, id);
    if (task) tasks.push(task);
  }

  return tasks.sort((a, b) => a.id - b.id);
}

export function tasksById(sessionId: string): Map<number, Task> {
  const map = new Map<number, Task>();
  for (const task of listTasks(sessionId)) {
    map.set(task.id, task);
  }
  return map;
}

export function isReady(task: Task, allTasks: Map<number, Task>): boolean {
  if (task.status !== "pending" && task.status !== "blocked") return false;

  return task.blockedBy.every((depId) => {
    const dep = allTasks.get(depId);
    return dep?.status === "completed";
  });
}

export function effectiveStatus(task: Task, allTasks: Map<number, Task>): Task["status"] {
  if (task.status === "pending" && !isReady(task, allTasks) && task.blockedBy.length > 0) {
    return "blocked";
  }
  return task.status === "blocked" && isReady(task, allTasks) ? "pending" : task.status;
}

function wouldCreateCycle(
  sessionId: string,
  taskId: number,
  dependsOnId: number
): boolean {
  if (taskId === dependsOnId) return true;

  const visited = new Set<number>();
  const stack = [dependsOnId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const task = readTask(sessionId, current);
    if (!task) continue;
    for (const depId of task.blockedBy) {
      stack.push(depId);
    }
  }

  return false;
}

export function addDependency(
  sessionId: string,
  taskId: number,
  dependsOnId: number
): void {
  const task = readTask(sessionId, taskId);
  const dependency = readTask(sessionId, dependsOnId);

  if (!task || !dependency) {
    throw new Error(`Task not found: ${!task ? taskId : dependsOnId}`);
  }

  if (task.blockedBy.includes(dependsOnId)) return;

  if (wouldCreateCycle(sessionId, taskId, dependsOnId)) {
    throw new Error(
      `Adding dependency ${taskId} -> ${dependsOnId} would create a cycle`
    );
  }

  const now = new Date().toISOString();
  task.blockedBy = [...task.blockedBy, dependsOnId];
  task.updatedAt = now;
  dependency.blocks = [...dependency.blocks, taskId];
  dependency.updatedAt = now;

  writeTask(sessionId, task);
  writeTask(sessionId, dependency);
}

export function createTask(
  sessionId: string,
  content: string,
  options: { blockedBy?: number[]; owner?: string } = {}
): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: allocateId(sessionId),
    content,
    status: "pending",
    blocks: [],
    blockedBy: [],
    createdAt: now,
    updatedAt: now,
    owner: options.owner,
  };

  writeTask(sessionId, task);

  for (const depId of options.blockedBy ?? []) {
    addDependency(sessionId, task.id, depId);
  }

  return readTask(sessionId, task.id) ?? task;
}

export function updateTask(
  sessionId: string,
  id: number,
  patch: { content?: string; status?: Task["status"] }
): Task {
  const task = readTask(sessionId, id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }

  if (patch.status === "in_progress") {
    const all = tasksById(sessionId);
    const blocked = task.blockedBy.some(
      (depId) => all.get(depId)?.status !== "completed"
    );
    if (blocked) {
      throw new Error(`Task ${id} is blocked by incomplete dependencies`);
    }
  }

  if (patch.content !== undefined) task.content = patch.content;
  if (patch.status !== undefined) {
    task.status = patch.status === "blocked" ? "pending" : patch.status;
  }
  task.updatedAt = new Date().toISOString();
  writeTask(sessionId, task);
  return task;
}

export function resetTaskGraph(sessionId: string): void {
  const dir = getTaskDir(sessionId);
  if (!existsSync(dir)) return;

  for (const file of readdirSync(dir)) {
    unlinkSync(path.join(dir, file));
  }
}
