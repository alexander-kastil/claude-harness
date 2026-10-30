# Benchmark a mod: with and without, headless

A mod that claims to save cost, time or tokens proves it with a paired benchmark: the same task,
run headless with the behaviour on and off, in a fresh checkout per run. One run per side is a
pilot, not a result; report a difference inside the run-to-run spread as no difference.

## Setup

1. **A toggle in the mod.** Read one env var at `session.start` (for example `MYMOD_MODE=off`)
   and keep the old path behind it, so both sides run the same installed code.
2. **One fresh worktree per run**, never a reset of the last one. A sparse worktree keeps it
   cheap: `git worktree add --no-checkout -f <dir> HEAD`, then
   `git -C <dir> sparse-checkout set --no-cone '/folder-a/' '/folder-b/'` and
   `git -C <dir> read-tree -mu HEAD`. From Git Bash export `MSYS_NO_PATHCONV=1` first, or the
   leading-slash patterns are stored as `C:/Program Files/Git/...`. Check `git status --short`
   prints nothing before the run. Link a large `node_modules` in as a junction instead of
   installing it.
3. **Baseline-build the untouched worktree once**, so a failing build after a run is the run's.
4. **Pin the `claude` binary.** On Windows `subprocess.run(["claude", ...])` resolves
   `claude.exe` first, which may be an older WinGet build than the npm one the shell uses. Pin
   the path and print `--version` before the first run. A run that ends in seconds at zero cost
   failed; never log it as data.

## One run

`claude -p "<task>" --model <orchestrator> --output-format json --permission-mode bypassPermissions`
in the worktree, with the toggle in its environment. Identical prompt on both sides.

- **Write stdout to a raw file before parsing it.** `total_cost_usd`, `num_turns` and
  `modelUsage` (per-model cost and tokens) exist only there.
- **Read the transcripts** for what the result omits: `~/.claude/projects/<cwd-slug>/<session>.jsonl`
  and the subagents under `<session>/subagents/`. Sum usage once per `message.id` (streamed rows
  repeat it), per `message.model`, and take wall time from the first and last `timestamp`. On
  Windows open them with the `\\?\` prefix: a worktree under `%TEMP%` pushes subagent paths past
  260 characters. Glob the project folder by session id; an 8.3 short path in the cwd changes the slug.
- **Check the outcome, not the claim**: build each tier, and grep only the files `git status`
  shows changed for the change's token in every layer it must reach.
- Append one JSON line per run to a results file, and keep an analyze-only mode that rebuilds a
  row from a session id, so a crash after the session does not cost a rerun.

## Reading it

- Three or more runs per side; alternate or parallelize the sides so drift hits both.
- Compare cost, wall time, per-model tokens and the mechanism's own counters (brief length,
  injected characters, nodes written), plus quality as a count of runs that passed every check.
- Look at the outliers before averaging: a run that skipped a step (no lookup agent spawned)
  moves the mean more than the mod did.
- Keep the raw rows next to the mod (`bench/results.jsonl`) so a later chart reads them directly.
