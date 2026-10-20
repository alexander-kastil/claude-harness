# Harness standard

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="repositories.md">← Back to Repositories</a></td>
<td align="center"></td>
<td align="right"><a href="claude-md-lenses.md">→ Next: CLAUDE.md lenses</a></td>
</tr>
</table>

Claude Harness checks each repo against the harness standard. The check runs `check-constitution.py` from the harness-plugin, so the results match what the plugin prints on the command line. Findings appear in the Problems panel, and each repo shows a badge in the sidebar.

## Results

| Finding | Problems panel | Points to |
| --- | --- | --- |
| FAIL | Error | The file and line it concerns |
| REVIEW | Warning | The file and line it concerns |
| INFO | Information | The file it concerns |

A finding can concern `CLAUDE.md`, a file that `CLAUDE.md` imports, `.claude/settings.json`, `.claude/settings.local.json` or a file under `.claude/hooks/`. Each entry uses the source **harness standard**. Click an entry in the repo page to open the file at that line.

## Badges

| Badge | Meaning |
| --- | --- |
| pass | The repo passes the standard. The tree reads "passes the standard". |
| fail | At least one FAIL. The badge shows the count, for example "fail 2 · review 1". |
| review | No FAIL, and at least one REVIEW. |
| checking | A check is running. |

The badges show on the **Repositories** node in the activity bar and next to each repo in the main window sidebar. See [Repositories](repositories.md#activity-bar-node).

## When a check runs

A check runs when:

- You expand the **Repositories** node in the activity bar.
- The [Fleet overview](fleet-overview.md) opens.
- A repo page opens.
- A repo's root `CLAUDE.md` is opened or saved.
- A file under the repo's `.claude` folder is saved.
- You run **Check Harness Standard**.

A result stays until a file the check reads changes. Those files are `CLAUDE.md`, the files it imports, the two repo settings files, the repo's hooks folder and the global `settings.json`. At most three repos are checked at once.

## Commands

| Command | What it does |
| --- | --- |
| Check Harness Standard | Checks every repo, or the repo you pick, and ignores the cached result |
| Open the Harness Standard | Opens the standard that the check follows, from the harness-plugin |

If the harness-plugin is missing or Python 3 is not on PATH, the check stays off and shows a message that says what is missing. The [README](../README.md#quick-start) lists what the check needs.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="repositories.md">← Back to Repositories</a></td>
<td align="center"><a href="#harness-standard">↑ Back to top</a></td>
<td align="right"><a href="claude-md-lenses.md">→ Next: CLAUDE.md lenses</a></td>
</tr>
</table>
