import crypto from "crypto";
import path from "path";
import os from "os";

const AGENT_HOME = path.join(os.homedir(), ".agent");

export function projectHash(cwd: string): string {
  const resolved = path.resolve(cwd);
  return crypto.createHash("sha256").update(resolved).digest("hex").slice(0, 16);
}

export function sessionsDir(cwd: string): string {
  const hash = projectHash(cwd);
  return path.join(AGENT_HOME, "projects", hash, "sessions");
}

export function sessionPath(cwd: string, sessionId: string): string {
  return path.join(sessionsDir(cwd), `${sessionId}.jsonl`);
}

export function latestPath(cwd: string): string {
  const hash = projectHash(cwd);
  return path.join(AGENT_HOME, "projects", hash, "latest");
}

export function memoryDir(cwd: string): string {
  const hash = projectHash(cwd);
  return path.join(AGENT_HOME, "projects", hash, "memory");
}

export function plansDir(): string {
  return path.join(AGENT_HOME, "plans");
}

export function planFilePath(sessionId: string): string {
  return path.join(plansDir(), `${sessionId}.md`);
}

export function tasksDir(sessionId: string): string {
  return path.join(AGENT_HOME, "tasks", sessionId);
}

export { AGENT_HOME };
