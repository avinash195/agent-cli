import { resolvePath } from "../utils/paths.js";
import { executeBash } from "./bashTool.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

export const globTool: Tool = {
  name: "glob",

  description:
    "Find files by name pattern. Returns matching file paths.",

  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "Glob pattern to match (e.g. '*.test.ts', 'src/**/*.json')",
      },
      path: {
        type: "string",
        description:
          "Directory to search in (default: project root)",
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

    const escapedPattern = pattern.replace(/'/g, "'\\''");

    const command =
      `rg --files --glob '${escapedPattern}' '${searchPath}' 2>/dev/null || ` +
      `find '${searchPath}' -name '${escapedPattern}' -type f 2>/dev/null || ` +
      `echo "(no matches)"`;

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
