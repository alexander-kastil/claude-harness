# Render a mod's drawn surface for docs and decks

A pane, band or toast on a drawn surface (desktop app, VS Code) is SVG the mod builds itself. For an
article or a slide, render it from those builder functions instead of redrawing it by hand: the
picture then shows what the mod draws, and it changes when the code changes.

## Steps

1. Take a real capture first: the CLI in Windows Terminal through its console (computer-automation,
   `references/cli-console-capture.md`), and the desktop app's Code tab. The VS Code extension runs
   mod hooks but draws no mod panes. A render is only the fallback, and a reader asked for the real
   thing rejects it.
2. Export the builders from the hooks module (`headSvg`, `runSvg`, `decisionsSvg` and their height
   helpers in agent-control-plugin). Import the `.ts` module directly with tsx; the script is
   `.mts`, because top-level await needs ESM.
3. Lay the SVGs out in the order the `ui.render` handler does. Host controls (`Text` group titles,
   `Button`) are not SVG: draw plain stand-ins and name them in the caption.
4. Feed real numbers. For delegation runs, `bench/results.jsonl` has per-agent `byModel` token counts
   and `first`/`last` timestamps; price them with the module's own `costOf`. Texts may follow the
   article's example; say which part is real.
5. Screenshot with headless Chrome through `puppeteer-core` at `deviceScaleFactor: 2`. The mod's SVGs
   carry their own `prefers-color-scheme` style, so the dark version is made with
   `page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }])` on a dark page
   background, never by recolouring.
6. Assert the summary line: the header values the mod computes (`headAlt`) must equal the values the
   brief expected. If they differ, report them; do not change the data to fit.
7. Save PNG and WebP (quality ~90) under the deck's `images/` folder with the section prefix.

Deps live outside the repo: `npm i --prefix <scratch> tsx puppeteer-core`.

## Worked example

`bench/agent-control-plugin/pane/render-pane.mts` with `pane-r1.json` (run r1 of the
owner-field benchmark):

```bash
npx --prefix <scratch> tsx bench/agent-control-plugin/pane/render-pane.mts \
  --data bench/agent-control-plugin/pane/pane-r1.json --out <dir> \
  --prefix 2-3-delegation-pane --deps <scratch>
```

## Proving it still holds

The command prints `header Delegation: 3 agents, 2 unverified, 1 decisions; ≈$0.25, 930k tokens, 2:22`
for `pane-r1.json`. A different line means the pane's builders or the price table changed: re-render
the images and re-check every figure in the text that quotes them.

## When the pane is host elements

A pane built from `Box` and `Text` (the /delegation pane since 2026-10-10) cannot be rendered from SVG
builders at all: only a surface draws it. Capture it in the desktop app, which loads the plugin from
`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>`: sync the working copy there (or bump the
version), then start a new session. `render-pane.mts` still renders the former SVG rows.
