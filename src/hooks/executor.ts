import {
  getHooksForEvent,
  type HookEvent,
  type HooksConfig,
} from "./config.js";
import { runHook, type HookInput } from "./runner.js";

export interface HookEventResult {
  blocked: boolean;
  reason: string;
  injections: string[];
  warnings: string[];
}

export async function executeHooks(
  config: HooksConfig,
  event: HookEvent,
  input: HookInput,
  cwd: string
): Promise<HookEventResult> {
  const hooks = getHooksForEvent(config, event, input.toolName);

  if (hooks.length === 0) {
    return { blocked: false, reason: "", injections: [], warnings: [] };
  }

  const results = await Promise.all(
    hooks.map((hook) => runHook(hook, input, cwd))
  );

  const canBlock = event === "PreToolUse";
  const blockResult = canBlock
    ? results.find((r) => r.decision === "block")
    : undefined;

  const warnings = results
    .filter((r) => {
      if (r.decision === "warn") return true;
      if (r.decision === "block" && !canBlock) return true;
      return false;
    })
    .map((r) => r.reason)
    .filter(Boolean);

  const injections = results
    .filter((r) => r.inject)
    .map((r) => r.inject!);

  return {
    blocked: Boolean(blockResult),
    reason: blockResult?.reason ?? "",
    injections,
    warnings,
  };
}
