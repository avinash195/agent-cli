import { matchesToolRule } from "../permissions/permissions.js";

let activeSkillRestriction: string[] | null = null;

export function setActiveSkillRestriction(allowedTools: string[]): void {
  if (allowedTools.length === 0) {
    activeSkillRestriction = null;
    return;
  }
  activeSkillRestriction = [...allowedTools];
}

export function clearActiveSkillRestriction(): void {
  activeSkillRestriction = null;
}

export function isToolAllowedBySkill(
  toolName: string,
  toolInput: Record<string, unknown>
): boolean {
  if (!activeSkillRestriction) return true;
  if (toolName === "Skill") return true;

  for (const allowed of activeSkillRestriction) {
    if (allowed.toLowerCase() === toolName.toLowerCase()) return true;

    const parenMatch = allowed.match(/^([\w*]+)\((.+)\)$/);
    if (parenMatch) {
      const allowedTool = parenMatch[1];
      if (allowedTool.toLowerCase() === toolName.toLowerCase()) {
        if (matchesToolRule(allowed, toolName, toolInput)) return true;
        const rewritten = `${toolName}(${parenMatch[2]})`;
        if (matchesToolRule(rewritten, toolName, toolInput)) return true;
      }
    }
  }

  return false;
}
