import { getEffectiveWindow } from "./modelLimits.js";

export interface BudgetThresholds {
  warning: number;
  error: number;
  blocking: number;
}

export type BudgetStatus = "ok" | "warning" | "error" | "blocking";

const REFERENCE_WINDOW = 180_000;
const WARNING_BUFFER = 20_000;
const ERROR_BUFFER = 12_000;
const BLOCKING_BUFFER = 4_000;

export function calculateThresholds(model: string): BudgetThresholds {
  const effective = getEffectiveWindow(model);
  const scale = effective / REFERENCE_WINDOW;

  return {
    warning: effective - Math.floor(WARNING_BUFFER * scale),
    error: effective - Math.floor(ERROR_BUFFER * scale),
    blocking: effective - Math.floor(BLOCKING_BUFFER * scale),
  };
}

export function checkBudget(tokenCount: number, model: string): BudgetStatus {
  const thresholds = calculateThresholds(model);

  if (tokenCount >= thresholds.blocking) return "blocking";
  if (tokenCount >= thresholds.error) return "error";
  if (tokenCount >= thresholds.warning) return "warning";
  return "ok";
}
