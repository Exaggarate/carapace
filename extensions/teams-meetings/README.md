# @carapace/teams-meetings

Official Microsoft Teams browser meeting participant plugin for Carapace.

This plugin registers the `teams_meetings` tool so agents can join Microsoft
Teams meetings as a Chrome browser guest.

## Install

```bash
carapace plugins install @carapace/teams-meetings
```

Restart the Gateway after installing or updating the plugin.

## Configure

Follow the Teams meetings guide for Chrome profiles, paired nodes, audio
routing, and guest join setup:

- ../../docs/plugins/teams-meetings.md

## Package

- Plugin id: `teams-meetings`
- Tool: `teams_meetings`
- Package: `@carapace/teams-meetings`
- Minimum Carapace host: `2026.7.2`
