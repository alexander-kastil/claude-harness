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
| Fleet overview (table icon) | Shows one table of every repo. See [Fleet overview](fleet-overview.md). |
| Marketplace health (package icon) | Shows the marketplaces and their plugins. See [Marketplace health](marketplace-health.md). |
| New (plus icon) | Creates an item. See [Editing](editing.md#create-rename-duplicate-and-delete). |
| Refresh | Reloads the harness and the MCP server list |

The search box filters every section by name and description.

Below the global sections, the **Repositories** group lists each repo, with its check badge. Click a repo to open its page. Its chevron expands its sections. Use the buttons on the group header to add or remove repos. See [Repositories](repositories.md).

A repo page has these parts, from top to bottom: one tile for each section, **Recently changed**, **Harness standard** and **Effective harness**. The page header also has buttons to check the repo, fix its settings and hooks, init a product repo and create an item in it. See [Harness standard](harness-standard.md), [Effective harness](effective-harness.md) and [Init product repo](init-product-repo.md).

## Overview

The overview shows the number of global assets and repositories. It has one tile for each global section with its count. Click a tile to open the first item in that section.

The **Recently changed** list shows the 12 most recently changed memory, rules, agents, skills, commands, output styles and workflows across all scopes.

## Activity bar view

The activity bar view shows the global harness as a tree. Expand a section to see its items, and expand a skill to see its files.

| Action | Result |
| --- | --- |
| Click an item | Opens it in the main window |
| Right-click an item | Opens the file, reveals it, and for editable items renames, duplicates or deletes it |
| Plugin row button | Enables or disables the plugin. See [Plugins](plugins.md). |
| Title bar buttons | Open the main window, create an item, refresh, open Claude Here and open the Fleet overview |

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="../README.md#features">← Back to Features</a></td>
<td align="center"><a href="#main-window">↑ Back to top</a></td>
<td align="right"><a href="harness-kinds.md">→ Next: Harness kinds</a></td>
</tr>
</table>
