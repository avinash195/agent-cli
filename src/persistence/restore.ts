import { readFile } from "fs/promises";

import { sessionPath, latestPath } from "./paths.js";
import type { MessageEntry, TranscriptEntry, UsageEntry } from "./types.js";
import type { Message } from "../types/message.js";

export interface RestoredSession {
  sessionId: string;
  messages: Message[];
  usage: { inputTokens: number; outputTokens: number };
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

  const messages: Message[] = [];
  let usage = { inputTokens: 0, outputTokens: 0 };

  for (const line of lines) {
    const entry: TranscriptEntry = JSON.parse(line);

    if (entry.type === "message") {
      messages.push((entry as MessageEntry).message);
    }

    if (entry.type === "usage") {
      usage = (entry as UsageEntry).cumulative;
    }
  }

  return { sessionId: id, messages, usage };
}
