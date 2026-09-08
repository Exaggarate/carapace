---
summary: "CLI reference for `carapace clawbot` (legacy alias namespace)"
read_when:
  - You maintain older scripts using `carapace clawbot ...`
  - You need migration guidance to current commands
title: "Clawbot"
---

# `carapace clawbot`

Legacy alias namespace kept for backward compatibility. It registers the same QR command as the top-level CLI, so `carapace clawbot qr` accepts every [`carapace qr`](/cli/qr) flag.

## Migration

Prefer the modern top-level command:

- `carapace clawbot qr` -> `carapace qr`

## Related

- [CLI reference](/cli)
