## Harness

Orchestration runs in the integrations-marketplace mods (`D:\git-projects\integrations-marketplace`) and the `harness-plugin` of the claude-harness marketplace, and the house rules in `~/.claude/CLAUDE.md` apply as they stand; this file repeats neither.

- `subagent-delegation-plugin`: routes work to the owning agent (owners in `.claude/rules/`), sends fact gathering to the Haiku fact-gatherer, bounds every brief, keeps the agent ledger.
- `learn-loop-plugin`: runs `claude-learn` once a session goes idle.
- `report-plugin`: starts a status cron when an agent or workflow runs long.
- `intent-guard-plugin`: holds destructive commands nobody asked for.
- `ask-check-plugin`: stops questions the conversation already settled and unrequested findings.
- `write-gate-plugin`: holds a writer's finish until the humanize and marketing-psychology passes ran.
- `harness-plugin`: guards this file's shape, halts a run on `AGENT_STOP`, redirects it with `STEER.md`; `fix-constitution` realigns the repo.
