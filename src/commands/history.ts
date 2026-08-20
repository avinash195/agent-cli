import { readdir, readFile } from "fs/promises";
import { join } from "path";

import { sessionsDir } from "../persistence/paths.js";
import type { TranscriptEntry } from "../persistence/types.js";

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  messageCount: number;
  totalTokens: number;
}

export async function listSessions(cwd: string): Promise<SessionSummary[]> {
  const dir = sessionsDir(cwd);

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;

    const raw = await readFile(join(dir, file), "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);

    let startedAt = "";
    let messageCount = 0;
    let totalTokens = 0;

    for (const line of lines) {
      const entry: TranscriptEntry = JSON.parse(line);

      if (entry.type === "session_meta") {
        startedAt = entry.startedAt;
      }
      if (entry.type === "message") {
        messageCount++;
      }
      if (entry.type === "usage") {
        totalTokens =
          entry.cumulative.inputTokens + entry.cumulative.outputTokens;
      }
    }

    summaries.push({
      sessionId: file.replace(".jsonl", ""),
      startedAt,
      messageCount,
      totalTokens,
    });
  }

  return summaries.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

export function formatSessionList(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return "No sessions found for this project.";
  }

  const lines = ["", "  Sessions for this project:", ""];

  for (const s of sessions) {
    const date = s.startedAt
      ? new Date(s.startedAt).toLocaleString()
      : "unknown";
    const id = s.sessionId.slice(0, 8);
    lines.push(
      `  ${id}...  ${date}  ${s.messageCount} msgs  ${s.totalTokens.toLocaleString()} tokens`
    );
  }

  lines.push("", "  Resume with: agent --resume <id>", "");
  return lines.join("\n");
}
