import { gatherEnvironment, renderEnvironment } from "./environment.js";
import { loadAgentMemory, renderAgentMemory } from "./agentmd.js";

export interface SystemPromptOptions {
  cwd: string;
  model?: string;
}

const STATIC_PROMPT = `You are a coding agent. You help builders write, debug, and refactor code.

## Behavior Rules

- Always read a file before editing it
- Prefer editing existing files over creating new ones
- Never run destructive commands without explicit permission
- When uncertain, ask for clarification
- Be concise. No filler.

## Tool Usage

- Use tools to gather information before making assumptions
- Prefer specific tools over shell commands for file operations
- Check your work after making changes`;

export function buildSystemPrompt(options: SystemPromptOptions): string[] {
  const { cwd } = options;

  const sections: string[] = [];

  sections.push(`<SYSTEM_STATIC_CONTEXT>`);
  sections.push(STATIC_PROMPT);
  sections.push(`</SYSTEM_STATIC_CONTEXT>`);

  sections.push(`<SYSTEM_DYNAMIC_CONTEXT>`);

  const env = gatherEnvironment(cwd);
  sections.push(renderEnvironment(env));

  const memory = loadAgentMemory(cwd);
  const memoryText = renderAgentMemory(memory);
  if (memoryText) {
    sections.push(memoryText);
  }

  sections.push(`</SYSTEM_DYNAMIC_CONTEXT>`);

  return sections;
}

export function renderSystemPrompt(options: SystemPromptOptions): string {
  return buildSystemPrompt(options).join("\n\n");
}
