import { execSync } from "child_process";
import os from "os";
import path from "path";

export interface EnvironmentContext {
  cwd: string;
  date: string;
  os: string;
  shell: string;
  git: GitContext | null;
}

export interface GitContext {
  branch: string;
  status: string;
  lastCommit: string;
}

export function gatherEnvironment(cwd: string): EnvironmentContext {
  return {
    cwd: path.resolve(cwd),
    date: new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    os: `${os.platform()} ${os.release()}`,
    shell: process.env.SHELL || "unknown",
    git: gatherGitContext(cwd),
  };
}

function gatherGitContext(cwd: string): GitContext | null {
  try {
    const run = (cmd: string) =>
      execSync(cmd, { cwd, encoding: "utf-8", timeout: 5000 }).trim();

    const branch = run("git rev-parse --abbrev-ref HEAD");
    const status = run("git status --short");
    const lastCommit = run("git log -1 --oneline");

    return { branch, status, lastCommit };
  } catch {
    return null;
  }
}

export function renderEnvironment(env: EnvironmentContext): string {
  const lines: string[] = [
    `# Environment`,
    `- Working directory: ${env.cwd}`,
    `- Date: ${env.date}`,
    `- OS: ${env.os}`,
    `- Shell: ${env.shell}`,
  ];

  if (env.git) {
    lines.push(
      ``,
      `# Git`,
      `- Branch: ${env.git.branch}`,
      `- Last commit: ${env.git.lastCommit}`
    );
    if (env.git.status) {
      lines.push(`- Uncommitted changes:`, "```", env.git.status, "```");
    } else {
      lines.push(`- Working tree clean`);
    }
  }

  return lines.join("\n");
}
