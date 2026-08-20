import type { Message } from "../types/message.js";

export interface TokenEstimationOptions {
  lastUsage?: { inputTokens: number };
  usageAnchorIndex?: number;
}

export function tokenCountWithEstimation(
  messages: Message[],
  options: TokenEstimationOptions = {}
): number {
  const { lastUsage, usageAnchorIndex } = options;

  if (lastUsage && usageAnchorIndex !== undefined) {
    const newMessages = messages.slice(usageAnchorIndex + 1);
    const estimatedNew = estimateTokens(newMessages);
    // 4/3 multiplier compensates for systematic undercount
    return lastUsage.inputTokens + Math.ceil(estimatedNew * (4 / 3));
  }

  return Math.ceil(estimateTokens(messages) * (4 / 3));
}

export function estimateTokens(messages: Message[]): number {
  let total = 0;

  for (const msg of messages) {
    total += 12; // per-message overhead

    if (typeof msg.content === "string") {
      total += Math.ceil(msg.content.length / 4);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text") {
          total += Math.ceil(block.text.length / 4);
        } else if (block.type === "tool_use" || block.type === "tool_result") {
          const json = JSON.stringify(block);
          total += Math.ceil(json.length / 2);
        }
      }
    }
  }

  return total;
}
