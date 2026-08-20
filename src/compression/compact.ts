import { getClient, getModel } from "../services/api/client.js";
import type { Message } from "../types/message.js";
import { hasToolResult, hasToolUse } from "./microCompact.js";
import { tokenCountWithEstimation } from "./tokens.js";

export const AUTO_COMPACT_RATIO = 0.83;
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;
export const TAIL_PRESERVE_COUNT = 8;
export const COMPACT_BOUNDARY = "---[CompactBoundary]---";

const COMPRESSION_SYSTEM_PROMPT = `You are a conversation summarizer. Produce a structured summary that preserves:
- All file paths and directory structures mentioned
- Function signatures and code snippets that are actively being worked on
- Current task state and next planned steps
- Errors encountered and their resolutions (or unresolved status)
- Key decisions made and their rationale

Format as markdown with sections. Be thorough but concise. Do NOT use tools.`;

export interface CompactOptions {
  maxContextTokens: number;
  focusDirective?: string;
  force?: boolean;
  lastUsage?: { inputTokens: number };
  usageAnchorIndex?: number;
  model?: string;
}

export interface CompactionResult {
  messages: Message[];
  tokensBefore: number;
  tokensAfter: number;
  summary: string;
}

export interface CompactCommand {
  type: "compact";
  focusDirective?: string;
}

export function shouldAutoCompact(
  messages: Message[],
  options: CompactOptions
): boolean {
  if (options.force) return true;

  const tokenCount = tokenCountWithEstimation(messages, {
    lastUsage: options.lastUsage,
    usageAnchorIndex: options.usageAnchorIndex,
  });

  return tokenCount > options.maxContextTokens * AUTO_COMPACT_RATIO;
}

export function findPreservedTailStart(messages: Message[]): number {
  let tailStart = messages.length - TAIL_PRESERVE_COUNT;

  while (tailStart > 0) {
    const msg = messages[tailStart];

    if (msg.role === "user" && hasToolResult(msg)) {
      tailStart--;
      continue;
    }

    if (tailStart > 0) {
      const prev = messages[tailStart - 1];
      if (prev.role === "assistant" && hasToolUse(prev)) {
        tailStart--;
        continue;
      }
    }

    break;
  }

  return Math.max(0, tailStart);
}

export function parseCompactCommand(input: string): CompactCommand | null {
  const match = input.trim().match(/^\/compact(?:\s+"([^"]+)")?(?:\s+(.+))?$/);
  if (!match) return null;

  const focusDirective = match[1] || match[2];
  return { type: "compact", focusDirective };
}

export async function performCompaction(
  messages: Message[],
  options: CompactOptions
): Promise<CompactionResult> {
  const tokenOptions = {
    lastUsage: options.lastUsage,
    usageAnchorIndex: options.usageAnchorIndex,
  };
  const tokensBefore = tokenCountWithEstimation(messages, tokenOptions);
  const tailStart = findPreservedTailStart(messages);

  if (tailStart <= 0) {
    return {
      messages,
      tokensBefore,
      tokensAfter: tokensBefore,
      summary: "",
    };
  }

  const summary = await generateCompression(
    messages,
    tailStart,
    options.focusDirective,
    options.model
  );

  const tail = messages.slice(tailStart);
  const compactedMessages: Message[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "# Conversation Summary (auto-compacted)",
            "",
            summary,
            "",
            COMPACT_BOUNDARY,
            "",
            "Continue from where you left off. The above is a summary of our prior work.",
          ].join("\n"),
        },
      ],
    },
  ];

  if (tail.length === 0 || tail[0].role === "user") {
    compactedMessages.push({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Understood. I have the context from our previous work. Continuing.",
        },
      ],
    });
  }

  compactedMessages.push(...tail);

  const tokensAfter = tokenCountWithEstimation(compactedMessages);

  return { messages: compactedMessages, tokensBefore, tokensAfter, summary };
}

async function generateCompression(
  messages: Message[],
  tailStart: number,
  focusDirective?: string,
  model?: string
): Promise<string> {
  const toCompress = messages.slice(0, tailStart);

  const compressionPrompt = [
    "Summarize the following conversation history.",
    focusDirective ? `Focus especially on: ${focusDirective}` : "",
    "Preserve all technical details needed to continue the work.",
  ]
    .filter(Boolean)
    .join("\n");

  const client = getClient();
  const response = await client.messages.create({
    model: model ?? getModel(),
    max_tokens: 4096,
    system: COMPRESSION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: compressionPrompt },
          {
            type: "text",
            text: toCompress
              .map((m) => `[${m.role}]: ${stringifyContent(m.content)}`)
              .join("\n\n"),
          },
        ],
      },
    ],
  });

  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function stringifyContent(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

export function formatCompactResult(result: CompactionResult): string {
  if (result.tokensBefore === result.tokensAfter && result.summary === "") {
    return "Nothing to compact — conversation is within the preserved tail.";
  }

  const reduction =
    result.tokensBefore === 0
      ? 0
      : Math.round((1 - result.tokensAfter / result.tokensBefore) * 100);

  return `Compacted: ${result.tokensBefore} -> ${result.tokensAfter} tokens (${reduction}% reduction)`;
}
