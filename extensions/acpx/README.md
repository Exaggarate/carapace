# @carapace/acpx

Official ACP runtime backend for Carapace.

ACPx lets Carapace run external coding harnesses through the Agent Client Protocol while Carapace still owns sessions, channels, delivery, permissions, and Gateway state.

## Install

```bash
carapace plugins install @carapace/acpx
```

Restart the Gateway after installing or updating the plugin.

## What it provides

- ACP-backed agent runtime sessions.
- Plugin-owned session and transport management.
- MCP bridge helpers for Carapace tools and plugin tools.
- Static runtime assets used by the ACP process bridge.

## Configure

Use the ACP docs for harness-specific setup, permission modes, and model/runtime selection:

- ../../docs/tools/acp-agents-setup.md
- ../../docs/tools/acp-agents.md

## Package

- Plugin id: `acpx`
- Package: `@carapace/acpx`
- Minimum Carapace host: `2026.4.25`
