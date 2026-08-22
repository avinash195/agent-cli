import { existsSync, readdirSync, readFileSync, realpathSync } from "fs";
import { homedir } from "os";
import path from "path";
import matter from "gray-matter";

import type { SkillDefinition } from "./types.js";

const USER_SKILLS_DIR = path.join(homedir(), ".agent", "skills");
const PROJECT_SKILLS_DIR = path.join(".agent", "skills");

export function loadAllSkills(cwd: string): SkillDefinition[] {
  const userSkills = loadSkillsFromDir(USER_SKILLS_DIR, "user");
  const projectSkills = loadSkillsFromDir(
    path.join(cwd, PROJECT_SKILLS_DIR),
    "project"
  );

  const merged = new Map<string, SkillDefinition>();
  const seenPaths = new Set<string>();

  for (const skill of [...userSkills, ...projectSkills]) {
    if (seenPaths.has(skill.sourcePath)) continue;
    seenPaths.add(skill.sourcePath);
    merged.set(skill.name, skill);
  }

  return Array.from(merged.values());
}

function loadSkillsFromDir(
  dir: string,
  level: "user" | "project"
): SkillDefinition[] {
  if (!existsSync(dir)) return [];

  const skills: SkillDefinition[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const skillPath = path.join(dir, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;

    const skill = parseSkillFile(skillPath, level);
    if (skill) skills.push(skill);
  }

  return skills;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseSkillFile(
  filePath: string,
  level: "user" | "project"
): SkillDefinition | null {
  try {
    const resolved = realpathSync(filePath);
    const raw = readFileSync(resolved, "utf-8");
    const { data, content } = matter(raw);

    const name = typeof data.name === "string" ? data.name : "";
    const description =
      typeof data.description === "string" ? data.description : "";
    if (!name || !description) return null;

    const whenToUse =
      typeof data.when_to_use === "string"
        ? data.when_to_use
        : typeof data.whenToUse === "string"
          ? data.whenToUse
          : "";

    return {
      name,
      description,
      whenToUse,
      allowedTools: asStringArray(
        data["allowed-tools"] ?? data.allowed_tools ?? data.allowedTools
      ),
      paths: asStringArray(data.paths),
      body: content.trim(),
      sourcePath: resolved,
      level,
    };
  } catch {
    return null;
  }
}
