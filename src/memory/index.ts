import fs from "fs";

export const INDEX_MAX_LINES = 200;
export const INDEX_MAX_BYTES = 25 * 1024;

export function validateIndex(indexPath: string): {
  valid: boolean;
  error?: string;
} {
  if (!fs.existsSync(indexPath)) {
    return { valid: true };
  }

  const content = fs.readFileSync(indexPath, "utf-8");
  const lines = content.split("\n").length;
  const bytes = Buffer.byteLength(content, "utf-8");

  if (lines > INDEX_MAX_LINES) {
    return {
      valid: false,
      error: `MEMORY.md has ${lines} lines (max ${INDEX_MAX_LINES}). Remove stale entries before adding new ones.`,
    };
  }

  if (bytes > INDEX_MAX_BYTES) {
    return {
      valid: false,
      error: `MEMORY.md is ${(bytes / 1024).toFixed(1)}KB (max ${INDEX_MAX_BYTES / 1024}KB). Shorten descriptions or remove stale entries.`,
    };
  }

  return { valid: true };
}
