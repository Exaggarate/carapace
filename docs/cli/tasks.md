---
summary: "CLI reference for `carapace tasks` (background task ledger and Task Flow state)"
read_when:
  - You want to inspect, audit, or cancel background task records
  - You are documenting Task Flow commands under `carapace tasks flow`
title: "`carapace tasks`"
doc-schema-version: 1
---

Inspect durable background tasks and Task Flow state. With no subcommand,
`carapace tasks` is equivalent to `carapace tasks list`.

See [Background Tasks](/automation/tasks) for the lifecycle and delivery
model, and its `tasks audit` section for full finding descriptions.

## Usage

```bash
carapace tasks
carapace tasks list
carapace tasks list --runtime acp
carapace tasks list --status running
carapace tasks list --status blocked
carapace tasks show <lookup>
carapace tasks notify <lookup> state_changes
carapace tasks cancel <lookup>
carapace tasks retry <lookup> [lookup...]
carapace tasks dismiss <lookup> [lookup...]
carapace tasks audit
carapace tasks maintenance
carapace tasks maintenance --apply
carapace tasks flow list
carapace tasks flow show <lookup>
carapace tasks flow cancel <lookup>
```

## Root Options

| Flag               | Description                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `--json`           | Output JSON.                                                                                                  |
| `--runtime <name>` | Filter by kind: `subagent`, `acp`, `cron`, or `cli`.                                                          |
| `--status <name>`  | Filter by status: `queued`, `running`, `succeeded`, `failed`, `timed_out`, `cancelled`, `lost`, or `blocked`. |

## Subcommands

### `list`

```bash
carapace tasks list [--runtime <name>] [--status <name>] [--json]
```

Lists tracked background tasks newest first.

Use `--status blocked` to find completed tasks whose result delivery is blocked.
These tasks retain their stored `succeeded` status and also remain included in
`--status succeeded` results; JSON task records keep the same stored status and
`terminalOutcome` fields.

### `show`

```bash
carapace tasks show <lookup> [--json]
```

Shows one task by task ID, run ID, or session key.

### `notify`

```bash
carapace tasks notify <lookup> <done_only|state_changes|silent>
```

Changes the notification policy for a running task.

### `cancel`

```bash
carapace tasks cancel <lookup>
```

Cancels a running background task.

### `retry`

```bash
carapace tasks retry <lookup> [lookup...]
```

Retries 1-10 blocked subagent completion deliveries. The child execution stays
successful; retry creates a fenced delivery generation from the retained
canonical result. An ambiguous earlier acknowledgement can still cause a
duplicate visible result.

Retry and dismissal select the task's exact retained run, never another result
from the same child session. Unrelated parent turns leave suspended completions
blocked until you retry them. Upgrading from an older release repairs missing task
bindings before loading runs, including runs that have not finished yet. Only
unambiguous bindings are repaired; conflicting records remain unchanged and
cannot be recovered by guessing from a shared session.

### `dismiss`

```bash
carapace tasks dismiss <lookup> [lookup...]
```

Records intentional non-delivery for 1-10 blocked subagent completions. The task
continues to show a blocked terminal outcome and retains its result until the
7-day completion-retention window expires.

### `audit`

```bash
carapace tasks audit [--severity <warn|error>] [--code <name>] [--limit <n>] [--json]
```

Surfaces stale, lost, delivery-failed, or otherwise inconsistent task and
Task Flow records. Lost tasks retained until `cleanupAfter` are warnings;
expired or unstamped lost tasks are errors.

`--code` accepts task codes (`stale_queued`, `stale_running`, `lost`,
`delivery_failed`, `missing_cleanup`, `inconsistent_timestamps`) and additional
Task Flow codes (`restore_failed`, `stale_waiting`, `stale_blocked`,
`cancel_stuck`, `missing_linked_tasks`, `blocked_task_missing`). See
[Background Tasks](/automation/tasks) for severity and trigger detail per
code.

### `maintenance`

```bash
carapace tasks maintenance [--apply] [--json]
```

Previews or applies task and Task Flow reconciliation, cleanup stamping,
pruning, and stale cron run session registry cleanup.

For cron tasks, reconciliation uses persisted run logs/job state before
marking an old active task `lost`, so completed cron runs do not become
false audit errors just because the in-memory Gateway runtime state is gone.
Offline CLI audit and maintenance are not authoritative for the Gateway's
process-local cron, CLI, or ACP liveness. They retain active tasks of those
kinds when the local runtime cannot prove completion. Gateway maintenance
marks CLI tasks with a run id/source id `lost` when their live run context is
gone, even if an old child-session row remains.

When applied, maintenance also prunes `cron:<jobId>:run:<uuid>` session
registry rows older than 7 days while preserving currently running cron
jobs and leaving non-cron session rows untouched.

### `flow`

```bash
carapace tasks flow list [--status <name>] [--json]
carapace tasks flow show <lookup> [--json]
carapace tasks flow cancel <lookup>
```

Inspects or cancels durable Task Flow state under the task ledger. There is no
top-level `carapace flows` command. Both `flow show` and `flow cancel` accept a
flow ID or its stable owner key as `<lookup>`.

`flow list --status` accepts `queued`, `running`, `waiting`, `blocked`,
`succeeded`, `failed`, `cancelled`, or `lost`. See [Task Flow](/automation/taskflow)
for ownership and lifecycle details.

## Related

- [CLI reference](/cli)
- [Background tasks](/automation/tasks)
