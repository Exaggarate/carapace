# Carapace

An independent, multi-channel AI agent gateway. Carapace runs your own assistant on your
own hardware and talks to your own chats — Telegram first, raw HTTP alongside, more
later. Every line here is written for this project: not a fork, not a rebrand.

## Status: M2 (gateway hardening)

Working today:

- **Agent loop** — OpenAI-compatible chat completions with tool calling; the loop iterates
  model → tools → results until a final answer (cap: `agent.maxToolIterations`). Provider
  failures and iteration caps degrade into readable replies, never crashes.
- **Built-in tools** — `exec` (timeout + denylist), `files` (confined to
  `tools.allowedRoots`), `web_fetch` (http/https only). All outputs are truncated to safe
  sizes and errors come back as tool results the model can recover from.
- **Sessions + SQLite** — every chat gets a persistent session (`<channel>:<chatId>`); full
  history including tool calls round-trips through `node:sqlite` (WAL journal mode).
- **Telegram channel** — long-poll adapter with `/start`, `/help`, `/id`, `/sessions`,
  `/reset`, a sender allowlist, and media handling: photos, documents and voice notes are
  downloaded into `channels.telegram.mediaDir` and passed to the agent as context paths,
  captions included.
- **HTTP channel** — `POST /api/v1/messages` runs the same agent loop; `GET /api/v1/sessions`
  lists sessions; both require bearer auth when `gateway.apiToken` resolves (constant-time
  compare, 401 on missing/wrong token).
- **Busy handling** — one in-flight turn per chat; further messages wait in a bounded queue
  (`gateway.busyQueueLimit`, default 10). A full queue is refused with a Telegram notice or
  HTTP 429 — nothing is dropped silently.
- **Graceful restarts** — SIGTERM/SIGINT stop channels, abort long polls, drain in-flight
  updates, and give agent turns a bounded grace period. Telegram update offsets persist in
  SQLite (contiguous frontier), so a restart resumes exactly where processing stopped —
  redelivery, never loss.
- **Gateway + doctor** — `carapace gateway` boots the runtime on `gateway.host:gateway.port`;
  `carapace doctor` verifies node, config, directories, storage engine, channels, llm, tools.

Next (M3): community-wishlist features designed in natively.

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
| gateway.port | 8899 | CARAPACE_GATEWAY_PORT |
| gateway.apiToken | `{"env": "CARAPACE_API_TOKEN"}` | CARAPACE_API_TOKEN |
| gateway.busyQueueLimit | 10 (1–100) | CARAPACE_BUSY_QUEUE_LIMIT |
| llm.baseURL | https://api.openai.com/v1 | CARAPACE_LLM_BASE_URL |
| llm.apiKey | `{"env": "CARAPACE_LLM_API_KEY"}` | CARAPACE_LLM_API_KEY |
| llm.model | gpt-4o-mini | CARAPACE_LLM_MODEL |
| llm.timeoutMs | 120000 (5000–600000) | — |
| channels.telegram.enabled | false | CARAPACE_TELEGRAM_ENABLED |
| channels.telegram.botToken | `{"env": "CARAPACE_TELEGRAM_TOKEN"}` | CARAPACE_TELEGRAM_TOKEN |
| channels.telegram.allowedSenders | [] (everyone) | — |
| channels.telegram.mediaDir | ~/.carapace/workspace/media | CARAPACE_MEDIA_DIR |
| channels.api.enabled | true | CARAPACE_API_ENABLED |
| agent.systemPrompt | Carapace default | — |
| agent.maxToolIterations | 12 (1–64) | — |
| tools.allowedRoots | [~/.carapace/workspace] | — |
| tools.exec.timeoutMs | 30000 (1000–300000) | — |
| tools.exec.denylist | 7 destructive-command patterns | — |
| storage.path | ~/.carapace/carapace.db | CARAPACE_STORAGE_PATH |

`CARAPACE_HOME` moves the whole config/state directory (handy for tests).

**Secrets:** don't paste tokens inline. Point at them instead — `{"env": "VARNAME"}` reads
an environment variable, `{"file": "/path"}` reads a file (tilde allowed). Resolution
happens at runtime; the value never lands in config files or logs.

## API endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| GET /health | — | liveness, version, uptime |
| GET / | — | index + route listing |
| POST /api/v1/messages | bearer | run one agent turn for a chat |
| GET /api/v1/sessions | bearer | list the 50 most recent sessions with message counts |
| GET /api/v1/channels | — | channel status |

Bearer auth: `Authorization: Bearer <gateway.apiToken>` (constant-time compare). With no
token configured the API channel runs open — keep `gateway.host` on localhost in that case;
`carapace doctor` flags the mode. Status codes: 200 reply · 400 invalid body · 401
unauthorized · 413 payload too large · 429 busy queue full · 500 agent turn failure.

## Requirements

- Node.js >= 22 (built-in `node:sqlite` + fetch; sqlite prints an upstream
  ExperimentalWarning — harmless)
- TypeScript for builds only — zero runtime dependencies by design

## Docs

See [docs/index.md](docs/index.md) for architecture, the full config reference, media
handling, restart semantics, doctor checks, and the roadmap.

## License

MIT. `LICENSE` + `THIRD_PARTY_NOTICES.md` retain attribution for any lineage we reference.