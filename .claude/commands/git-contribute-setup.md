---
description: Check the clone of your claude-harness fork, with origin as your fork and upstream as the owner's repo. Step 2 of CONTRIBUTE.md.
disable-model-invocation: true
---

# git-contribute-setup

Run it once in the clone of your fork, after step 1 (`gh repo fork alexander-kastil/claude-harness --clone`). Running this command is the instruction; it needs no further confirmation. Safe to run again.

## The pattern

- `origin` is your fork, `<you>/claude-harness`. You clone it and only ever push there.
- `upstream` is `alexander-kastil/claude-harness`, the owner's repo. Pull requests merge there; you never clone it.
- Remotes are recognised by their URL, never by their name.

## Never

- Push to the owner's repo.
- Remove or rename a remote that points to neither repo.
- Run in the owner's clone: when `gh api user --jq .login` is `alexander-kastil`, stop and say that the owner does not contribute through a fork.

## Steps

1. `gh auth status` must succeed. If it does not, hand over `gh auth login` for the contributor to run and stop. When `gh api user --jq .login` is `alexander-kastil`, stop (see Never).
2. `git remote -v`. When `origin` is `alexander-kastil/claude-harness`, this is a clone of the owner's repo: stop and say to clone the fork instead with `gh repo fork alexander-kastil/claude-harness --clone`.
3. When there is no `upstream` remote: `git remote add upstream https://github.com/alexander-kastil/claude-harness.git`.
4. `git fetch upstream`, then `git remote -v`: `origin` must be `<you>/claude-harness` and `upstream` must be `alexander-kastil/claude-harness`.
5. Report both remotes with their URLs, and that `/git-contribute-start <name>` begins a change.
