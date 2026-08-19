import { useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { Spinner } from './components/Spinner.js';
import { streamMessage } from '../services/api/streaming.js';
import type { AssistantMessage, Message } from '../types/message.js';

interface ToolCallInfo {
  name: string;
  input: Record<string, unknown>;
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

  // UI state
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

  // Async/internal state
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);

  async function runStreamingTurn(): Promise<AssistantMessage | null> {
    setIsLoading(true);
    setStreamingText('');
    setToolCalls([]);
    setErrorText('');

    const abort = new AbortController();
    abortRef.current = abort;

    const apiMessages = messagesRef.current;

    try {
      const generator = streamMessage(apiMessages, abort.signal);
      let result = await generator.next();

      while (!result.done) {
        const event = result.value;

        if (event.type === 'text') {
          setStreamingText(prev => prev + event.text);
        } else if (event.type === 'tool_use_start') {
          setToolCalls(prev => [
            ...prev,
            {
              name: event.name,
              input: {},
            },
          ]);
        }

        result = await generator.next();
      }

      setLastUsage({
        in: result.value.usage.inputTokens,
        out: result.value.usage.outputTokens,
      });

      return result.value.assistantMessage;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return null;
      }

      const msg =
        err instanceof Error ? err.message : 'Unknown error';

      setErrorText(msg);

      return null;
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }

  async function handleSubmit(text: string) {
    const userMsg: Message = {
      role: 'user',
      content: text,
    };

    const nextMessages = [
      ...messagesRef.current,
      userMsg,
    ];

    messagesRef.current = nextMessages;
    setMessages(nextMessages);

    const response = await runStreamingTurn();

    if (response) {
      const updatedMessages = [
        ...messagesRef.current,
        response,
      ];

      messagesRef.current = updatedMessages;
      setMessages(updatedMessages);
      setStreamingText('');
    }
  }

  useInput((input, key) => {
    // Ctrl+C - interrupt streaming
    if (key.ctrl && input === 'c') {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;

        setIsLoading(false);
        setStreamingText('');
        setErrorText('Interrupted.');
      }

      return;
    }

    // Ctrl+D - exit
    if (key.ctrl && input === 'd') {
      exit();
      return;
    }

    // Don't accept normal input while loading
    if (isLoading) {
      return;
    }

    // Enter - submit
    if (key.return) {
      if (inputValue.trim()) {
        handleSubmit(inputValue.trim());
        setInputValue('');
      }

      return;
    }

    // Backspace
    if (key.backspace) {
      setInputValue(prev => prev.slice(0, -1));
      return;
    }

    // Normal characters
    if (input && !key.ctrl && !key.meta) {
      setInputValue(prev => prev + input);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Agent CLI
        </Text>

        <Text dimColor>
          {' '}
          v0.1.0
        </Text>
      </Box>

      {/* Message history */}
      {messages.map((msg, i) => (
        <Box
          key={i}
          marginBottom={1}
          flexDirection="column"
        >
          <Text
            bold
            color={
              msg.role === 'user'
                ? 'green'
                : 'white'
            }
          >
            {msg.role === 'user' ? '> ' : ''}
            {getMessageText(msg)}
          </Text>
        </Box>
      ))}

      {/* Tool calls */}
      {toolCalls.map((tc, i) => (
        <Box key={`tool-${i}`}>
          <Text>
            {'  '}
            <Text color="green">✓</Text>{' '}
            {tc.name}
          </Text>
        </Box>
      ))}

      {/* Spinner */}
      {isLoading && !streamingText && <Spinner />}

      {/* Streaming response */}
      {streamingText && (
        <Box marginBottom={1}>
          <Text>{streamingText}</Text>
        </Box>
      )}

      {/* Error */}
      {errorText && (
        <Box>
          <Text color="red">{errorText}</Text>
        </Box>
      )}

      {/* Usage */}
      {lastUsage && (
        <Box>
          <Text dimColor>
            tokens:{' '}
            {lastUsage.in.toLocaleString()} in /{' '}
            {lastUsage.out.toLocaleString()} out
          </Text>
        </Box>
      )}

      {/* Input */}
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
