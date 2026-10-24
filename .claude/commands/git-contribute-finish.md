---
description: Clean up after your claude-harness pull request merged, by updating master and deleting the feature branch locally and on your fork. Step 9 of CONTRIBUTE.md.
argument-hint: [branch]
disable-model-invocation: true
---

# git-contribute-finish

Running this command is the instruction to delete the merged branch; it needs no further confirmation.

## Never

- Delete a branch whose pull request has not merged.
- Commit on `master`, or push to the owner's repo.

## Steps

1. Remotes: `origin` must be your fork and `upstream` must be `alexander-kastil/claude-harness`, both recognised by URL in `git remote -v`. If not, stop and point to `/git-contribute-setup`.
2. The branch is `$ARGUMENTS`, or the current branch when it is empty. It must be a `feature/` branch.
3. `gh pr list --repo alexander-kastil/claude-harness --author "@me" --head <branch> --state merged --json number,url` must return a pull request. If not, stop: nothing is deleted.
4. `git status --porcelain` must be empty. If not, stop and list the files.
5. `git checkout master`, then `git pull --ff-only upstream master`.
6. `git branch -d <branch>`. When it refuses because the pull request was squash-merged, `git branch -D <branch>`: step 3 confirmed the merge.
7. `git push origin --delete <branch>`. A branch already gone from the fork is fine.
8. Report the merged pull request, the new `master` commit and the deleted branch.
