import { readFile } from "fs/promises";

import { validatePath } from "../utils/paths.js";
import type {
  Tool,
  ToolResult,
  ToolContext,
} from "./Tool.js";

function formatLines(
  content: string,
  offset: number,
  limit?: number
): string {
  const lines = content.split("\n");

  const start = Math.max(0, offset - 1);
  const end = limit
    ? Math.min(lines.length, start + limit)
    : lines.length;

  const sliced = lines.slice(start, end);

  const maxLineNum = end;
  const padWidth = String(maxLineNum).length;

  return sliced
    .map((line, i) => {
      const lineNum = String(start + i + 1).padStart(
        padWidth,
        " "
      );

      return `${lineNum}|${line}`;
    })
    .join("\n");
}

export const fileReadTool: Tool = {
  name: "Read",

  description:
    "Read the contents of a file from the local filesystem. " +
    "Returns the file content with line numbers. " +
    "Use offset and limit to read specific sections of large files.",

  inputSchema: {
    type: "object",

    properties: {
      file_path: {
        type: "string",
        description:
          "The path to the file to read. " +
          "Relative paths are resolved from the working directory.",
      },

      offset: {
        type: "integer",
        description:
          "Line number to start reading from (1-indexed). Defaults to 1.",
      },

      limit: {
        type: "integer",
        description:
          "Maximum number of lines to read. " +
          "If omitted, reads to end of file.",
      },
    },

    required: ["file_path"],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const filePath = input.file_path as string;
    const offset = (input.offset as number) || 1;
    const limit = input.limit as number | undefined;

    try {
      const absolutePath = validatePath(filePath, context.cwd);

      const content = await readFile(
        absolutePath,
        "utf-8"
      );

      const totalLines = content.split("\n").length;

      const formatted = formatLines(
        content,
        offset,
        limit
      );

      const header =
        `File: ${filePath} (${totalLines} lines total)`;

      return {
        content: `${header}\n${formatted}`,
      };
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        err.code === "ENOENT"
      ) {
        return {
          content: `File not found: ${filePath}`,
          isError: true,
        };
      }

      if (
        err instanceof Error &&
        "code" in err &&
        err.code === "EISDIR"
      ) {
        return {
          content: `${filePath} is a directory, not a file`,
          isError: true,
        };
      }

      const message =
        err instanceof Error
          ? err.message
          : String(err);

      return {
        content: `Error reading file: ${message}`,
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