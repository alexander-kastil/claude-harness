# Command line

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="commands.md">← Back to Commands</a></td>
<td align="center"></td>
<td align="right"><a href="../README.md#features">↑ Back to Features</a></td>
</tr>
</table>

The Claude Harness features run from a terminal as `harness <command>` once **Claude Harness: Install 'harness' Command Line** has put `harness` on your PATH, or as `node <extension folder>/out/src/cli.js <command>` without it. In Claude Code, the harness plugin turns the views that only read into `@harness:` mentions you put in a prompt. The plugin needs Claude Harness 0.9.0 or later, and its version always matches the extension's. See [Install the harness plugin](../README.md#install-the-harness-plugin).

## Mentions in Claude Code

Type `@h` in a prompt to list the views, or `@harness:u` to narrow them, then move to a row and press Tab to write it. The views come after Claude Code's own rows for files, agents and MCP resources, so type a few letters after `@harness:` to bring them into view. When you send the prompt, each mention runs once and Claude reads its output as context; the prompt keeps the text you typed.

| Mention | Runs | Shows |
| --- | --- | --- |
| `@harness:inventory` | `inventory` | The harness of Global: memory, rules, agents, skills, commands, hooks, MCP servers and plugins. |
| `@harness:consolidate` | `consolidate` | Every skill, agent, rule, command or workflow that exists in more than one place, with its copies. |
| `@harness:agents` | `agents list` | The agents of Global, the plugins and the repos, with the copies that differ and the gated ones. |
| `@harness:usage` | `usage --session latest` | The tokens and cost of the latest session in the folder Claude Code runs in, by model and by agent. |
| `@harness:delegation` | `delegation --session latest` | The agents that session launched, with their decisions, slips and findings. |
| `@harness:hunt` | `hunt catalog` | The skills and agents a plugin can be made from. |
| `@harness:marketplaces` | `marketplaces` | Every marketplace with its plugins, and the plugins with an update or enabled without an install. |
| `@harness:check` | `check` | The harness checks of the known repos against the harness standard, with the failed checks. |
| `@harness:fleet` | `fleet` | One row per repo: its layout, its standard check, its CLAUDE.md lines, plugins and copies. |
| `@harness:sync` | `sync` | The repo copies of skills and agents that differ from Global. |
| `@harness:sessions` | `sessions` | The sessions of the folder Claude Code runs in, in /resume order, with their names, start, minutes and agents. |
| `@harness:mods` | `mods --session latest` | The mods and guards that acted in the latest session, with what they denied or held. |
| `@harness:time` | `time` | The time ledger of the folder Claude Code runs in, the last 14 days by day, with the total. |
| `@harness:lessons` | `lessons` | The entries of that folder's `tasks/lessons.md`. |
| `@harness:sources` | `sources` | The skills installed from a source, with their version and the repos they are linked into. |

The commands that write, and `media doctor`, which needs a folder, run from a terminal only.

## Tab completion

**Install 'harness' Command Line** adds a line to your PowerShell profiles and to `~/.bashrc` that loads `harness completion powershell` or `harness completion bash`. In a new terminal, press Tab after `harness ` to complete commands, options and values such as skill and agent names, sessions and film folders. VS Code's terminal suggestion box does not show these: only a preview API of VS Code can fill it.

## Commands

Each command follows `harness ` (or `node <extension folder>/out/src/cli.js `).

| Command | What it does |
| --- | --- |
| `inventory [--repo <dir>]` | The harness of Global, or of one repo: memory, rules, agents, skills, commands, hooks, MCP servers and plugins. |
| `consolidate [--name <n>]` | Every skill, agent, rule, command or workflow that exists in more than one place, with its copies. |
| `consolidate retire --name <n> --kind skill\|agent --from <global\|repo dir> [--dry-run]` | Retires one copy, backed up first with the same backup the extension makes. |
| `hunt catalog` | The skills and agents across Global and the repos that a plugin can be made from. |
| `hunt plan --name <plugin> --category <c> --skills a,b --agents x,y [--files <file>=<path in plugin>,...] [--drop-files] [--market <m>] [--description <t>] [--retire]` | The plugin that `hunt create` would write, the same as `hunt create --dry-run`. `--files` adds a hooks.json, a hook script or an `.mcp.json` to the plugin; `--drop-files` retires them too. |
| `hunt create <hunt plan options> [--dry-run]` | Writes the plugin and installs it; `--retire` retires the copies. Rolls back if the install fails. |
| `agents list` | The agents of Global, the plugins and the repos, with the copies that differ and the gated ones. |
| `agents route "<prompt>" [--repo <dir>]` | The agents the subagent-delegation plugin would route a prompt to, and the ones it drops. |
| `usage --session latest\|previous\|<id> [--repo <dir>] [--week] [--week-used <pct>]` | A session's tokens and cost by model and by agent; `--week` adds its share of the week. |
| `delegation --session latest\|previous\|<id> [--repo <dir>]` | The agents a session launched, with their decisions, slips and findings. |
| `media doctor <dir>` | Checks a film or images folder under `assets/films` or `assets/images`. |
| `skills move --leaf <skill>/<path> --to <skill>[/<path>] [--market <dir>] [--dry-run]` | Moves a leaf (file or folder) to another skill, or drops it when the target holds the same file, and repoints the references. Backed up first. |
| `skills split --from <skill> --name <new> --leaves a,b [--description <t>] [--market <dir>] [--dry-run]` | Makes a new skill from leaves of one skill and repoints the references. |
| `skills put --file <file> --to <skill>/<path>\|agents/<name>.md [--dry-run]` | Puts new or rewritten text into a skill or an agent file; an existing file is backed up first. |
| `skills remove --name <skill>\|--leaf <skill>/<path> [--market <dir>] [--dry-run]` | Deletes a skill or one leaf of it, backed up first, and lists what still mentions it. |
| `skills repoint --from <skill> --to <skill> [--skills a,b] [--agents x,y] [--market <dir>] [--dry-run]` | Rewrites the mentions of one skill name to another in skills and agents. |
| `marketplaces` | Every marketplace with its plugins, how many are installed and enabled, and the problems: an update available, or a plugin enabled without an install. |
| `marketplaces rename --from <name> --to <name> [--dry-run]` | Renames a directory marketplace in its catalog and in the settings that name it, and prints the `claude plugin marketplace` commands that register it again. |
| `check [--repo <dir>]` | The harness checks of the known repos, or of one, against the harness standard, with each failed check and whether a fix exists. |
| `check fix [--repo <dir>] [--dry-run]` | Applies the fixes the checks offer for settings and hooks; each repo's settings and hooks are backed up first. |
| `fleet` | One row per repo: its layout, its standard check, its CLAUDE.md lines, plugins, hook copies and copies. |
| `sync [--repo <dir>]` | The repo copies of skills and agents that differ from Global, with the files a sync would replace, add and delete. |
| `sync apply [--repo <dir>] [--name <n>] [--dry-run]` | Syncs those copies from Global, all of them or only `--name`, backed up first. |
| `sync plugin --name <plugin@market> [--dry-run]` | Updates an installed plugin from its marketplace when the marketplace has a newer version. |
| `sessions [--repo <dir>] [--limit <n>]` | The sessions of a repo in /resume order, with their names, start, minutes and agents; 20 by default. |
| `sessions rename --session latest\|previous\|<id> --title <t> [--repo <dir>] [--dry-run]` | Renames a session the way /rename does. A running session writes its own name again when it ends. |
| `mods --session latest\|previous\|<id> [--repo <dir>]` | The mods and guards that acted in a session, what each one decided, and the denials and holds with their reason. |
| `time [--repo <dir>] [--days <n>]` | The repo's time ledger, `.time/working-time.md`, by day for the last 14 days or `--days`, with the total of those days and of the ledger. |
| `lessons [--repo <dir>] [--find <text>]` | The entries of the repo's `tasks/lessons.md`, or only those that mention a text. |
| `sources` | The skills installed from a source, with their source, version, install date and the repos they are linked into. |
| `sources check` | Asks each source whether it has a newer version of the skill. |
| `sources update --name <skill> [--dry-run]` | Installs the source's version of one skill, backed up first. |
| `complete --line "<command line>" [--position <n>]` | The candidates for the word at the cursor, one per line, or a list with `--json`. The Tab completion scripts call it. |
| `completion powershell\|bash` | Prints the Tab completion script for that shell; the lines **Install 'harness' Command Line** adds load it. |

## Options

| Option | Meaning |
| --- | --- |
| `--root <dir>` | Claude's folder, `~/.claude` by default. |
| `--repo <dir>` | A repo to include besides the known ones; repeatable. |
| `--repos a,b` | More repos to include, like the extension's repoFolders setting. |
| `--json` | JSON instead of text. |
| `--dry-run` | A command that writes prints each action as `[dry-run] ...` and writes nothing. |
| `--help` | The list of commands and options. |

## Output

Commands that return data print a bold headline and then tables. With `--json`, every command ends in one JSON object whose `applied` key is `true` when it wrote something and `false` otherwise; a dry run and a real run have the same shape.

| Exit code | Meaning |
| --- | --- |
| 0 | Done. |
| 1 | An error, or problems found. |
| 2 | An unknown flag or bad arguments. |
