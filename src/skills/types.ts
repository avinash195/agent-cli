export interface SkillDefinition {
  name: string;
  description: string;
  whenToUse: string;
  allowedTools: string[];
  paths: string[];
  body: string;
  sourcePath: string;
  level: "user" | "project";
}
