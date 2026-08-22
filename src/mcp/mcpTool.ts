import type { Tool, ToolContext, ToolResult } from "../tools/Tool.js";
import type { McpClient, McpToolDescriptor } from "./client.js";

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function createMcpTool(
  descriptor: McpToolDescriptor,
  client: McpClient,
  serverName: string
): Tool {
  const prefixedName = `mcp_${sanitizeSegment(serverName)}_${sanitizeSegment(descriptor.name)}`;

  return {
    name: prefixedName,
    description: `[MCP: ${serverName}] ${descriptor.description ?? descriptor.name}`,
    inputSchema: descriptor.inputSchema ?? {
      type: "object",
      properties: {},
    },

    async call(
      input: Record<string, unknown>,
      _context: ToolContext
    ): Promise<ToolResult> {
      try {
        const result = await client.callTool(descriptor.name, input);
        return {
          content: result.text || "(empty MCP result)",
          isError: result.isError,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `MCP tool error: ${message}`, isError: true };
      }
    },

    isReadOnly(): boolean {
      return false;
    },

    isEnabled(): boolean {
      return true;
    },
  };
}
