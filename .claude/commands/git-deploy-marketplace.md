---
description: Publish claude-harness to the Visual Studio Marketplace by fast-forwarding the deploy branch to origin/master. The only release path.
disable-model-invocation: true
---

# git-deploy-marketplace

Releases what is on `origin/master` now. Running this command is the instruction to publish; it needs no further confirmation.

## The pattern

- `master` collects the work; pull requests merge there. Nothing on `master` publishes.
- `deploy` is the release branch. A push to it triggers pipeline 98 (`claude-harness-marketplace`, project `vscode-extensions`, org `integrationsonline`), which packages and runs `vsce publish --azure-credential`.
- `deploy` only ever moves forward to a commit of `origin/master`. It never gets commits of its own.
- Check 129 (branch control, `refs/heads/deploy` only) on the service connection `sc-vscode-marketplace` refuses a token to every other branch. The GitHub ruleset `deploy` (id 25674763) forbids force push and deletion and requires an approved pull request from everyone except Repository admin, who bypasses it always (added 2026-10-23), so the owner's fast-forward push in step 4 passes.

## Never

- Run pipeline 98 by hand on `master` or any branch other than `deploy` to publish.
- Force-push, reset or delete `deploy`, or commit to it directly.
- Disable or edit check 129, add another branch to the pipeline trigger, or move the publish step out of the `refs/heads/deploy` condition in `azure-pipelines.yml`.
- Release local commits. Only `origin/master` ships; if the work is not pushed there, say so and stop.

## Steps

1. `git fetch origin`, then `git log --oneline origin/deploy..origin/master`: these commits ship. Empty means there is nothing to release: stop.
2. `git merge-base --is-ancestor origin/deploy origin/master` must succeed. If it fails, `deploy` has diverged: stop and list the commits on `origin/deploy` that are not on `origin/master`.
3. Version gate: `version` from `git show origin/master:package.json` must be higher than `versions[0].version` from `npx @vscode/vsce show integrations-at.claude-harness --json`, because the Marketplace refuses a version it already holds. If it is not, stop and ask for a version bump on `master`.
4. `git push origin origin/master:refs/heads/deploy`. A rejected push means `deploy` is no longer an ancestor: go back to step 2, never `--force`. Rejected with "push declined due to repository rule violations" means the admin bypass is gone: `gh api repos/alexander-kastil/claude-harness/rulesets/25674763 --jq '{bypass_actors, current_user_can_bypass}'` shows it. Restoring it is the owner's call: say so and stop. A pull request into `deploy` is no way around it, since its merge commit is a commit of its own.
5. Find the run the push started: `az pipelines runs list --pipeline-ids 98 --branch refs/heads/deploy --top 1 --org https://dev.azure.com/integrationsonline --project vscode-extensions`, with `sourceVersion` equal to the pushed commit. If none appears within two minutes, start it on `deploy` only: `az pipelines run --id 98 --branch deploy --org https://dev.azure.com/integrationsonline --project vscode-extensions`. Poll `az pipelines runs show --id <run> --org https://dev.azure.com/integrationsonline --project vscode-extensions --query "[status,result]"` until `completed`.
6. Proof: the log of the "Publish to the Marketplace" task contains `DONE  Published`. `vsce show` lags by several minutes; say "published, not live yet" until `versions[0].version` shows the new version. The `vscode-extension:publish-vscode-ext` skill, `references/traps.md`, has the log lookup. Steps 5 and 6 in one call, read-only (0.5.0, run 322): `bash /d/git-projects/integrations-marketplace/plugins/vscode-extension/skills/publish-vscode-ext/scripts/publish-status.sh --org https://dev.azure.com/integrationsonline --project vscode-extensions --pipeline 98 --branch deploy --commit <pushed sha> --extension integrations-at.claude-harness`; if it ends `run=none`, start the run as in step 5 and call it again.
7. Report the version, the commit, the run id and its result.
