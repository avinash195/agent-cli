export const OUTPUT_TOKEN_TIERS = {
  default: 8_192,
  truncationRetry: 64_000,
  compression: 20_000,
} as const;

export function getOutputTokenLimit(
  purpose: keyof typeof OUTPUT_TOKEN_TIERS
): number {
  return OUTPUT_TOKEN_TIERS[purpose];
}
