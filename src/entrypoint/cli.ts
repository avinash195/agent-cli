#!/usr/bin/env node

import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  const pkgPath = resolve(__dirname, '../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

const args = process.argv.slice(2);
const cwd = process.cwd();

if (args.includes('--version') || args.includes('-v')) {
  console.log(`agent-cli v${getVersion()}`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: agent [options]');
  console.log('  -v, --version           Show version');
  console.log('  -h, --help              Show help');
  console.log('  --resume [session-id]   Resume the latest or specified session');
  console.log('  --dump-system-prompt    Print assembled system prompt and exit');
  process.exit(0);
}

if (args.includes('--dump-system-prompt')) {
  const { renderSystemPrompt } = await import('../context/systemPrompt.js');
  const { loadAllSkills } = await import('../skills/loader.js');
  console.log(
    renderSystemPrompt({ cwd, skills: loadAllSkills(cwd) })
  );
  process.exit(0);
}

async function main() {
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { getModel } = await import('../services/api/client.js');
  const { App } = await import('../ui/App.js');
  const { McpManager } = await import('../mcp/manager.js');
  const { registerExternalTools } = await import('../tools/index.js');
  const { loadAllSkills } = await import('../skills/loader.js');
  const { createSkillTool } = await import('../skills/skillTool.js');

  const mcpManager = new McpManager();
  const mcpTools = await mcpManager.initialize();
  const skills = loadAllSkills(cwd);
  registerExternalTools([
    ...(skills.length > 0 ? [createSkillTool(skills)] : []),
    ...mcpTools,
  ]);

  const shutdown = async () => {
    await mcpManager.shutdown();
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  let initialMessages: import('../types/message.js').Message[] = [];
  let initialUsage = { inputTokens: 0, outputTokens: 0 };
  let sessionId: string = crypto.randomUUID();

  const resumeIndex = args.indexOf('--resume');
  if (resumeIndex !== -1) {
    const maybeId = args[resumeIndex + 1];
    const targetId =
      maybeId && !maybeId.startsWith('--') ? maybeId : undefined;

    try {
      const { restoreSession } = await import('../persistence/restore.js');
      const restored = await restoreSession(cwd, targetId);
      initialMessages = restored.messages;
      initialUsage = restored.usage;
      sessionId = restored.sessionId;

      console.log(
        `Resumed session ${sessionId.slice(0, 8)}... ` +
          `(${initialMessages.length} messages, ` +
          `${initialUsage.inputTokens.toLocaleString()} input tokens)`
      );
    } catch (error) {
      console.error(
        `Failed to resume: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  } else {
    const { appendTranscriptEntry } = await import(
      '../persistence/transcript.js'
    );

    await appendTranscriptEntry(cwd, sessionId, {
      type: 'session_meta',
      sessionId,
      cwd: resolve(cwd),
      startedAt: new Date().toISOString(),
      model: getModel(),
    });
  }

  const instance = render(
    createElement(App, {
      initialMessages,
      initialUsage,
      sessionId,
    })
  );

  await instance.waitUntilExit();
  await mcpManager.shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
