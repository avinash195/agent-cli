import { microCompact, type CompactionResult } from "../compression/index.js";
import { loadRules } from "../config/settings.js";
import { executeSingleTool } from "./executeTool.js";
import {
  executeHooks,
  loadHooks,
  type HookEventResult,
  type HooksConfig,
} from "../hooks/index.js";
import { streamMessage } from "../services/api/streaming.js";
import { tokenCountWithEstimation } from "../compression/tokens.js";
import {
  checkBudget,
  createCircuitBreaker,
  handleBudgetStatus,
  invalidateUsageAnchor,
  getOutputTokenLimit,
  type CircuitBreakerState,
} from "../tokens/index.js";
import { getModel } from "../services/api/client.js";
import {
  evaluatePermission,
  SessionRules,
  type AgentMode,
  type PermissionRules,
} from "../permissions/permissions.js";
import { isToolAllowedBySkill } from "../skills/enforcement.js";
import { getTools } from "../tools/index.js";
import type { Tool, ToolContext } from "../tools/Tool.js";
import type {
  AssistantMessage,
  Message,
  ToolResultBlock,
  ToolUseBlock,
  UserMessage,
} from "../types/message.js";
import {
  createTerminalPermissionPrompt,
  inferPattern,
  summarizeToolCall,
  type PermissionPromptFn,
} from "../ui/confirmationPrompt.js";
import {
  defaultPlanApprovalPrompt,
  getPlanModeAttachment,
  type PlanApprovalOptions,
  type PlanApprovalPromptFn,
} from "../ui/planApproval.js";

export type LoopTerminationReason =
  | "completed"
  | "aborted"
  | "model_error"
  | "max_turns"
  | "blocking_limit"
  | "plan_accepted_clear";

export type LoopEvent =
  | { type: "text"; text: string }
  | {
      type: "tool_use_start";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_use_done";
      id: string;
      name: string;
      result: string;
      isError: boolean;
    }
  | {
      type: "tool_denied";
      id: string;
      name: string;
      reason: string;
    }
  | { type: "assistant_message"; message: AssistantMessage }
  | { type: "tool_result_message"; message: UserMessage }
  | {
      type: "compaction";
      tokensBefore: number;
      tokensAfter: number;
      result: CompactionResult;
    }
  | {
      type: "token_warning";
      level: "warning" | "info" | "blocking";
      tokenCount: number;
      message: string;
    }
  | { type: "stream_reset" }
  | { type: "turn_complete"; turnCount: number; reason: string }
  | { type: "error"; error: Error }
  | { type: "hook_warning"; event: string; message: string };

export interface LoopResult {
  messages: Message[];
  terminationReason: LoopTerminationReason;
  turnCount: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  lastCallUsage?: { inputTokens: number };
  usageAnchorIndex?: number;
}

export interface QueryOptions {
  messages: Message[];
  tools?: Tool[];
  getTools?: (mode: AgentMode) => Tool[];
  getMode?: () => AgentMode;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  abortSignal?: AbortSignal;
  cwd?: string;
  sessionId?: string;
  mode?: AgentMode;
  rules?: PermissionRules;
  sessionRules?: SessionRules;
  permissionPrompt?: PermissionPromptFn;
  lastCallUsage?: { inputTokens: number };
  usageAnchorIndex?: number;
  circuitBreaker?: CircuitBreakerState;
  querySource?: string;
  setPermissionMode?: (mode: AgentMode) => void;
  getPlanFilePath?: () => string | null;
  requestPlanApproval?: ToolContext["requestPlanApproval"];
  planApprovalPrompt?: PlanApprovalPromptFn;
  getSystemPrompt?: () => string;
  onFileTouched?: (filePath: string) => void;
  hooksConfig?: HooksConfig;
}

interface LoopState {
  messages: Message[];
  turnCount: number;
  aborted: boolean;
  lastCallUsage?: { inputTokens: number };
  usageAnchorIndex?: number;
}

export async function* query(
  options: QueryOptions
): AsyncGenerator<LoopEvent, LoopResult> {
  const {
    systemPrompt,
    model,
    maxTurns = 50,
    abortSignal,
    cwd = process.cwd(),
    sessionId,
    mode,
    rules = loadRules(),
    sessionRules = new SessionRules(),
    permissionPrompt = createTerminalPermissionPrompt(),
    circuitBreaker = createCircuitBreaker(),
    querySource = "user",
    setPermissionMode,
    getPlanFilePath,
    requestPlanApproval,
    planApprovalPrompt = defaultPlanApprovalPrompt,
    hooksConfig = loadHooks(),
  } = options;

  const resolveSystemPrompt = (): string | undefined =>
    options.getSystemPrompt?.() ?? systemPrompt;

  const resolvedModel = model ?? getModel();

  const getMode =
    options.getMode ?? (() => mode ?? rules.mode);

  const resolveTools = (): Tool[] => {
    if (options.getTools) return options.getTools(getMode());
    if (options.tools) return options.tools;
    return getTools(getMode());
  };

  const state: LoopState = {
    messages: [...options.messages],
    turnCount: 0,
    aborted: false,
    lastCallUsage: options.lastCallUsage,
    usageAnchorIndex: options.usageAnchorIndex,
  };

  const pendingPlan: { value: PlanApprovalOptions | null } = { value: null };

  const toolContext: ToolContext = {
    cwd,
    abortSignal,
    sessionId,
    setPermissionMode,
    getPlanFilePath,
    requestPlanApproval: (approval) => {
      pendingPlan.value = approval;
      requestPlanApproval?.(approval);
    },
  };
  let totalUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let planTurnCount = 0;
  let stopHookFired = false;

  const finish = (reason: LoopTerminationReason): LoopResult => ({
    messages: state.messages,
    terminationReason: reason,
    turnCount: state.turnCount,
    usage: totalUsage,
    lastCallUsage: state.lastCallUsage,
    usageAnchorIndex: state.usageAnchorIndex,
  });

  while (state.turnCount < maxTurns) {
    if (abortSignal?.aborted === true) {
      state.aborted = true;
      yield {
        type: "turn_complete",
        turnCount: state.turnCount,
        reason: "aborted",
      };
      return finish("aborted");
    }

    state.turnCount++;

    if (getMode() === "plan") {
      state.messages.push({
        role: "user",
        content: getPlanModeAttachment(planTurnCount),
      });
      planTurnCount++;
    }

    state.messages = microCompact(state.messages);

    if (state.turnCount > 1) {
      const tokenEstimate = tokenCountWithEstimation(state.messages, {
        lastUsage: state.lastCallUsage,
        usageAnchorIndex: state.usageAnchorIndex,
      });
      const budgetStatus = checkBudget(tokenEstimate, resolvedModel);

      if (budgetStatus === "blocking") {
        yield {
          type: "token_warning",
          level: "blocking",
          tokenCount: tokenEstimate,
          message: "Context window limit reached. Use /compact to continue.",
        };
        yield {
          type: "turn_complete",
          turnCount: state.turnCount,
          reason: "blocking_limit",
        };
        return finish("blocking_limit");
      }

      if (budgetStatus === "error") {
        const budgetResult = await handleBudgetStatus(
          budgetStatus,
          circuitBreaker,
          state.messages,
          querySource,
          resolvedModel
        );

        if (budgetResult.action === "compress" && budgetResult.compaction) {
          state.messages = budgetResult.messages;
          invalidateUsageAnchor(state);
          yield {
            type: "compaction",
            tokensBefore: budgetResult.compaction.tokensBefore,
            tokensAfter: budgetResult.compaction.tokensAfter,
            result: budgetResult.compaction,
          };
          yield {
            type: "token_warning",
            level: "info",
            tokenCount: tokenCountWithEstimation(state.messages),
            message: "Auto-compressed conversation to stay within budget.",
          };
        }
      }

      if (budgetStatus === "warning") {
        yield {
          type: "token_warning",
          level: "warning",
          tokenCount: tokenEstimate,
          message: "Context is getting large. Consider running /compact.",
        };
      }
    }

    let assistantMessage: AssistantMessage;
    let stopReason: string;
    let outputLimit = getOutputTokenLimit("default");
    let retriedForTruncation = false;

    const tools = resolveTools();
    const toolsApiParams = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    try {
      while (true) {
        const stream = streamMessage(state.messages, {
          systemPrompt: resolveSystemPrompt(),
          model: resolvedModel,
          cwd,
          tools: toolsApiParams,
          signal: abortSignal,
          maxTokens: outputLimit,
        });

        let streamResult = await stream.next();

        while (!streamResult.done) {
          const event = streamResult.value;

          if (event.type === "text") {
            yield { type: "text", text: event.text };
          } else if (event.type === "tool_use_start") {
            yield {
              type: "tool_use_start",
              id: event.id,
              name: event.name,
              input: event.input,
            };
          }

          streamResult = await stream.next();
        }

        assistantMessage = streamResult.value.assistantMessage;
        stopReason = streamResult.value.stopReason;
        totalUsage.inputTokens += streamResult.value.usage.inputTokens;
        totalUsage.outputTokens += streamResult.value.usage.outputTokens;
        totalUsage.cacheReadTokens += streamResult.value.usage.cacheReadTokens;
        state.lastCallUsage = {
          inputTokens: streamResult.value.usage.inputTokens,
        };
        state.usageAnchorIndex = state.messages.length - 1;

        if (stopReason === "max_tokens" && !retriedForTruncation) {
          retriedForTruncation = true;
          outputLimit = getOutputTokenLimit("truncationRetry");
          yield { type: "stream_reset" };
          continue;
        }

        break;
      }
    } catch (error) {
      yield { type: "error", error: error as Error };
      return finish("model_error");
    }

    state.messages.push(assistantMessage);
    yield { type: "assistant_message", message: assistantMessage };

    if (stopReason !== "tool_use") {
      if (!stopHookFired) {
        const stopResult = await executeHooks(
          hooksConfig,
          "Stop",
          { event: "Stop" },
          cwd
        );
        yield* yieldHookWarnings("Stop", stopResult);

        if (stopResult.injections.length > 0) {
          stopHookFired = true;
          yield {
            type: "hook_warning",
            event: "Stop",
            message: "Hook requested the agent continue.",
          };
          const injectionMessage: UserMessage = {
            role: "user",
            content: stopResult.injections.join("\n\n"),
          };
          state.messages.push(injectionMessage);
          yield { type: "tool_result_message", message: injectionMessage };
          continue;
        }
      }

      yield {
        type: "turn_complete",
        turnCount: state.turnCount,
        reason: "completed",
      };
      return finish("completed");
    }

    const toolUseBlocks = assistantMessage.content.filter(
      (block) => block.type === "tool_use"
    );

    const toolResults: ToolResultBlock[] = [];

    for (const toolCall of toolUseBlocks) {
      if (toolCall.type !== "tool_use") continue;

      if (!isToolAllowedBySkill(toolCall.name, toolCall.input)) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: `Permission denied: Tool "${toolCall.name}" is not allowed by the active skill`,
          is_error: true,
        });
        continue;
      }

      const decision = evaluatePermission(
        toolCall.name,
        toolCall.input,
        rules,
        getMode(),
        sessionRules
      );

      if (decision.decision === "deny") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: `Permission denied: ${decision.reason}`,
          is_error: true,
        });
        continue;
      }

      if (decision.decision === "ask") {
        const response = await permissionPrompt({
          toolName: toolCall.name,
          summary: summarizeToolCall(toolCall.name, toolCall.input),
          risk: decision.reason,
        });

        if (response === "deny") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: "User denied this operation.",
            is_error: true,
          });
          continue;
        }

        if (response === "always_allow") {
          const pattern = inferPattern(toolCall.name, toolCall.input);
          sessionRules.add(pattern);
        }
      }

      const executed = await executeToolWithHooks(
        toolCall,
        tools,
        toolContext,
        hooksConfig
      );
      yield* yieldHookWarnings("PreToolUse", executed.pre);
      yield* yieldHookWarnings("PostToolUse", executed.post);
      toolResults.push(executed.result);

      if (!executed.result.is_error) {
        const filePath =
          (toolCall.input.file_path as string | undefined) ??
          (toolCall.input.path as string | undefined);
        if (filePath) {
          options.onFileTouched?.(filePath);
        }
      }
    }

    const toolResultMessage: UserMessage = {
      role: "user",
      content: toolResults,
    };

    for (const block of assistantMessage.content) {
      if (block.type === "tool_use") {
        const result = toolResults.find(
          (r): r is ToolResultBlock =>
            r.type === "tool_result" && r.tool_use_id === block.id
        );

        if (result) {
          const wasDenied =
            result.content.startsWith("Permission denied:") ||
            result.content.startsWith("Blocked by hook:") ||
            result.content === "User denied this operation.";

          if (wasDenied) {
            yield {
              type: "tool_denied",
              id: block.id,
              name: block.name,
              reason: result.content,
            };
          }

          yield {
            type: "tool_use_done",
            id: block.id,
            name: block.name,
            result: result.content,
            isError: result.is_error ?? false,
          };
        }
      }
    }

    state.messages.push(toolResultMessage);
    yield { type: "tool_result_message", message: toolResultMessage };

    const exitedPlan = toolUseBlocks.some(
      (block) => block.type === "tool_use" && block.name === "ExitPlanMode"
    );

    if (exitedPlan && pendingPlan.value) {
      const submitted: PlanApprovalOptions = {
        planPath: pendingPlan.value.planPath,
        allowedPrompts: [...pendingPlan.value.allowedPrompts],
      };
      pendingPlan.value = null;
      const approval = await planApprovalPrompt(submitted);

      if (approval.type === "auto_accept_clear") {
        for (const pattern of submitted.allowedPrompts) {
          sessionRules.add(pattern);
        }
        yield {
          type: "turn_complete",
          turnCount: state.turnCount,
          reason: "plan_accepted_clear",
        };
        return finish("plan_accepted_clear");
      }

      if (approval.type === "auto_accept_keep") {
        for (const pattern of submitted.allowedPrompts) {
          sessionRules.add(pattern);
        }
        setPermissionMode?.("default");
      }

      if (approval.type === "manual") {
        setPermissionMode?.("default");
      }

      if (approval.type === "reject") {
        state.messages.push({
          role: "user",
          content: approval.feedback,
        });
      }
    }

    yield {
      type: "turn_complete",
      turnCount: state.turnCount,
      reason: "tool_use",
    };
  }

  return finish("max_turns");
}

function* yieldHookWarnings(
  event: string,
  result: HookEventResult
): Generator<LoopEvent> {
  for (const message of result.warnings) {
    yield { type: "hook_warning", event, message };
  }
}

async function executeToolWithHooks(
  toolCall: ToolUseBlock,
  tools: Tool[],
  context: ToolContext,
  hooksConfig: HooksConfig
): Promise<{
  result: ToolResultBlock;
  pre: HookEventResult;
  post: HookEventResult;
}> {
  const empty: HookEventResult = {
    blocked: false,
    reason: "",
    injections: [],
    warnings: [],
  };

  const pre = await executeHooks(
    hooksConfig,
    "PreToolUse",
    {
      event: "PreToolUse",
      toolName: toolCall.name,
      toolInput: toolCall.input,
    },
    context.cwd
  );

  if (pre.blocked) {
    return {
      result: {
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: `Blocked by hook: ${pre.reason}`,
        is_error: true,
      },
      pre,
      post: empty,
    };
  }

  const result = await executeSingleTool(toolCall, tools, context);

  const post = await executeHooks(
    hooksConfig,
    "PostToolUse",
    {
      event: "PostToolUse",
      toolName: toolCall.name,
      toolInput: toolCall.input,
      toolResult: result.content,
    },
    context.cwd
  );

  let content = result.content;
  if (post.injections.length > 0) {
    content += "\n\n" + post.injections.join("\n");
  }

  return {
    result: {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content,
      is_error: result.is_error,
    },
    pre,
    post,
  };
}
