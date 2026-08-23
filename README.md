# agent-cli

A terminal coding agent. Sessions persist under `~/.agent`.

## Run

```bash
npm install
```

Put `ANTHROPIC_AUTH_TOKEN` in `.env`. 

```bash
npm run dev
```

## Features

- File, search, and shell tools (`Read`, `write_file`, `edit_file`, `grep`, `glob`, `bash`)
- Permission prompts on writes and unknown shell commands (`y` / `n` / `a`)
- Plan mode, in-session todos, and a persistent task graph (`/tasks`)
- MCP servers, Markdown skills (`SKILL.md`), and lifecycle hooks
- Config in `~/.agent/settings.json` and `.agent/settings.json`

Slash commands: `/help`, `/clear`, `/compact`, `/cost`, `/model`, `/history`, `/memory`, `/tasks`.
