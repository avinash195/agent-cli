import type { Message } from "../types/message.js";

export interface SessionMetaEntry {
  type: "session_meta";
  sessionId: string;
  cwd: string;
  startedAt: string;
  model: string;
}

export interface MessageEntry {
  type: "message";
  timestamp: string;
  role: "user" | "assistant";
  message: Message;
}

export interface ToolEventEntry {
  type: "tool_event";
  timestamp: string;
  name: string;
  phase: "start" | "done";
  resultLength?: number;
  isError?: boolean;
}

export interface UsageEntry {
  type: "usage";
  timestamp: string;
  turn: { inputTokens: number; outputTokens: number };
  cumulative: { inputTokens: number; outputTokens: number };
}

export interface SystemEntry {
  type: "system";
  timestamp: string;
  level: "info" | "error";
  event: string;
  detail?: string;
}

export interface CompactionEntry {
  type: "compaction";
  timestamp: string;
  tokensBefore: number;
  tokensAfter: number;
  summary: string;
}

export type TranscriptEntry =
  | SessionMetaEntry
  | MessageEntry
  | ToolEventEntry
  | UsageEntry
  | SystemEntry
  | CompactionEntry;
