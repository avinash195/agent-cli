import { resolvePath } from "../utils/paths.js";
import { executeBash } from "./bashTool.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

export const grepTool: Tool = {
  name: "grep",

  description:
    "Search file contents for a pattern. Uses ripgrep if available, falls back to grep.",

  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The regex pattern to search for",
      },
      path: {
        type: "string",
        description:
          "Directory or file to search in (default: project root)",
      },
      include: {
        type: "string",
        description: "File pattern filter (e.g. '*.ts', '*.json')",
      },
    },
    required: ["pattern"],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const pattern = input.pattern as string;
    const searchPath = input.path
      ? resolvePath(input.path as string, context.cwd)
      : context.cwd;
    const include = input.include as string | undefined;

    const escapedPattern = pattern.replace(/'/g, "'\\''");
    const includeFlag = include ? `--glob '${include}'` : "";

    const command =
      `rg --line-number --no-heading --color never ` +
      `${includeFlag} '${escapedPattern}' '${searchPath}' 2>/dev/null || ` +
      `grep -rn '${escapedPattern}' '${searchPath}' ${
        include ? `--include='${include}'` : ""
      } 2>/dev/null || echo "(no matches)"`;

    try {
      const content = await executeBash({ command }, context.cwd);
      return { content };
    } catch (error) {
      return {
        content:
          error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  },

  isReadOnly(): boolean {
    return true;
  },

  isEnabled(): boolean {
    return true;
  },
};
