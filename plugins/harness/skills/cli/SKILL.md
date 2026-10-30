---
name: cli
description: >-
  Run the Claude Harness extension's command line from chat (extension 0.9.0 or later): Claude
  collects the parameters, the script reads or changes the harness and returns JSON. Triggers on
  "harness cli", "harness inventory", "what does this repo's harness hold", "which skills exist twice",
  "copies that drifted", "consolidate", "retire this copy", "plugin hunter", "bundle these skills into
  a plugin", "make a plugin from", "hunt create", "list the agents", "which agent would take this",
  "what did this chat cost", "how did this session delegate", "check this film", "media doctor",
  "marketplace health", "rename the marketplace", "check the harness of my repos", "fix settings and
  hooks", "fleet overview", "sync from global", "update the plugin", "list the sessions", "rename this
  session", "which mods fired", "what did the guards deny", "time ledger", "hours this week", "lessons
  about", "skill sources", "skill updates", "generate an agent", "generate a rule", "generate a skill",
  "generate a slash command", "add a hook", "add an MCP server", "add a plugin", "new repo harness",
  "update plugins and copies", "validate the harness", "harness script", "run a .harness file",
  "shell completion".
---

# cli

The extension's own code, run headless. Everything goes through one script, which finds the installed
extension (the version VS Code has registered, 0.9.0 or later) and passes the arguments on:

```bash
node <this skill>/scripts/harness.mjs <command> [options] --json
```

Read the JSON, never the text form, and report from it. `--help` prints the full usage.

## Judgement or script

| Step | Who |
| --- | --- |
| Which skills and agents belong together in a plugin, its name, category and one-line description; a name inside the plugin does not repeat the plugin's words (`vscode-extension:specialist`, not `vscode-extension:vscode-ext-specialist`) | Claude, from `hunt catalog` and the user's words |
| Everything that reads or writes the harness | the script |

Writing commands run for real by default. Add `--dry-run` only when the user asks to see the actions
first: it prints each action as `[dry-run] ...` and writes nothing.

## Which leaf

| You arrive with | Read |
| --- | --- |
| A question about the harness, its copies, agents, cost, delegation, a film or images folder, the repo checks, the fleet, sessions, mods, time, lessons or skill sources; shell completion | [references/read-views.md](references/read-views.md) |
| A plugin to build from skills and agents, a marketplace to check or rename, an installed plugin to update | [references/plugins-and-marketplaces.md](references/plugins-and-marketplaces.md) |
| A copy to retire, a skill or leaf to move, split, put, remove or repoint, copies to sync from Global, a sourced skill to update, settings and hooks to fix, a session to rename | [references/skills-and-copies.md](references/skills-and-copies.md) |
| An agent, rule, skill, slash command, hook or MCP server to make sure of, a plugin to add, a new repo's harness, plugins and copies to update, a `.harness` script to validate or run, a repo's harness to validate | [references/build-the-harness.md](references/build-the-harness.md) |

## Options and exit codes

Options for every command: `--root <dir>` (default `~/.claude`), `--repo <dir>` (repeatable),
`--repos a,b` (more repos, like the extension's repoFolders setting), `--json`.
Exit codes: 0 done, 1 error (for `hunt`, also a non-empty `problems`; for `validate`, a harness
problem), 2 unknown flag or bad arguments (for `validate` and `run`, also a script error).

In Claude Code the views that only read are also `@harness:<view>` mentions (inventory, consolidate, agents, usage, delegation, hunt, marketplaces, check, fleet, sync, sessions, mods, time, lessons, sources): on send the plugin runs each one and Claude reads its output as context, so a prompt that carries one already holds that output.

## After a create

The new plugin's skills and agents load in the next session. Report the plugin path, what was retired,
what was kept and the backup folder; restarting is the user's step.
