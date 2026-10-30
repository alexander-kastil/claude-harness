---
name: output-styles
description: >-
  Author, activate and debug Claude Code output styles: the Markdown files in
  ~/.claude/output-styles/ or .claude/output-styles/ that modify the system prompt to
  change role, tone or default response format every turn. Owns the keep-coding-instructions
  trap (the false default silently removes Claude Code's built-in software engineering
  instructions), the session-start caching rule, and the split against CLAUDE.md,
  --append-system-prompt, agents and skills. Project-agnostic. Triggers on: "output style",
  "create an output style", "custom output style", "outputStyle setting", "keep-coding-instructions",
  "make replies shorter", "stop bloating my replies", "change how Claude responds", "change the tone",
  "always answer with a diagram", "explanatory style", "learning style", "proactive style",
  "output style not taking effect", "style did not apply", "/output-style missing",
  "output style vs CLAUDE.md".
---

# Output Styles

An output style changes **how** Claude answers. `CLAUDE.md` changes **what** it knows.
The style is the only one of the two that edits the system prompt itself rather than
adding a message after it, which is why it holds for every turn without being repeated.

Reach for one when you keep re-prompting for the same voice or format: replies that
lead with a diagram, replies that never speculate, replies that stop at what changed.
For project conventions and codebase context, use `CLAUDE.md` instead.

## The trap that costs you the most

`keep-coding-instructions` defaults to **`false`**, and that default **removes** Claude
Code's built-in software engineering instructions: how it scopes a change, how it
comments code, how it verifies work.

So a style written only to shorten replies or fix tone will quietly gut engineering
behaviour unless you set the flag. Set `keep-coding-instructions: true` whenever the
work is still coding. Leave it out only when the session is not software engineering
at all, such as a writing or data-analysis assistant.

## Where the file lives

| Scope | Path |
|---|---|
| User (all your projects) | `~/.claude/output-styles/` |
| Project (committed, teammates get it) | `.claude/output-styles/` |
| Managed policy | `.claude/output-styles/` inside the managed settings directory |
| Plugin | an `output-styles/` directory in the plugin |

Project styles load from every `.claude/output-styles/` between the working directory
and the repo root. When two of those define the same name, the one closest to the
working directory wins.

## Frontmatter

| Field | Purpose | Default |
|---|---|---|
| `name` | Name shown in the picker | The file name |
| `description` | One line shown beside the name in `/config` | None |
| `keep-coding-instructions` | Keep the built-in engineering instructions | `false` |
| `force-for-plugin` | Plugin styles only: apply automatically while the plugin is enabled, overriding the user's `outputStyle` | `false` |

```markdown
---
name: Answer Only
description: Reply with what changed and what blocks the user, nothing else
keep-coding-instructions: true
---

Say what changed and where, and anything that blocks the user or is theirs to decide.

Do not include how you verified it, what you ruled out, caveats they did not raise,
or next steps. When holding detail that might matter, offer it in one clause and stop.
```

## Activating it

`/config` then **Output style** picks from a menu and writes the choice into
`.claude/settings.local.json`. To control the scope yourself, set the field directly
in whichever settings file you want it in:

```json
{
  "outputStyle": "Answer Only"
}
```

`/output-style` was deprecated in v2.1.73 and removed in v2.1.91. Any guide still
naming it is stale.

## Why it did not take effect

The style is part of the system prompt, and Claude Code reads that once at session
start. A new style, or an edit to the active one, applies after `/clear` or in the
next session, never mid-conversation. This is the usual reason a style "did nothing".

Styles apply to the main conversation only. A subagent runs its own system prompt and
is unaffected; a fork is the exception, since it inherits the parent's.

## Built-in styles

| Style | Behaviour |
|---|---|
| Default | The standard software engineering prompt |
| Proactive | Executes immediately, makes reasonable assumptions instead of pausing on routine decisions, without changing permission mode |
| Explanatory | Adds educational insights alongside the work |
| Learning | Adds insights and leaves `TODO(human)` markers for you to implement |

Explanatory and Learning produce longer responses by design, which costs output tokens.

## Choosing between the mechanisms

| Mechanism | How it reaches the model | Use it when |
|---|---|---|
| Output style | Modifies the system prompt | You want a different role, tone or default format every turn |
| `CLAUDE.md` | Adds a user message after the system prompt | Claude should always know your project conventions |
| `--append-system-prompt` | Appends to the system prompt for one invocation | A one-off addition to a single run |
| Agent | A subagent with its own prompt, model and tools | A separately scoped helper for a focused task |
| Skill | Task instructions loaded when invoked or relevant | A reusable workflow |

## Writing a style that actually holds

A style is instructions, so the same rules that make a good `CLAUDE.md` rule apply:
name the behaviour positively, and make it checkable. "Be concise" is advisory and
gets paid lip service. A content whitelist is not:

- say what to include (what changed, what blocks the user, the direct answer)
- say what to exclude by name (verification walkthroughs, alternatives rejected,
  unasked-for caveats, next steps, closing recaps)
- say what to do with the rest: offer it in one clause, deliver it only on request

A size cap is the wrong instrument when the real cost is reading, not length: a task
that genuinely changed twelve things needs twelve lines, and a one-line question
needs one.

## Reference

[Output styles](https://code.claude.com/docs/en/output-styles) has the authoritative
field list and the comparison table.
