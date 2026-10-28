---
name: fix-constitution
description: >-
  Realign an existing repo's Claude harness, its constitution (root CLAUDE.md, .claude/rules,
  .claude/settings.json, .claude/hooks, skill and agent copies), to the harness
  standard: a short router CLAUDE.md, area facts in path-scoped rules files, no restated house rules,
  no orchestration rules the mods already enforce, no per-repo plugin lists, no hook copies a mod
  replaced. Checks with a script, fixes, re-checks. Triggers on "fix constitution", "fix the
  constitution", "align the harness", "realign CLAUDE.md", "CLAUDE.md is pure prose", "the harness
  guard blocked CLAUDE.md", "optimize the repo harness", "remove harness duplication", "bring the
  repo to the harness standard".
---

# fix-constitution

One repo per run. The standard is [references/standard.md](references/standard.md); read it first. New
repos start from `init-product-repo` (product) or `create-class` `init-class-repo` (class) instead.

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
  file, skill or doc, `{{harness_block}}` is [templates/harness-block.md](templates/harness-block.md)
  and `{{working_method}}` is [templates/working-method.md](templates/working-method.md), both verbatim.
- Class: keep the class's `Layout` (and `Brand Voice`) text, fixed to what is on disk, then the
  harness block, `Hard Rules`, the working method.
- `Hard Rules` keeps only rules this repo adds, one line each. Drop every line the standard's
  "never restates" list names; keep the repo detail a line adds to one (where schema scripts live,
  which ports the owner runs).
- At most 120 lines, no em dashes. Every path named exists; repoint or drop the rest.

## 5. Settings, hooks, copies

- `.claude/settings.json`: drop `enabledPlugins` entries the global settings enable and the
  marketplace's `extraKnownMarketplaces` entry; rename a remaining `@claude-mods` suffix to
  `@integrations-marketplace`, except `harness-plugin`, which lives in the claude-harness
  marketplace: repoint `harness-plugin@integrations-marketplace` or `@claude-mods` to
  `harness-plugin@claude-harness`; drop hook entries for replaced scripts and an emptied `hooks` key.
  Keep every other key. A file left as `{}` is deleted.
- Delete the replaced hook scripts the standard lists.
- Product repo: retire copies of global or plugin skills and agents with `claude-learn`'s
  `skill-sync` Retire (`references/skill-sync.md`, section Retire), facts first. Class repo: keep the
  copies, add none.

## 6. Re-check and report

Run the check again: `fail=0`. Each `REVIEW` line is either fixed or kept on purpose (a repo detail
the line adds). Report per repo, one line each: files changed, files deleted, facts moved, and any
`REVIEW` line kept with its reason.

Never touched: nested `CLAUDE.md` in `demos/`, `labs/`, starters, solutions and `src/<app>/.claude/`,
`AGENTS.md`, `.github/`, `.claude/worktrees/`, `~/.claude/CLAUDE.md`, credentials files.
