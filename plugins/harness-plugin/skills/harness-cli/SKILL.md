---
name: harness-cli
description: >-
  Use the Claude Harness extension's features from chat through its command line (preview, extension
  0.8.0 or later): the harness inventory of Global or a repo, every skill or agent that exists in more
  than one place and whether the copies differ, retiring a copy with a backup, Plugin Hunter (the
  catalog of skills and agents, a plan, and creating, installing and retiring in one run), the agents
  of Global, the plugins and the repos with their gated ones, which specialist the delegation plugin
  would route a prompt to, what one session cost by model and agent and its share of the week, how a
  session delegated, and the checks of a film or images folder. Deterministic: Claude collects the
  parameters, the script does the work and returns one JSON result. Triggers on "harness inventory",
  "what does this repo's harness hold", "which skills exist twice", "copies that drifted",
  "consolidate", "retire this copy", "plugin hunter", "bundle these skills into a plugin", "make a
  plugin from", "hunt create", "harness cli", "list the agents", "which agent would take this", "what
  did this chat cost", "how did this session delegate", "check this film", "media doctor".
---

# harness-cli

The extension's own code, run headless. Everything goes through one script, which finds the installed
extension (the version VS Code has registered) and passes the arguments on:

```bash
node <this skill>/scripts/harness.mjs <command> [options] --json
```

Read the JSON, never the text form, and report from it. `--help` prints the full usage.

## Judgement or script

| Step | Who |
| --- | --- |
| Which skills and agents belong together in a plugin, its name, category and one-line description | Claude, from `hunt catalog` and the user's words |
| Everything that reads or writes the harness | the script |

Writing commands run for real by default. Add `--dry-run` only when the user asks to see the actions
first: it prints each action as `[dry-run] ...` and writes nothing.

## Commands

| Command | Returns (`--json`) |
| --- | --- |
| `inventory [--repo <dir>]` | `{scope, categories: [{kind, label, count, items: [{kind, name, description, file, copies?}]}], repos, applied}` for Global, or for one repo |
| `consolidate [--name <n>]` | `{elements: [{kind, name, allIdentical, copies: [{scope, label, file, state}]}], applied}`; `state` is `reference`, `identical`, `nearly identical` or `differs` |
| `consolidate retire --name <n> --kind skill\|agent --from <global\|repo dir>` | `{kind, name, from, path, backup, identicalTo, applied}`; a Global copy is retired only when an identical plugin copy exists |
| `hunt catalog` | `{catalog, markets, applied}`: the skills and agents across Global and repos, and the marketplaces (owned ones can take a plugin) |
| `hunt plan ...` | the same as `hunt create --dry-run` |
| `hunt create --name <p> --category <c> --skills a,b --agents x,y [--market <m>] [--description <t>] [--retire]` | `{name, market, problems, files, retired, kept, source, dir, installed, backup, applied}` |
| `agents list` | `{agents: [{name, scope, file, model, tools, gated, summary, copies: [{scope, state}]}], counts: {global, plugins, repos, gated, drifted}, applied}`; `state` is `identical`, `nearly identical` or `differs` |
| `agents route "<prompt>" [--repo <dir>]` | `{prompt, stacks, owners: [{name, score, terms, scope}], dropped: [{name, reason}], fallback, applied}`; `reason` is `gated` or `fact-gatherer`; exit 1, naming the missing script, when the delegation plugin is not installed |
| `usage --session latest\|previous\|<id> [--repo <dir>] [--week] [--week-used <pct>]` | `{session, models: [{model, tokens, usd, share}], agents: [{type, launches, usd}], usd, week?: {since, until, usd, share, week_pct?}, applied}`; `week` only with `--week` |
| `delegation --session latest\|previous\|<id> [--repo <dir>]` | `{session, agents: [{id, type, name, model, status, minutes, turns, tools, usd}], decisions: {byHook, byTone}, slips: {open, closed, byKind}, findings: [string], applied}` |
| `media doctor <dir>` | `{dir, kind: "film"\|"images", problems: [{check, path, line?, detail}], outputs: [{file, version, seconds, size, fps, changelog}], applied}`; exit 1 when `problems` is not empty, 2 for a folder outside `assets/films` or `assets/images` |
| `skills move --leaf <skill>/<path> --to <skill>[/<path>] [--market <dir>]` | `{op, changes: [{action, file, detail}], backup, applied}`; moves a file or folder of a skill into another skill, repoints every mention of its path in the skills, agents and market plugins, backs every changed file up first; an identical file at the destination only drops the source, a different one stops with exit 1; `check` rows name text that still mentions the old place |
| `skills split --from <skill> --name <new> --leaves a,b [--description <t>] [--market <dir>]` | the same shape: creates the new skill (a SKILL.md with one row per leaf) and moves the leaves into it |
| `skills put --file <file> --to <skill>/<path>\|agents/<name>.md` | the same shape: puts new or rewritten text in place, an existing file backed up first |
| `skills remove --name <skill>\|--leaf <skill>/<path> [--market <dir>]` | the same shape: deletes a skill or one leaf, backed up first, and lists what still mentions it |
| `skills repoint --from <skill> --to <skill> [--skills a,b] [--agents x,y] [--market <dir>]` | the same shape: rewrites the mentions of one skill name to another; exit 1 when nothing mentions it |
| `hunt create ... --files <file>=<path in plugin>,... [--drop-files]` | with `hunt create`: also copies a hooks.json, a hook script or an `.mcp.json` into the plugin (a plugin may be made of these alone); `--drop-files` retires the ones under `--root`, backed up first; `--market` takes the marketplace name or its folder |
| `complete --line "<command line>" [--position <n>] --json` | A JSON array of `{text, kind, description}` (no `applied`); `kind` is `command`, `flag` or `value` |
In Claude Code the views that only read are also `@harness:<view>` mentions (inventory, consolidate, agents, usage, delegation, hunt): on send the plugin runs each one and Claude reads its output as context, so a prompt that carries one already holds that output.

`hunt create` writes `plugins/<category>/<name>/` with `plugin.json`, the skills and agents, adds the
entry to the marketplace's `marketplace.json`, installs `<name>@<market>` for the user, and with
`--retire` retires every copy of the chosen items (backed up under `~/.claude/repo-sync-backups/<stamp>/`).
A repo whose `CLAUDE.md` keeps its copies stays; `kept` says why. If the install fails, the plugin
folder and its marketplace entry are removed again and nothing is retired.

Options for every command: `--root <dir>` (default `~/.claude`), `--repo <dir>` (repeatable), `--json`.
Exit codes: 0 done, 1 error (for `hunt`, also a non-empty `problems`), 2 unknown flag or bad arguments.

## After a create

The new plugin's skills and agents load in the next session. Report the plugin path, what was retired,
what was kept and the backup folder; restarting is the user's step.
