---
description: Delete a claude-harness feature branch you no longer need, locally and on your fork, when it has no open pull request.
argument-hint: [branch]
disable-model-invocation: true
---

# git-contribute-cleanup

For a feature branch that never made it to a pull request, or whose pull request was closed. A merged branch is cleaned up by `/git-contribute-finish`. Running this command is the instruction to delete the branch and its commits; it needs no further confirmation.

## Never

- Delete `master`, or a branch that is not a `feature/` branch.
- Delete a branch with an open pull request: deleting it would close the pull request.
- Push to the owner's repo.

## Steps

1. Remotes: `origin` must be your fork and `upstream` must be `alexander-kastil/claude-harness`, both recognised by URL in `git remote -v`. If not, stop and point to `/git-contribute-setup`.
2. The branch is `$ARGUMENTS` (`<name>` means `feature/<name>`), or the current branch when it is empty. It must be a `feature/` branch.
3. `gh pr list --repo alexander-kastil/claude-harness --author "@me" --head <branch> --state open --json url` must return nothing. If it returns a pull request, stop and show its URL.
4. `git status --porcelain` must be empty. If not, stop and list the files.
5. Note the tip with `git rev-parse <branch>` and the commits that go away with `git log --oneline upstream/master..<branch>`.
6. When the branch is checked out: `git checkout master`.
7. `git branch -D <branch>`.
8. When `git ls-remote --heads origin <branch>` lists it: `git push origin --delete <branch>`.
9. Report the deleted branch, the commits that went with it, and that `git branch <branch> <tip>` brings it back locally.
