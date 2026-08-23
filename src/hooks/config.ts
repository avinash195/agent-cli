import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const DEFAULT_HOOK_TIMEOUT_MS = 10_000;

export const HOOK_CONTEXT_PREFIX = "<hook-context>\n";

export interface HookConfig {
  matcher: string;
  command: string[];
  timeout: number;
}

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "Stop"
  | "SubagentStop";

export interface HooksConfig {
  hooks?: Partial<Record<HookEvent, HookConfig[]>>;
}

const HOOK_EVENTS: HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "Stop",
  "SubagentStop",
];

interface RawHookConfig {
  matcher?: unknown;
  command?: unknown;
  timeout?: unknown;
}

interface SettingsFile {
  hooks?: Partial<Record<string, RawHookConfig[]>>;
}

export function isHookContextMessage(content: string): boolean {
  return content.startsWith(HOOK_CONTEXT_PREFIX);
}

export function wrapHookContext(text: string): string {
  return `${HOOK_CONTEXT_PREFIX}${text}`;
}

function loadSettingsFile(path: string): SettingsFile | null {
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SettingsFile;
  } catch {
    return null;
  }
}

function normalizeHook(raw: RawHookConfig): HookConfig | null {
  const command = Array.isArray(raw.command)
    ? raw.command.filter((part): part is string => typeof part === "string")
    : typeof raw.command === "string"
      ? [raw.command]
      : [];

  if (command.length === 0) return null;

  const timeout =
    typeof raw.timeout === "number" && raw.timeout > 0
      ? raw.timeout
      : DEFAULT_HOOK_TIMEOUT_MS;

  return {
    matcher: typeof raw.matcher === "string" ? raw.matcher : "",
    command,
    timeout,
  };
}

function hooksFromFile(file: SettingsFile | null): HooksConfig {
  const hooks: NonNullable<HooksConfig["hooks"]> = {};
  if (!file?.hooks) return { hooks };

  for (const event of HOOK_EVENTS) {
    const entries = file.hooks[event];
    if (!Array.isArray(entries)) continue;

    const normalized = entries
      .map(normalizeHook)
      .filter((hook): hook is HookConfig => hook !== null);

    if (normalized.length > 0) {
      hooks[event] = normalized;
    }
  }

  return { hooks };
}

function mergeHookLists(
  user: HookConfig[] | undefined,
  project: HookConfig[] | undefined
): HookConfig[] | undefined {
  const merged = [...(user ?? []), ...(project ?? [])];
  return merged.length > 0 ? merged : undefined;
}

export function loadHooks(): HooksConfig {
  const user = hooksFromFile(
    loadSettingsFile(join(homedir(), ".agent", "settings.json"))
  );
  const project = hooksFromFile(
    loadSettingsFile(join(process.cwd(), ".agent", "settings.json"))
  );

  const hooks: NonNullable<HooksConfig["hooks"]> = {};
  for (const event of HOOK_EVENTS) {
    const merged = mergeHookLists(
      user.hooks?.[event],
      project.hooks?.[event]
    );
    if (merged) hooks[event] = merged;
  }

  return { hooks };
}

export function getHooksForEvent(
  config: HooksConfig,
  event: HookEvent,
  toolName?: string
): HookConfig[] {
  const hooks = config.hooks?.[event] ?? [];

  if (!toolName) return hooks;

  return hooks.filter((h) => {
    if (!h.matcher) return true;
    try {
      return new RegExp(h.matcher).test(toolName);
    } catch {
      return false;
    }
  });
}
