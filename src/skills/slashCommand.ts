import type { Message } from "../types/message.js";
import { formatSkillInstructions } from "./skillTool.js";
import type { SkillDefinition } from "./types.js";

export const SKILL_BODY_HIDDEN_PREFIX = "\x00skill_body\x00";

export function isSkillBodyMessage(content: string): boolean {
  return content.startsWith(SKILL_BODY_HIDDEN_PREFIX);
}

const BUILTIN_SLASH = new Set([
  "help",
  "clear",
  "cost",
  "compact",
  "model",
  "history",
  "memory",
  "tasks",
]);

export function expandSlashCommand(
  input: string,
  skills: SkillDefinition[]
): { visible: Message; hidden: Message; skill: SkillDefinition } | null {
  if (!input.startsWith("/")) return null;

  const parts = input.slice(1).split(/\s+/);
  const commandName = parts[0];
  if (!commandName || BUILTIN_SLASH.has(commandName)) return null;

  const skill = skills.find((s) => s.name === commandName);
  if (!skill) return null;

  const args = parts.slice(1).join(" ");

  return {
    skill,
    visible: { role: "user", content: input },
    hidden: {
      role: "user",
      content: SKILL_BODY_HIDDEN_PREFIX + formatSkillInstructions(skill, args),
    },
  };
}
