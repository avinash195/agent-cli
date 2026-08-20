import type { Message } from "../types/message.js";

export const MICRO_COMPACT_PLACEHOLDER = "[Old tool result content cleared]";
export const STALE_THRESHOLD = 8;

export function microCompact(messages: Message[]): Message[] {
  const totalMessages = messages.length;

  return messages.map((msg, index) => {
    const age = totalMessages - index;

    if (age <= STALE_THRESHOLD) return msg;
    if (!Array.isArray(msg.content) || !hasToolResult(msg)) return msg;

    return {
      ...msg,
      content: msg.content.map((block) =>
        block.type === "tool_result"
          ? { ...block, content: MICRO_COMPACT_PLACEHOLDER }
          : block
      ),
    };
  });
}

export function hasToolUse(msg: Message): boolean {
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((b) => b.type === "tool_use");
}

export function hasToolResult(msg: Message): boolean {
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((b) => b.type === "tool_result");
}
