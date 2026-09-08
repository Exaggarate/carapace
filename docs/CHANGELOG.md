# Changelog

Notable changes per release. Versions follow package.json / `carapace version`; the doctor
`docs:changelog` check (#48920) warns when the running version has no entry here.

## v0.12.0 — 2026-09-09 (M12: community wishlist round 2)

- Skill setup hooks (#80213) — optional `setup:` frontmatter script run via `carapace skills setup <name|all>` with a completion marker; never auto-executed; pending hooks visible in `skills list` + doctor
- Memory dreaming (#67413) — managed `memory-dreaming` scheduler job folds daily notes into MEMORY.md (`memory.dreaming` config; headless by default, optional summary push)
- Hardened boot (#108435) — bounded channel-start retry, degraded-channel state on GET /health, friendly port-in-use error
- Changelog coverage guard (#48920) — doctor warns when this file lacks an entry for the running version

## v0.11.0 — 2026-09-09 (M11: conversational UX)

- Telegram markdown formatting — HTML parse mode, 4096 paragraph-boundary chunking, graceful plain-text fallback
- Command system — branded start message, grouped /help, /status /skills /automations, unknown-command UX
- Persona layer — crafted 🦞 default, per-channel config override, consistent across telegram/discord/api/automations
- Error UX — friendly provider-failure one-liners, graceful fallback footer, discord mid-turn notice
- Doctor checks for start-message parse + persona layer

## v0.10.0 — 2026-09-08 (M10: community fixes)

- Community fixes — spawn_subagent, bootstrap files, steer mode, pre-reset flush, ack emojis (#85030 #29387 #48003 #45608 #8508)
- Dashboard community-wishlist panel — top-liked upstream issues + status tracker

## v0.9.0 — 2026-09-08 (M9: memory)

- Memory system — plain-file daily notes + MEMORY.md, prompt injection, memory tools, doctor check

## v0.8.0 — 2026-09-08 (M8: automations)

- Automations/scheduler — SQLite jobs, gateway tick loop, CLI, doctor check

## v0.7.0 — 2026-09-08 (M7: skills + providers)

- Skills system — SKILL.md loader, context injection, CLI, doctor check, examples
- Multi-provider LLM layer — OpenAI/Anthropic/Ollama providers + fallback chain

## v0.6.0 — 2026-09-08 (M6: discord)

- Discord channel adapter — gateway WS + REST, zero deps
- Doctor channel:discord check + gateway reachability probe

## v0.5.0 — 2026-09-08 (M5: themes + plugin UI)

- Dashboard themes + custom theme files (#28300)
- Plugin-UI foundation — plugin panels under /ui (#66944)

## v0.4.0 — 2026-09-08 (M4: telegram business)

- Telegram Business support — business_message / business_connection (#20786)
- pm2 ecosystem + gateway.env launcher for gateway durability

## v0.3.0 — 2026-09-08 (M3: wishlist features)

- Configurable turn budget + stall watchdog (#68596)
- announceTarget completion routing (#27445)
- Per-sender routing — tool allowlists + model overrides (#81271)

## v0.2.0 — 2026-09-08 (M2: gateway hardening)

- SecretRef resolution in every config surface (#38309)
- Exec approvals denylist (#6615)
- Multi-session, auth, media handling, error recovery

## v0.1.0 — 2026-09-08 (M0/M1: skeleton + agent core)

- Repo scaffold, config loader, CLI (gateway/doctor), HTTP server
- Agent loop with tool calling, session store, Telegram adapter