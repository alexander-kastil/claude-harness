# Command line

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="commands.md">← Back to Commands</a></td>
<td align="center"></td>
<td align="right"><a href="../README.md#features">↑ Back to Features</a></td>
</tr>
</table>

The Claude Harness features run from a terminal as `harness <command>` once **Claude Harness: Install 'harness' Command Line** has put `harness` on your PATH, or as `node <extension folder>/out/src/cli.js <command>` without it. In Claude Code, the harness plugin turns the views that only read into `@harness:` mentions you put in a prompt. The plugin needs Claude Harness 0.8.0 or later, and its version always matches the extension's. See [Install the harness plugin](../README.md#install-the-harness-plugin).

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
