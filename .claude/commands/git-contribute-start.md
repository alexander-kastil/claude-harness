---
description: Start a contribution to claude-harness on a new feature branch, cut from the owner's current master. Steps 3 and 4 of CONTRIBUTE.md.
argument-hint: <name>
disable-model-invocation: true
---

# git-contribute-start

Creates `feature/$ARGUMENTS` from the owner's current master. Running this command is the instruction; it needs no further confirmation.

## Never

- Commit on `master`, or push to the owner's repo.
- Force-push, rebase or reset anything.
- Start with uncommitted changes in the working tree.

## Steps

1. Remotes: `origin` must be your fork and `upstream` must be `alexander-kastil/claude-harness`, both recognised by URL in `git remote -v`. If not, stop and point to `/git-contribute-setup`.
2. `git status --porcelain` must be empty. If not, stop and list the files.
3. The name is `$ARGUMENTS`; when it is empty, ask for one. When `feature/<name>` already exists locally or on `origin`, stop.
4. `git checkout master`, then `git pull --ff-only upstream master`. A refused fast-forward means `master` holds commits of its own: stop and list them with `git log --oneline upstream/master..master`.
5. `git push origin master`.
6. `git checkout -b feature/<name>`.
7. Report the branch and the upstream commit it starts from.
