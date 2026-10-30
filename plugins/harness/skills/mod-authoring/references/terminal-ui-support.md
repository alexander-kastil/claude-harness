# What a mod's UI needs: fullscreen, the mouse, the terminal

Checked on 2026-10-30 against Claude Code 2.1.314: the API types written by 2.1.312, the local
changelog and code.claude.com/docs/en/plugins/mods/interface, `.../mods/reference` and `.../fullscreen`.
Fullscreen rendering is switched on with `/tui fullscreen` or `CLAUDE_CODE_NO_FLICKER=1`; the
default is the main screen.

| What | Main screen | Fullscreen | Declared in |
| --- | --- | --- | --- |
| Band rows (`AbovePrompt`) | yes, `maxRows` is the terminal's height | yes, at most half the rows, prompt included; a taller tree scrolls under an `n more` row | `AbovePrompt.maxRows` |
| Keys: ctrl+x tab focus, Tab, Enter, a Button's `hotkey`, arrows, Esc | yes | yes | `Button.hotkey`, `Pane.isFocused` |
| Pane inline above the prompt (`$.ui.open`, `rows`) | yes | yes, below the dock width | `Pane.placement: 'inline'` |
| Pane docked beside the transcript (`columns`, 24 up to 45% of the width) | no | from 110 columns, 144 for an open the person did not ask for | `Pane.placement: 'dock'`, `PaneOpenArgs.columns` |
| `hover` on Box, Text, Button, Link; `scope` groups; a reveal drawn `display: "none"` with `hover: { display: "flex" }` | no pointer events | where the terminal reports the mouse | `BoxHoverProps`, `TextHoverProps` |
| Click to press a Button, click `[-]`, `$.ui.selection()` | no | yes | docs: "a Button click needs fullscreen rendering" |
| `Input` (`rows`), `Select` | yes | yes | `RenderElement` |
| `$.ui.view({ agentId })`, back with `$.ui.view({})` | yes, only in answer to the person's press or prompt | yes | `$.ui.view` |
| `$.ui.toast`, `$.ui.status`, `$.ui.notify` | yes | yes | `$.ui` |
| `Image` | `alt` text | pixels only in kitty 0.28+, Ghostty, iTerm2 3.5+ (tmux with passthrough); `alt` text elsewhere | `Image` |
| `Raster` repainted with `$.ui.blit` | terminal only, text cells | terminal only | `Raster` |
| `Svg`, `Client` | no | no: Desktop app and VS Code only | docs reference |

## Windows

- The mod docs name no Windows limit. The changelog does: "Disable mouse tracking on Windows consoles
  that don't fully support it", and Windows Terminal scrolls by wheel in fullscreen ("Fixed slow
  mouse-wheel scrolling in NO_FLICKER mode on Windows Terminal").
- So in Windows Terminal hover and click work only in fullscreen; on the main screen, and in a console
  whose mouse tracking is off, a mod is keyboard-only. `Image` draws its `alt` text. This is read
  from the sources above, not yet tried in a live session: try a hover in fullscreen before relying on it.
- A detail view that works everywhere: a band Button with a `hotkey` calls
  `$.ui.open({ id, focus: true, closeOnEscape: true, rows })`; Esc returns the keys and closes it.
  The `focus` request is refused while the prompt holds text or a dialog is open.
- A hover runs no hook and is drawn data only, so whatever a hover reveals also needs a keyboard route
  (a pane or a Button) for the main screen.

## Prove it still holds

- Newest API types on the machine, no mod load needed:
  `ls -t ~/.claude/plugins/cache/*/*/*/.claude-plugin/types/claude-code/index.d.ts | head -1`; its
  first line names the version that wrote it. Grep it for `isFullscreen`, `maxRows`, `placement`,
  `BoxHoverProps` and `Image`.
- The changelog is local: `grep -n -i -E "mouse tracking|fullscreen|Image" ~/.claude/cache/changelog.md`.
