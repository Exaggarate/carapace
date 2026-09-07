# our-fork/ISSUES.md — Upstream Issue Tracker

Machine-refreshed triage of open upstream issues. Status: `open` → `queued` → `fixed` / `wontfix(reason)` / `upstream-tracked`.
Seed snapshot: 2026-09-07 (fresh P0/P1 first). Full enumeration via label-partitioned search API runs in the sync job.

| # | Title | Pri | Impact | Rating | Status |
|---|-------|-----|--------|--------|--------|
| 141273 | openclaw update leaves stale run stuck at phase=requested after gateway restart | P0 | ux-release-blocker | platinum-hermit | queued |
| 141254 | New Chat fails: archived "New chat" labels stay unique (Android sends const label) | P0 | session-state | diamond-lobster | queued |
| 141245 | Plugin-update failure silently disables ALL plugins in config (defensive enabled:false write) | P0 | message-loss | diamond-lobster | queued |
| 141252 | Regression: reply runs fail with "Reply operation has no active tool authority snapshot" (busy-session) | P1 | message-loss | diamond-lobster | queued |
| 141242 | Yielded running main session treated as terminal and rotated during sibling completion | P1 | session-state, message-loss | diamond-lobster | queued |
| 141213 | Internal runtime-context envelope leaks into visible Telegram turns | P1 | security, session-state | — | queued |
| 141279 | Windows: os.devNull in GIT_CONFIG_GLOBAL/SYSTEM still breaks update + 5 paths | P1 | other | diamond-lobster | queued |
| 141257 | Second model-scoped cooldown widens shared auth profile, skips healthy third fallback | P1 | auth-provider | diamond-lobster | open |
| 141211 | Compaction qualityGuard.maxRetries not visible in compaction-diag | P1 | session-state | silver-shellfish | open |
| 141295 | TTL or manual clear for interrupted/cancelled pending inputs (ref #140243) | P2 | session-state | gold-shrimp | open |
| 141291 | Telegram images sent as documents omitted from automatic vision input | P2 | message-loss | diamond-lobster | open |
| 141269 | Control UI Cron/Agents/Sessions list pages blank — SPA list RPCs rejected | P2 | ux-friction | silver-shellfish | open |
| 141264 | Chat Completions reports stop when partial answer hits output budget | P2 | other | diamond-lobster | open |
| 141263 | Cold agents list omits configured channel account names | P2 | ux-friction | diamond-lobster | open |
| 141261 | Improve Code Mode continuation and typed tool composition | P2 | other | diamond-lobster | open |
| 141260 | Failover rate-limit copy drops provider reset hint; "All models failed" string exceeds truncation | P2 | ux-friction | diamond-lobster | queued |
| 141249 | Regression: Skill Workshop Experience Review foreground prompt-cache reuse broken | P2 | other | diamond-lobster | open |
| 141233 | Codex transcript mirror duplicates unkeyed user inputs from Chat Completions | P2 | session-state | diamond-lobster | open |
| 141228 | Update-run tracking record stuck at phase 'requested' forever (family of #141273) | P2 | ux-friction | diamond-lobster | upstream-tracked→141273 |
| 141202 | Regression race after #120575: terminal process … | ? | ? | ? | open (fetch full body) |

Counts at seed time: 3,948 open issues · 2,354 open PRs (upstream).