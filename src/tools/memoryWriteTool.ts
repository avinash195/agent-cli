import { getMemoryDir } from "../memory/loader.js";
import { writeMemory, type WriteMemoryInput } from "../memory/write.js";
import type { MemoryFrontmatter } from "../memory/types.js";
import type { Tool, ToolContext, ToolResult } from "./Tool.js";

export const memoryWriteTool: Tool = {
  name: "write_memory",

  description:
    "Save a fact to long-term project memory. Check MEMORY.md index first " +
    "to avoid duplicates. If a memory with the same name exists, update it " +
    "instead of creating a new one.",

  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Kebab-case identifier for the memory (e.g. 'tests-need-real-db')",
      },
      description: {
        type: "string",
        description: "One-line summary that appears in the MEMORY.md index",
      },
      type: {
        type: "string",
        enum: ["user", "feedback", "project", "reference"],
        description:
          "Memory type: user (preferences), feedback (corrections/confirmations), " +
          "project (non-code facts), reference (external system pointers)",
      },
      content: {
        type: "string",
        description: "Full content of the memory with context and detail",
      },
      directory: {
        type: "string",
        description:
          "Optional subdirectory for organization (e.g. 'project', 'reference')",
      },
    },
    required: ["name", "description", "type", "content"],
  },

  async call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    try {
      const memoryInput: WriteMemoryInput = {
        name: input.name as string,
        description: input.description as string,
        type: input.type as MemoryFrontmatter["type"],
        content: input.content as string,
        directory: input.directory as string | undefined,
      };

      const result = writeMemory(getMemoryDir(context.cwd), memoryInput);
      return { content: result };
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
