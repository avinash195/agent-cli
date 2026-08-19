import { spawn } from "child_process";

import type { Tool, ToolContext, ToolResult } from "./Tool.js";

const OUTPUT_LIMIT = 30_000;
const DEFAULT_TIMEOUT = 120_000;

const READ_ONLY_COMMANDS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "find",
  "grep",
  "rg",
  "git status",
  "git log",
  "git diff",
  "git show",
  "git branch",
  "pwd",
  "echo",
  "which",
  "whoami",
  "date",
  "env",
  "printenv",
  "file",
  "stat",
  "du",
  "df",
  "uname",
  "hostname",
  "node --version",
  "npm list",
  "npx tsc --noEmit",
  "tree",
]);

export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();

  const segments = trimmed
    .split(/\s*&&\s*|\s*\|\|\s*|\s*;\s*|\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  return segments.every((segment) => {
    const base = segment.split(/\s+/)[0];
    if (READ_ONLY_COMMANDS.has(segment)) return true;
    if (READ_ONLY_COMMANDS.has(base)) return true;
    return false;
  });
}

function truncateOutput(output: string): string {
  if (output.length <= OUTPUT_LIMIT) return output;

  const half = Math.floor(OUTPUT_LIMIT / 2);
  const head = output.slice(0, half);
  const tail = output.slice(-half);
  const dropped = output.length - OUTPUT_LIMIT;

  return (
    head +
    `\n\n--- truncated ${dropped.toLocaleString()} characters ---\n\n` +
    tail
  );
}

export async function executeBash(
  input: { command: string; timeout?: number },
  cwd: string
): Promise<string> {
  const timeout = input.timeout ?? DEFAULT_TIMEOUT;

  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" ? "cmd" : "bash";
    const shellFlag = process.platform === "win32" ? "/c" : "-lc";

    const child = spawn(shell, [shellFlag, input.command], {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5_000);
      reject(
        new Error(
          `Command timed out after ${timeout / 1000}s: ${input.command}`
        )
      );
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);

      let output = "";
      if (stdout.trim()) output += stdout;
      if (stderr.trim()) {
        if (output) output += "\n";
        output += stderr;
      }

      output = truncateOutput(output || "(no output)");

      if (code !== 0) {
        output = `Exit code: ${code}\n${output}`;
      }

      resolve(output);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export const bashTool: Tool = {
  name: "bash",

  description:
    "Execute a shell command. Commands run in the project root directory.",

  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 120000)",
      },
    },
    required: ["command"],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    try {
      const content = await executeBash(
        {
          command: input.command as string,
          timeout: input.timeout as number | undefined,
        },
        context.cwd
      );
      return { content };
    } catch (error) {
      return {
        content:
          error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  },

  isReadOnly(): boolean {
    return false;
  },

  isEnabled(): boolean {
    return true;
  },
};
