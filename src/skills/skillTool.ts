import { dirname } from "path";

import type { Tool, ToolContext, ToolResult } from "../tools/Tool.js";
import { setActiveSkillRestriction } from "./enforcement.js";
import type { SkillDefinition } from "./types.js";

export function substituteSkillBody(body: string, args: string, sourcePath: string): string {
  return body
    .replace(/\$ARGUMENTS/g, args)
    .replace(/\$\{SKILL_DIR\}/g, dirname(sourcePath));
}

export function formatSkillInstructions(
  skill: SkillDefinition,
  args: string
): string {
  const body = substituteSkillBody(skill.body, args, skill.sourcePath);
  const toolRestriction =
    skill.allowedTools.length > 0
      ? `\n\nTOOL RESTRICTION: For this skill, only use these tools: ${skill.allowedTools.join(", ")}`
      : "";

  return ["Follow these instructions carefully:", "", body, toolRestriction]
    .join("\n")
    .trim();
}

export function createSkillTool(skills: SkillDefinition[]): Tool {
  const skillMap = new Map(skills.map((s) => [s.name, s]));

  return {
    name: "Skill",
    description:
      "Invoke a skill by name. Returns the full skill instructions " +
      "for you to follow using your available tools.",

    inputSchema: {
      type: "object",
      properties: {
        skill: {
          type: "string",
          description: "The name of the skill to invoke",
        },
        arguments: {
          type: "string",
          description: "Optional arguments or context for the skill",
        },
      },
      required: ["skill"],
    },

    async call(
      input: Record<string, unknown>,
      _context: ToolContext
    ): Promise<ToolResult> {
      const name = input.skill as string;
      const args = (input.arguments as string) ?? "";

      const skill = skillMap.get(name);
      if (!skill) {
        const available = Array.from(skillMap.keys()).join(", ") || "(none)";
        return {
          content: `Unknown skill "${name}". Available: ${available}`,
          isError: true,
        };
      }

      setActiveSkillRestriction(skill.allowedTools);

      return {
        content: formatSkillInstructions(skill, args),
      };
    },

    isReadOnly(): boolean {
      return true;
    },

    isEnabled(): boolean {
      return true;
    },
  };
}
