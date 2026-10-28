# The harness standard

What a repo's harness holds, where each kind of instruction lives, and what never belongs in a repo.

## Where each instruction lives

| Instruction | Home |
| --- | --- |
| House rules for every repo | `~/.claude/CLAUDE.md`, never restated in a repo |
| Orchestration: delegation, routing, briefs, fact gathering, the ledger, status reports, session close | the integrations-marketplace mods and harness-plugin (claude-harness marketplace), never restated in a repo |
| Conventions of a stack (.NET, Angular, Hugo, WPF, ...) | global skills in `~/.claude/skills/` and plugin skills |
| Repo map and the rules only this repo has | root `CLAUDE.md`, a router of at most 120 lines |
| Facts an agent needs for one area: commands, ports, paths, architecture, conventions, the owner agent | `.claude/rules/<area>.md` with `paths:` frontmatter |
| Deploy and docs facts that span areas | `.claude/rules/<topic>.md` without `paths:` |
| Procedures only this repo has (brand, data, test conventions) | `.claude/skills/<repo-skill>/` |
| Plan and corrections | `tasks/todo.md`, `tasks/lessons.md` |
| Hooks only this repo has | `.claude/hooks/`, wired in `.claude/settings.json` |

## Root CLAUDE.md

- Product repo, `##` sections in this order: `Project`, `Where the detail lives`, `Harness`, `Hard Rules`, `Working Method` (`templates/CLAUDE.product.md`).
- Class repo (`demos/` and `labs/` at the root): `Layout`, `Hard Rules`, `Working Method` in this order and `Harness` anywhere; `Brand Voice` and `Where the detail lives` may sit between them. A new class repo from `create-class`'s `init-class-repo` keeps the portable sections in `AGENTS.md` (`Layout`, `Brand Voice`, `Hard Rules`, read by every agent harness) and the Claude-only `Harness` and `Working Method` in `CLAUDE.md` after its `@AGENTS.md` line; both checks read the import expanded.
- `Harness` is `templates/harness-block.md` verbatim. `Working Method` is `templates/working-method.md` verbatim; a repo-only working rule follows as one more bullet.
- `Project` is one to three sentences plus the folder tree. `Where the detail lives` is a table of topic and location.
- `Hard Rules` holds only rules this repo adds, one line each: ports and servers the owner runs, where schema scripts live, which browser tool, which paths are generated, product invariants. A rule that only restates a house rule or an orchestration rule goes (list below); a rule that adds a repo detail to one keeps the detail.
- At most 120 lines, no em dashes, relative links, every path it names exists.

## House and orchestration rules a repo never restates

Remove the repo line when it says only this:

- Commit or push only on request, never offer; "override the history" means rewrite and force-push.
- No shared package or library; duplication is preferred.
- No documentation unless asked in that message.
- Do not delete files unless asked; "clear" means edit.
- No em dashes in generated text.
- Learnings go to `tasks/lessons.md`; no auto-memory.
- Parallelize independent work.
- Answer with the essentials; no recap.
- Search `~/.claude/skills/` and `.claude/skills/` before acting; the directory wins; never copy a global skill.
- Delegation is the default; use the named agent exactly; read the owning agent's file; continue with SendMessage; gated agents only on request.
- Close the session with `claude-learn`; status updates on long runs.
- Boilerplate sections `Workflow Orchestration`, `Subagent Strategy`, `Self-Improvement Loop`, `Task Management`, `Core Principles`, `Token Efficiency`, `Delegation`, `Agent Delegation`, `Skill Routing`: their working rules collapse into `Working Method`, their repo facts move to `Hard Rules` or `.claude/rules/`.

## .claude/rules/<area>.md

- `templates/rules-area.md`: `paths:` globs of the area, a title, then `- Owner agent: \`<agent>\`.` naming a global agent from `~/.claude/agents/` or a repo agent from `.claude/agents/`.
- One fact per bullet, moved verbatim in substance from the old `CLAUDE.md` or a retired copy.

## .claude/settings.json

- No `enabledPlugins` entry for an integrations-marketplace plugin the global `~/.claude/settings.json` already enables, and no `extraKnownMarketplaces` entry for the marketplace. A plugin enabled only in this repo stays, with the `@integrations-marketplace` suffix. `harness-plugin` is the exception: it comes from the claude-harness marketplace and is written `harness-plugin@claude-harness`; an older `harness-plugin@integrations-marketplace` or `@claude-mods` entry is repointed to it.
- No hook entry for a script a mod replaced. Remove an emptied `hooks` key; leave every other key as it is.

## Hooks the mods replaced

Delete the script and its settings entry:

| Script | Replaced by |
| --- | --- |
| `claude-md-guard.sh`, `skill-leaf-guard.sh`, `kill-switch.sh`, `steer.sh`, `verification-gate.sh` | `harness-plugin` (`HARNESS_VERIFICATION_GATE=1` turns the verification gate on) |
| `delegation-reminder.sh`, `skill-reference-guard.sh` | `subagent-delegation-plugin` |

Every other hook is repo-only and stays.

## Skill and agent copies

- Product repo: a copy of a global or plugin skill or agent is retired with `claude-learn`'s `skill-sync` Retire; its repo facts move to `.claude/rules/` first. Repo-only skills and agents stay.
- Class repo: keep the copies it has, add none.

## Never touched

- Nested `CLAUDE.md` under `demos/`, `labs/`, starters and solutions (teaching material) and under `src/<app>/.claude/`.
- `AGENTS.md` and `.github/` (other harnesses).
- `.claude/worktrees/`, `~/.claude/CLAUDE.md`, credentials files (`.env`, `credentials.*`, `deploy.json`).
