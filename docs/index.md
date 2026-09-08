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

## Architecture at M2

```
src/
├── cli/index.ts          carapace gateway | doctor | models | version | help
├── config.ts             ~/.carapace/config.json loader, CARAPACE_* overrides, SecretRef
├── core/
│   ├── agent.ts          agent loop: LLM → tool exec → iterate (defensive tool handling)
│   ├── llm.ts            OpenAI-compatible chat-completions provider (fetch-based)
│   ├── session.ts        SessionStore: identity, history, context assembly, deletion
│   └── tools/
│       ├── registry.ts   tool registry + OpenAI function specs
│       └── builtins/     exec (timeout + denylist), files (root confinement), web_fetch
├── gateway/
│   ├── server.ts         node:http server, /health, route table (500-on-throw)
│   ├── runtime.ts        wiring, per-chat busy gate, waitUntilIdle, offset adapter
│   └── channels/
│       ├── types.ts      ChannelAdapter contract, BusyTurnError, SessionDirectory
│       ├── telegram.ts   long-poll adapter: commands, media, offsets, drain
│       └── api.ts        HTTP channel: POST /api/v1/messages, GET /api/v1/sessions
├── storage/sqlite.ts     node:sqlite store (sessions, messages, channel_state; WAL)
└── types/node.d.ts       hand-rolled ambient types (keeps devDeps to typescript only)
```

Zero runtime dependencies. TypeScript is the only devDependency. Node >= 22 provides
everything else (fetch, node:sqlite, node:http).

## Gateway runtime semantics

### One session per chat

Every inbound message belongs to the session `<channel>:<chatId>` (e.g. `telegram:12345`,
`api:tester`). Sessions persist across gateway restarts; `/reset` (Telegram) deletes the
chat's session and its history via cascade, so the next message starts fresh. The most
recent sessions are visible through `GET /api/v1/sessions` and the Telegram `/sessions`
command.

### Busy queue

The runtime keeps one in-flight agent turn per chat. While it runs, further messages for
that chat wait in a bounded queue — up to `gateway.busyQueueLimit` (default 10). A full
queue refuses the message with `BusyTurnError`, which channels translate into a Telegram
notice ("queue for this chat is full") or an HTTP 429; nothing is dropped silently.
Different chats always run concurrently. `runtime.waitUntilIdle(ms)` reports when every
chat is drained (used by shutdown and tests).

### Media handling (Telegram)

Inbound photos (largest `PhotoSize` of the array), documents, and voice notes are
downloaded via `getFile` + the Bot API file endpoint into `channels.telegram.mediaDir`
(default `~/.carapace/workspace/media`, inside the default `tools.allowedRoots` so the
agent can read them). Saved names are collision-safe: `photo_<uniqueId>.jpg`,
`voice_<uniqueId>.ogg`, `doc_<uniqueId>_<sanitized-name>` (path separators and control
characters stripped, 64-char cap). The message text handed to the agent lists each saved
path with kind, mime type, size, and (for voice) duration; a caption rides along after a
blank line. Downloads respect the 20 MB Bot API cap; a failed or oversized attachment
degrades into a `[media] <kind> unavailable (…)` note inside the same turn, so one bad
attachment never kills the reply. Unsupported types (e.g. stickers) get a short notice.

### Graceful restarts

SIGTERM/SIGINT: channels stop first (the Telegram long poll aborts and in-flight updates
get up to 10s to finish), then the runtime waits up to 15s (`SHUTDOWN_GRACE_MS`) for
agent turns to drain, then the HTTP server closes (lingering sockets are force-closed)
and the store is closed. Restart safety comes from update offsets: an update id is
confirmed to Telegram only after every id up to it has finished processing (the
*contiguous frontier*, persisted in `channel_state` under `telegram:update_offset`). On
boot the long poll resumes at `frontier + 1`; a crash therefore causes redelivery of
whatever was still in flight — never loss. Redelivered ids already known to the channel
are re-confirmed without re-processing. The SQLite database runs in WAL journal mode, so
committed state survives crashes without losing tail writes.

## Endpoints

| Endpoint | Auth | Request / response |
|---|---|---|
| GET /health | — | `{ok, service, version, uptimeSec, node}` |
| GET / | — | index with the route list |
| POST /api/v1/messages | bearer | body `{"senderId": string, "text": string, "chatId"?: string}` → 200 `{"reply": string, "channel": "api", "chatId": string}` |
| GET /api/v1/sessions | bearer | 200 `{"sessions": [{id, channel, createdAt, updatedAt, messages}]}` (50 most recent) |
| GET /api/v1/channels | — | channel status listing |

Status codes on POST: 200 · 400 invalid body · 401 unauthorized · 413 payload too large ·
429 busy queue full · 500 agent turn failure (detail included). Bearer auth uses
`Authorization: Bearer <gateway.apiToken>` with a constant-time compare; 401 carries a
`WWW-Authenticate: Bearer` header. With no token configured the channel runs open — bind
it to localhost in that case; doctor names the mode.

## Telegram commands

| Command | Effect |
|---|---|
| /start, /help | welcome text with the command list |
| /id | this chat's id and your sender id |
| /sessions | the 10 most recently active sessions with message counts |
| /reset | delete this chat's session (history cascade) — next message starts fresh |

Unknown slash commands fall through to the agent like any other text. Only senders listed
in `channels.telegram.allowedSenders` are processed (empty list = everyone).

## Configuration

`~/.carapace/config.json` is created with defaults on first run. Every value has a
`CARAPACE_*` env override; env wins over the file.

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
| channels.telegram.allowedSenders | [] | — |
| channels.telegram.mediaDir | ~/.carapace/workspace/media | CARAPACE_MEDIA_DIR |
| channels.api.enabled | true | CARAPACE_API_ENABLED |
| agent.systemPrompt | Carapace default | — |
| agent.maxToolIterations | 12 (1–64) | — |
| tools.allowedRoots | [~/.carapace/workspace] | — |
| tools.exec.timeoutMs | 30000 (1000–300000) | — |
| tools.exec.denylist | 7 destructive-command patterns | — |
| storage.path | ~/.carapace/carapace.db | CARAPACE_STORAGE_PATH |

`CARAPACE_HOME` relocates the entire config/state directory (handy for tests). The M0-era
`channels.telegram.token` key is still accepted as an alias for `botToken`.

### SecretRef

Never paste tokens into config when you can avoid it. A SecretRef points at where the
secret lives:

```json
{ "env": "CARAPACE_TELEGRAM_TOKEN" }   // read an environment variable
{ "file": "/run/secrets/tg_token" }    // read a file (tilde allowed)
```

Resolution happens at runtime via `resolveSecret()`; the resolved value never lands in
config files or logs — status output only ever names the source. This applies to
`llm.apiKey`, `gateway.apiToken`, and `channels.telegram.botToken` alike.

## Doctor checks

`carapace doctor` reports and exits 0 when healthy:

1. node version (>= 22 required — node:sqlite + fetch)
2. config load/validate (creates defaults on first run; lists every schema issue)
3. config home directory writable
4. storage directory writable
5. storage engine probe: sessions + messages round-trip on a throwaway db in tmp
6. channel status (telegram enabled/token resolution/media dir, api enabled/auth mode)
7. llm reachability of secrets (`apiKey` unresolved is a warning, not a failure)
8. tools: allowedRoots writability, exec timeout, denylist size

Disabled-by-config channels are reported, not failed — a default install with only the
API channel enabled is healthy. Note: `node:sqlite` prints an upstream
`ExperimentalWarning` on first use; it is harmless.

## Storage schema

- `sessions(id, channel, created_at, updated_at, metadata)` — one row per conversation
- `messages(id, session_id, role, content, tool_call_id, tool_name, tool_calls, created_at)`
  — full turn history, roles user / assistant / tool / system, foreign-keyed with cascade
  delete (assistant tool calls persist as JSON and round-trip losslessly)
- `channel_state(key, value, updated_at)` — channel bookkeeping, currently the Telegram
  update-offset frontier

All tables are created idempotently on open; post-M0 columns are migrated in place, so
pre-M1 databases keep working.

## Roadmap

- **M2 (done):** gateway hardening — bearer auth on the API channel, Telegram media
  handling, multi-session management (/sessions, /reset, GET /api/v1/sessions), busy
  queue with bounded per-chat waiting, graceful restarts with persisted update offsets.
- **M3:** community-wishlist features designed in natively (configurable watchdogs,
  exec-approval denylist extensions, theme system, plugin UI hooks).
- **M4:** more channels (Discord, WhatsApp, …) and a third-party plugin interface.

## Conventions

- Conventional commits; one commit per coherent unit.
- A milestone lands green (typecheck + tests) before the next starts.
- No secrets in code or config; SecretRefs only.