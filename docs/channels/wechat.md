---
summary: "WeChat channel setup through the external carapace-weixin plugin"
read_when:
  - You want to connect Carapace to WeChat or Weixin
  - You are installing or troubleshooting the carapace-weixin channel plugin
  - You need to understand how external channel plugins run beside the Gateway
title: "WeChat"
---

Carapace connects to WeChat through Tencent's external
`@tencent-weixin/carapace-weixin` channel plugin.

Status: external plugin, maintained by the Tencent Weixin team. Direct chats and
media are supported. Group chats are not advertised by the plugin capability
metadata (it declares direct chats only).

## Naming

- **WeChat** is the user-facing name in these docs.
- **Weixin** is the name used by Tencent's package and by the plugin id.
- `carapace-weixin` is the Carapace channel id (`weixin` and `wechat` work as aliases).
- `@tencent-weixin/carapace-weixin` is the npm package.

Use `carapace-weixin` in CLI commands and config paths.

## How it works

The WeChat code does not live in the Carapace core repo. Carapace provides the
generic channel plugin contract, and the external plugin provides the
WeChat-specific runtime:

1. `carapace plugins install` installs `@tencent-weixin/carapace-weixin`.
2. The Gateway discovers the plugin manifest and loads the plugin entrypoint.
3. The plugin registers channel id `carapace-weixin`.
4. `carapace channels login --channel carapace-weixin` starts QR login.
5. The plugin stores account credentials under the Carapace state directory
   (`~/.carapace` by default).
6. When the Gateway starts, the plugin starts its Weixin monitor for each
   configured account.
7. Inbound WeChat messages are normalized through the channel contract, routed to
   the selected Carapace agent, and sent back through the plugin outbound path.

That separation matters: Carapace core stays channel-agnostic. WeChat login,
Tencent iLink API calls, media upload/download, context tokens, and account
monitoring are owned by the external plugin.

## Install

Quick install:

```bash
npx -y @tencent-weixin/carapace-weixin-cli install
```

Manual install:

```bash
carapace plugins install "@tencent-weixin/carapace-weixin"
carapace config set plugins.entries.carapace-weixin.enabled true
```

Restart the Gateway after install:

```bash
carapace gateway restart
```

## Login

Run QR login on the same machine that runs the Gateway:

```bash
carapace channels login --channel carapace-weixin
```

Scan the QR code with WeChat on your phone and confirm the login. The plugin saves
the account token locally after a successful scan.

To add another WeChat account, run the same login command again. For multiple
accounts, isolate direct-message sessions by account, channel, and sender:

```bash
carapace config set session.dmScope per-account-channel-peer
```

## Access control

Direct messages use the normal Carapace pairing and allowlist model for channel
plugins.

Approve new senders:

```bash
carapace pairing list carapace-weixin
carapace pairing approve carapace-weixin <CODE>
```

For the full access-control model, see [Pairing](/channels/pairing).

## Compatibility

The plugin checks the host Carapace version at startup.

| Plugin line | Carapace version                                                | npm tag  |
| ----------- | --------------------------------------------------------------- | -------- |
| `2.x`       | `>=2026.5.12` (current 2.4.8; early 2.x accepted `>=2026.3.22`) | `latest` |
| `1.x`       | `>=2026.1.0 <2026.3.22`                                         | `legacy` |

If the plugin reports that your Carapace version is too old, either update
Carapace or install the legacy plugin line:

```bash
carapace plugins install @tencent-weixin/carapace-weixin@legacy
```

Plugin 2.4.6 imports the retired `carapace/plugin-sdk/channel-runtime` path and
cannot load on Carapace 2026.8.1. If startup reports that this subpath is not
exported, update to plugin 2.4.8, which uses the available SDK path:

```bash
carapace plugins update @tencent-weixin/carapace-weixin@2.4.8
carapace gateway restart
```

## Sidecar process

The WeChat plugin can run helper work beside the Gateway while it monitors the
Tencent iLink API. In issue #68451, that helper path exposed a bug in Carapace's
generic stale-Gateway cleanup: a child process could try to clean up the parent
Gateway process, causing restart loops under process managers such as systemd.

Current Carapace startup cleanup excludes the current process and its ancestors,
so a channel helper cannot kill the Gateway that launched it. This fix is
generic; it is not a WeChat-specific path in core.

## Troubleshooting

Check install and status:

```bash
carapace plugins list
carapace channels status --probe
carapace --version
```

If the channel shows as installed but does not connect, confirm that the plugin is
enabled and restart:

```bash
carapace config set plugins.entries.carapace-weixin.enabled true
carapace gateway restart
```

If the Gateway restarts repeatedly after enabling WeChat, update both Carapace and
the plugin:

```bash
npm view @tencent-weixin/carapace-weixin version
carapace plugins install "@tencent-weixin/carapace-weixin" --force
carapace gateway restart
```

If startup reports that the installed plugin package `requires compiled runtime
output for TypeScript entry`, the npm package was published without the compiled
JavaScript runtime files Carapace needs. Update/reinstall after the plugin
publisher ships a fixed package, or temporarily disable/uninstall the plugin.

Temporary disable:

```bash
carapace config set plugins.entries.carapace-weixin.enabled false
carapace gateway restart
```

## Related docs

- Channel overview: [Chat Channels](/channels)
- Pairing: [Pairing](/channels/pairing)
- Channel routing: [Channel Routing](/channels/channel-routing)
- Plugin architecture: [Plugin Architecture](/plugins/architecture)
- Channel plugin SDK: [Channel Plugin SDK](/plugins/sdk-channel-plugins)
- External package: [@tencent-weixin/carapace-weixin](https://www.npmjs.com/package/@tencent-weixin/carapace-weixin)
