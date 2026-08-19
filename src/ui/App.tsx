import { useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { query } from '../core/agenticLoop.js';
import type { LoopEvent } from '../core/agenticLoop.js';
import { getAllTools } from '../tools/index.js';
import { Spinner } from './components/Spinner.js';
import type { Message } from '../types/message.js';

const SYSTEM_PROMPT = 'You are a helpful coding assistant.';

interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  done: boolean;
  isError: boolean;
}

function getMessageText(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

export function App() {
  const { exit } = useApp();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
  const [lastUsage, setLastUsage] = useState<{
    in: number;
    out: number;
  } | null>(null);
  const [errorText, setErrorText] = useState('');

  const abortRef = useRef<{ aborted: boolean } | null>(null);
  const messagesRef = useRef<Message[]>([]);

  function handleLoopEvent(event: LoopEvent) {
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
            input: event.input,
            done: false,
            isError: false,
          },
        ]);
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
        messagesRef.current = [
          ...messagesRef.current,
          event.message,
        ];
        setMessages([...messagesRef.current]);
        setStreamingText('');
        break;

      case 'tool_result_message':
        messagesRef.current = [
          ...messagesRef.current,
          event.message,
        ];
        setMessages([...messagesRef.current]);
        break;

      case 'turn_complete':
        if (event.reason === 'tool_use') {
          setStreamingText('');
          setToolCalls([]);
        }
        break;

      case 'error':
        setErrorText(event.error.message);
        break;
    }
  }

  async function handleSubmit(text: string) {
    const userMsg: Message = {
      role: 'user',
      content: text,
    };

    messagesRef.current = [...messagesRef.current, userMsg];
    setMessages([...messagesRef.current]);

    setIsLoading(true);
    setStreamingText('');
    setToolCalls([]);
    setErrorText('');

    const abortSignal = { aborted: false };
    abortRef.current = abortSignal;

    const loop = query({
      messages: messagesRef.current,
      tools: getAllTools(),
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: 50,
      abortSignal,
      cwd: process.cwd(),
    });

    try {
      let result = await loop.next();

      while (!result.done) {
        handleLoopEvent(result.value);
        result = await loop.next();
      }

      const loopResult = result.value;

      messagesRef.current = loopResult.messages;
      setMessages([...loopResult.messages]);
      setLastUsage({
        in: loopResult.usage.inputTokens,
        out: loopResult.usage.outputTokens,
      });

      if (loopResult.terminationReason === 'aborted') {
        setErrorText('Interrupted.');
      } else if (loopResult.terminationReason === 'max_turns') {
        setErrorText('Reached maximum number of turns.');
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Unknown error';
      setErrorText(msg);
    } finally {
      setIsLoading(false);
      setStreamingText('');
      setToolCalls([]);
      abortRef.current = null;
    }
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (abortRef.current) {
        abortRef.current.aborted = true;
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
        <Text dimColor> v0.1.0</Text>
      </Box>

      {messages.map((msg, i) => (
        <Box key={i} marginBottom={1} flexDirection="column">
          <Text
            bold
            color={msg.role === 'user' ? 'green' : 'white'}
          >
            {msg.role === 'user' ? '> ' : ''}
            {getMessageText(msg)}
          </Text>
        </Box>
      ))}

      {toolCalls.map((tc, i) => (
        <Box key={`tool-${i}`}>
          <Text>
            {'  '}
            {tc.done ? (
              <Text color={tc.isError ? 'red' : 'green'}>
                {tc.isError ? '✗' : '✓'}
              </Text>
            ) : (
              <Text color="yellow">⋯</Text>
            )}{' '}
            {tc.name}
          </Text>
        </Box>
      ))}

      {isLoading && !streamingText && toolCalls.length === 0 && (
        <Spinner />
      )}

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

      {!isLoading && (
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
