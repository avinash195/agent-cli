import fs from "fs";
import path from "path";

import { memoryDir as getMemoryDirPath } from "../persistence/paths.js";

export function getMemoryDir(cwd: string): string {
  return getMemoryDirPath(cwd);
}

export function loadMemoryIndex(cwd: string): string | null {
  const dir = getMemoryDir(cwd);
  const indexPath = path.join(dir, "MEMORY.md");

  try {
    const content = fs.readFileSync(indexPath, "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

export function renderMemorySection(
  index: string,
  memoryDirPath: string
): string {
  return [
    `# Project Memory`,
    ``,
    `The following memories are stored for this project.`,
    `Read individual files with the Read tool when relevant to the current task.`,
    `Memory directory: ${memoryDirPath}`,
    ``,
    index,
  ].join("\n");
}
