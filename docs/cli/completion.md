---
summary: "CLI reference for `carapace completion` (generate/install shell completion scripts)"
read_when:
  - You want shell completions for zsh/bash/fish/PowerShell
  - You need to cache completion scripts under Carapace state
title: "Completion"
---

# `carapace completion`

Generate shell completion scripts, cache them under Carapace state, and optionally install them into your shell profile.

## Usage

```bash
carapace completion                          # print the detected shell's script
carapace completion --shell fish             # print fish script
carapace completion --write-state            # cache scripts for all shells
carapace completion --write-state --install  # cache, then install in one step
carapace completion --shell bash --write-state
```

## Options

- `-s, --shell <shell>`: shell target (`zsh`, `bash`, `powershell`, `fish`; detected from `$SHELL`, otherwise PowerShell on Windows and zsh elsewhere)
- `-i, --install`: install completion by adding a source line for the cached script to your shell profile
- `--write-state`: write completion script(s) to `$CARAPACE_STATE_DIR/completions` (default `~/.carapace/completions`) without printing to stdout; with `--shell` writes only that shell, otherwise all four
- `-y, --yes`: skip install confirmation prompts (non-interactive)

## Install flow

`--install` points your profile at the cached script, so the cache must exist first: if it is missing, the command fails and tells you to run `carapace completion --write-state`. Combine `--write-state --install` to do both in one step. Without `--shell`, the command preserves a recognized `$SHELL`; when `$SHELL` is missing or unrecognized, it defaults to PowerShell on Windows and zsh elsewhere.

The install writes a small `# Carapace Completion` block into your shell profile and replaces any older slow `source <(carapace completion ...)` lines with the cached source line:

| Shell      | Profile                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| bash       | `~/.bashrc` (falls back to `~/.bash_profile` when `~/.bashrc` is missing)                                                                                                                  |
| fish       | `~/.config/fish/config.fish`                                                                                                                                                               |
| powershell | `~/.config/powershell/Microsoft.PowerShell_profile.ps1` (on Windows: `Documents/PowerShell/Microsoft.PowerShell_profile.ps1`, or `Documents/WindowsPowerShell/...` for Windows PowerShell) |
| zsh        | `$ZDOTDIR/.zshrc` when `ZDOTDIR` is defined; otherwise `~/.zshrc` (an empty `ZDOTDIR` resolves to `/.zshrc`)                                                                               |

Profile changes are staged beside the destination and atomically replace it only after a complete durable write. A failed install leaves an existing profile unchanged.

Installed source lines preserve literal cache paths, including spaces, quotes, dollar signs, and backslashes. Reinstalling replaces Carapace's previous source line after the state directory changes.

## Permission failures

If Doctor or onboarding cannot update your shell profile, completion remains
optional and setup continues. When a cache is available, the warning includes a
command to load that cache in your current matching shell session. Run the complete
command as printed. This does not install completion for future shell sessions.

For persistent installation, resolve the reported permission or read-only error
before retrying `carapace completion --install`. The failure location may be a
staging directory or a symlink target, not the profile itself. Atomic replacement
also needs write access to the destination directory. The installer uses the
profile selected in the table above; it has no profile-file destination option.

## Notes

- Without `--install` or `--write-state`, the command prints the script to stdout.
- Completion generation eagerly loads the full command tree, including plugin CLI commands, so nested subcommands are included.
- If invalid configuration prevents plugin discovery, generation warns and still includes core commands. Repair the configuration and regenerate to include plugin commands.
- Bash completion supports both `--flag value` and `--flag=value`, including named profiles before nested commands and single-quoted, double-quoted, or backslash-escaped value prefixes.
- `carapace update` refreshes the completion cache automatically after a successful update; `carapace doctor` can repair missing or stale completion setups.

## Related

- [CLI reference](/cli)
