---
name: init-product-repo
description: >-
  Write the harness base of a new product repo, stack-neutral, in one run: the router CLAUDE.md with
  the shared Harness section, one path-scoped .claude/rules file per area with its owner agent,
  tasks/todo.md, tasks/lessons.md and a catch-all .gitignore. Creates only what is missing, never
  overwrites; dry run first. Stack scaffolds (new-fullstack-project) layer on top of it; class repos
  use create-class init-class-repo; an existing repo uses fix-constitution. Triggers on "init product
  repo", "new product repo", "harness for a new repo", "default harness setup", "default CLAUDE.md
  for a new repo", "bootstrap the harness", "/init", "create a CLAUDE.md for this repo".
---

# init-product-repo

The templates are `fix-constitution`'s ([../fix-constitution/templates/](../fix-constitution/templates/)),
so a new repo and a realigned one carry the same text. Edit the standard there, never here.

The built-in `/init` writes its own CLAUDE.md layout, which `harness-guard` rejects. In a repo with
no CLAUDE.md, run this skill instead: /init's analysis answers step 1 (the summary, one area per
project with its owner agent, and the build, run and test commands as `--fact` lines), so the first
write already passes the check. Seen 2026-10-26: a default /init file had to be rewritten through
`fix-constitution` in the same turn.

## 1. Ask once

One message, with defaults:

1. What the product is and its stack, in one to three sentences.
2. The areas: name, folder globs, owner agent from `~/.claude/agents/` (`api=src/api/**:dotnet-expert`,
   `ui=src/ui/**:angular-expert`, `site=src/site/**:hugo-expert`, `desktop=src/app/**:wpf-expert`).
3. Rules only this repo has, one line each: ports the owner runs, where schema scripts live, which
   paths are generated. House rules from `~/.claude/CLAUDE.md` are never listed.

## 2. Dry run, then apply

```bash
python <this skill>/scripts/init-product-repo.py --root <repo> --summary "<sentences>" \
  --area api=src/api/**:dotnet-expert --area ui=src/ui/**:angular-expert --rule "<rule>" \
  --fact "api=<one fact for the api rules file>"
python <this skill>/scripts/init-product-repo.py ... --apply
```

It prints `create` or `skip` per file and ends in `created= skipped=`.

## 3. Prove it

```bash
python <fix-constitution>/scripts/check-constitution.py <repo>
```

A pass is `fail=0`. Fill each rules file with the area's commands, ports and conventions as the
code lands; the router `CLAUDE.md` stays at its sections.
