export const DEFAULT_MAX_RESULT_SIZE_CHARS = 100_000;

export function truncateToolResult(
  result: string,
  maxChars: number = DEFAULT_MAX_RESULT_SIZE_CHARS
): string {
  if (result.length <= maxChars) return result;

  const truncated = result.slice(0, maxChars);
  const totalChars = result.length;
  return `${truncated}\n\n[Output truncated: ${totalChars.toLocaleString()} chars total, showing first ${maxChars.toLocaleString()}]`;
}
