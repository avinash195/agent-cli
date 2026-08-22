import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: "stdio" | "sse";
  url?: string;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

function loadSettingsFile(path: string): McpConfig | null {
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as McpConfig;
  } catch {
    return null;
  }
}

export function loadMcpConfig(): Record<string, McpServerConfig> {
  const user = loadSettingsFile(join(homedir(), ".agent", "settings.json"));
  const project = loadSettingsFile(join(process.cwd(), ".agent", "settings.json"));

  return {
    ...(user?.mcpServers ?? {}),
    ...(project?.mcpServers ?? {}),
  };
}
