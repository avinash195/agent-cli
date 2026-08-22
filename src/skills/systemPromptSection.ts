import { filterActiveSkills } from "./activation.js";
import type { SkillDefinition } from "./types.js";

const SKILL_BUDGET = 8_000;

export function renderSkillsForPrompt(
  skills: SkillDefinition[],
  touchedPaths: string[],
  activated: Set<string>
): string {
  const active = filterActiveSkills(skills, touchedPaths, activated);
  if (active.length === 0) return "";

  const fullEntries = active.map(
    (s) =>
      `- **${s.name}**: ${s.description}` +
      (s.whenToUse ? ` (use when: ${s.whenToUse})` : "")
  );
  const fullText = fullEntries.join("\n");
  if (fullText.length <= SKILL_BUDGET) {
    return buildSection(fullText, active.length);
  }

  const shortEntries = active.map((s) => `- **${s.name}**: ${s.description}`);
  const shortText = shortEntries.join("\n");
  if (shortText.length <= SKILL_BUDGET) {
    return buildSection(shortText, active.length);
  }

  const namesOnly = active.map((s) => `- ${s.name}`).join("\n");
  return buildSection(namesOnly.slice(0, SKILL_BUDGET), active.length);
}

function buildSection(content: string, count: number): string {
  return [
    `# Available Skills (${count})`,
    ``,
    `Use Skill(skill="name") to invoke a skill. The full instructions will be provided.`,
    `You can also invoke a skill with /name in chat.`,
    ``,
    content,
  ].join("\n");
}
