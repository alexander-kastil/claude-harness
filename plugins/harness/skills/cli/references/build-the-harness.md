# Build the harness

`generate`, `add`, `new` and `update` each make sure one thing exists as given; a rerun with nothing
changed writes nothing. A `.harness` script holds such steps one per line: `validate` checks it,
`run` applies it. They run for real unless `--dry-run` is given; an existing file they change is
backed up under `<root>/repo-sync-backups/<stamp>/` first, and `backups` lists the copies.

A step command returns (`--json`) `{steps: [{line, step, result, error?, changes: [{action, file, size?, note?}]}], changes, backups, applied}`;
`result` is `done`, `nothing to be done`, `failed` or `not run`, `action` is `CREATE`, `UPDATE` or
`DELETE`; exit 1 when a step failed, 2 for bad arguments.

| Command | Returns (`--json`) |
| --- | --- |
| `generate agent <name> [--scope repo\|user] [--model <m>] [--tools a,b] [--description <t>] [--from <file>] [--dry-run]` | the step shape; an agent in the repo (or `~/.claude` with `--scope user`); `generate` has the alias `g` |
| `generate rule <name> [--scope repo\|user] [--paths a,b] [--from <file>] [--dry-run]` | the step shape; a rule, `--from` takes the text of a template file |
| `generate skill <name> [--scope repo\|user] [--description <t>] [--from <file>] [--dry-run]` | the step shape; a skill (a SKILL.md), `--from` takes the text of a template file |
| `generate command <name> [--scope repo\|user] [--description <t>] [--from <file>] [--dry-run]` | the step shape; a slash command, a name with `:` goes into folders |
| `generate hook <event> --command <c> [--matcher <m>] [--scope repo\|user] [--dry-run]` | the step shape; a hook in settings.json that runs the command on the event (`PreToolUse`, `PostToolUse`, `Stop` ...) |
| `generate mcp <name> --url <u>\|--command <c> [--args a,b] [--transport http\|sse] [--scope repo\|user] [--dry-run]` | the step shape; an MCP server, configured through `claude mcp add` |
| `add <plugin>@<marketplace> [--scope repo\|user] [--dry-run]` | the step shape; the plugin installed (`claude plugin install`) and enabled |
| `new <repo> --summary <t> [--area name=glob[,glob]:owner]... [--rule <t>]... [--dry-run]` | the step shape; the repo's harness from the harness standard's scaffold script, existing files skipped |
| `update [--repo <dir>] [--dry-run]` | the step shape; the installed plugins brought up to their marketplace version and the repo's skills and agents up to their Global copy |
| `validate [<file>] [--repo <dir>]` | writes nothing. A script alone: `{file, steps, problems: [], applied}`, or `{file, problems: [{line, message}], applied}` and exit 2 when a line is wrong. With `--repo` or no file: `{repo, problems: [{file, line, level, message}], notes, applied}`; `level` is `FAIL` (the standard's check) or `POINTER` (a dead pointer in `CLAUDE.md` or a rules file); exit 1 when there are problems |
| `run <file> [--dry-run]` | the step shape, one entry per script line; validates first (exit 2 with `{file, problems}`), then applies step by step, stops at the first failing step and marks the rest `not run` |
