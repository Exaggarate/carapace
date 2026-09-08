---
summary: "App-server transport, approval posture, auth order, and environment isolation"
read_when:
  - You are choosing an app-server transport or approval posture
  - You need the Codex auth selection order
  - You are isolating the Codex app-server environment
title: "Codex app-server policy"
sidebarTitle: "App-server policy"
---

How Carapace starts and authenticates the Codex app-server, and what it isolates from the operator environment. Part of the [Codex harness](/plugins/codex-harness) guide; [Where each section moved](/plugins/codex-harness#where-each-section-moved) lists every section.

## App-server policy

By default, the plugin starts Carapace's managed Codex binary locally with
stdio transport. Set `appServer.command` only to intentionally run a
different executable. Verified setup accepts a native Codex executable or the
official `@openai/codex` npm entrypoint, including its installed symlink or
Windows npm launcher. Arbitrary wrapper scripts cannot be verified because
their native target is unknown; select the native executable or official npm
launcher instead. Codex classifies WebSocket transport as experimental
and unsupported; use it only for non-production testing against an app-server
already running elsewhere:

```json5
{
  plugins: {
    entries: {
      codex: {
        enabled: true,
        config: {
          appServer: {
            transport: "websocket",
            url: "ws://gateway-host:39175",
            authToken: "${CODEX_APP_SERVER_TOKEN}",
          },
        },
      },
    },
  },
}
```

WebSocket transport proactively establishes the app-server connection at
gateway startup and limits the opening handshake to 10 seconds. An idle
connection sends a WebSocket ping every 20 seconds and allows 20 seconds for its
matching pong. A healthy app-server message or pong resets the missed-heartbeat
count; five consecutive missed pongs close the connection. Transient failures
reconnect automatically with bounded, jittered exponential backoff. Authentication
failures and unsupported app-server versions stop reconnecting and report that
operator action is required. Ping and pong frames are transport-level health
checks: they do not start a Codex turn or invoke a model. Local stdio and Unix
transports do not perform these remote connection checks.

Local stdio app-server sessions default to the trusted local operator
posture: `approvalPolicy: "never"`, `approvalsReviewer: "user"`, and
`sandbox: "danger-full-access"`. If local Codex requirements disallow that
implicit YOLO posture, Carapace selects allowed guardian permissions
instead. When an Carapace sandbox is active for the session, Carapace
disables Codex native Code Mode, user MCP servers, and app-backed plugin
execution for that turn instead of relying on Codex host-side sandboxing.
Shell access instead goes through Carapace sandbox-backed dynamic tools such
as `sandbox_exec` and `sandbox_process` when the normal exec/process tools
are available.

Use normalized Carapace exec mode for Codex native auto-review before
sandbox escapes or extra permissions:

```json5
{
  tools: {
    exec: {
      mode: "auto",
    },
  },
  plugins: {
    entries: {
      codex: {
        enabled: true,
      },
    },
  },
}
```

For Codex app-server sessions, `tools.exec.mode: "auto"` maps to Codex
Guardian-reviewed approvals: usually `approvalPolicy: "on-request"`,
`approvalsReviewer: "auto_review"`, and `sandbox: "workspace-write"` when
local requirements allow those values. In `tools.exec.mode: "auto"`,
Carapace does not preserve legacy unsafe Codex `approvalPolicy: "never"` or
`sandbox: "danger-full-access"` overrides; use `tools.exec.mode: "full"` for
an intentional no-approval Codex posture. The legacy
`plugins.entries.codex.config.appServer.mode: "guardian"` preset still
works, but `tools.exec.mode: "auto"` is the normalized Carapace surface.

For the mode-level comparison with host exec approvals and ACPX
permissions, see [Permission modes](/tools/permission-modes). For every
app-server field, auth order, environment isolation, and timeout behavior,
see [Codex harness reference](/plugins/codex-harness-reference).

### Native approval audit evidence

With `tools.exec.mode: "ask"` and the Codex user reviewer, native command and
file prompts use Carapace's two-phase operator approval route. The prompt shows
only decisions that the native request can preserve. For example, a command
that permits one execution but not session trust offers allow-once and deny;
byte-bound script approvals also remain one-shot. File prompts support both
one-shot and session approval.

Terminal operator decisions reuse the Gateway's authoritative approval row and
its exact execution binding. When execution identity collection is enabled,
inspect the admitted run with
[`carapace audit --run <run-id> --explain`](/cli/audit). The resulting receipt
can report allow-once, allow-always, denial, no-route, expiry, or cancellation
without exposing command text, patch content, paths, or native request ids.

Codex auto-review, full-access policy, and native hook or Carapace policy
decisions do not create an operator approval row. Missing or stale native turn
context is rejected before routing. These cases therefore do not produce an
enforced operator-approval receipt; audit inspection does not reconstruct one
from later tool events.

## Auth order

In the default per-agent home, auth is selected in this order:

1. Ordered OpenAI auth profiles for the agent, preferably under
   `auth.order.openai`. Run `carapace doctor --fix` to migrate older legacy
   Codex auth profile ids and legacy Codex auth order.
2. The app-server's existing account in that agent's Codex home.
3. For local stdio app-server launches only, `CODEX_API_KEY`, then
   `OPENAI_API_KEY`, when no app-server account is present and OpenAI auth
   is still required.

When Carapace sees a ChatGPT subscription-style Codex auth profile, it
removes `CODEX_API_KEY` and `OPENAI_API_KEY` from the spawned Codex child
process. That keeps Gateway-level API keys available for embeddings or
direct OpenAI models without making native Codex app-server turns bill
through the API by accident. Explicit Codex API-key profiles and local
stdio env-key fallback use app-server login instead of inherited
child-process env. WebSocket app-server connections do not receive Gateway
env API-key fallback; use an explicit auth profile or the remote
app-server's own account.

If a subscription profile hits a Codex usage limit, Carapace records the
reset time when Codex reports one and tries the next ordered auth profile
for the same Codex run. When the reset time passes, the subscription
profile becomes eligible again without changing the selected `openai/gpt-*`
model or Codex runtime.

When native Codex plugins are configured, Carapace reads and caches one
runtime-and-workspace-scoped `plugin/installed` snapshot. That one snapshot
covers configured plugins from Codex-discovered marketplaces, including
disabled plugin ownership. `plugin/read` resolves only explicitly configured
plugin details. `/codex plugins available` queries `plugin/list` with the
bound workspace, while `/codex plugins install <plugin>@<marketplace>` is the
owner- or administrator-authorized installation path. Routine thread setup
retains existing explicitly configured curated-plugin recovery.

`app/installed` supplies the installed app runtime snapshot, and `app/read`
supplies authenticated app metadata in batches of at most 100 app IDs. Carapace
force-refreshes a cold snapshot once and consolidates successful curated
installations into one app-inventory refresh. Ordinary cached reads do not
force a connector refresh for every thread.

An authorized app can initially appear disabled or non-callable because Codex
has not yet applied the target thread's restrictive app configuration.
Carapace provisionally admits only explicitly allowed, ownership-proven apps,
starts the thread with `_default.enabled = false`, and reads `app/installed`
once with that thread's ID and `forceRefresh: false`. Missing, disabled, or
non-callable apps produce one warning without blocking unrelated chat or
heartbeat runs. Codex still enforces app/tool permissions, managed restrictions,
and workspace policy; continuing the conversation does not enable an unavailable app.

The check runs before Carapace starts a turn or commits a thread binding. If the
snapshot request fails, a persistent provisional thread is deleted and an
ephemeral thread is unsubscribed. If cleanup cannot be confirmed, Carapace retires the app-server
connection instead of reusing an unsafe thread.

Account-wide app access never overrides an explicitly disabled configured
workspace plugin. When `app/read` omits that plugin's ownership, Carapace uses
the `plugin/installed` snapshot and reads only the exact configured plugin's
details to keep its apps denied. This check never installs, enables, or
authenticates the plugin.

Carapace does not install unknown apps or let the model authorize new plugin
installs. Owner-approved plugin installation refreshes the target runtime
inventory. Missing inventory methods, authentication errors, transport
failures, and connector refresh failures fail closed.

## Scheduled app authority

Automations inherit the creator turn's callable tools and app policy without an
explicit `toolsAllow` list. With a prepared ChatGPT profile, scheduled app access
remains bound to that exact profile and account. Without a prepared profile, an
agent-scoped configured WebSocket app-server owns the schedule through its
connection fingerprint. Reauthenticating that same endpoint to another account
does not revoke the schedule: subsequent runs use the endpoint's current account,
subject to the captured app ceiling and current app/tool policy. Scheduled
authority does not store or replay authentication credentials.

Removing or un-configuring the endpoint, changing its connection fingerprint, or
changing its captured managed requirements rejects the run before app execution.
The job remains inspectable, with an error in automation run history and its
last-run state; normal failure backoff still applies. Restore the authorized
connection or recreate the automation from a fresh authenticated owner turn.
Account changes that remove access to a captured app also fail visibly.

Before rolling back to a build without configured-endpoint authority and cron
authority hydration, disable these jobs with `carapace automations disable <id>`
and verify them with `carapace automations list --all`. Do not rely on an older
binary to enforce the new authority envelope. Keep the jobs disabled until you
return to a supporting build or recreate them under that build's supported auth
path. See [Automations](/automation/cron-jobs) for run history and failure handling.

## Environment isolation

For local stdio app-server launches, Carapace sets `CODEX_HOME` to a
per-agent directory so Codex config, auth/account files, plugin cache/data,
and native thread state do not read or write the operator's personal
`~/.codex` by default. Carapace preserves the normal process `HOME`;
Codex-run subprocesses can still find user-home config and tokens, and
Codex may discover shared `$HOME/.agents/skills` and
`$HOME/.agents/plugins/marketplace.json` entries. With
`appServer.homeScope: "user"`, Carapace instead uses the native user Codex
home and its existing account without injecting an Carapace auth profile.

If a deployment needs additional environment isolation, add those
variables to `appServer.clearEnv`:

```json5
{
  plugins: {
    entries: {
      codex: {
        enabled: true,
        config: {
          appServer: {
            clearEnv: ["CODEX_API_KEY", "OPENAI_API_KEY"],
          },
        },
      },
    },
  },
}
```

`appServer.clearEnv` only affects the spawned Codex app-server child
process. Carapace removes `CODEX_HOME` and `HOME` from this list during
local launch normalization: `CODEX_HOME` stays pointed at the selected
agent or user scope, and `HOME` stays inherited so subprocesses can use
normal user-home state.

Verified local setup turns also attest the selected Codex launcher and package.
Inherited `NODE_OPTIONS` may contain bounded resource, warning, DNS result order,
network-family autoselection, environment-proxy, and CA-source options because
those settings cannot preload code or change module resolution. For example,
`--dns-result-order=ipv4first --no-network-family-autoselection` is allowed.
Malformed or unknown options and code-loading options such as `--require` or
`--import` fail closed. If an inherited option is not needed by Codex, remove
`NODE_OPTIONS` with `appServer.clearEnv`.

## Local testing env overrides

- `CARAPACE_CODEX_APP_SERVER_BIN` bypasses the managed binary when
  `appServer.command` is unset.
- `CARAPACE_CODEX_APP_SERVER_ARGS` accepts a quoted argument string; see
  [argument parsing](/plugins/codex-harness-reference#app-server-transport).
- `CARAPACE_CODEX_APP_SERVER_MODE=yolo|guardian`
- `CARAPACE_CODEX_APP_SERVER_APPROVAL_POLICY`
- `CARAPACE_CODEX_APP_SERVER_SANDBOX`

`CARAPACE_CODEX_APP_SERVER_GUARDIAN=1` was removed. Use
`plugins.entries.codex.config.appServer.mode: "guardian"` instead, or
`CARAPACE_CODEX_APP_SERVER_MODE=guardian` for one-off local testing. Config
is preferred for repeatable deployments because it keeps the plugin
behavior in the same reviewed file as the rest of the Codex harness setup.
