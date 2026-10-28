# Harness scripts

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="command-line.md">← Back to Command line</a></td>
<td align="center"></td>
<td align="right"><a href="type-ahead.md">→ Next: Type-ahead</a></td>
</tr>
</table>

A `.harness` script lists `harness` commands, one per line, and runs them in order. It builds the same agents, rules, skills, commands, hooks and MCP servers as the single commands, from a file you can keep in the repo and review. Check the script with `harness validate` before you run it with `harness run`.

## Script format

Each line holds one command without the `harness` prefix:

```text
generate agent poem-writer --model sonnet --tools Read,Write,Edit --description "Writes a short poem on a given theme into poems/"
```

- A line starts with a verb: `generate` (or `g`), `add`, `new`, `update` or `repo`.
- A line that starts with `#` is a comment. Blank lines are ignored.
- `repo <dir>` sets the repo folder for the lines after it. A relative folder resolves against the script's folder, and the folder must exist. Lines before the first `repo` line apply to the current folder.
- `--from <file>` resolves against the script's folder, not the repo.
- A script line accepts the flags of its own verb. Global flags such as `--dry-run`, `--repo` and `--json` fail with `unknown flag`.

`generate` makes sure that a file exists the way the line describes. Each kind takes its own flags:

| Kind | Flags |
| --- | --- |
| `agent` | `--scope`, `--model`, `--tools`, `--description`, `--from` |
| `rule` | `--scope`, `--paths`, `--from` |
| `skill` | `--scope`, `--description`, `--from` |
| `command` | `--scope`, `--description`, `--from` |
| `hook` | `--scope`, `--matcher`, `--command`, with the event name in the name position |
| `mcp` | `--scope`, `--url`, `--command`, `--args`, `--transport` |

`--scope repo` is the default and writes into the repo's `.claude` folder. `--scope user` writes into the global `~/.claude` folder. The `--model` value is `sonnet`, `opus`, `haiku`, `inherit` or a full `claude-` model id.

The other verbs:

| Verb | Step |
| --- | --- |
| `add <plugin>@<marketplace>` | Installs a plugin from a registered marketplace. |
| `new <repo> --summary <text>` | Scaffolds a repo. `--summary` is required. |
| `update` | Brings installed plugins and the repo's skills and agents up to date. |

For the full list of commands and flags, see [Command line](command-line.md).

## The poem writer and reviewer sample

This sample creates a poem writer agent, a poem reviewer agent, a rule for poem style and a command that reviews the newest poem. It reads two templates from the script's folder:

```text
harness/
  poems.harness
  templates/
    commands/review-poem.md
    rules/poem-style.md
```

Save this script as `harness/poems.harness`:

```text
# poems.harness: a poem writer and a poem reviewer
repo D:/demo/poems
generate agent poem-writer --model sonnet --tools Read,Write,Edit --description "Writes a short poem on a given theme into poems/"
generate agent poem-reviewer --model haiku --tools Read,Grep --description "Reviews a poem for meter, rhyme and imagery"
generate rule poem-style --paths poems/** --from templates/rules/poem-style.md
generate command review-poem --description "Review the newest poem" --from templates/commands/review-poem.md
```

The rule template is `harness/templates/rules/poem-style.md`:

```markdown
# Poem style

- Four stanzas of four lines, rhyme scheme ABAB.
- Concrete images over abstract words.
- A title of at most five words.
```

The command template is `harness/templates/commands/review-poem.md`:

```markdown
Review the newest file in poems/ with the poem-reviewer agent and list one fix per stanza.
```

## Validate a script

`harness validate` checks each line of a script and writes nothing. A clean script prints one line and exits with 0:

```powershell
harness validate harness/poems.harness
```

```text
**harness/poems.harness: 4 steps, no problems.**
```

A script with mistakes prints a table of problems and exits with 2. The next script has five problems:

```text
# broken
repo D:/demo/poems
generate agent poem-writer --model sonet --tool Read
generat rule poem-style
generate rule Poem_Style --from templates/rules/missing.md
```

```powershell
harness validate harness/broken.harness
```

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

`harness run` on this file prints the same table and applies nothing.

## Run a script

`harness run --dry-run` shows what the script would change and writes nothing:

```powershell
harness run harness/poems.harness --dry-run
```

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

Run the script without `--dry-run` to write the files. The run prints the same CREATE lines and table as the dry run, without the NOTE line.

Running the same script again changes nothing. The run prints `Nothing to be done.` and marks each step as `nothing to be done`:

```powershell
harness run harness/poems.harness
```

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

Each step writes its file into the repo's `.claude` folder. The run writes `.claude/agents/poem-writer.md` like this:

```markdown
---
name: poem-writer
description: Writes a short poem on a given theme into poems/
model: sonnet
tools: Read, Write, Edit
---
```

A step that fails stops the run. The steps after it show `not run`.

## Edit .harness files in VS Code

The extension registers files with the `.harness` extension as the Harness script language. In an open script:

- The theme colors comments, verbs, kinds, flags, `plugin@marketplace` names and quoted text.
- Completions appear after a space, `-`, `,` or `=`. They offer the same candidates as Tab in the terminal. See [Type-ahead](type-ahead.md).
- Hovering over a command or an option shows its usage and a line of help. Hovering over `repo` shows what it does.
- Problems appear as errors with the source Claude Harness. The editor checks the script on open, on save and 250 ms after an edit, with the same messages as the `validate` table.
