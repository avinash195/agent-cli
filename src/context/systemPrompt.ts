import { gatherEnvironment, renderEnvironment } from "./environment.js";
import { loadAgentMemory, renderAgentMemory } from "./agentmd.js";
import {
  getMemoryDir,
  loadMemoryIndex,
  renderMemorySection,
} from "../memory/loader.js";

export interface SystemPromptOptions {
  cwd: string;
  model?: string;
  ignoreMemory?: boolean;
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
- Check your work after making changes

## Memory

You have access to project memory stored in markdown files.
The MEMORY.md index is included in your context. Read individual
memory files when they're relevant to the current task.

When you learn something important that should persist across sessions:
- Scan MEMORY.md first. If a similar memory exists, update it.
- Only store facts that can't be re-derived from the codebase.
- Use the write_memory tool with an appropriate type.

Memory types:
- user: Builder preferences and context
- feedback: Corrections and confirmations from the builder
- project: Facts not derivable from code
- reference: External system entry points`;

export function buildSystemPrompt(options: SystemPromptOptions): string[] {
  const { cwd, ignoreMemory = false } = options;

  const sections: string[] = [];

  sections.push(`<SYSTEM_STATIC_CONTEXT>`);
  sections.push(STATIC_PROMPT);
  sections.push(`</SYSTEM_STATIC_CONTEXT>`);

  sections.push(`<SYSTEM_DYNAMIC_CONTEXT>`);

  const env = gatherEnvironment(cwd);
  sections.push(renderEnvironment(env));

  const agentMd = loadAgentMemory(cwd);
  const agentText = renderAgentMemory(agentMd);
  if (agentText) {
    sections.push(agentText);
  }

  if (!ignoreMemory) {
    const memoryIndex = loadMemoryIndex(cwd);
    if (memoryIndex) {
      sections.push(renderMemorySection(memoryIndex, getMemoryDir(cwd)));
    }
  }

  sections.push(`</SYSTEM_DYNAMIC_CONTEXT>`);

  return sections;
}

export function renderSystemPrompt(options: SystemPromptOptions): string {
  return buildSystemPrompt(options).join("\n\n");
}
