import { readFile, writeFile } from "fs/promises";

import { validatePath } from "../utils/paths.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

function normalizeQuotes(str: string): string {
  return str
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

export const editTool: Tool = {
  name: "edit_file",

  description:
    "Replace a specific string in a file with new content. The old_string must match exactly once in the file.",

  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file to edit",
      },
      old_string: {
        type: "string",
        description:
          "The exact string to find and replace. Must be unique in the file.",
      },
      new_string: {
        type: "string",
        description: "The string to replace old_string with",
      },
    },
    required: ["file_path", "old_string", "new_string"],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const filePath = input.file_path as string;
    const oldString = input.old_string as string;
    const newString = input.new_string as string;

    try {
      const resolved = validatePath(filePath, context.cwd);

      let content = await readFile(resolved, "utf-8");
      const oldStr = normalizeQuotes(oldString);
      const newStr = normalizeQuotes(newString);

      const occurrences = content.split(oldStr).length - 1;

      if (occurrences === 0) {
        const normalizedContent = normalizeQuotes(content);
        const normalizedOccurrences =
          normalizedContent.split(oldStr).length - 1;

        if (normalizedOccurrences === 1) {
          content = normalizedContent;
        } else {
          throw new Error(
            `old_string not found in ${filePath}. Make sure it matches the file content exactly.`
          );
        }
      }

      if (occurrences > 1) {
        throw new Error(
          `old_string appears ${occurrences} times in ${filePath}. ` +
            `Include more surrounding context to make the match unique.`
        );
      }

      const updated = content.replace(oldStr, newStr);
      await writeFile(resolved, updated, "utf-8");

      const oldLines = oldStr.split("\n").length;
      const newLines = newStr.split("\n").length;
      const diff = newLines - oldLines;
      const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : "0";

      return {
        content: `Edited ${filePath} (${diffStr} lines)`,
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
