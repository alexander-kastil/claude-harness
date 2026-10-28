# Type-ahead

Type-ahead offers the next word in three places: the Claude Code prompt, a terminal, and a `.harness` script in VS Code. The samples use the poem writer and poem reviewer harness, `harness/poems.harness` in `D:/demo/poems`.

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="command-line.md">← Back to Command line</a></td>
<td align="center"><a href="#type-ahead">↑ Back to top</a></td>
<td align="right"><a href="harness-scripts.md">→ Harness scripts</a></td>
</tr>
</table>

## Mentions in the Claude Code prompt

The harness plugin offers `@harness:` mentions while you type a word that starts with `@h`. Each mention names a view that reads and needs no arguments. Press Tab on a row to write it into the prompt. When you send the prompt, each mention runs once and Claude reads its output as context. The prompt keeps the text you typed.

A mention runs only when it starts a word. `see@harness:agents` runs nothing, while `see @harness:agents` does.

### Mention rows

| Mention | Runs | Shows |
| --- | --- | --- |
| `@harness:inventory` | `inventory` | The harness of Global: memory, rules, agents, skills, commands, hooks, MCP servers, plugins |
| `@harness:consolidate` | `consolidate` | Every skill, agent, rule, command or workflow that exists in more than one place |
| `@harness:agents` | `agents list` | The agents of Global, the plugins and the repos, with the copies that differ and the gated ones |
| `@harness:usage` | `usage --session latest` | The tokens and cost of the latest session in the folder Claude Code runs in, by model and by agent |
| `@harness:delegation` | `delegation --session latest` | The agents the latest session launched, with their decisions, slips and findings |
| `@harness:hunt` | `hunt catalog` | The skills and agents a plugin can be made from |

The commands that write, and `media doctor`, which needs a folder, run from a terminal only.

### Narrowing the list

Type more letters after `@harness:` to narrow the rows.

| Typed | Rows offered |
| --- | --- |
| `@h` or `@harness:` | All six rows |
| `@harness:a` | `@harness:agents` |
| `@harness:d` | `@harness:delegation` |
| `@harness:u` | `@harness:usage` |

The views come after Claude Code's own rows for files, agents and MCP resources. Type a few letters after `@harness:` to bring them into view.

### Samples with the poem harness

Ask which agents the repo has. Type this in the prompt and send it:

```text
Which agents review the poems in poems/? @harness:agents
```

Claude gets a block that starts with this header, followed by the output of `agents list`:

```text
@harness:agents (claude-harness agents list):
```

Ask what the latest session launched:

```text
Did poem-reviewer run in the last session? @harness:delegation
```

A mention that is not a view sends Claude an error block. Sending this prompt:

```text
@harness:generate
```

Gives Claude this text:

```text
@harness:generate is not a harness view; the views are @harness:inventory, @harness:consolidate, @harness:agents, @harness:usage, @harness:delegation, @harness:hunt.
```

The harness plugin registers the mentions. Its `hooks.json` loads `harness-guard.mjs`, which sets up the mentions from `harness-command.mjs`.

## Tab completion in a terminal

Run **Claude Harness: Install 'harness' Command Line** in VS Code. On Windows, the command asks which shells to set up: PowerShell and Git Bash, PowerShell only, or Git Bash only. It adds one line to each chosen profile. The PowerShell line is:

```powershell
harness completion powershell | Out-String | Invoke-Expression
```

The Git Bash line goes into `~/.bashrc`:

```bash
eval "$(harness completion bash)"
```

Open a new terminal after the install. Press Tab after `harness ` to complete commands, options and values. `harness completion powershell` and `harness completion bash` print the scripts that these lines load.

The candidates depend on the words before the cursor. These rows are the output of `harness complete --line` for each typed line:

| Typed so far | Candidates |
| --- | --- |
| `harness g` | `generate` |
| `harness generate ` | `agent`, `rule`, `skill`, `command`, `hook`, `mcp` |
| `harness generate agent poem-writer --` | `--scope`, `--model`, `--tools`, `--description`, `--from`, `--dry-run`, `--root`, `--repo`, `--repos`, `--json`, `--help` |
| `harness generate agent poem-writer --model ` | `sonnet`, `opus`, `haiku`, `inherit` |
| `harness generate agent poem-writer --model h` | `haiku` |
| `harness generate agent poem-writer --tools Read,W` | `Read,Write`, `Read,WebFetch`, `Read,WebSearch` |
| `harness generate hook ` | `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `PreCompact`, then the options |
| `harness completion ` | `powershell`, `bash`, then the global options |

For every command and option, see [Command line](command-line.md).

## Completion in a .harness script in VS Code

A file with the `.harness` extension opens in the Claude Harness language. Its completions come from the same candidates as the terminal, with three changes for script lines:

- A line starts with one of these verbs: `repo`, `add`, `generate`, `g`, `new` or `update`.
- The options that only the terminal takes are left out: `--root`, `--repo`, `--repos`, `--json`, `--help`, `--dry-run` and `--user-config`.
- After `repo ` the editor offers nothing, because the folder that follows is free text.

Type this in `harness/poems.harness`:

```text
repo D:/demo/poems
gen
```

After `gen`, the editor offers `generate`. On the next line, typing `generate agent poem-writer --` offers `--scope`, `--model`, `--tools`, `--description` and `--from`. Typing `generate agent poem-writer --model ` offers `sonnet`, `opus`, `haiku` and `inherit`.

Hover a verb or an option to read its help text. The editor also checks the script with the same rules as `harness validate`. A broken line gets an error underline, and the message is the one `validate` prints. The checks run when a file opens, when it saves, and 250 ms after the last edit. This script has five problems:

```text
# broken
repo D:/demo/poems
generate agent poem-writer --model sonet --tool Read
generat rule poem-style
generate rule Poem_Style --from templates/rules/missing.md
```

The problems are `unknown flag: --tool` and `unknown model "sonet"` on line 3, `unknown verb "generat"` on line 4, and the rule name and missing file on line 5.

For the script format, see [Harness scripts](harness-scripts.md).

## What has no type-ahead yet

VS Code's terminal suggestion box shows no harness candidates. Filling it needs a proposed VS Code API.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="command-line.md">← Back to Command line</a></td>
<td align="center"><a href="#type-ahead">↑ Back to top</a></td>
<td align="right"><a href="harness-scripts.md">→ Harness scripts</a></td>
</tr>
</table>
