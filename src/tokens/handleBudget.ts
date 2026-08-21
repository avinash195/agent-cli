import {
  performCompaction,
  type CompactionResult,
} from "../compression/compact.js";
import { getEffectiveWindow } from "./modelLimits.js";
import {
  isCircuitOpen,
  recordCompressionFailure,
  recordCompressionSuccess,
  type CircuitBreakerState,
} from "./compressionCircuitBreaker.js";
import type { Message } from "../types/message.js";
import type { BudgetStatus } from "./budgetThresholds.js";

export interface BudgetAction {
  action: "continue" | "compress" | "block";
  messages: Message[];
  compaction?: CompactionResult;
}

export async function handleBudgetStatus(
  status: BudgetStatus,
  circuitBreaker: CircuitBreakerState,
  messages: Message[],
  querySource: string,
  model: string
): Promise<BudgetAction> {
  if (querySource === "compression") {
    return { action: "continue", messages };
  }

  if (status === "blocking") {
    return { action: "block", messages };
  }

  if (status === "error") {
    if (isCircuitOpen(circuitBreaker)) {
      return { action: "continue", messages };
    }

    try {
      const compaction = await performCompaction(messages, {
        maxContextTokens: getEffectiveWindow(model),
        model,
      });

      if (compaction.summary === "") {
        return { action: "continue", messages };
      }

      recordCompressionSuccess(circuitBreaker);
      return {
        action: "compress",
        messages: compaction.messages,
        compaction,
      };
    } catch {
      recordCompressionFailure(circuitBreaker);
      return { action: "continue", messages };
    }
  }

  return { action: "continue", messages };
}

export function invalidateUsageAnchor(state: {
  lastCallUsage?: { inputTokens: number };
  usageAnchorIndex?: number;
}): void {
  state.lastCallUsage = undefined;
  state.usageAnchorIndex = undefined;
}
