import { gatherEnvironment, renderEnvironment } from "./environment.js";
import { loadAgentMemory, renderAgentMemory } from "./agentmd.js";
import {
  getMemoryDir,
  loadMemoryIndex,
  renderMemorySection,
} from "../memory/loader.js";
import { renderSkillsForPrompt } from "../skills/systemPromptSection.js";
import type { SkillDefinition } from "../skills/types.js";

export interface SystemPromptOptions {
  cwd: string;
  model?: string;
  ignoreMemory?: boolean;
  skills?: SkillDefinition[];
  touchedPaths?: string[];
  activatedSkills?: Set<string>;
}

export interface SystemPromptBlock {
  text: string;
  cache: boolean;
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
- For multi-file or architectural work, call EnterPlanMode before editing
- For multi-step work, call TodoWrite with the full checklist before acting, and update it as you go
- If TaskCreate is available, use the persistent task graph (with dependencies) instead of TodoWrite
- Tools prefixed with mcp_ come from external MCP servers. Use them when they match the user's request.
- Call Skill with a skill name when a listed workflow matches the task. Follow the returned instructions.

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

export function buildSystemPromptBlocks(
  options: SystemPromptOptions
): SystemPromptBlock[] {
  const {
    cwd,
    ignoreMemory = false,
    skills = [],
    touchedPaths = [],
    activatedSkills = new Set<string>(),
  } = options;

  const blocks: SystemPromptBlock[] = [
    {
      text: [
        "<SYSTEM_STATIC_CONTEXT>",
        STATIC_PROMPT,
        "</SYSTEM_STATIC_CONTEXT>",
      ].join("\n\n"),
      cache: true,
    },
  ];

  const projectSections: string[] = [];
  const agentText = renderAgentMemory(loadAgentMemory(cwd));
  if (agentText) projectSections.push(agentText);

  if (!ignoreMemory) {
    const memoryIndex = loadMemoryIndex(cwd);
    if (memoryIndex) {
      projectSections.push(renderMemorySection(memoryIndex, getMemoryDir(cwd)));
    }
  }

  if (projectSections.length > 0) {
    blocks.push({
      text: [
        "<SYSTEM_PROJECT_CONTEXT>",
        ...projectSections,
        "</SYSTEM_PROJECT_CONTEXT>",
      ].join("\n\n"),
      cache: true,
    });
  }

  const dynamicSections = ["<SYSTEM_DYNAMIC_CONTEXT>"];
  dynamicSections.push(renderEnvironment(gatherEnvironment(cwd)));

  if (skills.length > 0) {
    const skillSection = renderSkillsForPrompt(
      skills,
      touchedPaths,
      activatedSkills
    );
    if (skillSection) dynamicSections.push(skillSection);
  }

  dynamicSections.push("</SYSTEM_DYNAMIC_CONTEXT>");
  blocks.push({ text: dynamicSections.join("\n\n"), cache: false });

  return blocks;
}

export function renderSystemPrompt(options: SystemPromptOptions): string {
  return buildSystemPromptBlocks(options)
    .map((block) => block.text)
    .join("\n\n");
}
