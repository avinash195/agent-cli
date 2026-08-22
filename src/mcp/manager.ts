import type { Tool } from "../tools/Tool.js";
import { McpClient } from "./client.js";
import { loadMcpConfig, type McpServerConfig } from "./config.js";
import { createMcpTool } from "./mcpTool.js";
import { createSseTransport, createStdioTransport } from "./transport.js";

export class McpManager {
  private readonly clients = new Map<string, McpClient>();

  async initialize(): Promise<Tool[]> {
    const configs = loadMcpConfig();
    const allTools: Tool[] = [];

    for (const [name, config] of Object.entries(configs)) {
      try {
        const client = await this.connectServer(name, config);
        this.clients.set(name, client);

        const descriptors = await client.listTools();
        const tools = descriptors.map((d) => createMcpTool(d, client, name));
        allTools.push(...tools);

        process.stderr.write(
          `[mcp] ${name}: ${descriptors.length} tools registered\n`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mcp] ${name}: failed to connect - ${message}\n`);
      }
    }

    return allTools;
  }

  private async connectServer(
    name: string,
    config: McpServerConfig
  ): Promise<McpClient> {
    const transport =
      config.type === "sse" && config.url
        ? createSseTransport(config.url)
        : createStdioTransport(
            config.command ?? "npx",
            config.args ?? [],
            config.env ?? {}
          );

    const client = new McpClient(name, transport);
    try {
      await client.initialize();
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    for (const [name, client] of this.clients) {
      client.close();
      process.stderr.write(`[mcp] ${name}: disconnected\n`);
    }
    this.clients.clear();
  }
}
