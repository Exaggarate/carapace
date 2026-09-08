---
summary: "Run Carapace in a Daytona cloud sandbox with SSH access and signed preview URLs"
read_when:
  - Running Carapace in a Daytona sandbox
  - You want a cloud sandbox for Carapace without managing a VPS
title: "Daytona"
---

Run a persistent Carapace Gateway in a [Daytona](https://www.daytona.io) cloud
sandbox: an isolated Linux environment with SSH access and built-in preview
URLs, no VPS management required. Carapace comes pre-installed in the
`daytona-medium` snapshot, so setup starts immediately after SSH.

Keep the Gateway on loopback and reach the dashboard through Daytona's signed
preview URLs. Do not expose the Gateway port directly to the public internet.

## What you need

- [Daytona account](https://app.daytona.io) (free tier available)
- Daytona API key from the [Daytona dashboard](https://app.daytona.io/dashboard/keys)
- API key for your model provider (Anthropic, OpenAI, etc.)

## Install the Daytona CLI

<Tabs>
  <Tab title="macOS / Linux">
    ```bash
    brew install daytonaio/cli/daytona
    ```
  </Tab>
  <Tab title="Windows">
    ```powershell
    powershell -Command "irm https://get.daytona.io/windows | iex"
    ```
  </Tab>
</Tabs>

Verify the installation:

```bash
daytona --version
```

Older CLI versions miss newer sandbox commands; keep it current (for example
`brew upgrade daytonaio/cli/daytona`).

## Authenticate

```bash
daytona login --api-key=YOUR_API_KEY
```

## Create a sandbox

```bash
daytona sandbox create --name carapace --snapshot daytona-medium --auto-stop 0
```

| Flag                        | Why                                                |
| --------------------------- | -------------------------------------------------- |
| `--snapshot daytona-medium` | Provides enough memory headroom to run the Gateway |
| `--auto-stop 0`             | Keeps the sandbox running until manually stopped   |

## Connect via SSH

```bash
daytona ssh carapace
```

## Run onboarding

Inside the sandbox, configure Carapace in one command:

```bash
carapace onboard --non-interactive --accept-risk \
  --anthropic-api-key YOUR_ANTHROPIC_KEY \
  --skip-daemon --skip-channels --skip-skills --skip-hooks --skip-health
```

`--skip-daemon` matters: Daytona sandboxes do not run a service manager, so
you start the Gateway manually below. Swap the key flag for your provider
(`--openai-api-key`, `--openrouter-api-key`, and so on); `carapace onboard
--help` lists them all. Channels, skills, and hooks are skipped here and
configured later.

Running `carapace onboard` without flags starts a conversational setup
assistant instead and requires an interactive terminal;
`carapace onboard --classic` runs the older step-by-step wizard.

Onboarding configures a gateway auth token. Print it any time from the
sandbox:

```bash
node -p "require(process.env.HOME + '/.carapace/carapace.json').gateway.auth.token"
```

`carapace config get gateway.auth.token` returns `__CARAPACE_REDACTED__`
rather than the value, because the CLI masks secrets in its output.

## Allow the preview URL origin

The Gateway accepts browser connections only from allowed origins, and
Daytona's preview proxy sits in front of it. Configure both before starting
the Gateway.

From your **local terminal** (not the sandbox SSH session), generate a signed
preview URL for the Gateway port:

```bash
daytona preview-url carapace --port 18789
```

Copy the URL it prints. Back in the sandbox SSH session, allow that origin and
trust the in-sandbox preview proxy, replacing the example URL with your own:

```bash
carapace config set gateway.controlUi.allowedOrigins '["PASTE_YOUR_PREVIEW_URL"]'
carapace config set gateway.trustedProxies '["127.0.0.1"]'
```

Paste the URL exactly as printed: scheme and host only, with no trailing slash
and no path. The Gateway compares the browser origin literally, and browsers
send `https://host` without a trailing slash, so `https://host/` fails to
match and the connection is rejected. Browser address bars often display that
trailing slash, so copy from the terminal instead.

## Start the Gateway

```bash
nohup carapace gateway run > /tmp/gateway.log 2>&1 &
```

The Gateway runs in the background and survives SSH disconnects. Verify it is
up:

```bash
carapace gateway health
```

The command reports the Gateway status, so `OK` means you are good to
continue.

To restart the Gateway later (after config changes or updates):

```bash
pkill -f "carapace gateway" || true
nohup carapace gateway run > /tmp/gateway.log 2>&1 &
```

## Open the dashboard

Open the preview URL you generated earlier in your browser. The Control UI
asks for the gateway token on first connect; paste the value you printed
after onboarding.

### Approve your device

The first browser connection queues a device pairing request. Back in your
sandbox SSH session:

```bash
# List pending requests and copy the request id
carapace devices list

# Approve it
carapace devices approve REQUEST_ID
```

## Security

Access to the Gateway is protected in three layers:

| Layer           | Description                                            |
| --------------- | ------------------------------------------------------ |
| Preview URL     | Time-limited signed URL (expires after 1 hour)         |
| Gateway token   | Required to connect via the Control UI                 |
| Device approval | Each new browser or client must be explicitly approved |

Keep your gateway token and preview URLs private. The Gateway stays bound to
loopback; Daytona's preview proxy handles external access.

## Channel setup

Unknown senders require pairing approval by default; see
[Pairing](/channels/pairing).

### Telegram

Create a bot with [@BotFather](https://t.me/botfather) (`/newbot`), copy the
token, then configure Carapace from the sandbox SSH session:

```bash
export TELEGRAM_BOT_TOKEN="<bot-token>"
carapace channels add --channel telegram --use-env
```

Also store `TELEGRAM_BOT_TOKEN=<bot-token>` in `~/.carapace/.env` so the
background Gateway receives it after a restart. `--use-env` validates the token
without copying it into `carapace.json`.

Restart the Gateway (see above), send your bot a DM, then approve the pairing
code it reports:

```bash
carapace pairing list telegram
carapace pairing approve telegram PAIRING_CODE
```

Pairing codes expire after 1 hour. Full reference: [Telegram](/channels/telegram).

### WhatsApp

WhatsApp ships as a separate plugin, so install and enable it first:

```bash
carapace plugins install clawhub:@carapace/whatsapp
carapace plugins enable whatsapp
```

Installing does not enable a plugin, so the `enable` step is required;
otherwise the Gateway reports the channel as configured but untrusted. Running
the login command below without installing first prompts you to download the
plugin from ClawHub or npm instead.

Then link the account by scanning a QR code from the sandbox SSH session:

```bash
carapace channels login --channel whatsapp
```

On your phone: **Settings → Linked Devices → Link a Device**, then scan the QR
code shown in the terminal. Restart the Gateway after linking, then message
yourself on WhatsApp and Carapace replies in that chat.

No pairing approval is needed: with no allowlist configured, the linked
account's own number is allowed by default. Pairing applies to unknown
senders, which is why Telegram needs it and self-chat does not. Allowlists,
personal-number mode, and self-chat details: [WhatsApp](/channels/whatsapp).

## Updating

The snapshot's global npm tree is owned by root, so plain `carapace update`
cannot write to it. Update from the sandbox SSH session with:

The command below is for npm 12 or npm 11.16+. On npm 11.15 and earlier,
omit `--allow-scripts=carapace`.

```bash
sudo env "PATH=$PATH" npm install --global carapace@latest --allow-scripts=carapace
carapace doctor
```

`carapace doctor` migrates any older config after the update. Restart the
Gateway afterwards (see above).

## Stop and resume the sandbox

```bash
# Stop
daytona sandbox stop carapace

# Resume
daytona sandbox start carapace
```

Sandbox state persists across stop/start cycles, but the Gateway process does
not auto-start. After a resume, reconnect and start it again:

```bash
daytona ssh carapace
nohup carapace gateway run > /tmp/gateway.log 2>&1 &
```

## Troubleshooting

### Gateway not running after sandbox restart

The Gateway process does not survive a sandbox restart. Reconnect with
`daytona ssh carapace` and start it again with the `nohup` command above.

### Preview URL expired

Preview URLs are time-limited (default 3600 seconds). Regenerate from your
local terminal, optionally with a longer expiry:

```bash
daytona preview-url carapace --port 18789 --expires 86400
```

Each generated URL has a different host, so it is a new origin. After
regenerating, update `gateway.controlUi.allowedOrigins` with the new URL and
restart the Gateway, or the Control UI is rejected with `origin not allowed`.

### Sandbox auto-stopped

If the sandbox was created without `--auto-stop 0`, it stops automatically
when idle. Resume it with `daytona sandbox start carapace`.

### Gateway port not reachable

Confirm the Gateway is running and listening:

```bash
carapace gateway health
tail -20 /tmp/gateway.log
```

If you changed the Gateway port, pass the same port to `daytona preview-url`.

## Notes

- For programmatic sandbox provisioning, see the
  [Daytona Carapace SDK guide](https://www.daytona.io/docs/en/guides/carapace/carapace-sdk-sandbox/)

## Related

- [Gateway remote access](/gateway/remote)
- [Gateway security](/gateway/security)
- [Updating Carapace](/install/updating)
