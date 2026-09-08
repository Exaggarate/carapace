---
summary: "Carapace ClickClack channel plugin."
read_when:
  - You are installing, configuring, or auditing the clickclack plugin
title: "Clickclack plugin reference"
---

<!-- Generated file. Do not edit by hand.
Run `pnpm plugins:inventory:gen` to rebuild it. Hand-written text survives only
between the carapace-plugin-reference:manual-start and
carapace-plugin-reference:manual-end comment markers. -->

Carapace ClickClack channel plugin.

## Distribution

- Package: `@carapace/clickclack`
- Install route: npm or ClawHub: `clawhub:@carapace/clickclack`

## Surface

- Channels: `clickclack`
- Contracts: `tools`

<!-- carapace-plugin-reference:manual-start -->

The plugin can optionally create a lifecycle-synchronized ClickClack channel
for each Carapace session. Managed discussion channels use a same-agent side
session for observation and relay, while the attached main session receives a
pull-only `discussion` tool. See [ClickClack session discussions](/channels/clickclack#session-discussions)
for configuration and session-tool visibility requirements.

<!-- carapace-plugin-reference:manual-end -->

## Related docs

- [clickclack](/channels/clickclack)
