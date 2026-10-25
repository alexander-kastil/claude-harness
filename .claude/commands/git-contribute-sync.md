---
description: Merge the owner's latest master into your claude-harness feature branch, run the tests and push it to your fork. Step 6 of CONTRIBUTE.md, and step 8 while the pull request is open.
disable-model-invocation: true
---

# git-contribute-sync

The step that avoids conflicts: run it right before the pull request, and again whenever master moves on while the pull request is open. Running this command is the instruction; it needs no further confirmation.

## Never

- Rebase or force-push: the feature branch is shared once maintainers can edit the pull request.
- Push to the owner's repo, or push a branch whose tests fail.
- Resolve a conflict without the contributor.

## Steps

1. Remotes: `origin` must be your fork and `upstream` must be `alexander-kastil/claude-harness`, both recognised by URL in `git remote -v`. If not, stop and point to `/git-contribute-setup`.
2. The current branch must be a `feature/` branch. On `master`, stop and point to `/git-contribute-start <name>`.
3. `git status --porcelain` must be empty. If not, stop and ask to commit the work first.
4. `git fetch upstream`. Note whether `git diff --quiet HEAD...upstream/master -- package-lock.json` reports a change.
5. `git merge upstream/master`. On a conflict, stop: list the files from `git diff --name-only --diff-filter=U`, show each conflict, and say to resolve them, `git add` the files, `git commit --no-edit` and run this command again.
6. When `package-lock.json` changed in step 4: `npm ci`. Then `npm test`, which compiles first. On a failure, stop, show the failing output and do not push.
7. `git push -u origin HEAD`.
8. Report how many upstream commits came in, the test result and the pushed commit. When `gh pr list --repo alexander-kastil/claude-harness --author "@me" --head <branch> --state open --json url` returns a pull request, say that it now shows the pushed commit.
