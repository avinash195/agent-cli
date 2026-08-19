import type { Tool } from "./Tool.js";
import { bashTool } from "./bashTool.js";
import { editTool } from "./editTool.js";
import { fileReadTool } from "./fileReadTool.js";
import { globTool } from "./globTool.js";
import { grepTool } from "./grepTool.js";
import { writeTool } from "./writeTool.js";

const allTools: Tool[] = [
  fileReadTool,
  writeTool,
  editTool,
  bashTool,
  grepTool,
  globTool,
];

export function getAllTools(): Tool[] {
  return allTools.filter((tool) => tool.isEnabled());
}

export function findToolByName(name: string): Tool | undefined {
  return allTools.find((tool) => tool.name === name);
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

export { isReadOnlyCommand } from "./bashTool.js";
