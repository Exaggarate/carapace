# @carapace/imessage

Official iMessage channel plugin for Carapace, using `imsg` on a signed-in Mac.

The plugin supports iMessage and SMS DMs and groups, media, replies, tapbacks,
effects, polls, and group management when the `imsg` private API bridge is
available.

## Install

```bash
carapace plugins install @carapace/imessage
```

Restart the Gateway after installing or updating the plugin.

## Configure

Follow the iMessage guide for installing `imsg`, granting macOS permissions,
enabling private API actions, and configuring local or remote-Mac operation:

- ../../docs/channels/imessage.md

## Package

- Plugin id: `imessage`
- Channel id: `imessage`
- Package: `@carapace/imessage`
- Minimum Carapace host: `2026.7.2`
