---
summary: "Adds OpenCode model provider support to Carapace."
read_when:
  - You are installing, configuring, or auditing the opencode plugin
title: "OpenCode plugin reference"
---

<!-- Generated file. Do not edit by hand.
Run `pnpm plugins:inventory:gen` to rebuild it. Hand-written text survives only
between the carapace-plugin-reference:manual-start and
carapace-plugin-reference:manual-end comment markers. -->

Adds OpenCode model provider support to Carapace.

## Distribution

- Package: `@carapace/opencode-provider`
- Install route: npm or ClawHub: `clawhub:@carapace/opencode-provider`

## Surface

- Providers: `opencode`
- Contracts: `mediaUnderstandingProviders`

<!-- carapace-plugin-reference:manual-start -->

## Native sessions

Carapace auto-detects the `opencode` CLI on the Gateway and paired nodes. Stored
sessions then appear in the **OpenCode** sessions-sidebar group, with transcript
browsing through the official `opencode --pure db ... --format json` and
`opencode --pure export` commands. Local rows also offer **Continue**, which
creates an Carapace session whose first turn resumes the native OpenCode session
through ACP. OpenCode retains the full server-side model context, and the catalog
viewer continues to show that history. Carapace also imports the recent native
history into the adopted session transcript. Very long transcripts import only
their most recent 200 items using a 512 KiB serialized-item budget. Paired-node
rows remain view-only.

The restricted environment and `--pure` mode prevent catalog browsing from
loading project plugins or inheriting unrelated Gateway credentials.

Turn **OpenCode Session Catalog** off under **Config > Plugins > OpenCode** to
disable discovery. It is enabled by default.

<!-- carapace-plugin-reference:manual-end -->

## Related docs

- [opencode](/providers/opencode)
