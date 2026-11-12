# Sync instructions

Sync instructions copies your `CLAUDE.md` into the instruction files of other AI tools, so Cursor, Codex, GitHub Copilot, Gemini CLI and Cline read the same rules that Claude Code reads. `CLAUDE.md` is the source. Nothing is written until you confirm.

## Where to open it

Open the **Memory** page of Global or of a repo, then press **Sync**. The page is named **Sync instructions**, and its back arrow returns to Memory.

## What you see

A line at the top names the source file (for example `CLAUDE.md`, or `.claude/CLAUDE.md` when the repo keeps it there) with its character count. Below it is a table with one row per tool file:

| Column | Meaning |
| --- | --- |
| Switch | Includes the file in the next Sync. Files already in sync are switched off and cannot be chosen. |
| File | The file path. A repo path is relative to the repo, a global path starts with `~`. |
| Tool | The tool that reads the file. |
| State | **in sync**, **differs** or **missing**. A hover says what each one means. |
| Claude Code | For a repo `AGENTS.md` only: whether Claude Code loads that file, with a reason in the hover. |
| Compare | Opens the file and what Sync would write side by side. |

Files that differ are switched on by default. A file that is missing gets created.

## Which files are targets

For a repo:

- `AGENTS.md` (read by Codex, Cursor and Copilot)
- `.cursor/rules/claude.mdc` (Cursor, written with the frontmatter Cursor expects, always applied)
- `.github/copilot-instructions.md` (GitHub Copilot)

For Global:

- `~/.agents/AGENTS.md` and `~/.codex/AGENTS.md` (Cline and Codex)
- `~/.gemini/GEMINI.md` (Gemini CLI)
- `~/.copilot/copilot-instructions.md` (Copilot CLI)

## What you can do

- Switch the files you want to include.
- **Compare** a row to see the current file and the text Sync would write, side by side. Nothing is written by Compare.
- **Sync** writes the switched-on files that differ or are missing.

## What is asked before a write

Sync opens a confirm card first. It lists each file that will be created or overwritten, says that `CLAUDE.md` itself is not changed, and names the backup folder when an existing file will be overwritten. Choose **Sync** on the card to write. Any existing file is copied to the backup folder before it is overwritten. Choosing nothing, or closing the card, writes nothing.

After a write, the page says how many files were written, and the table refreshes.

## Limits

Other tools do not follow `@imports` in `CLAUDE.md`. Sync copies the text of the file as it stands, so an imported file's content is not included. The page shows an import count when the source has any.
