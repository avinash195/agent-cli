import type { Tool } from "./Tool.js";
import { fileReadTool } from "./fileReadTool.js";

const allTools: Tool[] = [
  fileReadTool,
];

export function getAllTools(): Tool[] {
  return allTools.filter((tool) =>
    tool.isEnabled()
  );
}

export function findToolByName(
  name: string
): Tool | undefined {
  return allTools.find(
    (tool) => tool.name === name
  );
}

export function getToolsApiParams(): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return getAllTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}