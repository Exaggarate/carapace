# Carapace

Carapace is an independent, multi-channel AI agent gateway. It runs on hardware you
control, answers inside chat surfaces you already use, and keeps its state in files and
SQLite you can back up with `cp`. It is an original codebase — not a fork, not a
rebrand — and its roadmap is driven by what its users actually ask for.

## Why it exists

Most assistant gateways assume the vendor owns your runtime. Carapace assumes the
opposite: the operator (you) owns the machine, the config, the secrets, and the chat
accounts. The gateway's job is to connect those chats to an agent loop with tools —
reliably, transparently, and without phoning home.

## Architecture at M0

```
src/
├── cli/index.ts          carapace gateway | doctor | models | version | help
├── config.ts             ~/.carapace/config.json loader, CARAPACE_* overrides, SecretRef
├── gateway/
│   ├── server.ts         node:http server, GET /health, exact-match route table
│   └── channels/
│       ├── types.ts      shared ChannelAdapter contract
│       ├── telegram.ts   Telegram adapter skeleton (real transport lands in M1)
│       └── api.ts        raw HTTP channel (POST /api/v1/messages, frozen contract)
├── core/
│   ├── agent.ts          agent loop types + documented M1 contract (runAgentTurn stub)
│   └── tools/registry.ts tool registry types + empty registry
├── storage/sqlite.ts     node:sqlite store (sessions + messages)
└── types/node.d.ts       hand-rolled ambient types (keeps devDeps to typescript only)
```

Zero runtime dependencies. TypeScript is the only devDependency. Node >= 22 provides
everything else (fetch, node:sqlite, node:http).

## Quickstart

```bash
npm install
npm run build
node dist/cli/index.js doctor    # real health report; exit 0 means healthy
node dist/cli/index.js gateway   # boots config + HTTP server on 127.0.0.1:8787
```

## Configuration

`~/.carapace/config.json` is created with defaults on first run. Every value has a
`CARAPACE_*` env override; env wins over file.

| Key | Default | Env override |
|---|---|---|
| gateway.host | 127.0.0.1 | CARAPACE_GATEWAY_HOST |
| gateway.port | 8787 | CARAPACE_GATEWAY_PORT |
| channels.telegram.enabled | false | CARAPACE_TELEGRAM_ENABLED |
| channels.telegram.token | `{"env": "CARAPACE_TELEGRAM_TOKEN"}` | CARAPACE_TELEGRAM_TOKEN |
| channels.telegram.allowedSenders | [] | — |
| channels.api.enabled | true | CARAPACE_API_ENABLED |
| agent.model | placeholder | CARAPACE_AGENT_MODEL |
| agent.maxToolIterations | 8 (1–64) | — |
| storage.path | ~/.carapace/carapace.db | CARAPACE_STORAGE_PATH |

`CARAPACE_HOME` relocates the entire config/state directory (handy for tests).

### SecretRef

Never paste tokens into config when you can avoid it. A SecretRef points at where the
secret lives:

```json
{ "env": "CARAPACE_TELEGRAM_TOKEN" }   // read an environment variable
{ "file": "/run/secrets/tg_token" }    // read a file (tilde allowed)
```

Resolution happens at runtime via `resolveSecret()`; the resolved value never lands in
config files or logs — status output only ever names the source.

## Doctor checks

`carapace doctor` reports and exits 0 when healthy:

1. node version (>= 22 required — node:sqlite + fetch)
2. config load/validate (creates defaults on first run; lists every schema issue)
3. config home directory writable
4. storage directory writable
5. storage engine probe: sessions + messages round-trip on a throwaway db in tmp
6. channel status (telegram enabled/token resolution, api enabled)

Disabled-by-config channels are reported, not failed — a default install with only the
API channel enabled is healthy. Note: `node:sqlite` prints an upstream
`ExperimentalWarning` on first use; it is harmless.

## Storage schema (M0)

- `sessions(id, channel, created_at, updated_at, metadata)` — one row per conversation
- `messages(id, session_id, role, content, created_at)` — full turn history,
  roles: user / assistant / tool / system, foreign-keyed with cascade delete

## Roadmap

- **M0 (done):** repo scaffold, config loader + SecretRef, CLI (gateway/doctor/models),
  HTTP server with /health, channel skeletons, tool registry types, sqlite store.
- **M1:** the agent loop — model providers (openai-compatible, anthropic, ollama),
  tool execution (exec/files/web), session persistence, streaming into Telegram.
- **M2:** gateway hardening — multi-session, auth, pairing, media, graceful restarts.
- **M3:** community-wishlist features designed in natively (configurable watchdogs,
  exec-approval denylists, theme system, plugin UI hooks).
- **M4:** more channels (Discord, WhatsApp, …) and a third-party plugin interface.

## Conventions

- Conventional commits; one commit per coherent unit.
- A milestone lands green (typecheck + tests) before the next starts.
- No secrets in code or config; SecretRefs only.