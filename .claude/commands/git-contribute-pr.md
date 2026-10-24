---
description: Open the pull request from your claude-harness feature branch against the owner's master, after syncing it with the latest master. Step 7 of CONTRIBUTE.md.
disable-model-invocation: true
---

# git-contribute-pr

Running this command is the instruction to open the pull request; it needs no further confirmation.

## Never

- Open the pull request before the sync passed.
- Pass `--no-maintainer-edit`: "Allow edits by maintainers" stays on.
- Open a second pull request for a branch that already has one.

## Steps

1. Run every step of `.claude/commands/git-contribute-sync.md` first, and stop wherever it stops.
2. When `gh pr list --repo alexander-kastil/claude-harness --author "@me" --head <branch> --state open --json url` returns a pull request, report its URL and stop: the sync already updated it.
3. Read the change from `git log --no-merges upstream/master..HEAD` and `git diff upstream/master...HEAD --stat`. Write a title that names the change, and a body that says what changed, why, and that `npm test` passed. Put the body in a file in the scratchpad.
4. The fork owner is the owner in the `origin` URL. `gh pr create --repo alexander-kastil/claude-harness --base master --head <fork-owner>:<branch> --title "<title>" --body-file <file>`.
5. Report the pull request URL. While it is open and master moves on, `/git-contribute-sync` keeps it up to date.
