import type {
  JsonRpcMessage,
  JsonRpcResponse,
  McpTransport,
} from "./transport.js";

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const REQUEST_TIMEOUT_MS = 60_000;

export class McpClient {
  private requestId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly serverName: string,
    private readonly transport: McpTransport
  ) {
    this.transport.onMessage((msg: JsonRpcMessage) => {
      if (!("id" in msg) || msg.id === undefined) return;
      if (typeof msg.id !== "number") return;

      const handler = this.pending.get(msg.id);
      if (!handler) return;
      this.pending.delete(msg.id);
      clearTimeout(handler.timer);

      const response = msg as JsonRpcResponse;
      if (response.error) {
        handler.reject(new Error(`MCP error: ${response.error.message}`));
      } else {
        handler.resolve(response.result);
      }
    });
  }

  private request(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      this.transport.send({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agent-cli", version: "0.1.0" },
    });

    this.transport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = (await this.request("tools/list")) as {
      tools?: McpToolDescriptor[];
    };
    return result.tools ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ text: string; isError: boolean }> {
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    const text = (result.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("\n");

    return { text, isError: result.isError === true };
  }

  close(): void {
    for (const [, handler] of this.pending) {
      clearTimeout(handler.timer);
      handler.reject(new Error(`MCP server ${this.serverName} closed`));
    }
    this.pending.clear();
    this.transport.close();
  }
}
