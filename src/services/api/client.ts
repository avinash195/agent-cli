import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_MAX_TOKENS = 8096;

let clientInstance: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!clientInstance) {
    const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_AUTH_TOKEN not set. Add it to your .env file."
      );
    }

    clientInstance = new Anthropic({
      apiKey,
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    });
  }
  return clientInstance;
}

export function getModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

export function setClient(client: Anthropic): void {
  clientInstance = client;
}
