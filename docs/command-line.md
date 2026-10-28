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

For type-ahead on the terminal commands, see [Type-ahead](type-ahead.md).

## Tab completion

**Install 'harness' Command Line** adds a line to your PowerShell profiles and to `~/.bashrc` that loads `harness completion powershell` or `harness completion bash`. In a new terminal, press Tab after `harness ` to complete commands, options and values such as skill and agent names, sessions and film folders. VS Code's terminal suggestion box does not show these: only a preview API of VS Code can fill it.

The candidates that each command offers are listed on the [Type-ahead](type-ahead.md) page.

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
| `generate agent <name> [--scope repo\|user] [--model <m>] [--tools a,b] [--description <t>] [--from <file>] [--dry-run]` | Makes sure an agent exists in the repo's `.claude` folder, or in `~/.claude` with `--scope user`. A rerun with nothing changed writes nothing. `g` is an alias of `generate`. |
| `generate rule <name> [--scope repo\|user] [--paths a,b] [--from <file>] [--dry-run]` | Makes sure a rule exists. `--from` takes the text of a template file. |
| `generate skill <name> [--scope repo\|user] [--description <t>] [--from <file>] [--dry-run]` | Makes sure a skill exists, as a `SKILL.md`. `--from` takes the text of a template file. |
| `generate command <name> [--scope repo\|user] [--description <t>] [--from <file>] [--dry-run]` | Makes sure a slash command exists. A name with `:` goes into folders. |
| `generate hook <event> --command <c> [--matcher <m>] [--scope repo\|user] [--dry-run]` | Makes sure `settings.json` has a hook for the event, such as `PreToolUse`, `PostToolUse` or `Stop`, that runs the command. |
| `generate mcp <name> --url <u>\|--command <c> [--args a,b] [--transport http\|sse] [--scope repo\|user] [--dry-run]` | Makes sure an MCP server is configured, through `claude mcp add`. |
| `add <plugin>@<marketplace> [--scope repo\|user] [--dry-run]` | Makes sure a plugin is installed (`claude plugin install`) and enabled. |
| `new <repo> --summary <t> [--area name=glob[,glob]:owner]... [--rule <t>]... [--dry-run]` | Scaffolds a repo's harness with the harness standard's scaffold script. Files that exist are skipped. |
| `update [--repo <dir>] [--dry-run]` | Brings installed plugins up to their marketplace version, and the repo's skills and agents up to their Global copy. |
| `validate [<file>] [--repo <dir>]` | Checks a `.harness` script line by line, and the harness of `--repo`. Writes nothing. |
| `run <file> [--dry-run]` | Validates a `.harness` script, then applies it step by step. Stops at the first failing step and ends with a summary table. |
| `complete --line "<command line>" [--position <n>]` | The candidates for the word at the cursor, one per line, or a list with `--json`. The Tab completion scripts call it. |
| `completion powershell\|bash` | Prints the Tab completion script for that shell; the lines **Install 'harness' Command Line** adds load it. |

`validate` and `run` read a `.harness` script. Its format is described on the [Harness scripts](harness-scripts.md) page.

## Example: the poem harness

The poem harness has a poem writer agent, a poem reviewer agent, a style rule and a review command. Its script, `harness/poems.harness`, writes them into the repo `D:/demo/poems`. The rule and the command take their text from templates beside the script, and `--from` resolves against the script's own folder.

```text
# poems.harness: a poem writer and a poem reviewer
repo D:/demo/poems
generate agent poem-writer --model sonnet --tools Read,Write,Edit --description "Writes a short poem on a given theme into poems/"
generate agent poem-reviewer --model haiku --tools Read,Grep --description "Reviews a poem for meter, rhyme and imagery"
generate rule poem-style --paths poems/** --from templates/rules/poem-style.md
generate command review-poem --description "Review the newest poem" --from templates/commands/review-poem.md
```

The rule template, `harness/templates/rules/poem-style.md`:

```markdown
# Poem style

- Four stanzas of four lines, rhyme scheme ABAB.
- Concrete images over abstract words.
- A title of at most five words.
```

The command template, `harness/templates/commands/review-poem.md`:

```markdown
Review the newest file in poems/ with the poem-reviewer agent and list one fix per stanza.
```

Check the script, then run it from a terminal:

```powershell
harness validate harness/poems.harness
harness run harness/poems.harness --dry-run
harness run harness/poems.harness
```

## Options

| Option | Meaning |
| --- | --- |
| `--root <dir>` | Claude's folder, `~/.claude` by default. |
| `--repo <dir>` | A repo to include besides the known ones; repeatable. |
| `--repos a,b` | More repos to include, like the extension's repoFolders setting. |
| `--json` | JSON instead of text. |
| `--dry-run` | A command that writes writes nothing. `generate` and `run` print the lines a real run would print and end with the `NOTE:` line (see [Dry run](#dry-run)); the other commands print each action as `[dry-run] ...`. |
| `--scope repo\|user` | Where a `generate` or `add` command writes: the repo, or the user scope. |
| `--yes`, `--apply` | Accepted, and do nothing. |
| `--help` | The list of commands and options. |

## Output

Commands that return data print a bold headline and then tables. With `--json`, every command ends in one JSON object whose `applied` key is `true` when it wrote something and `false` otherwise; a dry run and a real run have the same shape.

Commands that write print one line per change: the action, the file, and either its size or a note in brackets. `CREATE` adds a file and `UPDATE` replaces one. When a run replaces an existing file, it backs the file up and prints a `Backup:` line with the backup folder. A rerun that has nothing to change prints `Nothing to be done.`

`run` ends with a summary table, one row per step. Each row shows the step's line in the script and its result: `done`, `nothing to be done`, `failed` or `not run`. A failed step stops the run, and the steps after it show `not run`.

### Dry run

`harness run harness/poems.harness --dry-run` prints:

```text
CREATE .claude/agents/poem-writer.md (127 bytes)
CREATE .claude/agents/poem-reviewer.md (116 bytes)
CREATE .claude/rules/poem-style.md (163 bytes)
CREATE .claude/commands/review-poem.md (135 bytes)
NOTE: The "--dry-run" option means no changes were written.

**4 steps**

| Line | Step                                                                                                                               | Result |
| ---: | ---------------------------------------------------------------------------------------------------------------------------------- | ------ |
|    3 | generate agent poem-writer --model sonnet --tools Read,Write,Edit --description "Writes a short poem on a given theme into poems/" | done   |
|    4 | generate agent poem-reviewer --model haiku --tools Read,Grep --description "Reviews a poem for meter, rhyme and imagery"           | done   |
|    5 | generate rule poem-style --paths poems/** --from templates/rules/poem-style.md                                                     | done   |
|    6 | generate command review-poem --description "Review the newest poem" --from templates/commands/review-poem.md                       | done   |
```

### Run

`harness run harness/poems.harness` prints the same CREATE lines and table as the dry run, without the NOTE line.

### Rerun

Running the same command again writes nothing:

```text
Nothing to be done.

**4 steps**

| Line | Step                                                                                                                               | Result             |
| ---: | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
|    3 | generate agent poem-writer --model sonnet --tools Read,Write,Edit --description "Writes a short poem on a given theme into poems/" | nothing to be done |
|    4 | generate agent poem-reviewer --model haiku --tools Read,Grep --description "Reviews a poem for meter, rhyme and imagery"           | nothing to be done |
|    5 | generate rule poem-style --paths poems/** --from templates/rules/poem-style.md                                                     | nothing to be done |
|    6 | generate command review-poem --description "Review the newest poem" --from templates/commands/review-poem.md                       | nothing to be done |
```

### Validation error

This script has five problems:

```text
# broken
repo D:/demo/poems
generate agent poem-writer --model sonet --tool Read
generat rule poem-style
generate rule Poem_Style --from templates/rules/missing.md
```

`harness validate harness/broken.harness` prints the problems and exits 2:

```text
**5 problems in harness/broken.harness**

| Line | Problem                                                                                                                        |
| ---: | ------------------------------------------------------------------------------------------------------------------------------ |
|    3 | unknown flag: --tool                                                                                                           |
|    3 | unknown model "sonet": sonnet, opus, haiku, inherit or a claude-... id; did you mean sonnet?                                   |
|    4 | unknown verb "generat"                                                                                                         |
|    5 | "Poem_Style" is not a valid rule name. Lowercase letters, digits, dots, dashes and underscores; starts with a letter or digit. |
|    5 | --from file templates/rules/missing.md does not exist                                                                          |
```

`harness run harness/broken.harness` prints the same table and applies nothing.

### Exit codes

| Exit code | Meaning |
| --- | --- |
| 0 | Done. |
| 1 | An error, or a harness problem found by `validate`. A failed step in `run` also exits 1. |
| 2 | A script error or bad arguments. |
