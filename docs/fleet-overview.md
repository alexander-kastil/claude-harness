# GitHub Repo overview

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="bulk-edits.md">← Back to Bulk-edit guard</a></td>
<td align="center"></td>
<td align="right"><a href="rules-editor.md">→ Next: Rules editor</a></td>
</tr>
</table>

The GitHub Repo overview shows every repo in one table. Use it to compare line counts, plugins and copies. Clicking a row opens that repo's page. Provider features appear when a harness standard provider plugin is installed.

![GitHub Repo overview table with one row per repo](images/fleet-overview.png)

## Search

The search box above the table filters the repos by name or path as you type. When no repo matches, the page says so.

## Columns

| Column | Meaning |
| --- | --- |
| Repo | The repo name |
| Lines | The line count of the root `CLAUDE.md` |
| Plugins | The plugins enabled in the repo's settings. The tooltip lists them. |
| Hook copies | Hook scripts that also exist in another scope or a plugin |
| Copies | Skills and agents that also exist in another scope or a plugin. See [Duplicates](duplicates.md). |

## Toolbar

| Button | What it does |
| --- | --- |
| Retire clean copies | Starts [Retire Clean Copies](duplicates.md#retire-clean-copies) |
| Reload | Reloads the table |

## Open the GitHub Repo overview

- The GitHub icon in the main window sidebar header.
- **Claude Harness: GitHub Repo Overview** in the command palette.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="bulk-edits.md">← Back to Bulk-edit guard</a></td>
<td align="center"><a href="#github-repo-overview">↑ Back to top</a></td>
<td align="right"><a href="rules-editor.md">→ Next: Rules editor</a></td>
</tr>
</table>
