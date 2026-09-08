---
summary: "CLI reference for `carapace uninstall` (remove gateway service + local data)"
read_when:
  - You want to remove the gateway service and/or local state
  - You want a dry-run first
title: "Uninstall CLI"
---

# `carapace uninstall`

Uninstall the Gateway service and/or local data. The CLI itself is not
removed; uninstall it via npm/pnpm separately.

## Options

| Flag                | Default | Description                                          |
| ------------------- | ------- | ---------------------------------------------------- |
| `--service`         | `false` | Remove the Gateway service.                          |
| `--state`           | `false` | Remove state and config.                             |
| `--workspace`       | `false` | Remove workspace directories.                        |
| `--app`             | `false` | Remove the macOS app.                                |
| `--all`             | `false` | Shorthand for `--service --state --workspace --app`. |
| `--yes`             | `false` | Skip confirmation prompts.                           |
| `--non-interactive` | `false` | Disable prompts; requires `--yes`.                   |
| `--dry-run`         | `false` | Print planned actions without removing files.        |

With no scope flags, an interactive multiselect prompts for which components
to remove (defaults to the Gateway service only).

## Examples

```bash
carapace backup create
carapace uninstall
carapace uninstall --service --yes --non-interactive
carapace uninstall --state --workspace --yes --non-interactive
carapace uninstall --all --yes
carapace uninstall --dry-run
```

## Notes

Uninstall reports each requested scope and exits nonzero if any requested cleanup fails or is blocked. A failed gateway service inspection, stop, or uninstall blocks state and workspace mutation, but independent macOS app cleanup is still attempted. After service teardown is safe, other permitted scopes continue so failures can be reported together. On non-macOS systems, `--app` reports that the scope is not applicable.

- Run `carapace backup create` first for a restorable snapshot before removing
  state or workspaces.
- Before removing state, `--state` requires exclusive state ownership. If an
  unmanaged or externally supervised Gateway is still running, uninstall
  refuses and asks you to stop it first.
- `--state` preserves configured workspace directories unless `--workspace` is
  also selected.

## Related

- [CLI reference](/cli)
- [Uninstall](/install/uninstall)
