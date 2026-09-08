# @carapace/tokenjuice

Official Tokenjuice output compaction plugin for Carapace.

Tokenjuice compacts noisy `exec` and `bash` tool results after commands run, before the result is fed back into the active agent session. It does not rewrite commands, rerun commands, or change exit codes.

## Install

```bash
carapace plugins install @carapace/tokenjuice
```

Restart the Gateway after installing or updating the plugin.

## Enable

```bash
carapace config set plugins.entries.tokenjuice.enabled true
```

Equivalent:

```bash
carapace plugins enable tokenjuice
```

## Docs

- ../../docs/tools/tokenjuice.md

## Package

- Plugin id: `tokenjuice`
- Package: `@carapace/tokenjuice`
- Minimum Carapace host: `2026.5.28`
