---
name: align-harness
description: >-
  Realign an existing repo's Claude harness (root CLAUDE.md, .claude/rules, .claude/settings.json,
  .claude/hooks, skill and agent copies) to the harness standard: check with a script, fix, re-check.
  A new repo uses scaffold-repo-harness instead. Triggers on "align harness", "align the harness",
  "fix constitution", "fix the constitution", "realign CLAUDE.md", "CLAUDE.md is pure prose", "the
  harness guard blocked CLAUDE.md", "optimize the repo harness", "remove harness duplication", "bring
  the repo to the harness standard".
---

# align-harness

One repo per run. The standard is [references/standard.md](references/standard.md); read it first. New
repos start from `scaffold-repo-harness` (product) or `create-class` `init-class-repo` (class) instead.

## 1. Check

```bash
python <this skill>/scripts/check-constitution.py <repo root>
```

It prints `FAIL`, `REVIEW` and `INFO` lines and ends in `repo= kind= fail= review=`. `kind=class`
when `demos/` and `labs/` sit at the root, otherwise `product`. Keep the output: it is the work list.

## 2. Inventory before any edit

Read the root `CLAUDE.md`, every `.claude/rules/*.md`, `.claude/settings.json`,
`.claude/settings.local.json`, the file names in `.claude/hooks/`, `.claude/skills/`,
`.claude/agents/` and `.claude/commands/`. List every fact the old `CLAUDE.md` carries and the home
the standard gives it. Nothing is deleted before its facts have a home.

## 3. Move the detail out

- Commands, ports, architecture, conventions and paths of one area go to `.claude/rules/<area>.md`
  ([templates/rules-area.md](templates/rules-area.md)): `paths:` globs, a title, the owner agent, one
  fact per bullet. Extend an existing rules file of that area instead of adding a second one.
- Deploy and docs facts that span areas go to a rules file without `paths:`.
- A coding-standards block that a global skill already carries (`angular-conventions`,
  `dotnet-conventions`, ...) goes; only the repo's deviations move to the area's rules file.
- A routing table (which agent owns what) becomes the `Owner agent` line of each area's rules file.

## 4. Rewrite the root CLAUDE.md

- Product: [templates/CLAUDE.product.md](templates/CLAUDE.product.md). `{{summary}}` is one to three
  sentences, `{{tree}}` the top folders with one phrase each, `{{detail_rows}}` one row per rules
  file, skill or doc plus the `tasks/` row, `{{hard_rules}}` the repo-only rules as one `- ` line each
  (`- None yet.` when there are none), `{{harness_block}}` is
  [templates/harness-block.md](templates/harness-block.md) and `{{working_method}}` is
  [templates/working-method.md](templates/working-method.md), both verbatim.
- Class: keep the class's `Layout` (and `Brand Voice`) text, fixed to what is on disk, then the
  harness block, `Hard Rules`, the working method.
- `Hard Rules` keeps only rules this repo adds, one line each. Drop every line the standard's
  "never restates" list names; keep the repo detail a line adds to one (where schema scripts live,
  which ports the owner runs).
- At most 120 lines, no em dashes. Every path named exists; repoint or drop the rest.
- After a change to `templates/harness-block.md`, one run writes it into every repo:
  `python <this skill>/scripts/sync-harness-block.py [--roots "D:/git-*/*"] [--dry-run] [--json]`
  replaces the `## Harness` section of each root `CLAUDE.md` that has one, keeps the file's line
  endings, and ends in `repos= replaced= aligned= without=`; a repo without the section is left to
  this skill's full run.

## 5. Settings, hooks, copies

```bash
python <this skill>/scripts/fix-settings.py <repo root>
python <this skill>/scripts/fix-settings.py <repo root> --apply
```

The first run is a dry run: one line per change, ending in `repo= changes= dry-run`. Read it, then
apply. `--keep-plugins` leaves `enabledPlugins` and `extraKnownMarketplaces` as they are, for a repo
shared with people who lack the global settings.

- Product repo: retire copies of global or plugin skills and agents with `claude-learn`'s
  `skill-sync` Retire (`references/skill-sync.md`, section Retire), facts first. Class repo: keep the
  copies, add none.

## 6. Re-check and report

Run the check again: `fail=0`. Each `REVIEW` line is either fixed or kept on purpose (a repo detail
the line adds). Report per repo, one line each: files changed, files deleted, facts moved, and any
`REVIEW` line kept with its reason.

Never touched: nested `CLAUDE.md` in `demos/`, `labs/`, starters, solutions and `src/<app>/.claude/`,
`AGENTS.md`, `.github/`, `.claude/worktrees/`, `~/.claude/CLAUDE.md`, credentials files.
