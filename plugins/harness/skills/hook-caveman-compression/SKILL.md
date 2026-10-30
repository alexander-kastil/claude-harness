---
name: hook-caveman-compression
description: >-
  Install, tune, verify or remove a UserPromptSubmit hook that puts each turn in caveman mode (short
  imperatives, no articles, no hedging, no preamble or closing summary) to cut token cost, and that
  stays silent for prompts asking for finished prose (teaching material, demo and lab guides, READMEs,
  docs, brand-voice copy, release notes) where the wording has to be exactly right. Trigger phrases:
  caveman hook, caveman mode, hook caveman compression, compress my turns, terse mode hook, cut token
  cost per turn, install compression hook, turn caveman off, tune the caveman exclusions.
---

# Caveman Compression Hook

Caveman compression is a rewriting discipline: strip articles, copulas, hedges and politeness scaffolding, keep every rule intact. Applied to a file it cuts roughly 60-75% of the tokens. This skill applies the same discipline per turn, through a `UserPromptSubmit` hook that injects the caveman directive before the model answers, and that suppresses itself when the prompt asks for text whose wording must be exact.

## What the hook does

1. Reads the hook payload on stdin and extracts `.prompt`.
2. Matches the prompt against the exclusion list. On a match it exits 0 with no output, so the turn runs normally.
3. Otherwise it prints the caveman directive on stdout, which Claude Code appends to the turn's context.

It never blocks a prompt and never edits one: `UserPromptSubmit` cannot rewrite the user's text, only add context beside it.

## Install

Copy the script into the harness and register it.

Project scope (`.claude/settings.json`, applies to this repo only):

```bash
cp templates/caveman-compression.sh .claude/hooks/caveman-compression.sh
```

```powershell
Copy-Item templates/caveman-compression.sh .claude/hooks/caveman-compression.sh
```

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/caveman-compression.sh\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

User scope (`~/.claude/settings.json`, applies everywhere): copy the script to `~/.claude/hooks/` and use `bash "$HOME/.claude/hooks/caveman-compression.sh"` as the command. `$CLAUDE_PROJECT_DIR` points at the current project, so it is wrong for a user-scope hook.

On a host without bash, ship `templates/caveman-compression.ps1` instead and use `pwsh -NoProfile -File "$HOME/.claude/hooks/caveman-compression.ps1"`. Both scripts emit the same directive and read the same payload; keep them in sync if you edit one.

An existing `UserPromptSubmit` entry is not replaced: add this hook as another object in the same `hooks` array, and both run.

## The exclusion list is the tuning knob

The `EXCLUDE` regex at the top of the script decides when caveman mode stays off. It ships covering the cases where compressed output is a defect rather than a saving:

- Authored teaching material: `teaching`, `tutorial`, `lab`, `demo`, `slide`, `deck`, `handout`.
- Documentation: `readme`, `docs`, `documentation`, `changelog`, `release notes`.
- Voice-bound copy: `brand voice`, `marketing`, `copywriting`, `blog`, `article`, `newsletter`, `email`, `announcement`.
- Exactness-bound text: `commit message`, `pull request description`, `verbatim`, `prose`.
- Manual escape hatches: `no caveman`, `full prose`.

Matching is case-insensitive and substring-based, and a match fails safe: the turn simply runs uncompressed. Add a term whenever a compressed answer damaged a deliverable; remove one only when it is suppressing turns that produce no prose.

## Verify

```bash
echo '{"prompt":"refactor the user router"}' | bash .claude/hooks/caveman-compression.sh
echo '{"prompt":"write the readme for module 08"}' | bash .claude/hooks/caveman-compression.sh
```

```powershell
'{"prompt":"refactor the user router"}' | pwsh -NoProfile -File .claude/hooks/caveman-compression.ps1
'{"prompt":"write the readme for module 08"}' | pwsh -NoProfile -File .claude/hooks/caveman-compression.ps1
```

The first prints the directive, the second prints nothing. In a live session, `/context` shows the injected block and `/usage` shows whether replies actually got shorter.

## Turn it off

Delete the hook object from `settings.json`, or type `no caveman` in the prompt to skip a single turn.

## Cost note

The directive costs about 90 tokens per turn. It pays for itself when replies shrink by more than that, which holds for coding and analysis turns and not for one-line answers. If most of your turns are short questions, install it at project scope on the repos where the work is long, not at user scope.

## Anti-patterns

- Do not compress meaning. Rules, paths, identifiers, numbers, flags, quotes and code fences stay byte-exact; only wrapper words go.
- Do not use this hook to shorten files that will be read by humans as prose. Compressing a harness file is the `caveman` rewrite, a separate one-off job on a chosen file.
- Do not let the hook exit non-zero. Exit code 2 blocks the prompt, and a blocked prompt over a compression preference is never the right trade.
