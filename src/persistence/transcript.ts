import { mkdir, appendFile, writeFile } from "fs/promises";

import type { CompactionResult } from "../compression/compact.js";
import { sessionsDir, sessionPath, latestPath } from "./paths.js";
import type { TranscriptEntry } from "./types.js";

export async function appendTranscriptEntry(
  cwd: string,
  sessionId: string,
  entry: TranscriptEntry
): Promise<void> {
  const dir = sessionsDir(cwd);
  await mkdir(dir, { recursive: true });

  const filePath = sessionPath(cwd, sessionId);
  const line = JSON.stringify(entry) + "\n";

  await appendFile(filePath, line, "utf-8");
  await writeFile(latestPath(cwd), sessionId, "utf-8");
}

export async function appendCompactionToTranscript(
  cwd: string,
  sessionId: string,
  result: CompactionResult
): Promise<void> {
  await appendTranscriptEntry(cwd, sessionId, {
    type: "compaction",
    timestamp: new Date().toISOString(),
    tokensBefore: result.tokensBefore,
    tokensAfter: result.tokensAfter,
    summary: result.summary,
  });

  for (const msg of result.messages) {
    await appendTranscriptEntry(cwd, sessionId, {
      type: "message",
      timestamp: new Date().toISOString(),
      role: msg.role,
      message: msg,
    });
  }
}
