import { mkdir, appendFile, writeFile } from "fs/promises";

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
