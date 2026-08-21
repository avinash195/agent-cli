// Offline family windows — longest prefix wins.
// Prefer a conservative window when a family spans sizes.
const MODEL_FAMILIES: Array<[string, number]> = [
  ["claude-opus-4-5", 200_000],
  ["claude-opus-4-6", 1_000_000],
  ["claude-opus-4-7", 1_000_000],
  ["claude-opus-4-8", 1_000_000],
  ["claude-opus-5", 1_000_000],
  ["claude-opus-4", 200_000],
  ["claude-sonnet-4-5", 1_000_000],
  ["claude-sonnet-4-6", 1_000_000],
  ["claude-sonnet-5", 1_000_000],
  ["claude-sonnet-4", 200_000],
  ["claude-haiku", 200_000],
  ["claude-fable", 1_000_000],
  ["gpt-5.2-chat", 128_000],
  ["gpt-5.3-chat", 128_000],
  ["gpt-5.3-codex-spark", 128_000],
  ["gpt-5.4", 1_050_000],
  ["gpt-5.5", 1_050_000],
  ["gpt-5.6", 1_050_000],
  ["gpt-5", 400_000],
  ["gpt-4.1", 1_047_576],
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["o4-mini", 200_000],
  ["o3-mini", 200_000],
  ["o3", 200_000],
  ["o1", 200_000],
  ["kimi-k3", 1_048_576],
  ["kimi-k2", 262_144],
  ["kimi", 262_144],
  ["moonshot", 262_144],
  ["deepseek-v4", 1_000_000],
  ["deepseek-v3", 128_000],
  ["deepseek-r1", 164_000],
  ["deepseek-reasoner", 128_000],
  ["deepseek-chat", 128_000],
  ["deepseek", 128_000],
  ["gemini-2.5-flash-image", 32_768],
  ["gemini", 1_048_576],
];

const DEFAULT_CONTEXT_WINDOW = 128_000;

export function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/_/g, "-");
}

export function getContextWindowForModel(model: string): number {
  const envWindow = readEnvOverride(model);
  if (envWindow) return envWindow;

  return matchFamily(model) ?? DEFAULT_CONTEXT_WINDOW;
}

export function getEffectiveWindow(model: string): number {
  const contextWindow = getContextWindowForModel(model);
  const reserved = Math.min(20_000, Math.floor(contextWindow * 0.2));
  return contextWindow - reserved;
}

function readEnvOverride(model: string): number | undefined {
  const envKey = `CONTEXT_WINDOW_${model.toUpperCase().replace(/[-.]/g, "_")}`;
  const raw = process.env[envKey];
  if (!raw) return undefined;

  const parsed = parseInt(raw, 10);
  if (!isNaN(parsed) && parsed > 0) return parsed;
  return undefined;
}

function matchFamily(model: string): number | undefined {
  const normalized = normalizeModelId(model);
  const base = normalized.split("/").pop() ?? normalized;

  for (const [prefix, window] of [...MODEL_FAMILIES].sort(
    (a, b) => b[0].length - a[0].length
  )) {
    if (idMatchesPrefix(normalized, prefix) || idMatchesPrefix(base, prefix)) {
      return window;
    }
  }

  return undefined;
}

function idMatchesPrefix(id: string, prefix: string): boolean {
  return id === prefix || id.startsWith(`${prefix}-`) || id.startsWith(prefix);
}
