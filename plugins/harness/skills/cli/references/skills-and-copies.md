# Skills and copies that write

These commands change files, each backed up first, always under `<root>/repo-sync-backups/<stamp>/`. They run for real unless `--dry-run` is given.

| Command | Returns (`--json`) |
| --- | --- |
| `consolidate retire --name <n> --kind skill\|agent --from <global\|repo dir>` | `{kind, name, from, path, backup, identicalTo, applied}`; a Global copy is retired only when an identical plugin copy exists |
| `skills move --leaf <skill>/<path> --to <skill>[/<path>] [--market <dir>]` | `{op, changes: [{action, file, detail}], backup, applied}`; moves a file or folder of a skill into another skill, repoints every mention of its path in the skills, agents and market plugins, backs every changed file up first; an identical file at the destination only drops the source, a different one stops with exit 1; `check` rows name text that still mentions the old place |
| `skills split --from <skill> --name <new> --leaves a,b [--description <t>] [--market <dir>]` | the same shape: creates the new skill (a SKILL.md with one row per leaf) and moves the leaves into it |
| `skills put --file <file> --to <skill>/<path>\|agents/<name>.md` | the same shape: puts new or rewritten text in place, an existing file backed up first |
| `skills remove --name <skill>\|--leaf <skill>/<path> [--market <dir>]` | the same shape: deletes a skill or one leaf, backed up first, and lists what still mentions it |
| `skills repoint --from <skill> --to <skill> [--skills a,b] [--agents x,y] [--market <dir>]` | the same shape: rewrites the mentions of one skill name to another; exit 1 when nothing mentions it |
| `skills rename --from <skill> --to <name> [--market <dir>]` | the same shape with `op: 'rename'`: renames the skill's folder (`<root>/skills/<from>`, else `<market>/plugins/**/skills/<from>`) and its `name:` line, then rewrites the mentions as `repoint` does, the skill's own files included; every changed file backed up first; exit 1 when the skill is missing or `<to>` exists beside it |
| `sync apply [--repo <dir>] [--name <n>] [--dry-run]` | `{copies: [{repo, kind, name, state, files, backup, error?}], applied}`; syncs the repo copies that differ from Global, backed up under `<root>/repo-sync-backups/<stamp>/`; exit 1 for an unknown `--name` or a failed copy |
| `sources update --name <skill> [--dry-run]` | `{name, source, from, to, changed, added, removed, backup, applied}`; installs the source's version into `~/.claude/skills`, backed up under `<root>/repo-sync-backups/<stamp>/skills/<name>` first |
| `check fix [--repo <dir>] [--dry-run]` | `{repos: [{repo, fixable, changes: [string], backup, error}], applied}`; applies the settings and hooks fixes, the repo's settings and hooks backed up under `<root>/repo-sync-backups/<stamp>/<repo path>/` first; exit 1 when a repo errored |
| `sessions rename --session latest\|previous\|<id> --title <t> [--repo <dir>] [--dry-run]` | `{session, file, from, to, applied}`; renames as /rename does; a running session gets its own name back at exit |
