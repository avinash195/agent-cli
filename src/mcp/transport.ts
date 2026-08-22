import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse;

export interface McpTransport {
  send(message: JsonRpcMessage): void;
  onMessage(handler: (message: JsonRpcMessage) => void): void;
  close(): void;
}

function encodeMessage(message: JsonRpcMessage): Buffer {
  const json = JSON.stringify(message);
  const body = Buffer.from(json, "utf-8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf-8");
  return Buffer.concat([header, body]);
}

export class MessageParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): JsonRpcMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: JsonRpcMessage[] = [];

    while (this.buffer.length > 0) {
      const framed = this.readContentLengthFrame();
      if (framed === "incomplete") break;
      if (framed) {
        messages.push(framed);
        continue;
      }

      const ndjson = this.readNdjsonLine();
      if (ndjson === "incomplete") break;
      if (ndjson) {
        messages.push(ndjson);
      }
    }

    return messages;
  }

  private readContentLengthFrame(): JsonRpcMessage | "incomplete" | null {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return null;

    const header = this.buffer.subarray(0, headerEnd).toString("utf-8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) return null;

    const length = Number.parseInt(match[1], 10);
    const start = headerEnd + 4;
    if (this.buffer.length < start + length) return "incomplete";

    const json = this.buffer.subarray(start, start + length).toString("utf-8");
    this.buffer = this.buffer.subarray(start + length);

    try {
      return JSON.parse(json) as JsonRpcMessage;
    } catch {
      return null;
    }
  }

  private readNdjsonLine(): JsonRpcMessage | "incomplete" | null {
    const nl = this.buffer.indexOf("\n");
    if (nl === -1) return "incomplete";

    const line = this.buffer.subarray(0, nl).toString("utf-8").trim();
    this.buffer = this.buffer.subarray(nl + 1);
    if (!line.startsWith("{")) return null;

    try {
      return JSON.parse(line) as JsonRpcMessage;
    } catch {
      return null;
    }
  }
}

export function createStdioTransport(
  command: string,
  args: string[],
  env: Record<string, string>
): McpTransport {
  const child: ChildProcess = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const emitter = new EventEmitter();
  const parser = new MessageParser();

  child.stdout?.on("data", (chunk: Buffer) => {
    for (const message of parser.push(chunk)) {
      emitter.emit("message", message);
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[mcp:stderr] ${chunk.toString()}`);
  });

  child.on("error", (error) => {
    process.stderr.write(`[mcp] spawn error: ${error.message}\n`);
  });

  return {
    send(message: JsonRpcMessage) {
      child.stdin?.write(encodeMessage(message));
    },
    onMessage(handler) {
      emitter.on("message", handler);
    },
    close() {
      child.kill("SIGTERM");
    },
  };
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

export function createSseTransport(url: string): McpTransport {
  const emitter = new EventEmitter();
  const abort = new AbortController();
  let postEndpoint = "";
  const queue: JsonRpcMessage[] = [];

  function flushQueue() {
    while (postEndpoint && queue.length > 0) {
      const message = queue.shift();
      if (!message) break;
      void fetch(postEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      }).catch((error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[mcp:sse] post failed: ${text}\n`);
      });
    }
  }

  void (async () => {
    try {
      const response = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal: abort.signal,
      });

      if (!response.body) {
        throw new Error("SSE response has no body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const parsed = parseSseBlock(block);
          if (!parsed) continue;

          if (parsed.event === "endpoint") {
            postEndpoint = new URL(parsed.data, url).toString();
            flushQueue();
            continue;
          }

          try {
            const message = JSON.parse(parsed.data) as JsonRpcMessage;
            emitter.emit("message", message);
          } catch {
            // malformed SSE payload
          }
        }
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      const text = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[mcp:sse] ${text}\n`);
    }
  })();

  return {
    send(message: JsonRpcMessage) {
      queue.push(message);
      flushQueue();
    },
    onMessage(handler) {
      emitter.on("message", handler);
    },
    close() {
      abort.abort();
    },
  };
}
