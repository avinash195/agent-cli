#!/usr/bin/env node

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

if (args.includes('--version') || args.includes('-v')) {
  console.log(`agent-cli v${getVersion()}`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: agent [options]');
  console.log('  -v, --version  Show version');
  console.log('  -h, --help     Show help');
  process.exit(0);
}

async function main() {
  const { render } = await import('ink');
  const { createElement } = await import('react');

  const { App } = await import('../ui/App.js');

  const instance = render(
    createElement(App)
  );

  await instance.waitUntilExit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});