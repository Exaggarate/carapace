# Carapace

An independent, multi-channel AI agent gateway. Carapace runs your own assistant on your
own hardware and talks to your own chats — Telegram first, raw HTTP alongside, more
later. Every line here is written for this project: not a fork, not a rebrand.

## Status: M0 (skeleton)

Working today:

- `carapace gateway` — boots config + HTTP server (`GET /health`, route table)
- `carapace doctor` — real health report: node, config, directories, storage, channels
- `carapace models` — provider listing placeholder (providers land in M1)
- `carapace version` / `carapace help`
- config bootstrap: `~/.carapace/config.json` created on first run, `CARAPACE_*` env overrides
- SecretRef placeholders in config (`{"env": "NAME"}` / `{"file": "/path"}`), resolved at runtime
- SQLite storage via Node's built-in `node:sqlite` (sessions + messages schema)

Next (M1): the agent loop — model providers, tool execution, session streaming into channels.

## Quickstart

```bash
npm install
npm run build
node dist/cli/index.js doctor
node dist/cli/index.js gateway
```

## Config

`~/.carapace/config.json` (created with defaults if missing). Env overrides use the
`CARAPACE_` prefix and win over the file:

| Key | Default | Env override |
|---|---|---|
| gateway.host | 127.0.0.1 | CARAPACE_GATEWAY_HOST |
| gateway.port | 8787 | CARAPACE_GATEWAY_PORT |
| channels.telegram.enabled | false | CARAPACE_TELEGRAM_ENABLED |
| channels.telegram.token | {"env": "CARAPACE_TELEGRAM_TOKEN"} | CARAPACE_TELEGRAM_TOKEN |
| channels.api.enabled | true | CARAPACE_API_ENABLED |
| agent.model | placeholder | CARAPACE_AGENT_MODEL |
| storage.path | ~/.carapace/carapace.db | CARAPACE_STORAGE_PATH |

`CARAPACE_HOME` moves the whole config directory (handy for tests).

**Secrets:** don't paste tokens inline. Point at them instead — `{"env": "VARNAME"}` reads
an environment variable, `{"file": "/path"}` reads a file (tilde allowed). Resolution
happens at runtime; the value never lands in config files or logs.

## Requirements

- Node.js >= 22 (built-in `node:sqlite` + fetch; sqlite prints an upstream
  ExperimentalWarning — harmless)
- TypeScript for builds only — zero runtime dependencies by design

## Docs

See [docs/index.md](docs/index.md) for architecture, the full config reference, doctor
checks, and the roadmap.

## License

MIT (attribution files land with the legacy-branch worker).