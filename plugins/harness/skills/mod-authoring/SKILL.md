---
name: mod-authoring
description: >-
  Build, test and ship a Claude Code mod: a JavaScript hooks module inside a plugin that watches the
  session, changes what Claude Code does, or draws UI (the band above the prompt, a pane, a /command).
  Covers getting the generated API types, the hook budget, state refs, holding a tool call for a
  person, tests with the mock clock, plugin naming, dependencies, userConfig, and the integrations-marketplace
  plugins. Use when asked to "build a mod", "make a mod", "write a Claude Code mod", "add a
  pane", "band above the prompt", "hold this command", "plugin hooks module", "claude-mods", "integrations-marketplace", "install all mods", "add the mods marketplace", "rename a plugin", "merge plugins", "move a plugin to its own marketplace", "move the plugin into the product repo",
  "add -plugin to the names", "benchmark a mod", "with and without the mod", "does the mod save tokens",
  "screenshot the pane", "render the pane", "pane screenshot for the article", "publish a plugin to the marketplace",
  "smoke-run a plugin agent", "plugin agent not suggested", "does hover work on Windows",
  "mod UI in Windows Terminal", "needs fullscreen", "detail view in a pane", "can a mod show an image".
---

# mod-authoring: Claude Code mods

A mod is a plugin whose `hooks/hooks.json` lists exactly one module: `{ "modules": ["./x.mjs"] }`.
The module exports `register(on, options)`; every hook is `on(event, matcher?, ($, e, next) => ...)`.
Observe (`await next(e)` then look), rewrite (`next({ ...e, ... })`) or answer (`{ deny }` without `next`).

## Order of work

1. Scaffold the folder by hand: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/<name>.mjs`,
   `types/index.d.ts` (state contract, named as `"types"` in plugin.json), `tests/<name>.test.ts`.
   `claude plugin init` makes a classic command-hook plugin with a TODO skill, not a mod.
2. Get the real API before writing hooks: load the mod once headless,
   `claude -p "reply ok" --plugin-dir <dir> --model haiku`, and read
   `.claude-plugin/types/claude-code/index.d.ts` (15k lines; grep the event and type names).
   `claude plugin validate` and `claude plugin test` do not write the types. Any installed mod
   already holds a copy: `ls -t ~/.claude/plugins/cache/*/*/*/.claude-plugin/types/claude-code/index.d.ts | head -1`
   (its first line names the writing version); the changelog is local at `~/.claude/cache/changelog.md`.
3. Write the hooks, then `claude plugin validate <dir>` (it lists hooks, `$` calls, state reads/writes).
4. Test with `claude plugin test <dir>` (bun, `claude-code/testing`). Stub every event your hook
   passes down with `next(e)`, or the call fails with "no implementation for <event>".
   `node <this skill>/scripts/plugin-check.mjs --dir <plugin> [--skip-test] [--skip-validate]` runs the test and the validate step and ends with `tests= pass= fail= validate=ok|errors= first_error=`.
5. Before shipping anything that classifies commands or text, replay it over the real transcripts in
   `~/.claude/projects/*/*.jsonl` and read a sample of every bucket it fires on.
6. Ship in a marketplace repo (`.claude-plugin/marketplace.json`), install with
   `claude plugin marketplace add <owner>/<repo>` and `claude plugin install <plugin>@<marketplace>`.
   Install all mods at once, user scope, once per machine, or put one new plugin live, prove it loaded and smoke-run its agent: [references/install-mods.md](references/install-mods.md).
   When READMEs are asked for: the root `README.md` is an index (one-line row and link per plugin, the
   dependency diagram, install); each plugin's details and diagrams go in `<plugin>/README.md`.

7. A claimed saving (cost, time, tokens) is measured with a paired headless benchmark, mod
   behaviour on and off, one fresh worktree per run: [references/benchmark-mods.md](references/benchmark-mods.md).

Gotchas with their exact fixes: [references/gotchas.md](references/gotchas.md).
Will this band, pane, hover, click or image work on the main screen, in fullscreen, in Windows Terminal: [references/terminal-ui-support.md](references/terminal-ui-support.md).
Renaming a plugin, merging a mod into its skill plugin, or moving a plugin into its product repo as its own marketplace: [references/rename-merge-plugins.md](references/rename-merge-plugins.md).
Screenshots of a pane or band for an article or deck, rendered from the mod's own SVG builders: [references/render-drawn-surface.md](references/render-drawn-surface.md).

## Hard rules

- A mod is repo-agnostic: no repo names, paths, customer names or repo rules in it. Those stay in
  the repo's `CLAUDE.md` or `permissions.deny`.
- A mod is a safety net, not a permission system: an absolute block belongs in `permissions.deny`,
  which bypass mode still honours.
