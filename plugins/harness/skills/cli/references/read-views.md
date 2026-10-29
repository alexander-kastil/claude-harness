# Views that read

These commands change nothing. Run them with `--json` and report from the result.

| Command | Returns (`--json`) |
| --- | --- |
| `inventory [--repo <dir>]` | `{scope, categories: [{kind, label, count, items: [{kind, name, description, file, copies?}]}], repos, applied}` for Global, or for one repo |
| `consolidate [--name <n>]` | `{elements: [{kind, name, allIdentical, copies: [{scope, label, file, state}]}], applied}`; `state` is `reference`, `identical`, `nearly identical` or `differs` |
| `agents list` | `{agents: [{name, scope, file, model, tools, gated, summary, copies: [{scope, state}]}], counts: {global, plugins, repos, gated, drifted}, applied}`; `state` is `identical`, `nearly identical` or `differs` |
| `agents route "<prompt>" [--repo <dir>]` | `{prompt, stacks, owners: [{name, score, terms, scope}], dropped: [{name, reason}], fallback, applied}`; `reason` is `gated` or `fact-gatherer`; exit 1, naming the missing script, when the delegation plugin is not installed |
| `usage --session latest\|previous\|<id> [--repo <dir>] [--week] [--week-used <pct>]` | `{session, models: [{model, tokens, usd, share}], agents: [{type, launches, usd}], usd, week?: {since, until, usd, share, week_pct?}, applied}`; `week` only with `--week` |
| `delegation --session latest\|previous\|<id> [--repo <dir>]` | `{session, agents: [{id, type, name, model, status, minutes, turns, tools, usd}], decisions: {byHook, byTone}, slips: {open, closed, byKind}, findings: [string], applied}` |
| `media doctor <dir>` | `{dir, kind: "film"\|"images", problems: [{check, path, line?, detail}], outputs: [{file, version, seconds, size, fps, changelog}], applied}`; exit 1 when `problems` is not empty, 2 for a folder outside `assets/films` or `assets/images` |
| `check [--repo <dir>]` | `{repos: [{repo, passed, failed, review, fixable, error}], failures: [{repo, check, detail, fixable}], applied}`; the known repos against the harness standard, exit 0 even when checks fail |
| `fleet` | `{standard, rows: [{id, label, path, layout?, lines, emDashes?, check?: {fail, review, kind}, checkState, plugins, hookCopies, copies, error?}], counts: {repos, pass, review, fail, error}, applied}` |
| `sync [--repo <dir>]` | `{copies: [{repo, kind, name, state, files: {replaced, added, deleted}}], applied}`; the repo copies that differ from Global, `state` is `differs` or `nearly identical` |
| `sessions [--repo <dir>] [--limit <n>]` | `{repo, total, sessions: [{id, title, started, minutes, agents, live}], applied}`; in /resume order, 20 by default |
| `mods --session latest\|previous\|<id> [--repo <dir>]` | `{session, mods: [{name, plugin, events, allowed, denied, held, context, failed, other, last}], denials: [{at, mod, decision, hook, reason}], applied}`; `decision` is `denied` or `held` |
| `time [--repo <dir>] [--days <n>]` | `{ledger, window_days, window_hours, total_hours, days: [{date, sessions, hours, work}], applied}`; the last 14 days of `.time/working-time.md` by default, counted back from its newest day; exit 1 without a ledger |
| `lessons [--repo <dir>] [--find <text>]` | `{file, find, total, entries: [{line, title, date}], applied}`; the `## ` entries of `tasks/lessons.md`, `--find` matches title and body; exit 1 without the file |
| `sources` | `{skills: [{name, source, ref, version, installedAt, repos}], applied}`; the skills installed from a source and the repos they are linked into |
| `sources check` | `{checked, newer, skills: [{name, source, state, installed, newerVersion, error}], applied}`; asks each source over the network; exit 1 when no source answers |
| `complete --line "<command line>" [--position <n>] --json` | A JSON array of `{text, kind, description}` (no `applied`); `kind` is `command`, `flag` or `value` |
| `completion powershell\|bash` | no JSON: prints the script a shell profile evaluates to register Tab completion for `harness` |
