# Example skills

Skill playbooks following the Carapace skills convention: a directory containing a
`SKILL.md` with `name`/`description` frontmatter and a markdown body of instructions.

Install one by copying it into the skills root (create it first if missing):

```
mkdir -p ~/.carapace/skills
cp -r skills/examples/web-research ~/.carapace/skills/web-research
```

The gateway loads every skill at boot, keeps them fresh while running (edits apply
without a restart), and tells the agent which skills exist and where each `SKILL.md`
lives. The agent reads the full file with its file tools when a task matches.

- `web-research/` — multi-source lookup procedure for the `web_fetch` tool.
- `sysadmin/` — safe operational habits for the `exec` tool on the host.

These files are examples, not loaded automatically — install them or write your own.