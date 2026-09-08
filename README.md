# Carapace

An independent, multi-channel AI agent gateway. Carapace runs your own assistant on your
own hardware and talks to your own chats — Telegram, Discord, raw HTTP — more later.
Every line here is written for this project: not a fork, not a rebrand.

## Status: M10 (community wishlist panel + native issue fixes)

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
- **Discord channel (M6)** — gateway adapter on Node 22's built-in WebSocket (zero extra
  dependencies): identify with the bot token, heartbeat on the server-provided interval,
  resume with `session_id`+`seq` across reconnects, op-7/INVALID_SESSION handling, and a
  4004 close treated as fatal (bad token). MESSAGE_CREATE (bot authors and webhook chatter
  ignored) runs the same agent loop; replies post via REST `POST /channels/{id}/messages`
  through a serialized queue with `x-ratelimit-remaining`/`retry_after` handling and
  2000-char chunking. `carapace doctor` probes the token against `GET /users/@me`.
- **Skills system (M7)** — operator-authored playbooks in `~/.carapace/skills/<name>/SKILL.md`
  (name/description frontmatter, markdown body, optional `scripts/`+`assets/`): loaded at
  gateway boot, re-loaded on directory changes without a restart, and injected into the
  agent's system context as an "available skills" index — the agent reads the full SKILL.md
  with its file tools when a task matches. `carapace skills list` / `carapace skills path
  <name>`, a doctor check, and two example playbooks ship in `skills/examples/`.
- **Multi-provider models (M7)** — `llm.provider` selects `openai` (the original
  chat/completions path), `anthropic` (native `/v1/messages`: `x-api-key` +
  `anthropic-version` headers, `tool_use` blocks mapped to Carapace tool calls), or
  `ollama` (local OpenAI-compatible server, default `http://127.0.0.1:11434/v1`). The
  top-level `llm.baseURL`/`apiKey`/`model` fields keep working unchanged.
- **Fallback chain (M7)** — `llm.fallbacks[]` lists fully-specified backup providers tried
  in order when the primary fails (rate limit, timeout, 5xx, network error); the first
  provider to answer serves the turn and every turn logs which one did. `carapace models`
  prints the serving chain; `carapace doctor` checks config + reachability per provider.
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
  `carapace doctor` verifies node, config, directories, storage engine, channels, llm
  (per provider, plus reachability probes), skills, file-defined tools, and routing tables.
- **Web dashboard + theme system (#28300)** — `GET /ui` serves a zero-dependency single-page
  dashboard (vanilla HTML/JS/CSS, no build step): a status panel (version, uptime, channels,
  storage counts), the session list with reset buttons, recent messages, a chat console that
  POSTs to `/api/v1/messages`, and a config view with every secret value redacted. Themes are
  CSS-variable presets — `dark` (default), `light`, `lobster-red`, `carapace-amber` — selected
  by `ui.theme` and previewable live via `?theme=…`; `ui.theme: "custom"` inlines the
  `ui.themeFile` stylesheet (default `~/.carapace/theme.css`), validated by doctor. Data
  endpoints share the API channel's bearer-auth model; the page shell itself carries no data.
- **Plugin-UI foundation (#66944)** — a `plugins/` directory convention: each plugin directory
  ships a `plugin.json` manifest and may serve `panel.html` + `panel.js` under
  `/ui/plugins/<name>/`, listed at `GET /api/v1/plugins` and linked from the dashboard's
  Plugins tab. Bundled plugins live in `<package>/plugins` (the repo ships a `system-info`
  example), user plugins in `~/.carapace/plugins`, plus one optional `ui.pluginsDir`. Only
  allow-listed panel files are served — no arbitrary file access, no path traversal.
  (Extension point only — no third-party plugin API yet.)
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

Next (M7): WhatsApp (needs a Meta Business API vs unofficial-bridge design decision), a
third-party plugin interface (tool injection + lifecycle hooks), and richer dashboard
write actions.

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
| channels.telegram.steerMode | inject (inject · queue) | — |
| channels.telegram.ackEmoji | 👀 (empty = off) | — |
| channels.telegram.doneEmoji | ✅ (empty = off) | — |
| channels.api.enabled | true | CARAPACE_API_ENABLED |
| channels.discord.enabled | false | CARAPACE_DISCORD_ENABLED |
| channels.discord.botToken | `{"env": "CARAPACE_DISCORD_TOKEN"}` | CARAPACE_DISCORD_TOKEN |
| agent.systemPrompt | Carapace default | — |
| agent.maxToolIterations | 12 (1–64) | — |
| agent.announceTarget | null (reply to origin) | CARAPACE_ANNOUNCE_TARGET (`channel:chatId`) |
| agent.subagentTimeoutSec | 300 (5–3600) | — |
| senders | [] (no per-sender routing) | — |
| tools.allowedRoots | [~/.carapace/workspace] | — |
| tools.exec.timeoutMs | 30000 (1000–300000) | — |
| tools.exec.denylist | 7 destructive-command patterns | — |
| storage.path | ~/.carapace/carapace.db | CARAPACE_STORAGE_PATH |
| ui.theme | dark (dark · light · lobster-red · carapace-amber · custom) | CARAPACE_UI_THEME |
| ui.themeFile | ~/.carapace/theme.css | — |
| ui.pluginsDir | — (bundled `<package>/plugins` + `~/.carapace/plugins` are always scanned) | — |

`CARAPACE_HOME` moves the whole config/state directory (handy for tests).

**Secrets:** don't paste tokens inline. Point at them instead — `{"env": "VARNAME"}` reads
an environment variable, `{"file": "/path"}` reads a file (tilde allowed). Resolution
happens at runtime; the value never lands in config files or logs.

## Discord channel setup

The Discord adapter connects to `wss://gateway.discord.dev` with Node 22's built-in
WebSocket — no Discord library, no extra dependencies — and posts replies through the
Discord REST API.

1. Create an application at <https://discord.com/developers/applications> (**New Application**).
2. Open **Bot** → **Reset Token** and copy the bot token — this becomes
   `channels.discord.botToken` (store it as a SecretRef, e.g. an env var, not inline).
3. Under **Bot → Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT**. Carapace
   requests the `MESSAGE_CONTENT` intent in its identify payload; without the portal
   toggle Discord delivers guild messages with empty content (DMs still carry content),
   so the agent would see blank text. The toggle is privileged because it exposes message
   content to bots at scale — that is exactly why it must be enabled deliberately.
4. Invite the bot (OAuth2 → URL Generator, scope `bot`, permissions `Send Messages` +
   `Read Message History`), or DM it directly — DMs need no guild.
5. Enable it in config:

```json
"channels": {
  "discord": { "enabled": true, "botToken": { "env": "CARAPACE_DISCORD_TOKEN" } }
}
```

When the channel is enabled, `carapace doctor` probes REST `GET /users/@me` with the
token (401 = bad token → FAIL; unreachable gateway → WARN). The bot ignores its own and
other bots' messages plus webhook chatter; long replies are chunked at Discord's
2000-character cap.

## Community wishlist → Carapace

Carapace's roadmap is driven by what users actually ask for upstream. Top-liked community
requests become native features, designed in rather than patched on. The dashboard's
"Community wishlist" panel (`GET /api/v1/wishlist`) renders the live GitHub 👍 ranking
(1h-cached fetch) merged with per-issue status from `docs/wishlist-status.json`.

| Upstream issue | 👍 | Carapace feature |
|---|---|---|
| #68596 configurable streaming watchdog | 8 | `llm.turnTimeoutMs` + `llm.watchdogTimeoutSec` — stalled turns abort cleanly with a user-visible error |
| #20786 Telegram Business Bot support | 7 | `business_message`/`business_connection` handled natively — persisted connections, separate business sessions, replies on behalf of the business account |
| #85030 subagent tool injection | 6 | `spawn_subagent` tool — sub-turns inherit the parent's tool registry, run in their own session, max depth 1, time-boxed by `agent.subagentTimeoutSec` |
| #8508 configurable ack/done reactions | 6 | `channels.telegram.ackEmoji` / `doneEmoji` — 👀 on receipt, ✅ on completion, empty string disables |
| #29387 agentDir bootstrap files | 5 | `~/.carapace/agents/*/bootstrap/*.md` loaded into every system context, fresh each turn |
| #27445 announceTarget for completion routing | 5 | `agent.announceTarget` — full replies route to a chosen `channel:chatId`; the origin chat gets a short notice |
| #28300 theme customization system | 5 | `ui.theme` presets (dark / light / lobster-red / carapace-amber) + a custom `~/.carapace/theme.css` stylesheet inlined by `GET /ui`, doctor-validated |
| #80213 tool/skill setup hooks | 4 | `~/.carapace/tools/*.json` declare exec-backed tools with a once-only `setup` argv (marker-tracked, logged) |
| #66944 plugin UI extension system | 4 | `plugins/` convention — `plugin.json` + `panel.html`/`panel.js` served under `/ui/plugins/<name>/`, manifest at `GET /api/v1/plugins`, `system-info` example ships |
| #48003 steer mode | 4 | `channels.telegram.steerMode = "inject" \| "queue"` (default inject) — mid-turn messages join the running turn's context |
| #45608 pre-reset memory flush | 4 | before a session reset, one LLM call distills key facts/decisions into the daily memory note |
| #81271 per-sender exec node routing | 3 | `senders[]` routing table — per-sender tool allowlists + model overrides (single-node adaptation) |

### Bootstrap files (#29387)

Drop markdown files into `~/.carapace/agents/<id>/bootstrap/` and every agent turn picks
them up — sorted by agent id then file name, injected fresh each turn under a "Bootstrap
files" section, capped at 20,000 chars. Non-markdown files are ignored, missing
directories are a no-op, and unreadable files never break turns.

M8 shipped the automations/scheduler (recurring + timed jobs); M9 shipped the plain-file
memory system; M10 shipped the wishlist panel + the fixes above. Beyond: WhatsApp
channels, a third-party plugin interface (tool injection + lifecycle), and richer
dashboard write actions.

## API endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| GET /health | — | liveness, version, uptime |
| GET / | — | index + route listing |
| GET /ui | — | single-page dashboard (`?theme=` previews a preset or the custom file) |
| POST /api/v1/messages | bearer | run one agent turn for a chat |
| GET /api/v1/sessions | bearer | list the 50 most recent sessions with message counts |
| GET /api/v1/sessions/messages?sessionId=&limit= | bearer | most recent messages of one session (oldest → newest, limit 1–500) |
| POST /api/v1/sessions/reset | bearer | body `{"sessionId": string}` — delete a session (history cascade) |
| GET /api/v1/status | bearer | version, uptime, model, storage counts, channel states |
| GET /api/v1/config | bearer | full config with every secret value redacted |
| GET /api/v1/plugins | bearer | loaded plugin-UI manifests |
| GET /api/v1/wishlist | bearer | top-liked upstream issues + Carapace status (1h-cached GitHub fetch merged with `docs/wishlist-status.json`) |
| GET /ui/plugins/<name>/ | — | plugin panel page (`panel.js` served alongside; extension point #66944) |
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