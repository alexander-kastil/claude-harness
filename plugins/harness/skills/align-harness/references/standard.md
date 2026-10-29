# The harness standard

What a repo's harness holds, where each kind of instruction lives, and what never belongs in a repo. The numbers and lists the check, the fix and the `harness-guard` hook share live in `standard.json` next to this file.

## Where each instruction lives

| Instruction | Home |
| --- | --- |
| House rules for every repo | `~/.claude/CLAUDE.md`, never restated in a repo |
| Orchestration: delegation, routing, briefs, fact gathering, the ledger, status reports, session close | the installed plugins `harness` and `agent-control-plugin`, never restated in a repo |
| Conventions of a stack (.NET, Angular, Hugo, WPF, ...) | global skills in `~/.claude/skills/` and plugin skills |
| Repo map and the rules only this repo has | root `CLAUDE.md`, a router of at most 120 lines |
| Facts an agent needs for one area: commands, ports, paths, architecture, conventions, the owner agent | `.claude/rules/<area>.md` with `paths:` frontmatter |
| Deploy and docs facts that span areas | `.claude/rules/<topic>.md` without `paths:` |
| Procedures only this repo has (brand, data, test conventions) | `.claude/skills/<repo-skill>/` |
| Plan and corrections | `tasks/todo.md`, `tasks/lessons.md` |
| Hooks only this repo has | `.claude/hooks/`, wired in `.claude/settings.json` |

## Root CLAUDE.md

- A section is a `## ` line outside a code fence; its name is the text up to the first `(`, trimmed.
- Product repo, sections in this order: `Project`, `Where the detail lives`, `Harness`, `Hard Rules`, `Working Method` (`templates/CLAUDE.product.md`).
- Class repo (`demos/` and `labs/` at the root): `Layout`, `Hard Rules`, `Working Method` in this order and `Harness` anywhere; `Brand Voice` and `Where the detail lives` may sit between them. A new class repo from `create-class`'s `init-class-repo` keeps the portable sections in `AGENTS.md` (`Layout`, `Brand Voice`, `Hard Rules`, read by every agent harness) and the Claude-only `Harness` and `Working Method` in `CLAUDE.md` after its `@AGENTS.md` line; both checks read the import expanded.
- `Harness` is the one sentence of `templates/harness-block.md`, verbatim. `Working Method` holds the bullets of `templates/working-method.md` verbatim and in this order; a repo-only working rule is one more bullet.
- `Project` is one to three sentences plus the folder tree; every folder under `src/` is named and every `src/<name>` named exists. `Where the detail lives` is a table of topic and location, with the `tasks/` row.
- `Hard Rules` holds only rules this repo adds, one line each: ports and servers the owner runs, where schema scripts live, which browser tool, which paths are generated, product invariants. A rule that only restates a house rule or an orchestration rule goes (list below); a rule that adds a repo detail to one keeps the detail.
- No inventory: no agent or tool table, no MCP server list, no dev commands; commands go to the rules file of their area.
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

- `templates/rules-area.md`: `paths:` globs of the area, a title, then `- Owner agent: \`<agent>\`.` naming a global agent from `~/.claude/agents/`, a repo agent from `.claude/agents/`, or a plugin agent written `<plugin>:<agent>` (`dotnet-conventions:dotnet-expert`); the extension accepts both forms.
- One fact per bullet, moved verbatim in substance from the old `CLAUDE.md` or a retired copy.

## .claude/settings.json

`scripts/fix-settings.py` applies this section; the check reports what is left.

- No `enabledPlugins` entry set to `true` for a plugin the global `~/.claude/settings.json` already enables, and no `extraKnownMarketplaces` entry for a marketplace the global settings already carry. A plugin enabled only in this repo stays, and so does an entry set to `false`: it is the repo's opt-out.
- `harness@claude-harness` is the plugin's id; an older `harness-plugin@claude-harness`, `harness-plugin@integrations-marketplace` or `harness-plugin@claude-mods` entry is repointed to it. Any other entry of a renamed marketplace (`marketplaceRenames`: `@claude-mods` becomes `@integrations-marketplace`) takes the new name.
- No hook entry for a script a plugin replaced. Remove an emptied `hooks` key; leave every other key as it is. A file left as `{}` is deleted.

## Hooks the plugins replaced

Delete the script and its settings entry, and `.claude/hooks/` when nothing else is in it:

| Script | Replaced by |
| --- | --- |
| `claude-md-guard.sh`, `skill-leaf-guard.sh`, `kill-switch.sh`, `steer.sh`, `verification-gate.sh` | `harness` (`HARNESS_VERIFICATION_GATE=1` turns the verification gate on) |
| `delegation-reminder.sh`, `skill-reference-guard.sh` | `agent-control-plugin` |

Every other hook is repo-only and stays.

## Skill and agent copies

- Product repo: a copy of a global or plugin skill or agent is retired with `claude-learn`'s `skill-sync` Retire; its repo facts move to `.claude/rules/` first. Repo-only skills and agents stay.
- Class repo: keep the copies it has, add none.

## Skill leaves

- A `references/<leaf>.md` of a skill holds at most 275 lines and 12 `##` sections.
- A playbook, marked `<!-- playbook -->` or with more than half its `##` sections numbered steps, holds at most 400 lines and its sections are not counted.

## Never touched

- Nested `CLAUDE.md` under `demos/`, `labs/`, starters and solutions (teaching material) and under `src/<app>/.claude/`.
- `AGENTS.md` and `.github/` (other harnesses).
- `.claude/worktrees/`, `~/.claude/CLAUDE.md`, credentials files (`.env`, `credentials.*`, `deploy.json`).
