# Carapace

An independent, multi-channel AI agent gateway. Carapace runs your own assistant on your
own hardware and talks to your own chats — Telegram first, raw HTTP alongside, more
later. Every line here is written for this project: not a fork, not a rebrand.

## Status: M4 (Telegram Business + durable deployment)

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
- **Telegram Business (#20786)** — when the owner connects the bot via Telegram Business
  settings, `business_message`/`business_connection` updates are handled natively:
  conversations get their own sessions plus a `[business]` context line naming the
  account, replies go out via `sendMessage` with `business_connection_id` (on behalf of
  the business account), and connection state persists across restarts. Toggle:
  `channels.telegram.business` (default true).
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
  `carapace doctor` verifies node, config, directories, storage engine, channels, llm,
  file-defined tools, and routing tables.
- **pm2-ready durability** — `ecosystem.config.cjs` + `scripts/start-gateway.sh` run the
  gateway under pm2 with autorestart, exponential restart backoff, a memory ceiling, and a
  kill timeout matching the 15s shutdown grace; credentials load from
  `~/.carapace/gateway.env`, so pm2's process dump stays secret-free.
- **Turn budget + stall watchdog (#68596)** — `llm.turnTimeoutMs` bounds one whole agent
  turn and `llm.watchdogTimeoutSec` aborts a provider call that never completes; stalled
  turns abort cleanly with a user-visible error instead of hanging forever.
- **Completion routing (#27445)** — `agent.announceTarget` delivers full replies for turns
  arriving from other chats to a chosen `channel:chatId` and leaves the origin chat a
  one-line notice; unreachable targets degrade to replying in place.
- **Per-sender routing (#81271)** — a `senders[]` config table maps sender/chat ids to
  per-sender tool allowlists and model overrides.
- **File-defined tools + setup hooks (#80213)** — `~/.carapace/tools/*.json` add
  exec-backed tools; an optional `setup` argv runs once on first load, inside the allowed
  roots, with its output logged.

Next (M5): theme system (#28300) and plugin-contributed UI (#66944) — both need a
web-layer design decision first — plus more channels (Discord, WhatsApp) and a
third-party plugin interface.

## Quickstart

```bash
npm install
npm run build
node dist/cli/index.js doctor
node dist/cli/index.js gateway
```

**Deploy:** `pm2 start ecosystem.config.cjs` — credentials in `~/.carapace/gateway.env`;
see docs/index.md, section "Deployment with pm2".

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
| llm.turnTimeoutMs | 600000 (1000–3600000) | CARAPACE_TURN_TIMEOUT_MS |
| llm.watchdogTimeoutSec | 300 (1–3600) | CARAPACE_WATCHDOG_TIMEOUT_SEC |
| channels.telegram.enabled | false | CARAPACE_TELEGRAM_ENABLED |
| channels.telegram.botToken | `{"env": "CARAPACE_TELEGRAM_TOKEN"}` | CARAPACE_TELEGRAM_TOKEN |
| channels.telegram.allowedSenders | [] (everyone) | — |
| channels.telegram.mediaDir | ~/.carapace/workspace/media | CARAPACE_MEDIA_DIR |
| channels.telegram.business | true | — |
| channels.api.enabled | true | CARAPACE_API_ENABLED |
| agent.systemPrompt | Carapace default | — |
| agent.maxToolIterations | 12 (1–64) | — |
| agent.announceTarget | null (reply to origin) | CARAPACE_ANNOUNCE_TARGET (`channel:chatId`) |
| senders | [] (no per-sender routing) | — |
| tools.allowedRoots | [~/.carapace/workspace] | — |
| tools.exec.timeoutMs | 30000 (1000–300000) | — |
| tools.exec.denylist | 7 destructive-command patterns | — |
| storage.path | ~/.carapace/carapace.db | CARAPACE_STORAGE_PATH |

`CARAPACE_HOME` moves the whole config/state directory (handy for tests).

**Secrets:** don't paste tokens inline. Point at them instead — `{"env": "VARNAME"}` reads
an environment variable, `{"file": "/path"}` reads a file (tilde allowed). Resolution
happens at runtime; the value never lands in config files or logs.

## Community wishlist → Carapace

Carapace's roadmap is driven by what users actually ask for upstream. M3 and M4 turn the
top-liked community requests from the upstream project into native features, designed in rather than patched on:

| Upstream issue | 👍 | Carapace feature |
|---|---|---|
| #68596 configurable streaming watchdog | 8 | `llm.turnTimeoutMs` + `llm.watchdogTimeoutSec` — stalled turns abort cleanly with a user-visible error |
| #27445 announceTarget for completion routing | 5 | `agent.announceTarget` — full replies route to a chosen `channel:chatId`; the origin chat gets a short notice |
| #80213 tool/skill setup hooks | 4 | `~/.carapace/tools/*.json` declare exec-backed tools with a once-only `setup` argv (marker-tracked, logged) |
| #20786 Telegram Business Bot support | 7 | `business_message`/`business_connection` handled natively — persisted connections, separate business sessions, replies on behalf of the business account |
| #81271 per-sender exec node routing | 3 | `senders[]` routing table — per-sender tool allowlists + model overrides (single-node adaptation) |

Deferred to M5 (larger surfaces): theme customization (#28300) and plugin-contributed UI
pages (#66944) — both need a web-layer design decision first.

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

See [docs/index.md](docs/index.md) for architecture, the full config reference, Telegram
Business, pm2 deployment, media handling, restart semantics, doctor checks, and the
roadmap.

## License

MIT. `LICENSE` + `THIRD_PARTY_NOTICES.md` retain attribution for any lineage we reference.