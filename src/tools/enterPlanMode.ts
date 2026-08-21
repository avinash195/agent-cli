import { mkdirSync } from "fs";

import { plansDir } from "../persistence/paths.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

export const enterPlanModeTool: Tool = {
  name: "EnterPlanMode",

  description:
    "Switch to read-only exploration mode. Use this when a task is complex " +
    "enough to need a plan before execution. You'll be able to read and search " +
    "code but not modify anything except the plan file.",

  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },

  async call(
    _input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    mkdirSync(plansDir(), { recursive: true });
    context.setPermissionMode?.("plan");
    const planPath = context.getPlanFilePath?.();

    const content = [
      `Plan mode activated. You are now in read-only exploration mode.`,
      ``,
      `Plan file: ${planPath ?? "(unavailable)"}`,
      ``,
      `## Workflow`,
      `1. Use Read, grep, glob, and read-only bash to explore the codebase`,
      `2. Write your implementation plan to the plan file (${planPath})`,
      `3. The plan should include: approach, files to modify, risks, and order of changes`,
      `4. When the plan is complete, call ExitPlanMode to submit for approval`,
      ``,
      `## Constraints`,
      `- All write operations are blocked except writing to the plan file`,
      `- write_file, edit_file, write_memory, and destructive bash will be denied`,
      `- Focus on understanding the codebase before proposing changes`,
    ].join("\n");

    return { content };
  },

  isReadOnly(): boolean {
    return true;
  },

  isEnabled(): boolean {
    return true;
  },
};
