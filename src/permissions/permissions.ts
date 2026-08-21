import path from "path";

import { plansDir } from "../persistence/paths.js";
import { expandHome } from "../utils/paths.js";

export type AgentMode = "default" | "plan" | "auto";

export type PermissionDecisionType = "allow" | "ask" | "deny";

export interface PermissionDecision {
  decision: PermissionDecisionType;
  reason: string;
}

export interface DenyRule {
  tool: string;
  pattern: RegExp;
  reason: string;
}

export interface BashRule {
  pattern: string;
  decision: "allow" | "deny";
}

export interface PermissionRules {
  mode: AgentMode;
  allow: string[];
  deny: DenyRule[];
  bashAllow: BashRule[];
}

const READ_ONLY_TOOLS = new Set(["Read", "grep", "glob"]);

const BASH_READ_ONLY_COMMANDS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "pwd",
  "echo",
  "which",
  "whoami",
  "find",
  "grep",
  "rg",
  "wc",
  "du",
  "df",
  "file",
  "stat",
  "cd",
  "git status",
  "git log",
  "git diff",
  "git branch",
  "git remote -v",
  "node --version",
  "npm --version",
  "python --version",
]);

export const DEFAULT_ALLOW_RULES: string[] = [
  "bash(npm run *)",
  "bash(npm test*)",
  "bash(npm install*)",
  "bash(npm ci*)",
  "bash(npx *)",
  "bash(node *)",
  "bash(cd *)",
  "bash(git add *)",
  "bash(git commit *)",
  "bash(git checkout *)",
  "bash(git pull*)",
];

export const DEFAULT_DENY_PATTERNS: DenyRule[] = [
  {
    tool: "bash",
    pattern: /rm\s+-rf\s+[/~]/,
    reason: "Recursive delete on root or home",
  },
  {
    tool: "bash",
    pattern: /mkfs|format\s+[a-z]:/i,
    reason: "Disk format command",
  },
  {
    tool: "bash",
    pattern: /chmod\s+777\s+\//,
    reason: "World-writable root",
  },
  {
    tool: "bash",
    pattern: />\s*\/dev\/sd/,
    reason: "Direct disk write",
  },
];

export function isReadOnly(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

export function isPlanFileWrite(
  toolName: string,
  toolInput: Record<string, unknown>
): boolean {
  if (toolName !== "write_file" && toolName !== "edit_file") return false;

  const filePath = toolInput.file_path as string | undefined;
  if (!filePath) return false;

  const expanded = expandHome(filePath);
  const resolved = path.resolve(expanded);
  const plans = plansDir();
  const rel = path.relative(plans, resolved);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function globMatch(value: string, pattern: string): boolean {
  return globToRegExp(pattern).test(value);
}

export function parseRuleString(
  rule: string
): { tool: string; pattern: string } | null {
  const match = rule.match(/^(\w+)\((.+)\)$/);
  if (!match) return null;
  return { tool: match[1], pattern: match[2] };
}

export function parseDenyRuleString(rule: string): DenyRule | null {
  const parsed = parseRuleString(rule);
  if (!parsed) return null;

  return {
    tool: parsed.tool.toLowerCase(),
    pattern: globToRegExp(parsed.pattern),
    reason: `Matched deny rule: ${rule}`,
  };
}

export function matchesToolRule(
  rule: string,
  toolName: string,
  toolInput: Record<string, unknown>
): boolean {
  const parsed = parseRuleString(rule);
  if (!parsed) return false;
  if (parsed.tool.toLowerCase() !== toolName.toLowerCase()) return false;

  if (toolName === "bash") {
    const command = normalizeBashSegment(toolInput.command as string);
    return globMatch(command, parsed.pattern);
  }

  if (toolName === "write_file" || toolName === "edit_file") {
    return globMatch(toolInput.file_path as string, parsed.pattern);
  }

  if (toolName === "Read") {
    return globMatch(toolInput.file_path as string, parsed.pattern);
  }

  return parsed.pattern === "*";
}

export class SessionRules {
  private rules: string[] = [];

  add(pattern: string): void {
    this.rules.push(pattern);
  }

  matches(toolName: string, toolInput: Record<string, unknown>): boolean {
    for (const rule of this.rules) {
      if (matchesToolRule(rule, toolName, toolInput)) return true;
    }
    return false;
  }
}

export function normalizeBashSegment(command: string): string {
  return command
    .trim()
    .replace(/\s+\d*>&\d*\s*$/g, "")
    .replace(/\s+\d*>>?\s*[^\s|&;]+/g, "")
    .replace(/\s+<\s*[^\s|&;]+/g, "")
    .trim();
}

export function isBashReadOnly(command: string): boolean {
  const normalized = normalizeBashSegment(command);

  if (BASH_READ_ONLY_COMMANDS.has(normalized)) return true;

  for (const safe of BASH_READ_ONLY_COMMANDS) {
    if (normalized.startsWith(safe + " ") || normalized === safe) {
      return true;
    }
  }

  return false;
}

export function matchBashRule(
  command: string,
  rules: BashRule[]
): PermissionDecision | null {
  for (const rule of rules) {
    if (globMatch(command, rule.pattern)) {
      return {
        decision: rule.decision,
        reason: `Matched rule: bash(${rule.pattern})`,
      };
    }
  }
  return null;
}

function checkDenyRules(
  toolName: string,
  toolInput: Record<string, unknown>,
  denyRules: DenyRule[]
): PermissionDecision | null {
  const normalizedTool = toolName.toLowerCase();

  if (toolName === "bash") {
    const command = toolInput.command as string;
    const segments = command.split(/\s*(?:&&|\|\||\||;)\s*/);

    for (const segment of segments) {
      const trimmed = segment.trim();
      if (!trimmed) continue;

      for (const deny of denyRules) {
        if (
          deny.tool === normalizedTool &&
          deny.pattern.test(trimmed)
        ) {
          return { decision: "deny", reason: deny.reason };
        }
      }
    }
    return null;
  }

  for (const deny of denyRules) {
    if (deny.tool !== normalizedTool) continue;

    const value =
      (toolInput.file_path as string) ??
      (toolInput.command as string) ??
      "";

    if (deny.pattern.test(value)) {
      return { decision: "deny", reason: deny.reason };
    }
  }

  return null;
}

function checkAllowRules(
  toolName: string,
  toolInput: Record<string, unknown>,
  rules: PermissionRules,
  sessionRules: SessionRules
): PermissionDecision | null {
  if (sessionRules.matches(toolName, toolInput)) {
    return { decision: "allow", reason: "Session allow rule" };
  }

  for (const rule of rules.allow) {
    if (matchesToolRule(rule, toolName, toolInput)) {
      return { decision: "allow", reason: `Matched allow rule: ${rule}` };
    }
  }

  return null;
}

export function evaluateBashCommand(
  command: string,
  rules: PermissionRules,
  sessionRules: SessionRules
): PermissionDecision {
  const segments = command.split(/\s*(?:&&|\|\||\||;)\s*/);

  let maxRisk: "allow" | "ask" = "allow";

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const normalized = normalizeBashSegment(trimmed);

    for (const deny of rules.deny) {
      if (
        deny.tool === "bash" &&
        (deny.pattern.test(trimmed) || deny.pattern.test(normalized))
      ) {
        return { decision: "deny", reason: deny.reason };
      }
    }

    if (isBashReadOnly(trimmed)) continue;

    if (sessionRules.matches("bash", { command: trimmed })) continue;
    if (sessionRules.matches("bash", { command: normalized })) continue;

    const ruleMatch = matchBashRule(normalized, rules.bashAllow);
    if (ruleMatch?.decision === "allow") continue;
    if (ruleMatch?.decision === "deny") {
      return ruleMatch;
    }

    if (
      rules.allow.some((rule) =>
        matchesToolRule(rule, "bash", { command: normalized })
      )
    ) {
      continue;
    }

    maxRisk = "ask";
  }

  return {
    decision: maxRisk,
    reason:
      maxRisk === "allow"
        ? "All segments read-only or allowed"
        : "Contains unrecognized commands",
  };
}

export function evaluatePermission(
  toolName: string,
  toolInput: Record<string, unknown>,
  rules: PermissionRules,
  mode: AgentMode,
  sessionRules: SessionRules
): PermissionDecision {
  if (mode === "plan") {
    if (isReadOnly(toolName)) {
      return { decision: "allow", reason: "Read-only tool in plan mode" };
    }

    if (isPlanFileWrite(toolName, toolInput)) {
      return { decision: "allow", reason: "Writing to plan file" };
    }

    if (toolName === "bash" && isBashReadOnly(toolInput.command as string)) {
      return { decision: "allow", reason: "Read-only command in plan mode" };
    }

    if (toolName === "ExitPlanMode") {
      return { decision: "allow", reason: "Exiting plan mode" };
    }

    return { decision: "deny", reason: "Plan mode: write operations blocked" };
  }

  if (mode === "auto") {
    const denyCheck = checkDenyRules(toolName, toolInput, rules.deny);
    if (denyCheck) return denyCheck;
    return { decision: "allow", reason: "Auto mode" };
  }

  if (toolName === "bash") {
    const denyCheck = checkDenyRules(toolName, toolInput, rules.deny);
    if (denyCheck) return denyCheck;

    const allowCheck = checkAllowRules(
      toolName,
      toolInput,
      rules,
      sessionRules
    );
    if (allowCheck) return allowCheck;

    return evaluateBashCommand(
      toolInput.command as string,
      rules,
      sessionRules
    );
  }

  if (isReadOnly(toolName)) {
    return { decision: "allow", reason: "Read-only tool" };
  }

  const denyCheck = checkDenyRules(toolName, toolInput, rules.deny);
  if (denyCheck) return denyCheck;

  const allowCheck = checkAllowRules(
    toolName,
    toolInput,
    rules,
    sessionRules
  );
  if (allowCheck) return allowCheck;

  return {
    decision: "ask",
    reason: "No matching rule, requires confirmation",
  };
}
