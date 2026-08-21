import type { AgentMode } from "../permissions/permissions.js";

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface PlanApprovalRequest {
  planPath: string;
  allowedPrompts: string[];
}

export interface ToolContext {
  cwd: string;
  abortSignal?: AbortSignal;
  sessionId?: string;
  setPermissionMode?: (mode: AgentMode) => void;
  getPlanFilePath?: () => string | null;
  requestPlanApproval?: (options: PlanApprovalRequest) => void;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  maxResultSizeChars?: number;

  call(
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;

  isReadOnly(): boolean;
  isEnabled(): boolean;
}