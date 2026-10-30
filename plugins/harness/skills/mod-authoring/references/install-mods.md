# Install every mod of a marketplace

Run once per machine, never per repo: `--scope user` writes the marketplace and every plugin into
`~/.claude/settings.json`, so the mods load in every repo and every new session.

```bash
bash <this skill>/scripts/install-mods.sh "D:\git-projects\integrations-marketplace"
```

The script reads `.claude-plugin/marketplace.json`, adds the marketplace (or updates it when already
known) and installs each listed plugin at user scope. Re-running it picks up mods added since.

| Situation | Command |
| --- | --- |
| Another machine with GitHub access to the private repo | `install-mods.sh alexander-kastil/integrations-marketplace` |
| Teammates of one repo should get the mods | Commit `extraKnownMarketplaces` (GitHub source) and `enabledPlugins` to that repo's `.claude/settings.json`; they get an install prompt when they trust the folder |
| The repo's GitHub marketplace and your local directory marketplace share a name | Your user-level directory source wins on your machine, so edits still load without a push; check with `claude plugin marketplace list` |
| A mod declares `userConfig` | `claude plugin configure <plugin>@integrations-marketplace`, or `--config KEY=VALUE` on install |
| Only one repo should get a mod | `claude plugin install <plugin>@integrations-marketplace --scope project` in that repo |
| Mods do not show in the running session | `/reload-plugins`, or start a new session |
| A new plugin in the local directory marketplace should go live on this machine | Its entry in `.claude-plugin/marketplace.json`, `claude plugin marketplace update <marketplace>`, `claude plugin install <plugin>@<marketplace> --scope user`; no push. Prove it loaded: `echo "Reply OK" \| claude -p --model haiku --max-turns 1 --output-format stream-json --verbose`, then read `plugins`, `agents` (named `<plugin>:<agent>`) and `skills` of the `init` record |
| Smoke-run a plugin's agent headless | `echo "<prompt>" \| claude -p --agent <plugin>:<agent> --allowedTools Read Glob Grep Skill`. `--allowedTools` takes every following word, so a prompt placed after it is swallowed ("Input must be provided"): pass the prompt on stdin |
| A plugin ships an agent the delegation mod should suggest | agent-control-plugin (formerly orchestration-plugin and subagent-delegation-plugin, 0.7.6 and later) lists enabled plugins' agents in the roster, but names one per prompt only on a `VOCAB` term in its `hooks/route.mjs`; give a new domain its own term |
