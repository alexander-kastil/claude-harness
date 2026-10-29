---
name: scaffold-repo-harness
description: >-
  Write the harness base of a new product repo, stack-neutral, in one run: router CLAUDE.md, one
  path-scoped .claude/rules file per area with its owner agent, tasks/ and .gitignore; creates only
  what is missing. A class repo uses create-class init-class-repo, an existing harness align-harness.
  Triggers on "scaffold repo harness", "init product repo", "new product repo", "harness for a new
  repo", "default harness setup", "default CLAUDE.md for a new repo", "bootstrap the harness",
  "/init", "create a CLAUDE.md for this repo".
---

# scaffold-repo-harness

The templates are `align-harness`'s ([../align-harness/templates/](../align-harness/templates/)), so a
new repo and a realigned one carry the same text. Edit the standard there, never here. Stack scaffolds
(`new-fullstack-project`) layer on top of it.

The built-in `/init` writes its own CLAUDE.md layout, which `harness-guard` rejects. In a repo with no
CLAUDE.md, run this skill instead, so the first write already passes the check.

## 1. Read the repo, ask once for the rest

Derive from the repo first:

1. The summary: what the product is and its stack, in one to three sentences, from the README and
   the project files (`*.csproj`, `package.json`, `hugo.toml`, ...).
2. The areas: one per project folder, with its globs and an owner agent from `~/.claude/agents/`,
   `.claude/agents/` or a plugin, written `<plugin>:<agent>`
   (`api=src/api/**:dotnet-conventions:dotnet-expert`, `ui=src/ui/**:angular-conventions:angular-expert`,
   `site=src/site/**:hugo-expert`, `desktop=src/app/**:wpf-expert`).
3. The build, run and test commands of each area, as `--fact` lines for its rules file.

Then one message asks only for what the repo does not answer, with a default for each, usually the
rules only this repo has: ports the owner runs, where schema scripts live, which paths are generated.
House rules from `~/.claude/CLAUDE.md` are never listed. When nothing is missing, there is no question.

## 2. Dry run, then apply

```bash
python <this skill>/scripts/init-product-repo.py --root <repo> --summary "<sentences>" \
  --area api=src/api/**:dotnet-conventions:dotnet-expert --area ui=src/ui/**:angular-conventions:angular-expert \
  --rule "<rule>" --fact "api=<one fact for the api rules file>"
python <this skill>/scripts/init-product-repo.py ... --apply
```

`--area` splits at the first `:` after `=`, so an owner may carry its plugin. It prints `create` or
`skip` per file and ends in `created= skipped=`.

## 3. Prove it

```bash
python <align-harness>/scripts/check-constitution.py <repo>
```

A pass is `fail=0`. Fill each rules file with the area's commands, ports and conventions as the
code lands; the router `CLAUDE.md` stays at its sections.
