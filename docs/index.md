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

## Architecture at M7

```
src/
├── cli/index.ts          carapace gateway | doctor | models | skills | version | help
├── config.ts             ~/.carapace/config.json loader, CARAPACE_* overrides, SecretRef
├── core/
│   ├── agent.ts          agent loop: LLM → tool exec → iterate (defensive tool handling)
│   ├── llm.ts            provider re-exports (implementations live under llm/providers/)
│   ├── llm/providers/    openai · anthropic (/v1/messages) · ollama · fallback chain (M7)
│   ├── skills.ts         skill playbooks: SKILL.md scan, change-watch, context index (M7)
│   ├── session.ts        SessionStore: identity, history, context assembly, deletion
│   └── tools/
│       ├── registry.ts   tool registry + OpenAI function specs
│       ├── custom.ts     file-defined tools (~/.carapace/tools) + once-only setup hooks
│       └── builtins/     exec (timeout + denylist), files (root confinement), web_fetch
├── gateway/
│   ├── server.ts         node:http server, /health, route table (500-on-throw)
│   ├── runtime.ts        wiring, per-chat busy gate, waitUntilIdle, offset adapter
│   ├── dashboard.ts      GET /ui single-page dashboard + theme system (#28300)
│   ├── plugins.ts        plugin-UI loader: manifest scan + panel routes (#66944)
│   └── channels/
│       ├── types.ts      ChannelAdapter contract, BusyTurnError, SessionDirectory
│       ├── telegram.ts   long-poll adapter: commands, media, business (#20786), offsets, drain
│       ├── discord.ts    gateway WS adapter: identify, heartbeat, resume, REST sender (M6)
│       └── api.ts        HTTP channel: POST /api/v1/messages, GET /api/v1/sessions
├── storage/sqlite.ts     node:sqlite store (sessions, messages, channel_state; WAL)
└── types/node.d.ts       hand-rolled ambient types (keeps devDeps to typescript only)

plugins/                 bundled plugin-UI extensions (system-info example, #66944)
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

### Telegram Business support (#20786)

When the owner connects the bot to their account via Telegram Business settings, the Bot
API starts delivering `business_connection` and `business_message` updates. Carapace
handles both natively (toggle: `channels.telegram.business`, default `true`):

- `business_connection` updates are remembered — connection id, the business user's
  @username/name, `can_reply`, `is_enabled` — and persisted in `channel_state`
  (`telegram:business_connections`), so business chats keep working after a restart
  without waiting for a fresh connection update.
- `business_message` updates route through the same agent loop as normal messages. The
  agent receives a `[business] Replying on behalf of @<username>` context line, and the
  conversation gets its own session (`telegram:business:<chatId>`), separate from any
  direct chat with the same customer.
- Replies go out via `sendMessage` carrying `business_connection_id`, so they are sent on
  behalf of the business account; the typing indicator is scoped the same way.
- Authorization: business customers are trusted via the active connection (`is_enabled`
  and `can_reply` both required); `channels.telegram.allowedSenders` applies to direct
  bot chats only. Messages for unknown, disabled, or non-replying connections are dropped
  and logged. With the toggle off, business messages are ignored while direct chats keep
  working (connections are still recorded, so re-enabling later just works).
- Media in business messages (photo/document/voice) is handled like direct-chat media.

`allowed_updates` includes the business update types automatically; no Bot API-side setup
is needed beyond connecting the bot in Telegram Business settings.

### Discord adapter (M6)

`src/gateway/channels/discord.ts` connects to `wss://gateway.discord.dev/?v=10&encoding=json`
with Node 22's built-in WebSocket — zero runtime dependencies, no Discord library:

- **Identify** — after HELLO the adapter sends IDENTIFY with `channels.discord.botToken`
  (SecretRef, resolved at runtime) and intents GUILD_MESSAGES | DIRECT_MESSAGES |
  MESSAGE_CONTENT. The portal's MESSAGE CONTENT INTENT toggle must be enabled — without
  it Discord delivers guild message content empty (DMs still carry content; the README's
  Discord setup section explains why the toggle is privileged).
- **Heartbeat** — every `heartbeat_interval` from HELLO the adapter sends `{op: 1, d: seq}`;
  a missed HEARTBEAT_ACK tears the zombie link down and resumes.
- **Resume** — READY's `session_id` and every dispatch's `seq` are remembered; after any
  close (server RECONNECT op 7, dropped socket, backoff capped at 30 s) the adapter sends
  RESUME with `token + session_id + seq`. INVALID_SESSION `d=true` resumes, `d=false`
  forgets the session and identifies fresh after the mandated 1–5 s pause. Close code
  4004 is fatal — the token is invalid, retrying can never succeed.
- **Dispatch → agent** — MESSAGE_CREATE (bot authors and webhook chatter ignored,
  whitespace-only skipped) becomes a `discord:<chatId>` session message through the same
  per-chat busy gate as every channel; replies post via REST
  `POST /channels/{id}/messages`, split at the 2000-character content cap.
- **Rate limits** — REST sends run through a serialized queue; `x-ratelimit-remaining: 0`
  (with `x-ratelimit-reset-after`) sets a cooldown before the next send, and a 429 body's
  `retry_after` triggers exactly one delayed retry.
- **Doctor** — `channel:discord` reports enabled/token resolution; with a resolvable
  token, `channel:discord-gateway` probes REST `GET /users/@me` (401 FAILs, unreachable
  WARNs). A disabled channel never touches the network.

Disabled by default (`channels.discord.enabled: false`) — the adapter only connects once
a token resolves.

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

### Turn budget and stall watchdog (#68596)

Two `llm` keys keep a hung model from hanging the gateway:

- `llm.turnTimeoutMs` (default 600000, range 1000–3600000) — wall-clock budget for one
  whole agent turn, covering every LLM call and tool run. A turn that passes its deadline
  is aborted cleanly at the next step boundary and the chat gets a readable error reply.
- `llm.watchdogTimeoutSec` (default 300, range 1–3600) — per-call stall watchdog: a
  provider call that produces no completion within this window is aborted (real fetches
  are cancelled via an abort signal; providers that ignore it are cut by the loop's
  timer race).

Both surface the abort reason to the user ("the model stalled — no response within Ns…"
or "the turn exceeded its …ms budget…") and persist it as the turn's final assistant
message. Env overrides: `CARAPACE_TURN_TIMEOUT_MS`, `CARAPACE_WATCHDOG_TIMEOUT_SEC`. The
effective single-step cap is the minimum of `llm.timeoutMs`, the watchdog, and the
remaining turn budget.

### Completion routing — agent.announceTarget (#27445)

`agent.announceTarget: { "channel": "telegram", "chatId": "-100123456" }` (or env
`CARAPACE_ANNOUNCE_TARGET=telegram:-100123456`) routes turn completions: when a message
arrives from a different chat, the full reply is delivered to the target chat through
that channel's adapter, and the origin chat receives a one-line routing notice instead.
Targets that are unknown, disabled, or reply-in-band (the HTTP API channel cannot
receive pushes) degrade to replying in place, with a single warning logged. Same-chat
turns are never double-sent. This is the native adaptation of upstream sub-agent
completion routing: completion notices land where the owner wants them.

### Per-sender routing — senders[] (#81271)

A top-level `senders` table maps a sender or chat id to routing overrides; the first
matching entry wins:

```json
{
  "senders": [
    { "match": "12345", "allowTools": ["files", "web_fetch"], "model": "gpt-4o-mini" },
    { "match": "-100999", "channel": "telegram", "model": "llama3" }
  ]
}
```

- `match` — exact sender id or chat id; `channel` (optional) scopes the route to one
  channel.
- `allowTools` — per-sender tool allowlist: the tool specs offered to the model for that
  turn are filtered, so restricted senders never even see the rest.
- `model` — per-sender model override; the runtime builds (and caches) one provider per
  model name.

This adapts upstream's per-sender "exec node routing" intent to Carapace's single-node
architecture: instead of routing to different machines, it routes to different toolsets
and models on the same node. Validation rejects entries without `allowTools` or `model`
and duplicate `channel:match` pairs; doctor lists the routes and warns about unknown
tool names.

### File-defined tools and setup hooks (#80213)

Tool definition files live in `~/.carapace/tools/*.json`:

```json
{
  "name": "git_status",
  "description": "git status of the workspace",
  "inputSchema": { "type": "object", "properties": {}, "required": [] },
  "exec": { "argv": ["git", "status", "--short"] },
  "setup": { "argv": ["bash", "-c", "mkdir -p ~/.carapace/cache"] }
}
```

- `exec.argv` is spawned directly (no shell) inside the first allowed root when the
  model calls the tool; `{{key}}` tokens substitute model-supplied arguments into single
  argv entries (never shell-interpolated). Exit code 0 → ok; stdout/stderr return as the
  tool result, capped like the exec tool. Timeout: `tools.exec.timeoutMs`.
- `setup` is optional: it runs ONCE on first load — inside the allowed roots, output
  logged as `[tools] setup "<name>" ok/FAILED …` — tracked by a marker file under
  `<toolsDir>/.setup/<name>-<argv-hash>`, so an edited setup re-runs exactly once. A
  failed setup is logged and retried on the next boot; it never blocks tool registration
  or gateway boot.
- Broken definition files and name collisions with built-ins degrade to warnings.
- Definition files are operator-authored and executed on the operator's machine — the
  same trust level as config.json itself. `carapace doctor` validates them read-only
  (check `tools:custom`) and never runs setups.

### Web dashboard + theme system (#28300)

`GET /ui` serves a zero-dependency single-page dashboard (vanilla HTML/JS/CSS, no build
step) over the gateway's own HTTP surface:

- **Status** — version, uptime, node version, model, storage path with live session/message
  counts, and one chip per channel; refreshes every 15s.
- **Sessions** — the 50 most recent sessions; `View` opens the messages view, `Reset`
  deletes a session (history cascades) after a confirm dialog.
- **Messages** — the most recent N messages of the selected session (limit 50/100/200),
  role-chipped, tool rows labeled with their tool name.
- **Chat** — a console that POSTs to `/api/v1/messages` and renders the reply; a full
  busy queue surfaces as an inline notice, ctrl+enter sends.
- **Config** — the full config structure with every secret value replaced by its origin
  (`from env:NAME`, `from file:PATH`, `set inline — value hidden`). The dashboard never
  displays, stores, or transmits secret values.
- **Plugins** — cards for the loaded plugin-UI panels (next section).

**Auth model:** the page shell is static HTML and carries no data, so `GET /ui` stays
open; every data endpoint (`/api/v1/status`, `/api/v1/config`, `/api/v1/sessions/*`)
requires the same bearer token as the API channel when `gateway.apiToken` resolves. On
the first 401 the dashboard prompts for the token and keeps it in the browser's
localStorage, sending it as an `Authorization` header on later calls.

**Themes:** CSS-variable presets selected by `ui.theme` — `dark` (default), `light`,
`lobster-red`, `carapace-amber` — plus `custom`, which inlines `ui.themeFile` (default
`~/.carapace/theme.css`) after the dark variables so a custom file can override
individual properties. `?theme=<name>` previews any theme without touching config (the
header shows a preview note; the picker reloads with it). A missing, unreadable, or
invalid custom file degrades to dark with a note on the page — the gateway never fails
to render because of a theme file. Doctor check `ui:theme` fails on an invalid custom
file (empty, markup-looking, or unbalanced braces).

### Plugin-UI foundation (#66944)

A `plugins/` directory convention: each plugin is a directory containing `plugin.json`
plus optional `panel.html` and `panel.js`, served under `/ui/plugins/<name>/`:

```json
{
  "name": "system-info",
  "title": "System Info",
  "description": "Live gateway + process stats from GET /health and GET /api/v1/status.",
  "version": "0.1.0"
}
```

- Scan roots, in order: bundled `<packageRoot>/plugins` (the repo ships the `system-info`
  example), user `~/.carapace/plugins`, and one optional `ui.pluginsDir` (tilde allowed).
  First declaration of a name wins; duplicates, broken manifests, and URL-unsafe names
  are reported by doctor (`ui:plugins`) and skipped — never a boot failure.
- `GET /api/v1/plugins` (bearer) lists the boot manifest — name, title, description,
  version, source, `hasPanel` — which the dashboard's Plugins tab renders as cards.
- Panel routes are exact-match and file names are allow-listed (`panel.html`,
  `panel.js`); names are validated at boot, so path traversal is structurally
  impossible. Unknown plugins and non-panel files 404.
- Panels are same-origin pages: the example reads the dashboard's stored bearer token
  from localStorage and polls `/health` + `/api/v1/status`, refreshing every 10s.
- Extension point only — no third-party plugin API (tool injection, lifecycle hooks)
  yet; that lands with the plugin-interface work.

## Endpoints

| Endpoint | Auth | Request / response |
|---|---|---|
| GET /health | — | `{ok, service, version, uptimeSec, node}` |
| GET / | — | index with the route list |
| POST /api/v1/messages | bearer | body `{"senderId": string, "text": string, "chatId"?: string}` → 200 `{"reply": string, "channel": "api", "chatId": string}` |
| GET /api/v1/sessions | bearer | 200 `{"sessions": [{id, channel, createdAt, updatedAt, messages}]}` (50 most recent) |
| GET /api/v1/sessions/messages | bearer | query `sessionId` (required), `limit` (1–500, default 100) → `{session, messages[]}` — most recent messages, oldest → newest |
| POST /api/v1/sessions/reset | bearer | body `{"sessionId": string}` → 200 `{ok, sessionId}` · 404 unknown session |
| GET /api/v1/status | bearer | `{version, node, uptimeSec, model, llmBaseURL, storage{path, sessions, messages}, channels[], theme}` |
| GET /api/v1/config | bearer | full config view with every secret value redacted |
| GET /api/v1/plugins | bearer | plugin-UI boot manifest `{plugins: [{name, title, description, version, source, hasPanel}]}` |
| GET /ui | — | the dashboard page; `?theme=<name>` previews a preset or the custom file |
| GET /ui/plugins/<name>/ | — | plugin panel `panel.html` (the bare path 302-redirects here; `panel.js` served alongside) |
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
in `channels.telegram.allowedSenders` are processed (empty list = everyone); business-
message customers are instead authorized by their active business connection.

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
| llm.turnTimeoutMs | 600000 (1000–3600000) | CARAPACE_TURN_TIMEOUT_MS |
| llm.watchdogTimeoutSec | 300 (1–3600) | CARAPACE_WATCHDOG_TIMEOUT_SEC |
| llm.provider | openai (openai · anthropic · ollama) | — |
| llm.anthropic.apiKey | `{"env": "CARAPACE_ANTHROPIC_API_KEY"}` | CARAPACE_ANTHROPIC_API_KEY |
| llm.anthropic.model | claude-sonnet-4-5 | — |
| llm.anthropic.baseURL | https://api.anthropic.com | — |
| llm.anthropic.maxTokens | 8192 (256–200000) | — |
| llm.ollama.baseURL | http://127.0.0.1:11434/v1 | — |
| llm.ollama.model | llama3.1 | — |
| llm.ollama.apiKey | ollama (sent as bearer; ignored by Ollama) | — |
| llm.fallbacks | [] (no backup providers) | — |
| channels.telegram.enabled | false | CARAPACE_TELEGRAM_ENABLED |
| channels.telegram.botToken | `{"env": "CARAPACE_TELEGRAM_TOKEN"}` | CARAPACE_TELEGRAM_TOKEN |
| channels.telegram.allowedSenders | [] | — |
| channels.telegram.mediaDir | ~/.carapace/workspace/media | CARAPACE_MEDIA_DIR |
| channels.telegram.business | true | — |
| channels.api.enabled | true | CARAPACE_API_ENABLED |
| channels.discord.enabled | false | CARAPACE_DISCORD_ENABLED |
| channels.discord.botToken | `{"env": "CARAPACE_DISCORD_TOKEN"}` | CARAPACE_DISCORD_TOKEN |
| agent.systemPrompt | Carapace default | — |
| agent.maxToolIterations | 12 (1–64) | — |
| agent.announceTarget | null (reply to origin) | CARAPACE_ANNOUNCE_TARGET (`channel:chatId`) |
| senders | [] (no per-sender routing) | — |
| tools.allowedRoots | [~/.carapace/workspace] | — |
| tools.exec.timeoutMs | 30000 (1000–300000) | — |
| tools.exec.denylist | 7 destructive-command patterns | — |
| storage.path | ~/.carapace/carapace.db | CARAPACE_STORAGE_PATH |
| ui.theme | dark (dark · light · lobster-red · carapace-amber · custom) | CARAPACE_UI_THEME |
| ui.themeFile | ~/.carapace/theme.css | — |
| ui.pluginsDir | — (bundled `<package>/plugins` + `~/.carapace/plugins` are always scanned) | — |

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
`llm.apiKey`, `gateway.apiToken`, `channels.telegram.botToken`, and
`channels.discord.botToken` alike.

## Deployment with pm2

The repo ships `ecosystem.config.cjs` and `scripts/start-gateway.sh` for supervised,
self-healing deployments:

1. **Credentials** — put `KEY=VALUE` lines (`CARAPACE_TELEGRAM_TOKEN=…`,
   `CARAPACE_LLM_API_KEY=…`, `CARAPACE_API_TOKEN=…`) into `~/.carapace/gateway.env`
   (mode 600). The launcher sources it at boot; pm2 never sees the values, so its process
   dump stays secret-free. A missing file is fine — config.json and SecretRefs resolve as
   usual (`CARAPACE_GATEWAY_ENV` moves the env file if you need another path).
2. **Start** — `pm2 start ecosystem.config.cjs`. The app runs as `carapace-gateway`
   (`scripts/start-gateway.sh` → `exec node dist/cli/index.js gateway`), fork mode, single
   instance.
3. **Durability knobs** — autorestart on, `max_restarts: 20` within a `min_uptime: 30s`
   window, `exp_backoff_restart_delay: 1000` (exponential restart backoff),
   `max_memory_restart: 512M`, and `kill_timeout: 15000` — matching the gateway's 15s
   shutdown grace so in-flight turns drain on `pm2 restart` instead of being killed mid-turn.
4. **Verify** — `pm2 status` shows the app online; `curl http://127.0.0.1:8899/health`
   returns `{"ok":true,…}`; `pm2 restart carapace-gateway` and re-check health.
5. **Boot resurrection** — run `pm2 save` to snapshot the process list, then `pm2 startup`
   once per host and follow the printed command; the saved list (and the gateway) comes
   back after reboot. Logs live under `~/.pm2/logs/` (`pm2 logs carapace-gateway`).

## Skills (M7)

Skills are operator-authored playbooks that shape agent behavior:

- Convention: `~/.carapace/skills/<name>/SKILL.md` — a `---` frontmatter block with
  non-empty `name:` and `description:`, then markdown instructions. Optional `scripts/`
  and `assets/` subdirectories live next to the file.
- The gateway loads every skill at boot and re-loads on directory changes (debounced
  `fs.watch` — edits apply without a restart).
- Only the index is injected into the agent's system context: name, one-line description,
  and the SKILL.md path. The agent reads the full file with its file tools when a task
  matches.
- CLI: `carapace skills list` (loaded skills, sources, issues) and `carapace skills path
  <name>` (print the SKILL.md path). `carapace doctor` reports the count; parse problems
  WARN, never fail.
- Two example playbooks ship in the repo under `skills/examples/` (`web-research`,
  `sysadmin`) — copy one into `~/.carapace/skills/` to install it.

## Providers and fallbacks (M7)

`llm.provider` selects how turns reach a model:

| provider | wire protocol | configured via |
|---|---|---|
| `openai` (default) | `POST {baseURL}/chat/completions` | top-level `llm.baseURL` / `llm.apiKey` / `llm.model` — kept unchanged for backward compatibility |
| `anthropic` | `POST {baseURL}/v1/messages` with `x-api-key` + `anthropic-version` headers | `llm.anthropic.{apiKey, model, baseURL, maxTokens}` |
| `ollama` | OpenAI-compatible local server | `llm.ollama.{baseURL, model, apiKey}` — defaults to `http://127.0.0.1:11434/v1` |

The Anthropic provider maps Carapace tool specs to Anthropic's `input_schema` shape and
`tool_use` content blocks back into Carapace tool calls; system prompts ride the `system`
field and tool results return as `tool_result` blocks.

**Fallback chain** — `llm.fallbacks[]` is an ordered list of fully-specified backup
providers. When the primary fails — rate limit, timeout, 5xx, or network error — the next
entry is tried; the first provider to answer serves the turn, and the gateway logs which
one did (`[llm] turn served by provider "…"`). `carapace models` prints the whole chain.

```json
{
  "llm": {
    "provider": "openai",
    "baseURL": "https://api.openai.com/v1",
    "apiKey": { "env": "CARAPACE_LLM_API_KEY" },
    "model": "gpt-4o-mini",
    "fallbacks": [
      { "provider": "ollama", "model": "llama3.1" },
      { "provider": "anthropic", "model": "claude-sonnet-4-5",
        "apiKey": { "env": "CARAPACE_ANTHROPIC_API_KEY" } }
    ]
  }
}
```

## Doctor checks

`carapace doctor` reports and exits 0 when healthy:

1. node version (>= 22 required — node:sqlite + fetch)
2. config load/validate (creates defaults on first run; lists every schema issue)
3. config home directory writable
4. storage directory writable
5. storage engine probe: sessions + messages round-trip on a throwaway db in tmp
6. channel status (telegram enabled/token resolution/media dir, api enabled/auth mode,
   discord enabled/token resolution + gateway reachability probe)
7. llm — one config entry per serving-chain provider (primary first, then
   `llm.fallbacks[]`); unresolved credentials WARN. Providers with a resolvable credential
   (or auth-free Ollama) get a bounded reachability probe — a rejected credential
   (401/403) FAILs, an unreachable endpoint WARNs
8. tools: allowedRoots writability, exec timeout, denylist size
9. tools:custom — file-defined tool definitions validated read-only (setups never run)
10. skills — SKILL.md scan of `~/.carapace/skills`: loaded count; parse problems WARN
11. routing tables — `agent.announceTarget` (push-incapable targets warn) and `senders[]`
    (unknown tool names warn)
12. ui:theme — dashboard theme preset valid; with `ui.theme: "custom"` the theme file must
    be readable and CSS-shaped (non-empty, no markup, balanced braces) — invalid files FAIL
13. ui:plugins — plugin-UI scan: loaded plugins are listed; manifest problems WARN
14. channel:discord — enabled/token resolution (disabled channels are reported, not
    failed); with a resolvable token, `channel:discord-gateway` probes REST
    `GET /users/@me` — a rejected token (401) FAILs, an unreachable gateway WARNs

Disabled-by-config channels are reported, not failed — a default install with only the
API channel enabled is healthy. Note: `node:sqlite` prints an upstream
`ExperimentalWarning` on first use; it is harmless.

## Storage schema

- `sessions(id, channel, created_at, updated_at, metadata)` — one row per conversation
- `messages(id, session_id, role, content, tool_call_id, tool_name, tool_calls, created_at)`
  — full turn history, roles user / assistant / tool / system, foreign-keyed with cascade
  delete (assistant tool calls persist as JSON and round-trip losslessly)
- `channel_state(key, value, updated_at)` — channel bookkeeping: the Telegram
  update-offset frontier and the persisted Telegram business-connection map

All tables are created idempotently on open; post-M0 columns are migrated in place, so
pre-M1 databases keep working.

## Roadmap

- **M2 (done):** gateway hardening — bearer auth on the API channel, Telegram media
  handling, multi-session management (/sessions, /reset, GET /api/v1/sessions), busy
  queue with bounded per-chat waiting, graceful restarts with persisted update offsets.
- **M3 (done):** community wishlist as native features — configurable turn budget/stall
  watchdog (#68596), announceTarget completion routing (#27445), per-sender routing
  table (#81271), file-defined tools with once-only setup hooks (#80213).
- **M4 (done):** Telegram Business support (#20786 — `business_connection`/`business_message`
  handling with persisted connections, separate business sessions, and replies sent on
  behalf of the business account) and gateway durability via pm2 (`ecosystem.config.cjs`
  + `scripts/start-gateway.sh` sourcing `~/.carapace/gateway.env`).
- **M5 (done):** web dashboard + theme system (#28300 — `GET /ui` with status, sessions,
  messages, chat, and redacted-config views; presets + custom theme file, doctor-validated)
  and the plugin-UI foundation (#66944 — `plugins/` convention, manifest endpoint, bundled
  `system-info` panel).
- **M6 (done):** Discord channel adapter — gateway WebSocket (identify, heartbeat,
  resume, reconnect flows; zero runtime dependencies) + REST message sender with minimal
  rate-limit handling, `channels.discord { enabled, botToken }` config, doctor probes.
- **M7 (done):** skills system — `~/.carapace/skills/<name>/SKILL.md` playbooks loaded at
  boot and re-loaded on change, an "available skills" index injected into the system
  context, `carapace skills list|path`, a doctor check, and two example playbooks — plus
  the multi-provider LLM layer: `llm.provider` = `openai` | `anthropic` (native
  `/v1/messages` with tool_use mapping) | `ollama` (local OpenAI-compatible), the
  `llm.fallbacks[]` serving chain with per-turn provider logging, and per-provider doctor
  checks.
- **M8/M9 (planned):** automations/scheduler (recurring + timed jobs), then a memory
  system. After that: WhatsApp (needs a Meta Business API vs unofficial-bridge design
  decision), a third-party plugin interface (tool injection + lifecycle hooks), richer
  dashboard write actions.

## Conventions

- Conventional commits; one commit per coherent unit.
- A milestone lands green (typecheck + tests) before the next starts.
- No secrets in code or config; SecretRefs only.