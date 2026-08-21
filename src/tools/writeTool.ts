import { writeFile, mkdir, access } from "fs/promises";
import { dirname } from "path";

import { plansDir } from "../persistence/paths.js";
import { validatePath } from "../utils/paths.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export const writeTool: Tool = {
  name: "write_file",

  description:
    "Write content to a file. Creates the file and any parent directories if they don't exist. Overwrites existing content.",

  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file to write",
      },
      content: {
        type: "string",
        description: "The full content to write to the file",
      },
    },
    required: ["file_path", "content"],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const filePath = input.file_path as string;
    const content = input.content as string;

    try {
      const resolved = validatePath(filePath, context.cwd, [plansDir()]);
      const existed = await fileExists(resolved);

      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");

      return {
        content: existed
          ? `Updated file: ${filePath}`
          : `Created file: ${filePath}`,
      };
    } catch (error) {
      return {
        content:
          error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  },

  isReadOnly(): boolean {
    return false;
  },

  isEnabled(): boolean {
    return true;
  },
};
