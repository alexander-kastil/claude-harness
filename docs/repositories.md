# Repositories

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="editing.md">← Back to Editing</a></td>
<td align="center"></td>
<td align="right"><a href="sessions.md">→ Next: Sessions</a></td>
</tr>
</table>

A repository appears under **Repositories** in the sidebar. Its harness is read from its own `.claude` folder and its `CLAUDE.md` files, with the same kinds as the global harness. Click a repo to open its page.

| Section | Description |
| --- | --- |
| [Where repos come from](#where-repos-come-from) | The three sources and the order of the list |
| [Repository page](#repository-page) | The tabs and the buttons on a repo page |
| [Add a repo](#add-a-repo) | Adds repo folders |
| [Remove a repo](#remove-a-repo) | Hides repos or added folders |

## Where repos come from

A folder counts as a repo when it has a `.claude` folder or a `CLAUDE.md` file. Claude Harness finds repos in three places:

| Source | Notes |
| --- | --- |
| Projects in `~/.claude.json` | The projects Claude Code knows about. Folders in the temp folder are skipped. Your home folder is never listed. |
| Open workspace folders | Each folder open in the VS Code window that has a `.claude` folder or a `CLAUDE.md` file. |
| Folders added with Add Repo | A repo folder, or a parent folder. A parent folder also checks its direct subfolders, except hidden folders, `node_modules`, `.git`, `__pycache__` and `.venv`. |

A subfolder that you create later under an added parent folder appears after you click **Refresh** or reload the window.

In the sidebar, repos that are open as workspace folders are listed first under **Repositories**. The other repos follow. By default the other repos sort by last used, which the **Sort by last used** button (history icon) on the group header selects. The repo with the newest Claude Code session comes first, and repos without a session follow in alphabetical order by folder name. Click **Sort A-Z** (case-sensitive icon) to sort the other repos alphabetically by folder name instead. Claude Harness remembers your choice. Open repos stay on top in both orders. When both kinds are present, a thin line separates them.

![Sidebar with the open repo on top and a separator line below it](images/repositories.png)

## Repository page

The repo page shows the repo name and a short count line such as `13 assets · repos/shop-api`, with the full path on hover. Four tabs sit under the header: **Overview**, **Effective harness**, **Sessions** and **Models**.

- **Overview** starts with four figure tiles: **Sessions**, **Agents launched**, **Always loaded** and **Copies**. Under **Harness** it has one tile for each section, on one line with the count beside the icon and label. A count of zero is dimmed. Click a tile to open that section's type page for the repo: its items, with a search box and filters. Below the tiles, **Recently changed** lists the 10 most recently changed items in the repo.
- **Effective harness** shows what a session in the repo loads. See [Effective harness](effective-harness.md).
- **Sessions** lists the repo's sessions, newest first, with the 10 newest and **Show all**. **Search and filter** opens the [Sessions page](sessions.md#sessions-page).
- **Models** shows the tokens and cost over the last 7 days, for each account, in one-line tables. A **Repo** table gives this repo's share, and the tables **By model** and **By agent type** cover all repos. See [Last 7 days](sessions.md#last-7-days).
- Header buttons: **New in** the repo name (plus icon) creates an item in this repo. See [Editing](editing.md#create-rename-duplicate-and-delete). The trash button removes this repo from the harness. Nothing is deleted on disk.
- With a harness standard provider installed, the header also has buttons to check the repo against the standard, align its `CLAUDE.md`, fix its settings and hooks, and scaffold its harness.

The terminal button in the AI group on a repo row in the sidebar (tooltip **Open Claude in** and the repo name) opens a terminal in that repo running `claude`. See [Commands](commands.md#open-claude-here).

Provider features appear when a harness standard provider plugin is installed.

## Add a repo

1. Run **Claude Harness: Add Repo...** from the command palette, or click the add button on the **Repositories** header in the sidebar.
2. Select one or more folders. Pick a repo folder, or a parent folder that holds several repos.
3. Claude Harness shows how many repos it added. If none of the folders has a `.claude` folder or a `CLAUDE.md` file, it says so.

Added folders are saved in the `claudeHarness.repoFolders` setting. Adding a repo, or its parent folder, again also shows a repo that you removed before. See [Settings](settings.md).

## Remove a repo

Remove a repo in one of two ways:

- Click the trash button on the repo page.
- Run **Claude Harness: Remove Repo...** from the command palette. The picker has two groups:

| Group | What removing does |
| --- | --- |
| Added folders | Removes the folder from `claudeHarness.repoFolders`. Removing a parent folder also removes all of its repos. |
| Repositories | Hides the repo through `claudeHarness.removedRepos`. This works for repos from `~/.claude.json`, open workspace folders and parent folders. |

Claude Harness reports how many repos it removed. Nothing is deleted on disk.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="editing.md">← Back to Editing</a></td>
<td align="center"><a href="#repositories">↑ Back to top</a></td>
<td align="right"><a href="sessions.md">→ Next: Sessions</a></td>
</tr>
</table>
