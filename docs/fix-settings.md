# Fix settings and hooks

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="duplicates.md">← Back to Duplicates</a></td>
<td align="center"></td>
<td align="right"><a href="bulk-edits.md">→ Next: Bulk-edit guard</a></td>
</tr>
</table>

**Fix Settings and Hooks...** runs `fix-settings.py` from the harness-plugin on a repo's `.claude` settings and hooks. It shows what the script would change before anything is written. Nothing changes until you choose **Apply**.

## Start a fix

Start it from any of these places:

- The wrench button on a repo page.
- The **Fix settings and hooks...** item in a repo's menu or in the Repositories node menu.
- The wrench button on the [Fleet overview](fleet-overview.md), or the command in the palette. The command asks which repos to fix.

## Choose what may change

A pick list asks what the fix may change:

| Choice | Effect |
| --- | --- |
| Fix plugins, marketplaces and hooks | The script may change plugin settings, marketplace entries and hooks. |
| Keep plugin settings | Runs with `--keep-plugins`. Only replaced hooks are removed. |

## Review and apply

1. The script runs as a dry run on a temporary copy of the repo's settings and hooks. Your files are not touched.
2. A diff editor opens for each changed file, comparing the file now with the file after the fix. Up to eight diffs open.
3. A confirmation lists the change lines for each repo. Choose **Apply** to write the changes, or cancel.

If a fix would change nothing, Claude Harness says so and opens no diff. If the script fails in one repo, the others still run.

The [bulk-edit guard](bulk-edits.md) may leave out repos before the preview runs.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="duplicates.md">← Back to Duplicates</a></td>
<td align="center"><a href="#fix-settings-and-hooks">↑ Back to top</a></td>
<td align="right"><a href="bulk-edits.md">→ Next: Bulk-edit guard</a></td>
</tr>
</table>
