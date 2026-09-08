---
summary: "CLI reference for `carapace setup` (system-agent chat with onboarding fallback)"
read_when:
  - You want to chat with Carapace for setup or repair
  - You're doing first-run setup with the onboarding wizard
  - You want to set the default workspace path
  - You need the baseline-only setup flag for scripts
title: "Setup CLI"
---

# `carapace setup`

`carapace setup` is the system-agent entry point. On a configured system, bare
`carapace setup` opens an interactive Carapace chat. On a fresh system, it
falls through to guided onboarding. Use `-m`/`--message` for one request or
`--baseline` to initialize config/workspace folders without the wizard.

Routing order:

1. Any onboarding option (`--wizard`, `--baseline`, workspace, reset,
   non-interactive, flow, mode, Gateway, daemon, skip, import, remote, or auth
   options) runs onboarding exactly as `carapace onboard` does.
2. `-m`/`--message` or `--yes` runs the system agent.
3. With no routing option, a configured interactive system opens Carapace. A
   fresh system runs onboarding. On a configured system, `--json` prints the
   system overview even without a TTY; an onboarding option keeps onboarding's
   JSON summary.

In guided mode, `--workspace <dir>` is the workspace proposed to Carapace;
it is persisted only after you approve that proposal. Baseline, classic, and
noninteractive setup persist the supplied workspace through their normal flow
on a fresh install. When an existing agent roster would be remapped, the
classic wizard requires explicit confirmation; noninteractive setup keeps the
current fleet workspace and prints a warning.

Guided inference detection runs on the Gateway host on macOS or Linux. The CLI
and macOS app call the same Gateway-owned detector, which checks configured
models, supported CLI logins, API-key environment variables, and already
installed Ollama or LM Studio models. Local models are never downloaded by this
discovery pass. Both CLI onboarding and the macOS app wait for you to choose a
connection before testing it. A failed or cancelled attempt never selects another
provider automatically. A selected candidate must answer a real completion before
its provider and model configuration is saved.

Initial Claude Code and Codex detection checks executable versions without
running auth-status commands or starting an app server. Readable Codex
credentials are reported as stored evidence; the active login remains
unverified during detection. Stored credentials do not
receive verified-subscription priority over environment API keys.

Pi and OpenCode CLIs may also be reported for context when they cannot serve as
the reusable inference route for guided setup. Gemini CLI and Antigravity are
not offered as detected setup routes.

`setup` accepts the same onboarding flags as `carapace onboard`, including
auth (`--auth-choice`, `--token`, provider key flags), Gateway
(`--gateway-port`, `--gateway-bind`, `--gateway-auth`, `--install-daemon`),
Tailscale (`--tailscale`), reset (`--reset`, `--reset-scope`), flow
(`--flow quickstart|advanced|manual|import`), and skip flags
(`--skip-channels`, `--skip-skills`, `--skip-bootstrap`, `--skip-search`,
`--skip-health`, `--skip-ui`, `--skip-hooks`). Pass `--tui` to use the same
terminal hatch as `carapace onboard --tui`. See [Onboard](/cli/onboard) and
[CLI automation](/start/wizard-cli-automation) for the full flag reference and
non-interactive examples. `carapace onboard --modern` remains a compatibility
entry for the same inference-gated Carapace assistant.

Local onboarding generates a Gateway secret in token mode by default, without
asking you to choose token or password. Existing password-mode configs are
preserved. Use `--gateway-auth password` or `--gateway-password <value>` to
choose a password explicitly; Tailscale Funnel still requires password mode.

<Note>
`carapace setup` is for mutable config installs. In Nix mode (`CARAPACE_NIX_MODE=1`) Carapace refuses setup writes because the config file is managed by Nix. Use the first-party [nix-carapace Quick Start](https://github.com/Exaggarate/carapace/nix-carapace#quick-start) or the equivalent source config for another Nix package.
</Note>

## Options

| Flag                           | Description                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `-m, --message <text>`         | Run one Carapace request.                                                                            |
| `--yes`                        | Approve persistent config writes for one `--message` request.                                        |
| `--workspace <dir>`            | Workspace proposal; existing fleets require classic confirmation and are preserved noninteractively. |
| `--baseline`                   | Create baseline config/workspace/session folders without onboarding.                                 |
| `--wizard`                     | Force interactive onboarding.                                                                        |
| `--tui`                        | Use the terminal hatch instead of the browser handoff.                                               |
| `--non-interactive`            | Run onboarding without prompts.                                                                      |
| `--accept-risk`                | Acknowledge full-system agent access risk; required with `--non-interactive`.                        |
| `--mode <mode>`                | Onboarding mode: `local` or `remote`.                                                                |
| `--flow <flow>`                | Onboard flow: `quickstart`, `advanced`, `manual`, or `import`.                                       |
| `--reset`                      | Reset config + credentials + sessions before onboarding (workspace only with `--reset-scope full`).  |
| `--reset-scope <scope>`        | Reset scope: `config`, `config+creds+sessions`, or `full`.                                           |
| `--import-from <provider>`     | Migration provider to run during onboarding.                                                         |
| `--import-source <path>`       | Source agent home for `--import-from`.                                                               |
| `--import-secrets`             | Import supported secrets during onboarding migration.                                                |
| `--remote-url <url>`           | Remote Gateway WebSocket URL.                                                                        |
| `--remote-token <token>`       | Remote Gateway token (optional).                                                                     |
| `--remote-password <password>` | Remote Gateway password (optional).                                                                  |
| `--json`                       | Configured system: Carapace overview. Onboarding route: onboarding summary.                          |

`--classic` and `--non-interactive` are mutually exclusive: classic opens the
prompted wizard, while noninteractive setup uses the automation path.
In interactive onboarding, `--remote-url`, `--remote-token`, and
`--remote-password` prefill the remote Gateway step and take precedence over
stored remote values for that run. Pass either a token or a password, not both.
Changing the URL does not reuse stored credentials unless you also provide a new
token or password. The interactive step asks for one **Gateway secret** and
stores it as `gateway.remote.token`; either field is accepted by the Gateway.
The credential remains masked and uses the wizard's selected
plaintext or SecretRef storage mode. `--gateway-token`, `--gateway-token-ref-env`,
and `--gateway-password` configure a local Gateway and are not valid in remote
mode. For remote token SecretRefs, set `CARAPACE_GATEWAY_TOKEN` and use
`--remote-token` with `--secret-input-mode ref`.

### Baseline mode

`carapace setup --baseline` preserves the older baseline-only behavior: it
creates the config, workspace, and session directories, then exits without
running onboarding. It accepts `--workspace` and harmless output controls, but
rejects explicit onboarding, Gateway, auth, reset, or daemon options instead of
silently ignoring them. If an existing config is invalid, baseline setup preserves
it and asks you to run `carapace doctor` before retrying.

## Examples

```bash
carapace setup
carapace setup -m "status"
carapace setup -m "restart gateway" --yes
carapace setup --json
carapace setup --wizard
carapace setup --baseline
carapace setup --workspace ~/.carapace/workspace
carapace setup --import-from hermes --import-source ~/.hermes
carapace setup --non-interactive --accept-risk --mode remote --remote-url wss://gateway-host:18789 --remote-token <token>
carapace setup --non-interactive --accept-risk --mode remote --remote-url wss://gateway-host:18789 --remote-password <password>
```

## Notes

- Inside the interactive Carapace chat, `configure skills`, `configure web search`, and `configure gateway` run hosted setup flows. `open search wizard` and `open gateway wizard` hand credential entry to masked terminal wizards. Gateway setup is local-only and config-only; restart afterward with `restart gateway` in chat or `carapace gateway restart` in the terminal. See [`carapace setup` operations](/cli/carapace#operations-and-approval).
- `import memory` copies detected local memory into the existing default agent workspace without importing config, credentials, or skills. Finish onboarding first; the chat reports partial and failed copies instead of assuming success.
- After baseline setup, run `carapace onboard` for the full guided journey, `carapace configure` for targeted changes, or `carapace channels add` to add channel accounts.
- If Hermes state is detected, interactive onboarding can offer migration automatically. Import onboarding requires a fresh setup; use [Migrate](/cli/migrate) for dry-run plans, backups, and overwrite mode outside onboarding.

## Related

- [CLI reference](/cli)
- [Onboard](/cli/onboard)
- [Onboarding (CLI)](/start/wizard)
- [Getting started](/start/getting-started)
- [Install overview](/install)
