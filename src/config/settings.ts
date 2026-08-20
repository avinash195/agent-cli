import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import {
  DEFAULT_ALLOW_RULES,
  DEFAULT_DENY_PATTERNS,
  parseDenyRuleString,
  parseRuleString,
  type AgentMode,
  type BashRule,
  type DenyRule,
  type PermissionRules,
} from "../permissions/permissions.js";

interface SettingsFile {
  mode?: AgentMode;
  allow?: string[];
  deny?: string[];
}

function loadJSON(path: string): SettingsFile | null {
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as SettingsFile;
  } catch {
    return null;
  }
}

function extractBashAllowRules(allowRules: string[]): BashRule[] {
  const bashRules: BashRule[] = [];

  for (const rule of allowRules) {
    const parsed = parseRuleString(rule);
    if (!parsed || parsed.tool.toLowerCase() !== "bash") continue;

    bashRules.push({ pattern: parsed.pattern, decision: "allow" });
  }

  return bashRules;
}

function mergeDenyRules(
  userDeny: string[],
  projectDeny: string[]
): DenyRule[] {
  const rules: DenyRule[] = [...DEFAULT_DENY_PATTERNS];

  for (const ruleStr of [...userDeny, ...projectDeny]) {
    const parsed = parseDenyRuleString(ruleStr);
    if (parsed) rules.push(parsed);
  }

  return rules;
}

export function loadRules(): PermissionRules {
  const userRules = loadJSON(join(homedir(), ".agent", "settings.json"));
  const projectRules = loadJSON(
    join(process.cwd(), ".agent", "settings.json")
  );

  const allow = [
    ...DEFAULT_ALLOW_RULES,
    ...(userRules?.allow ?? []),
    ...(projectRules?.allow ?? []),
  ];

  const deny = mergeDenyRules(
    userRules?.deny ?? [],
    projectRules?.deny ?? []
  );

  return {
    mode: projectRules?.mode ?? userRules?.mode ?? "default",
    allow,
    deny,
    bashAllow: extractBashAllowRules(allow),
  };
}
