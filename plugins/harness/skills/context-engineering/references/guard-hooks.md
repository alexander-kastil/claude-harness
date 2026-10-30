# Guard hooks: when a rule stops being prose

A repeated failure written as another paragraph is a rule the model skims. Written as a `PreToolUse`
hook it is a rule the model cannot skip. This leaf covers when to make that move, what the hook may
decide, and the testing step that is not optional.

## When a lesson earns a hook

Three conditions, all of them:

1. **It happened at least twice.** One incident is a lesson entry. Two is a pattern, and the second
   one proves the prose did not hold.
2. **The check is deterministic.** It reads the tool input and answers yes or no without inferring
   intent. "Never commit unless asked in this message" is not decidable by a hook; "this command
   stages or commits" is, and the hook can ask the human instead of guessing.
3. **The cost of the failure is higher than the cost of a false positive.** A hook that fires wrongly
   blocks real work, so the bar is destructive or silent failures: another session's index, a write
   that lands nowhere, a stylesheet nothing validates.

What stays prose: taste, ordering, tone, anything whose violation is a judgement call.

## deny, ask, and the difference

- **deny** is for actions that are never correct in this repo. The reason string is the whole
  teaching surface: name what was wrong, and name the correct move, because the model reads it
  instead of the rule it never loaded.
- **ask** is for actions that are correct only when a human just asked for them. A hook cannot see
  the conversation, but the human can answer. Staging, committing, pushing and history rewriting are
  the canonical set.

Order matters: a broad `ask` rule placed before a narrow `deny` rule swallows it, and the narrower
prohibition never fires. Put every `deny` ahead of the `ask` it overlaps.

Fail open on every ambiguity: no `jq`, unparsable payload, empty command. A guard that traps the
session on its own bug costs more than the failure it prevents.

## The corpus test, before wiring

A matcher is code. Build a corpus from the session's own command history, run every line through the
hook, and read the decision column. `scripts/hook-cases.sh` in this skill does exactly that, and
takes an optional `allow|`, `deny|` or `ask|` prefix per line so the corpus doubles as a regression
test (non-zero exit on any mismatch):

```bash
bash <this skill>/scripts/hook-cases.sh \
  .claude/hooks/<guard>.sh .claude/hooks/<guard>.cases
```

By hand, the same thing is:

```bash
while IFS= read -r line; do
  [ -n "$line" ] || continue
  d=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(printf '%s' "$line" | jq -Rs .)" \
      | bash .claude/hooks/<guard>.sh | jq -r '.hookSpecificOutput.permissionDecision // empty')
  printf '%-6s %s\n' "${d:-allow}" "$line"
done < cases.txt
```

- **Write the corpus to a file, never into the command line.** A test command containing
  `git checkout --` or `--no-verify` trips the very rule it is testing, and the hook blocks the call
  that would have fixed it. This costs a round trip every time it is rediscovered.
- **Seed it with commands you consider normal**, not just the ones you expect to be denied. Every
  deny on a normal command is a defect found for free.
- Re-run the whole corpus after each matcher change: fixing one over-fire routinely opens another.

## Shell redirect matching, specifically

Detecting "this command writes to a relative path" is where guards over-fire, because `>` appears in
far more than redirects. Three false positives, each seen live:

| Text | Why it matched | Guard |
| --- | --- | --- |
| `grep -oE '>>?[[:space:]]*...'` | a `>` inside a quoted regex | require the target to be path-shaped: `^[A-Za-z0-9_.~-]+(/[A-Za-z0-9_.~-]+)*$` |
| `s.replace('a => this.factory', 'b')` | the `>` of `=>` | require the char before `>` to not be `=`, `-`, `<` or `!` |
| `grep ... > /dev/null && echo done` | a real redirect to the null device | exclude `/dev/null` explicitly |

Also strip a leading quote from the captured target, or `> "$DIR/out.css"` reads as relative when it
is not.

## Where the hook does not belong

- **Not as a trust boundary.** An agent with `Write` access can edit the hook or the file it reads.
  Hooks encode the rules an honest actor forgets, not the rules a dishonest one would break.
- **Not for what a linter or a test already catches.** Prefer the check that runs in CI and fails the
  build for everyone, and reach for a hook when nothing in the toolchain parses the artifact at all
  (a stylesheet in a static-site build, a config nothing validates).
- **Not per repo when the rule is universal.** A rule about your own habits belongs in the global
  settings; a rule about this repo's estate belongs in the repo, where teammates get it via git.

## Companion: the PostToolUse integrity check

The same "broken twice" logic covers artifacts nothing in the stack parses. A `PostToolUse` matcher
on `Edit|Write` that asserts a structural invariant (brace balance in CSS, comment balance, JSON
parses) and exits 2 with the fix instructions catches a class of silent corruption that a green build
will happily hide. Keep the assertion cheap and total: it runs on every write to that file type.
