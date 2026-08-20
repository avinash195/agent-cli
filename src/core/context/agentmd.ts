import fs from "fs";
import path from "path";
import os from "os";

export interface AgentMemoryFile {
  path: string;
  content: string;
  level: "user" | "project" | "directory";
}

export function loadAgentMemory(cwd: string): AgentMemoryFile[] {
  const files: AgentMemoryFile[] = [];

  const userPath = path.join(os.homedir(), ".agent", "AGENT.md");
  const userContent = safeRead(userPath);
  if (userContent) {
    files.push({
      path: userPath,
      content: stripComments(userContent),
      level: "user",
    });
  }

  const projectRoot = findProjectRoot(cwd);
  if (projectRoot) {
    const rootPath = path.join(projectRoot, "AGENT.md");
    const rootContent = safeRead(rootPath);
    if (rootContent) {
      files.push({
        path: rootPath,
        content: stripComments(rootContent),
        level: "project",
      });
    }

    if (cwd !== projectRoot) {
      const cwdPath = path.join(cwd, "AGENT.md");
      const cwdContent = safeRead(cwdPath);
      if (cwdContent) {
        files.push({
          path: cwdPath,
          content: stripComments(cwdContent),
          level: "directory",
        });
      }
    }
  }

  return files;
}

function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function stripComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
}

function findProjectRoot(dir: string): string | null {
  let current = path.resolve(dir);
  while (true) {
    if (
      fs.existsSync(path.join(current, "package.json")) ||
      fs.existsSync(path.join(current, ".git"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function renderAgentMemory(files: AgentMemoryFile[]): string {
  if (files.length === 0) return "";

  const sections = files.map(
    (f) => `## Rules from ${f.path}\n\n${f.content}`
  );

  return `# Project Memory (AGENT.md)\n\n${sections.join("\n\n")}`;
}
