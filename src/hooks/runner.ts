import { spawn } from "child_process";
import { DEFAULT_HOOK_TIMEOUT_MS, type HookConfig } from "./config.js";

export interface HookInput {
  event: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  userPrompt?: string;
}

export interface HookOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  decision: "pass" | "block" | "warn";
  reason: string;
  inject?: string;
}

export async function runHook(
  hook: HookConfig,
  input: HookInput,
  cwd: string
): Promise<HookOutput> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (output: HookOutput) => {
      if (settled) return;
      settled = true;
      resolve(output);
    };

    const timeoutMs =
      hook.timeout > 0 ? hook.timeout : DEFAULT_HOOK_TIMEOUT_MS;

    const child = spawn(hook.command[0], hook.command.slice(1), {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      child.stdin?.write(JSON.stringify(input));
      child.stdin?.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finish({
        exitCode: 1,
        stdout: "",
        stderr: message,
        decision: "warn",
        reason: `Hook failed to run: ${message}`,
      });
      return;
    }

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        exitCode: 1,
        stdout: "",
        stderr: `Hook timed out after ${timeoutMs}ms`,
        decision: "warn",
        reason: "Hook timed out",
      });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;

      let decision: "pass" | "block" | "warn";
      let reason = "";
      let inject: string | undefined;

      if (exitCode === 0) {
        decision = "pass";
      } else if (exitCode === 2) {
        decision = "block";
      } else {
        decision = "warn";
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as {
          decision?: "pass" | "block" | "warn";
          reason?: string;
          message?: string;
        };
        if (parsed.decision) decision = parsed.decision;
        if (parsed.reason) reason = parsed.reason;
        if (parsed.message) inject = parsed.message;
      } catch {
        reason = stdout.trim() || stderr.trim();
      }

      finish({ exitCode, stdout, stderr, decision, reason, inject });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      finish({
        exitCode: 1,
        stdout: "",
        stderr: err.message,
        decision: "warn",
        reason: `Hook failed to run: ${err.message}`,
      });
    });
  });
}
