---
name: claude-harness-consolidate
description: >-
  Consolidate a project's skill and agent ecosystem after adopting Claude Code as the harness. Tear
  down a parallel Copilot/.github mirror, migrate naming (copilot-* to claude-*), generalize over-specific
  slugs (drop a domain prefix when a skill is generic), fold single-purpose orphans into master skills to
  cut the top-level count, then chase every dangling reference, orphaned artifact, and stale config entry
  the teardown exposes. Project-agnostic. Triggers on: "consolidate skills", "clean up skill ecosystem",
  "fewer top-level skills", "remove copilot duplicates", "migrate to claude harness", "rename copilot- to
  claude-", "fold skill into master", "reduce skill sprawl", "skill restructure", "remove .github mirror",
  "agent is messy", "agent definition too long", "move code patterns out of the agent", "agent duplicates the
  skill", "add strict delegations to the skill", "caveman compress the agent", "behaviors delegations rules".
---

# claude-harness-consolidate - Skill & Agent Ecosystem Cleanup

A procedure for reorganizing a repository's `.claude/skills/` and `.claude/agents/` once Claude Code is the harness. The mechanics (rename a dir, edit a link) are easy; the value is in the judgment calls and the discipline that keep you from leaving broken links or deleting something load-bearing.

Run this in the [[claude-looped]] conversation style: small visible bursts, report what landed on disk after each, one bounded change per loop. Never commit unless asked.

## When to Use

- The repo carries a second harness's config (a `.github/skills/`, `.github/agents/`, `copilot-instructions.md`, `prompts/`, `instructions/` mirror) that is now dead weight.
- Skills are duplicated across naming conventions (`copilot-*` vs `claude-*`, or two skills with near-identical descriptions).
- There are too many top-level skills; single-purpose orphans should live as references under a master.
- A skill is named for one domain (`hugo-*`) but is actually useful repo-wide.

## When NOT to Use

- A single skill edit or one rename. Just do it directly.
- The repo genuinely runs two harnesses on purpose. Confirm before tearing one down.

## Procedure

### Phase 1 - Survey before touching anything

1. `Glob` every skill and agent: `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, and any `.github/skills|agents` mirror.
2. `Grep` the whole repo for each affected slug to map cross-references (delegate maps, agent skill-lists, router/team-delegation docs, `settings.local.json` skillOverrides, `docs/`).
3. Classify each item: **active master**, **leaf reference**, **orphan** (no `SKILL.md`, or superseded), **duplicate**, or **genuine product skill**. Do not skip this; it is what prevents bad deletes.

### Phase 2 - Confirm blast radius

For any large or destructive deletion, use `AskUserQuestion` with `preview` options that show exactly what gets deleted versus kept. State the irreversible-ish parts plainly. CI workflows (`.github/workflows`), `FUNDING.yml`, issue templates, and similar general-GitHub files are out of scope by default; call that out.

### Phase 3 - Decide the taxonomy

Apply these rules (see also the project memory entry on naming and consolidation):

- **Prefix:** internal skills use `claude-*`, not `copilot-*` or another harness's prefix.
- **Generalize:** drop a domain prefix when the skill is useful beyond that domain (for example `hugo-mcp-reference` becomes `mcp-reference`, because MCP servers serve the whole repo).
- **Keep:** do NOT rename a skill whose name refers to a real external product. `copilot-sdk` documents `@github/copilot-sdk`; renaming it to `claude-sdk` would be wrong.
- **Fold:** a single-purpose orphan skill becomes a `references/<slug>.md` leaf under the relevant master. Strip its YAML frontmatter when moving.
- **Merge:** two masters merge when they cover the same concern. The strongest signal is a duplicate reference file shipped under both (for example two `hugo-setup-iac.md`). Diff the duplicates and keep the richer one.
- **Extract:** a reusable interaction or conversation protocol embedded in one skill/agent becomes its own thin, project-agnostic skill that others delegate to (this is how [[claude-looped]] was born).
- **Goal:** fewer top-level skills. Prefer master + references over many siblings.

### Phase 4 - Execute renames and merges (lockstep)

1. **Filesystem first:** rename directories and reference files, then move folded leaves, then delete confirmed orphans. Use `git mv` when history matters, plain `mv`/`rm` otherwise.
2. **Match `name:` to directory:** update each moved skill's frontmatter `name:` to its new slug.
3. **Bulk token replacement, ordered specific before prefix:** replace `copilot-plan-feature` before `copilot-plan`, and `copilot-learn-analyze` before `copilot-learn`. Otherwise the prefix pass corrupts the longer tokens.
4. **Exclude edge cases from any blanket replace** (handle them by hand): historical lineage / "Supersedes" notes, product references, and prose that merely contains the word (for example "VS Code Copilot").

### Phase 5 - Fix every reference

Update delegate maps, agent skill-lists, the top-level router, the team-delegation doc, and `docs/`. Distinguish a **doc filename** (`basics-hugo-configuration.md`) from a **skill name** (`hugo-config`); they look alike and a blanket replace will hit both. Remove dead "full skill instructions" links left by folded leaves.

### Phase 6 - Cascade the orphan cleanup

Deleting a subsystem exposes downstream orphans. Sweep for them:

- Spec folders and docs that describe the deleted thing.
- A skill documented as "superseded by X" is safe to delete (functionality lives in X). The supersedes table is your proof of no functionality loss.
- Stale `skillOverrides` entries in `.claude/settings.local.json` (see Gotchas).
- References to files that never existed (pre-existing broken links you now own).

### Phase 7 - Verify

`Grep` the whole repo again for every affected slug. The only acceptable survivors are intentional historical lineage notes and illustrative example strings. Spot-check that each master's `references/<file>.md` link resolves. Confirm nothing is committed.

## Agent Shape: behaviors, delegations, rules

An agent definition is a router with a job description, not a manual. Three sections and nothing else:

- **Behaviors** - the ordered procedure the agent runs: which MCP call opens the work, what it reads before writing, how it verifies.
- **Delegation (strict)** - a table mapping task to the exact skill reference leaf that owns the pattern, plus the precedence rules: no pattern from memory, leaf read precedes the first line of code, leaf beats the agent's defaults, repo `CLAUDE.md`/`docs/` beats the leaf, no leaf means the documentation MCP rather than improvisation.
- **Rules** - working-tree safety (never commit/push, never `git checkout --`/`restore`/`stash`/`reset`), comment policy, background processes killed, side effects reported, plus the structured-response schema the orchestrator expects.

Code patterns, sample components, style lists and API snippets belong in `.claude/skills/<domain>/references/<leaf>.md`. **Before moving a pattern out of an agent, grep the leaves for it: it is usually already there, so the operation is a delete, not a move.**

The reason is drift, not tidiness. A pattern duplicated in an agent and a skill diverges, and the agent copy wins because it sits in context while the leaf is only a link. One agent mandated Reactive Forms while its skill mandated Signal Forms; deleting the agent's copy resolved the contradiction that no build would have caught.

Compress what remains caveman-style: short imperatives, no articles, no hedging. Rules survive verbatim; only the prose around them is cut. Frontmatter (`name`, `description`, `model`, `tools`, `mcpServers`, `disallowedTools`) is never compressed: the description is the routing surface.

## Gotchas

- **settings.local.json is self-modification.** Editing `.claude/settings.local.json` (including pruning stale `skillOverrides`) is often blocked by the auto-mode classifier as startup-config self-modification, even mid-task. Do not fight it. Surface the exact stale lines and let the user delete or approve them. Authorization is per-line: approval to remove one entry does not extend to others.
- **Product names are not duplicates.** Re-read a skill's body before assuming its prefix is a naming artifact.
- **Keep lineage notes.** "This skill replaces X" lines are accurate history; leave them even after X is gone.
- **A `references/` folder with no `SKILL.md`** is a dead skill folder, not a skill. Safe to remove.
- **Generated blocks in agents and `CLAUDE.md` go stale silently.** A `<!-- SKILLS:BEGIN -->` roster reads as authoritative precisely because it is generated, so nobody rereads it. Diff every such list against `ls` of the directory it describes, in the same edit.

## Quick Checklist

- [ ] Surveyed all skills/agents/mirrors and grepped cross-references
- [ ] Confirmed deletion blast radius with the user (preview options)
- [ ] Applied naming rules (claude-* / generalize / keep product / fold / merge)
- [ ] Renamed filesystem first, then frontmatter, then content (specific-before-prefix)
- [ ] Fixed delegate maps, agent lists, routers, docs; removed dead links
- [ ] Cascaded orphan cleanup (specs, superseded skills, settings, docs)
- [ ] Re-grepped: only lineage notes and examples remain
- [ ] Flagged settings.local.json edits for the user; did not commit
