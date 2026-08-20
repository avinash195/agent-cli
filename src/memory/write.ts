import fs from "fs";
import path from "path";

import { validateIndex } from "./index.js";
import type { MemoryFrontmatter } from "./types.js";

export interface WriteMemoryInput {
  name: string;
  description: string;
  type: MemoryFrontmatter["type"];
  content: string;
  directory?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateIndex(
  indexPath: string,
  entry: {
    name: string;
    file: string;
    description: string;
    isUpdate: boolean;
  }
): void {
  const newLine = `- [${entry.name}](${entry.file}) - ${entry.description}`;

  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      `# Project Memory\n\n${newLine}\n`,
      "utf-8"
    );
    return;
  }

  let content = fs.readFileSync(indexPath, "utf-8");

  if (entry.isUpdate) {
    const pattern = new RegExp(
      `^- \\[${escapeRegex(entry.name)}\\]\\(.*\\).*$`,
      "m"
    );
    if (pattern.test(content)) {
      content = content.replace(pattern, newLine);
    } else {
      content = content.trimEnd() + "\n" + newLine + "\n";
    }
  } else {
    content = content.trimEnd() + "\n" + newLine + "\n";
  }

  fs.writeFileSync(indexPath, content, "utf-8");
}

export function writeMemory(
  memoryDir: string,
  input: WriteMemoryInput
): string {
  const indexPath = path.join(memoryDir, "MEMORY.md");

  const fileName = `${input.name}.md`;
  const relPath = input.directory
    ? path.posix.join(input.directory, fileName)
    : fileName;
  const fullPath = path.join(memoryDir, relPath);

  const isUpdate = fs.existsSync(fullPath);

  const fileContent = [
    "---",
    `name: ${input.name}`,
    `description: ${input.description}`,
    `type: ${input.type}`,
    "---",
    "",
    input.content,
  ].join("\n");

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, fileContent, "utf-8");

  updateIndex(indexPath, {
    name: input.name,
    file: relPath,
    description: input.description,
    isUpdate,
  });

  const validation = validateIndex(indexPath);
  if (!validation.valid) {
    return `Memory saved to ${relPath}, but warning: ${validation.error}`;
  }

  return isUpdate
    ? `Updated memory: ${input.name}`
    : `Created memory: ${input.name}`;
}
