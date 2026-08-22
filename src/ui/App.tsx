import { useEffect, useRef, useState } from 'react';
import { readFileSync } from 'fs';
import { Box, Text, useApp, useInput } from 'ink';

import { QueryEngine } from '../core/queryEngine.js';
import type { QueryEngineEvent } from '../core/queryEngine.js';
import { getModel } from '../services/api/client.js';
import { Spinner } from './components/Spinner.js';
import type {
  ConfirmationPrompt,
  PermissionResponse,
} from './confirmationPrompt.js';
import {
  isPlanModeAttachment,
  type ApprovalDecision,
  type PlanApprovalOptions,
} from './planApproval.js';
import { isSkillBodyMessage } from '../skills/slashCommand.js';
import type { Message } from '../types/message.js';
import { todoStore } from '../tasks/todoStore.js';
import type { TodoItem } from '../tasks/todoTypes.js';

interface ToolCallInfo {
  id: string;
  name: string;
  done: boolean;
  isError: boolean;
  denied?: boolean;
}

interface DisplayMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tone?: 'warning' | 'info' | 'blocking';
}

function getMessageText(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

function messagesToDisplay(messages: Message[]): DisplayMessage[] {
  const result: DisplayMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        if (isPlanModeAttachment(msg.content)) continue;
        if (isSkillBodyMessage(msg.content)) continue;
        result.push({ role: 'user', content: msg.content });
      }
    } else {
      const text = getMessageText(msg);
      if (text) {
        result.push({ role: 'assistant', content: text });
      }
    }
  }

  return result;
}

export interface AppProps {
  initialMessages?: Message[];
  initialUsage?: { inputTokens: number; outputTokens: number };
  sessionId?: string;
}

export function App({
  initialMessages = [],
  initialUsage,
  sessionId,
}: AppProps) {
  const { exit } = useApp();

  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>(
    () => messagesToDisplay(initialMessages)
  );
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
  const [lastUsage, setLastUsage] = useState<{
    in: number;
    out: number;
  } | null>(
    initialUsage
      ? { in: initialUsage.inputTokens, out: initialUsage.outputTokens }
      : null
  );
  const [activeModel, setActiveModel] = useState(getModel());
  const [errorText, setErrorText] = useState('');
  const [pendingPermission, setPendingPermission] =
    useState<ConfirmationPrompt | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanApprovalOptions | null>(
    null
  );
  const [planFeedbackMode, setPlanFeedbackMode] = useState(false);
  const [inPlanMode, setInPlanMode] = useState(false);
  const [taskMode, setTaskMode] = useState<'todo' | 'task'>('todo');
  const [todos, setTodos] = useState<TodoItem[]>([]);

  const pendingPermissionRef = useRef<ConfirmationPrompt | null>(null);
  const permissionResolverRef = useRef<
    ((response: PermissionResponse) => void) | null
  >(null);
  const pendingPlanRef = useRef<PlanApprovalOptions | null>(null);
  const planResolverRef = useRef<((decision: ApprovalDecision) => void) | null>(
    null
  );

  const permissionPrompt = useRef(
    (prompt: ConfirmationPrompt): Promise<PermissionResponse> =>
      new Promise((resolve) => {
        permissionResolverRef.current = resolve;
        pendingPermissionRef.current = prompt;
        setPendingPermission(prompt);
      })
  ).current;

  const planApprovalPrompt = useRef(
    (options: PlanApprovalOptions): Promise<ApprovalDecision> =>
      new Promise((resolve) => {
        planResolverRef.current = resolve;
        pendingPlanRef.current = options;
        setPlanFeedbackMode(false);
        setPendingPlan(options);
      })
  ).current;

  const engine = useRef(
    new QueryEngine({
      defaultModel: getModel(),
      cwd: process.cwd(),
      permissionPrompt,
      planApprovalPrompt,
      initialMessages,
      initialUsage,
      sessionId,
    })
  ).current;

  useEffect(() => {
    const id = engine.getSessionId();
    setTodos(todoStore.get(id));
    setTaskMode(engine.getTaskMode());
    return todoStore.subscribe(id, setTodos);
  }, [engine]);

  function resolvePermission(response: PermissionResponse) {
    permissionResolverRef.current?.(response);
    permissionResolverRef.current = null;
    pendingPermissionRef.current = null;
    setPendingPermission(null);
  }

  function resolvePlan(decision: ApprovalDecision) {
    planResolverRef.current?.(decision);
    planResolverRef.current = null;
    pendingPlanRef.current = null;
    setPendingPlan(null);
    setPlanFeedbackMode(false);
  }

  function handleEvent(event: QueryEngineEvent) {
    setInPlanMode(engine.getPermissionMode() === 'plan');

    switch (event.type) {
      case 'text':
        setStreamingText((prev) => prev + event.text);
        break;

      case 'tool_use_start':
        setToolCalls((prev) => [
          ...prev,
          {
            id: event.id,
            name: event.name,
            done: false,
            isError: false,
          },
        ]);
        break;

      case 'tool_denied':
        setToolCalls((prev) =>
          prev.map((tc) =>
            tc.id === event.id
              ? {
                  ...tc,
                  done: true,
                  isError: true,
                  denied: true,
                }
              : tc
          )
        );
        break;

      case 'tool_use_done':
        setToolCalls((prev) =>
          prev.map((tc) =>
            tc.id === event.id
              ? { ...tc, done: true, isError: event.isError }
              : tc
          )
        );
        break;

      case 'assistant_message':
        setDisplayMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: getMessageText(event.message),
          },
        ]);
        setStreamingText('');
        break;

      case 'turn_complete':
        if (event.reason === 'tool_use') {
          setStreamingText('');
          setToolCalls([]);
        } else if (event.reason === 'aborted') {
          setErrorText('Interrupted.');
        } else if (event.reason === 'max_turns') {
          setErrorText('Reached maximum number of turns.');
        }
        break;

      case 'slash_command_result':
        setDisplayMessages((prev) => [
          ...prev,
          { role: 'system', content: event.output },
        ]);
        setActiveModel(engine.getActiveModel());
        setTaskMode(engine.getTaskMode());
        break;

      case 'session_cleared':
        setDisplayMessages([]);
        setStreamingText('');
        setToolCalls([]);
        setErrorText('');
        setLastUsage(null);
        setActiveModel(engine.getActiveModel());
        setTodos([]);
        break;

      case 'compaction': {
        const reduction =
          event.tokensBefore === 0
            ? 0
            : Math.round(
                (1 - event.tokensAfter / event.tokensBefore) * 100
              );
        setDisplayMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: `Compacted: ${event.tokensBefore.toLocaleString()} → ${event.tokensAfter.toLocaleString()} tokens (${reduction}% reduction)`,
          },
        ]);
        break;
      }

      case 'token_warning':
        setDisplayMessages((prev) => [
          ...prev,
          {
            role: 'system',
            tone: event.level,
            content: `[budget] ${event.message}`,
          },
        ]);
        if (event.level === 'blocking') {
          setErrorText(event.message);
        }
        break;

      case 'stream_reset':
        setStreamingText('');
        break;

      case 'error':
        setErrorText(event.error.message);
        break;
    }
  }

  async function handleSubmit(text: string) {
    const slashName = text.startsWith('/')
      ? text.slice(1).split(/\s+/)[0]
      : '';
    const builtinSlash = new Set([
      'help',
      'clear',
      'cost',
      'compact',
      'model',
      'history',
      'memory',
      'tasks',
    ]);
    const hideFromTranscript =
      text.startsWith('/') && builtinSlash.has(slashName);

    if (!hideFromTranscript) {
      setDisplayMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
      ]);
    }

    setIsLoading(true);
    setStreamingText('');
    setToolCalls([]);
    setErrorText('');

    try {
      for await (const event of engine.submitMessage(text)) {
        handleEvent(event);
      }

      const usage = engine.getUsage();
      setLastUsage({ in: usage.inputTokens, out: usage.outputTokens });
      setActiveModel(engine.getActiveModel());
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Unknown error';
      setErrorText(msg);
    } finally {
      setIsLoading(false);
      setStreamingText('');
      setToolCalls([]);
      setPendingPermission(null);
      permissionResolverRef.current = null;
      pendingPlanRef.current = null;
      setPendingPlan(null);
      setPlanFeedbackMode(false);
      planResolverRef.current = null;
      setInPlanMode(engine.getPermissionMode() === 'plan');
    }
  }

  useInput((input, key) => {
    if (pendingPlanRef.current) {
      if (planFeedbackMode) {
        if (key.return) {
          resolvePlan({
            type: 'reject',
            feedback: inputValue.trim() || 'Please revise the plan.',
          });
          setInputValue('');
          return;
        }
        if (key.backspace) {
          setInputValue((prev) => prev.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setInputValue((prev) => prev + input);
        }
        return;
      }

      if (input === '1') {
        resolvePlan({ type: 'auto_accept_clear' });
      } else if (input === '2') {
        resolvePlan({ type: 'auto_accept_keep' });
      } else if (input === '3') {
        resolvePlan({ type: 'manual' });
      } else if (input === '4') {
        setPlanFeedbackMode(true);
        setInputValue('');
      } else if (key.ctrl && input === 'c') {
        resolvePlan({ type: 'manual' });
      }
      return;
    }

    if (pendingPermissionRef.current) {
      const choice = (input || '').toLowerCase();
      if (choice === 'y') {
        resolvePermission('allow_once');
      } else if (choice === 'n') {
        resolvePermission('deny');
      } else if (choice === 'a') {
        resolvePermission('always_allow');
      } else if (key.ctrl && input === 'c') {
        resolvePermission('deny');
      }
      return;
    }

    if (key.ctrl && input === 'c') {
      if (isLoading) {
        engine.abort();
      }
      return;
    }

    if (key.ctrl && input === 'd') {
      exit();
      return;
    }

    if (isLoading) {
      return;
    }

    if (key.return) {
      if (inputValue.trim()) {
        handleSubmit(inputValue.trim());
        setInputValue('');
      }
      return;
    }

    if (key.backspace) {
      setInputValue((prev) => prev.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setInputValue((prev) => prev + input);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Agent CLI
        </Text>
        <Text dimColor>
          {' '}
          v0.1.0 · {activeModel}
          {sessionId ? ` · ${sessionId.slice(0, 8)}` : ''}
          {inPlanMode ? ' · plan' : ''}
          {taskMode === 'task' ? ' · tasks' : ''}
        </Text>
      </Box>

      {todos.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {todos.map((todo, i) => (
            <Text key={`${todo.content}-${i}`} dimColor={todo.status === 'pending'}>
              {todo.status === 'completed'
                ? '[x] '
                : todo.status === 'in_progress'
                  ? '[>] '
                  : '[ ] '}
              {todo.content}
            </Text>
          ))}
        </Box>
      )}

      {displayMessages.map((msg, i) => (
        <Box key={i} marginBottom={1} flexDirection="column">
          {msg.role === 'system' ? (
            <Text
              color={
                msg.tone === 'blocking'
                  ? 'red'
                  : msg.tone === 'warning'
                    ? 'yellow'
                    : msg.tone === 'info'
                      ? 'cyan'
                      : undefined
              }
              dimColor={!msg.tone}
            >
              {msg.content}
            </Text>
          ) : (
            <Text
              bold
              color={msg.role === 'user' ? 'green' : 'white'}
            >
              {msg.role === 'user' ? '> ' : ''}
              {msg.content}
            </Text>
          )}
        </Box>
      ))}

      {toolCalls.map((tc, i) => (
        <Box key={`tool-${i}`}>
          <Text>
            {'  '}
            {tc.done ? (
              <Text color={tc.denied || tc.isError ? 'red' : 'green'}>
                {tc.denied ? '⊘' : tc.isError ? '✗' : '✓'}
              </Text>
            ) : (
              <Text color="yellow">⋯</Text>
            )}{' '}
            {tc.name}
          </Text>
        </Box>
      ))}

      {pendingPermission && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          marginY={1}
        >
          <Text color="yellow" bold>
            ⚠ Permission required
          </Text>
          <Text> Tool: {pendingPermission.toolName}</Text>
          <Text> Action: {pendingPermission.summary}</Text>
          <Text dimColor> Risk: {pendingPermission.risk}</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color="green">[y]</Text> allow once
            </Text>
            <Text>
              <Text color="red">[n]</Text> deny
            </Text>
            <Text>
              <Text color="blue">[a]</Text> always allow this pattern
            </Text>
          </Box>
        </Box>
      )}

      {pendingPlan && (
        <PlanApprovalBox
          options={pendingPlan}
          feedbackMode={planFeedbackMode}
          feedbackValue={inputValue}
        />
      )}

      {isLoading &&
        !streamingText &&
        toolCalls.length === 0 &&
        !pendingPermission &&
        !pendingPlan && <Spinner />}

      {streamingText && (
        <Box marginBottom={1}>
          <Text>{streamingText}</Text>
        </Box>
      )}

      {errorText && (
        <Box>
          <Text color="red">{errorText}</Text>
        </Box>
      )}

      {lastUsage && (
        <Box>
          <Text dimColor>
            tokens: {lastUsage.in.toLocaleString()} in /{' '}
            {lastUsage.out.toLocaleString()} out
          </Text>
        </Box>
      )}

      {!isLoading && !pendingPermission && !pendingPlan && (
        <Box>
          <Text color="green" bold>
            {'> '}
          </Text>
          <Text>{inputValue}</Text>
          <Text color="gray">█</Text>
        </Box>
      )}
    </Box>
  );
}

function readPlanContent(planPath: string): string {
  try {
    return readFileSync(planPath, 'utf-8');
  } catch {
    return '(plan file could not be read)';
  }
}

function PlanApprovalBox({
  options,
  feedbackMode,
  feedbackValue,
}: {
  options: PlanApprovalOptions;
  feedbackMode: boolean;
  feedbackValue: string;
}) {
  const planContent = readPlanContent(options.planPath);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Text color="cyan" bold>
        Plan
      </Text>
      <Text>{planContent}</Text>
      {options.allowedPrompts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Auto-allow patterns:</Text>
          {options.allowedPrompts.map((pattern) => (
            <Text key={pattern} dimColor>
              {'  '}
              {pattern}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {feedbackMode ? (
          <Box>
            <Text>Feedback: {feedbackValue}</Text>
            <Text color="gray">█</Text>
          </Box>
        ) : (
          <>
            <Text>
              <Text color="green">[1]</Text> Auto-accept (clear context)
            </Text>
            <Text>
              <Text color="green">[2]</Text> Auto-accept (keep context)
            </Text>
            <Text>
              <Text color="yellow">[3]</Text> Manually approve each edit
            </Text>
            <Text>
              <Text color="red">[4]</Text> Reject with feedback
            </Text>
          </>
        )}
      </Box>
    </Box>
  );
}
