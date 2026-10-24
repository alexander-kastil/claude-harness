---
description: Package claude-harness and sideload it into your current VS Code, or with --new into a separate VS Code instance opened on this repo.
argument-hint: [--new]
disable-model-invocation: true
---

# git-sideload

Packages the working tree as it is, at the version in `package.json`, and installs the VSIX. Running this command is the instruction; it needs no further confirmation.

## Never

- Reload, restart or close a VS Code window, or stop a Code process: a Claude Code session running in that window ends with it.
- Install into the current VS Code when `--new` was given.

## Steps

1. `npm run package`. Read the VSIX from the line `DONE  Packaged: <file>.vsix (<n> files, ...)`. When the line is missing, stop and show the output.
2. The CLI is `code`, or `code-insiders` when only `Code - Insiders` is running.
3. Without `--new` in `$ARGUMENTS`, the current instance: `code --install-extension <file>.vsix --force`, and the output must say `successfully installed`. Open windows keep the old build until their extension host restarts: tell the user to run **Developer: Restart Extension Host** in the window to test in, or to open a new window with `code -n`.
4. With `--new`, a separate instance with its own settings and extensions under `<temp>/claude-harness-vscode`, where `<temp>` is `$env:TEMP` on Windows and `${TMPDIR:-/tmp}` elsewhere. Your own VS Code and its extensions stay untouched, and the folder is reused on the next run.
   - `code --user-data-dir <temp>/claude-harness-vscode/ud --extensions-dir <temp>/claude-harness-vscode/ext --install-extension <file>.vsix --force`, and the output must say `successfully installed`.
   - `code --user-data-dir <temp>/claude-harness-vscode/ud --extensions-dir <temp>/claude-harness-vscode/ext --new-window <repo folder>`.
5. Report the version, the VSIX, its file count and the instance it went into.
