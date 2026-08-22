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
import { taskCreateTool } from "./taskCreateTool.js";
import { taskGetTool } from "./taskGetTool.js";
import { taskListTool } from "./taskListTool.js";
import { taskUpdateTool } from "./taskUpdateTool.js";
import { todoWriteTool } from "./todoWriteTool.js";
import { writeTool } from "./writeTool.js";

export type TaskMode = "todo" | "task";

const taskGraphTools: Tool[] = [
  taskCreateTool,
  taskUpdateTool,
  taskListTool,
  taskGetTool,
];

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
  todoWriteTool,
  ...taskGraphTools,
];

let externalTools: Tool[] = [];

function withTrackingTools(tools: Tool[], taskMode: TaskMode): Tool[] {
  const tracking = taskMode === "task" ? taskGraphTools : [todoWriteTool];
  return [...tools, ...tracking].filter((tool) => tool.isEnabled());
}

export function registerExternalTools(tools: Tool[]): void {
  externalTools = tools.filter((tool) => tool.isEnabled());
}

export function getTools(
  mode: AgentMode,
  taskMode: TaskMode = "todo"
): Tool[] {
  const base = [fileReadTool, grepTool, globTool, bashTool];

  const builtins =
    mode === "plan"
      ? withTrackingTools(
          [...base, writeTool, editTool, exitPlanModeTool],
          taskMode
        )
      : withTrackingTools(
          [...base, writeTool, editTool, memoryWriteTool, enterPlanModeTool],
          taskMode
        );

  if (mode === "plan") {
    return builtins;
  }

  return [...builtins, ...externalTools];
}

export function getAllTools(): Tool[] {
  return getTools("default");
}

export function findToolByName(name: string): Tool | undefined {
  return [...allTools, ...externalTools].find((tool) => tool.name === name);
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
