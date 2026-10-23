# Main window

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="../README.md#features">← Back to Features</a></td>
<td align="center"></td>
<td align="right"><a href="harness-kinds.md">→ Next: Harness kinds</a></td>
</tr>
</table>

The main window shows your global harness and each repository in one place. The sidebar lists the sections, and the selected item opens on the right. Only one main window opens at a time. Running the command again brings the open window forward.

## Open the main window

| Method | Result |
| --- | --- |
| **Claude Harness** in the status bar (bottom bar) | Opens the main window |
| Claude Harness icon in the activity bar | Opens the activity bar view. Click an item there to open it in the main window. |
| **Claude Harness: Open Claude Harness** in the command palette | Opens the main window |

## Sidebar

The sidebar has a search box and five buttons in its header:

| Control | What it does |
| --- | --- |
| Overview (home icon) | Shows the overview page |
| Fleet overview (dashboard icon) | Shows one table of every repo. See [Fleet overview](fleet-overview.md). |
| Marketplace health (package icon) | Shows the marketplaces and their plugins. See [Marketplace health](marketplace-health.md). |
| New (plus icon) | Creates an item. See [Editing](editing.md#create-rename-duplicate-and-delete). |
| Refresh | Reloads the harness and the MCP server list |

The search box filters every section by name and description.

Click a section header to fold or unfold it. A section's type page opens from its tile on the overview or on a repo page.

Below the global sections, the **Repositories** group lists each repo. Click a repo to open its page. Its chevron expands its sections. When a repo is open, its sections start with a **Sessions** node, above **Memory**, with its count. Click the search icon to open the [Sessions page](sessions.md#sessions-page), and click the row to fold or unfold the sessions. Use the buttons on the group header to sort the repos by last used or A-Z, and to add or remove repos. See [Repositories](repositories.md).

A repo page has four tabs: **Overview**, with one tile for each section and **Recently changed**, **Effective harness**, **Sessions** and **Models**. Models shows the last 7 days of tokens and cost by model, for each account; see [Last 7 days](sessions.md#last-7-days). The page header has a button to create an item in the repo. See [Repositories](repositories.md#repository-page) and [Effective harness](effective-harness.md). Provider features appear when a harness standard provider plugin is installed.

## Overview

The overview shows the number of global assets and repositories. It has one tile for each global section with its count. Click a tile to open that section's type page: its items, with a search box and filters.

The **Recently changed** list shows the 12 most recently changed memory, rules, agents, skills, commands, output styles and workflows across all scopes.

## Activity bar view

The activity bar view shows the global harness as a tree. Expand a section to see its items, and expand a skill to see its files.

| Action | Result |
| --- | --- |
| Click an item | Opens it in the main window |
| Right-click an item | Opens the file, reveals it, and for editable items renames, duplicates or deletes it |
| Plugin row button | Enables or disables the plugin. See [Plugins](plugins.md). |
| Title bar buttons | Open the main window, create an item, refresh, open the Fleet overview and open Claude Here |

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="../README.md#features">← Back to Features</a></td>
<td align="center"><a href="#main-window">↑ Back to top</a></td>
<td align="right"><a href="harness-kinds.md">→ Next: Harness kinds</a></td>
</tr>
</table>
