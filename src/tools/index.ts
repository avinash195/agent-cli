import type { AgentMode } from "../permissions/permissions.js";
import type { Tool } from "./Tool.js";
import { bashTool } from "./bashTool.js";
import { editTool } from "./editTool.js";
import { enterPlanModeTool } from "./enterPlanMode.js";
import { exitPlanModeTool } from "./exitPlanMode.js";
import { fileReadTool } from "./fileReadTool.js";
import { globTool } from "./globTool.js";
import { grepTool } from "./grepTool.js";
import { memoryWriteTool } from "./memoryWriteTool.js";
import { writeTool } from "./writeTool.js";

const allTools: Tool[] = [
  fileReadTool,
  writeTool,
  editTool,
  memoryWriteTool,
  bashTool,
  grepTool,
  globTool,
  enterPlanModeTool,
  exitPlanModeTool,
];

export function getTools(mode: AgentMode): Tool[] {
  const base = [fileReadTool, grepTool, globTool, bashTool];

  if (mode === "plan") {
    return [...base, writeTool, editTool, exitPlanModeTool].filter((tool) =>
      tool.isEnabled()
    );
  }

  return [
    ...base,
    writeTool,
    editTool,
    memoryWriteTool,
    enterPlanModeTool,
  ].filter((tool) => tool.isEnabled());
}

export function getAllTools(): Tool[] {
  return getTools("default");
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
