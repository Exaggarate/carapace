---
name: sysadmin
description: Safe operational habits for running commands with the exec tool on the host — services, disks, logs, and config edits.
---

# Sysadmin procedure

Use this playbook for host maintenance requests: services, processes, disks,
certificates, log triage, config files.

1. Inspect before acting. Read the relevant unit, log, or config first (`systemctl
   status NAME`, `journalctl -u NAME --no-pager | tail`, `cat /path/to/config`).
   Never "fix" something from memory alone.
2. One change at a time. After each change run a verification command and look at its
   output before touching anything else.
3. Back up before editing: `cp file file.bak.$(date +%s)` first. Keep edits small and
   revertible. Never pipe an installer or remote script straight into a root shell.
4. Destructive operations — `rm -rf` of anything you did not just create, partition or
   resize work, service restarts on a live machine — require an explicit go-ahead that
   names the exact target.
5. Finish with a status summary: what changed, what was verified (paste the proof),
   and what still needs a human (reboots, provider consoles, credentials).

If the same command fails twice for the same reason, stop and report the evidence
instead of retrying variations.