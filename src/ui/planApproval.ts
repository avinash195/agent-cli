export interface PlanApprovalOptions {
  planPath: string;
  allowedPrompts: string[];
}

export type ApprovalDecision =
  | { type: "auto_accept_clear" }
  | { type: "auto_accept_keep" }
  | { type: "manual" }
  | { type: "reject"; feedback: string };

export type PlanApprovalPromptFn = (
  options: PlanApprovalOptions
) => Promise<ApprovalDecision>;

export const PLAN_MODE_HIDDEN_PREFIX = "\x00plan_mode_instructions\x00";

const FULL_PLAN_INSTRUCTIONS = [
  "You are in PLAN MODE (read-only exploration).",
  "Write your implementation plan to the plan file.",
  "Use Read, grep, glob, and read-only bash to explore.",
  "Call ExitPlanMode when the plan is complete.",
].join("\n");

const BRIEF_PLAN_REMINDER = "Still in plan mode. Write findings to plan file.";

export function getPlanModeAttachment(planTurnCount: number): string {
  const content =
    planTurnCount % 5 === 0 ? FULL_PLAN_INSTRUCTIONS : BRIEF_PLAN_REMINDER;
  return PLAN_MODE_HIDDEN_PREFIX + content;
}

export function isPlanModeAttachment(content: string): boolean {
  return content.startsWith(PLAN_MODE_HIDDEN_PREFIX);
}

export async function defaultPlanApprovalPrompt(
  _options: PlanApprovalOptions
): Promise<ApprovalDecision> {
  return { type: "manual" };
}
