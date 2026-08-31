import { readFile } from "fs/promises";

import { sessionPath, latestPath } from "./paths.js";
import type { MessageEntry, TranscriptEntry, UsageEntry } from "./types.js";
import type { Message } from "../types/message.js";

export interface RestoredSession {
  sessionId: string;
  messages: Message[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

async function readLatest(cwd: string): Promise<string | null> {
  try {
    const content = await readFile(latestPath(cwd), "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

export async function restoreSession(
  cwd: string,
  sessionId?: string
): Promise<RestoredSession> {
  const id = sessionId ?? (await readLatest(cwd));

  if (!id) {
    throw new Error("No previous session found for this project.");
  }

  const filePath = sessionPath(cwd, id);
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);

  let lastCompactionIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed: TranscriptEntry = JSON.parse(lines[i]);
    if (parsed.type === "compaction") {
      lastCompactionIndex = i;
      break;
    }
  }

  const messages: Message[] = [];
  let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  for (let i = 0; i < lines.length; i++) {
    const entry: TranscriptEntry = JSON.parse(lines[i]);

    if (entry.type === "message" && i > lastCompactionIndex) {
      messages.push((entry as MessageEntry).message);
    }

    if (entry.type === "usage") {
      const cumulative = (entry as UsageEntry).cumulative;
      usage = {
        inputTokens: cumulative.inputTokens,
        outputTokens: cumulative.outputTokens,
        cacheReadTokens: cumulative.cacheReadTokens ?? 0,
      };
    }
  }

  return { sessionId: id, messages, usage };
}
