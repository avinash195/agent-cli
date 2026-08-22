import { minimatch } from "minimatch";

import type { SkillDefinition } from "./types.js";

export function filterActiveSkills(
  skills: SkillDefinition[],
  touchedPaths: string[],
  activated: Set<string>
): SkillDefinition[] {
  return skills.filter((skill) => {
    if (skill.paths.length === 0) return true;
    if (activated.has(skill.name)) return true;

    const matches = touchedPaths.some((filePath) =>
      skill.paths.some((pattern) => minimatch(filePath, pattern))
    );

    if (matches) {
      activated.add(skill.name);
    }

    return matches;
  });
}
