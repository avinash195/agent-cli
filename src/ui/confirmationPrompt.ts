import chalk from "chalk";
import readline from "readline";

export type PermissionResponse = "allow_once" | "deny" | "always_allow";

export interface ConfirmationPrompt {
  toolName: string;
  summary: string;
  risk: string;
}

export type PermissionPromptFn = (
  prompt: ConfirmationPrompt
) => Promise<PermissionResponse>;

export function summarizeToolCall(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "bash":
      return `Run: ${input.command as string}`;

    case "write_file": {
      const path = input.file_path as string;
      const content = input.content as string;
      const lines = content.split("\n").length;
      return `Write ${lines} line${lines === 1 ? "" : "s"} to ${path}`;
    }

    case "edit_file": {
      const path = input.file_path as string;
      const oldStr = (input.old_string as string) ?? "";
      const preview =
        oldStr.length > 40 ? oldStr.slice(0, 40) + "…" : oldStr;
      return `Edit ${path}: replace "${preview}"`;
    }

    case "write_memory":
      return `Save memory: ${input.name as string}`;

    case "Read":
      return `Read ${input.file_path as string}`;

    default:
      return `${toolName}(${JSON.stringify(input).slice(0, 80)})`;
  }
}

export function inferPattern(
  toolName: string,
  toolInput: Record<string, unknown>
): string {
  if (toolName === "bash") {
    const command = toolInput.command as string;
    const firstWord = command.split(/\s/)[0];
    return `bash(${firstWord} *)`;
  }

  if (toolName === "write_file" || toolName === "edit_file") {
    const path = toolInput.file_path as string;
    const lastSlash = path.lastIndexOf("/");
    const dir = lastSlash >= 0 ? path.substring(0, lastSlash) : ".";
    return `${toolName}(${dir}/*)`;
  }

  return `${toolName}(*)`;
}

async function readSingleKey(): Promise<string> {
  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.resume();

    const onKey = (
      str: string,
      key: readline.Key
    ) => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);

      if (key.ctrl && key.name === "c") {
        resolve("n");
        return;
      }

      resolve(str || key.name || "");
    };

    process.stdin.on("keypress", onKey);
  });
}

export async function promptUser(
  prompt: ConfirmationPrompt
): Promise<PermissionResponse> {
  console.log(`\n${chalk.yellow("⚠")} Permission required`);
  console.log(`  Tool: ${chalk.bold(prompt.toolName)}`);
  console.log(`  Action: ${prompt.summary}`);
  console.log(`  Risk: ${chalk.dim(prompt.risk)}`);
  console.log();
  console.log(`  ${chalk.green("[y]")} allow once`);
  console.log(`  ${chalk.red("[n]")} deny`);
  console.log(`  ${chalk.blue("[a]")} always allow this pattern`);

  const key = await readSingleKey();

  switch (key.toLowerCase()) {
    case "y":
      return "allow_once";
    case "n":
      return "deny";
    case "a":
      return "always_allow";
    default:
      return "deny";
  }
}

export function createTerminalPermissionPrompt(): PermissionPromptFn {
  return promptUser;
}
