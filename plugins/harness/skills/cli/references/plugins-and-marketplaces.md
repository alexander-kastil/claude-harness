# Plugins and marketplaces

Plugin Hunter builds a plugin from skills and agents; the marketplace commands list, check and rename
marketplaces and update an installed plugin. Writing commands run for real unless `--dry-run` is given.

| Command | Returns (`--json`) |
| --- | --- |
| `hunt catalog` | `{catalog, markets, applied}`: the skills and agents across Global and repos, and the marketplaces (owned ones can take a plugin) |
| `hunt plan ...` | the same as `hunt create --dry-run` |
| `hunt create --name <p> --category <c> --skills a,b --agents x,y [--market <m>] [--description <t>] [--retire]` | `{name, market, problems, files, retired, kept, source, dir, installed, backup, applied}` |
| `hunt create ... --files <file>=<path in plugin>,... [--drop-files]` | with `hunt create`: also copies a hooks.json, a hook script or an `.mcp.json` into the plugin (a plugin may be made of these alone); `--drop-files` retires the ones under `--root`, backed up first; `--market` takes the marketplace name or its folder |
| `marketplaces` | `{marketplaces: [{name, kind, source, location, plugins, installed, enabled, updates}], problems: [{marketplace, plugin, problem, installed, source}], applied}`; `problem` is `Update available` or `Enabled, not installed` |
| `marketplaces rename --from <name> --to <name> [--dry-run]` | `{from, to, kind, changes: [{file, detail}], commands: [string], applied}`; rewrites the catalog and the settings that name it, and lists the `claude plugin marketplace` commands that re-register it; only a directory marketplace, exit 1 for an unknown `--from` or an existing `--to` |
| `sync plugin --name <plugin@market> [--dry-run]` | `{plugin, market, installed, source, action, applied}`; `action` is `current`, `would update` or `updated` |

`hunt create` writes `plugins/<category>/<name>/` with `plugin.json`, the skills and agents, adds the
entry to the marketplace's `marketplace.json`, installs `<name>@<market>` for the user, and with
`--retire` retires every copy of the chosen items (backed up under `~/.claude/repo-sync-backups/<stamp>/`).
A repo whose `CLAUDE.md` keeps its copies stays; `kept` says why. If the install fails, the plugin
folder and its marketplace entry are removed again and nothing is retired.
