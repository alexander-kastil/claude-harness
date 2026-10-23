---
paths:
  - "media/**"
  - "src/**"
---

# Working on the extension

- Load the global `vscode-extension` skill before the first edit of `media/` or `src/`. Bump and install is its `scripts/sideload.ps1 -Repo <repo>`; a look at a webview change is its `references/design-preview.md`; chart shapes the owner settled are in its `references/webview-charts.md`.
- Work on this extension belongs to the `vscode-ext-specialist` agent. Kept on the main thread, an implementation turn puts its open questions (callers, CSS rules, signatures) into one fact-gatherer brief before the first edit and reads only the files it edits: the delegation mod denies the fourth main-thread lookup of a turn.
- Edit source with the Edit tool. Never edit through a Bash heredoc (`python - <<'EOF'`, `sed` with escapes): it rewrites `\n` and fails on CRLF files. Scratch and test scripts that hold a backslash (a regex like `/[\\/]/`, a Windows path literal) go through the Write tool too: a heredoc here collapses `\\` to `\`, so the test checks a different regex than the code has.
- Give Node Windows paths with forward slashes, from a script file, not `node -e` with escaped backslashes.
- The owner's history of corrections is in `tasks/lessons.md`; read the entries for the view you are about to change.
- The webview script is `src/webview/*.ts`, bundled by `npm run webview` (part of `npm run compile`) into `media/panel.js`, which is generated and not in git: never edit it. Messages between host and webview are typed in `src/shared/messages.ts`; change a message there first. A module still starting with `// @ts-nocheck` is unchecked; removing the line switches it on.
- Every tooltip in the webview uses the house hover card (`.hc` in `.tl-hover`, shown with `placeCard`). A plain hint is a `title` attribute: the delegated handler in `src/webview/hover.ts` (`showTip`) renders it as the card, with the element's own codicon in the head and lines after the first as text. A hint with a heading and a sentence uses `tabTip(label, glyph, text)`. Never a native browser tooltip and never a separately styled one.
