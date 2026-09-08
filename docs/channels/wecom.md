---
summary: "Install the official WeCom plugin and find its versioned setup documentation"
read_when:
  - You want to connect Carapace to WeCom
  - You need the supported WeCom plugin and its setup documentation
title: "WeCom"
---

Carapace exposes WeCom through the external
`@wecom/wecom-carapace-plugin` package maintained by the Tencent WeCom team.
The plugin is listed in Carapace's official channel catalog but is not bundled
with the core install.

## Install

```bash
carapace channels add --channel wecom
carapace gateway restart
carapace channels status --channel wecom
```

The Carapace catalog installs an exact version of
`@wecom/wecom-carapace-plugin`.

## Configure

WeCom credentials, connection modes, callback routes, and access-control
behavior belong to the external plugin and can change independently of
Carapace. Follow the
[package documentation](https://www.npmjs.com/package/@wecom/wecom-carapace-plugin)
for the installed release before configuring the channel.

When upgrading the plugin independently, keep using the documentation for the
installed version.
