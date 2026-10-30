# Marketplace health

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="rules-editor.md">← Back to Rules editor</a></td>
<td align="center"></td>
<td align="right"><a href="configure-tools.md">→ Next: Configure Tools</a></td>
</tr>
</table>

The Marketplace health page lists each marketplace you have added, with its plugins. It shows which installed plugins are behind their source. Use it before you update plugins or rename a marketplace. Each marketplace also has a page of its own, see [Marketplace page](#marketplace-page).

![Marketplace health page with a plugin whose source is ahead of the installed copy](images/marketplace-health.png)

## Read the page

The marketplaces are in two groups: **Local, on disk** for your own directory marketplaces comes first, then **Hosted** for the others. When there is no directory marketplace, the list has no group headings. Each marketplace shows its source kind (`github` or `directory`) and its location. A tag reads "1 ahead" when a plugin's source version is newer than the installed copy.

| Column | Meaning |
| --- | --- |
| Plugin | The plugin name |
| Installed | The installed version, empty when the plugin is not installed |
| Latest | The version the marketplace offers. The column shows only when a plugin lists one. |
| Sync | A **Sync plugin** button when the source is ahead of the installed copy, otherwise `current` or `uninstalled`. The hover card of `current` or `uninstalled` says which, and adds "Enabled" when the plugin is on. While at least one plugin is ahead, the column's header is a **Sync all** button. |

**Sync plugin** refreshes the marketplace and updates that plugin from it, after a card that names both versions. The same command is **Claude Harness: Sync Plugin from Its Marketplace...** in the plugin's right-click menu. **Sync all** syncs every plugin of that marketplace that is ahead in one go, see [Sync every plugin that is ahead](#sync-every-plugin-that-is-ahead).

Open the page from the package icon in the sidebar header, the **Marketplaces** header in the sidebar, or **Claude Harness: Marketplace Health** in the command palette.

## Marketplace page

The **Marketplaces** section of the sidebar, under **Plugins** and above **Repositories**, lists every marketplace Claude Code knows, with the icon of its source kind and a second line such as `28 plugins · 11 ahead`. Click a row to open that marketplace's page. Click the section header to fold or unfold it and to open Marketplace health. On the [Plugins page](plugins.md), the name in each marketplace heading is a link to the same page; its **Back** button then returns to the Plugins page.

The page has a header like the Plugins page: the package icon, the marketplace name and a count line such as `28 plugins · 28 installed · 28 enabled · 11 ahead`. Under it are the source (for example `local · integrations-marketplace`, with the full source and folder in the hover card) and the table of its plugins.

| Column | Meaning |
| --- | --- |
| Plugin | The plugin name, with a filled check when it is enabled |
| Description | What the catalog or the plugin's manifest says it does |
| Installed | The installed version |
| Latest | The version the marketplace offers |
| Sync | The same column as on Marketplace health: **Sync plugin**, `current` or `uninstalled`, with **Sync all** in its header while one plugin is ahead |

Click a row of an installed plugin to open its page. That page's **Back** returns to the marketplace.

| Button | What it does |
| --- | --- |
| Back | Returns to Marketplace health, or to the Plugins page when you came from there |
| Rename marketplace... | Renames a directory marketplace. Shown for directory marketplaces only. See [Rename a directory marketplace](#rename-a-directory-marketplace). |
| Reload | Reads the marketplace again |
| Sync N plugins | Syncs every plugin that is ahead. Shown while at least one is, with the count in its label. |
| Draw with Claude | Sits in the Claude group, last at the right end of the header. One press draws two drawings, shown above the table with a toggle: Harness, the marketplace's plugins and what each brings, and Process, how the plugins call, gate or plug into each other. A card asks first, because the run counts against your plan. |

## Sync every plugin that is ahead

**Sync N plugins** in the marketplace page's header and **Sync all** in the header of a Sync column do the same. A card lists every plugin that is ahead with its installed and its new version; with more than ten the list scrolls. After you choose **Sync N plugins** on the card, the extension runs `claude plugin marketplace update <marketplace>` once, then `claude plugin update` for each of those plugins, and refreshes the page. A plugin that fails does not stop the others; the message at the end names the failures. Claude Code sessions that are open pick the new versions up after a restart.

## Rename a directory marketplace

The **Rename...** button appears on directory marketplaces only. A `github` marketplace takes its name from its `marketplace.json`, so rename it at its source.

1. Type the new name. It takes lowercase letters, digits and dashes, and it must not exist yet.
2. The extension previews each file it will change: the marketplace entry in your user settings, the repos' settings files and the marketplace's `marketplace.json`. Each file shows a diff.
3. The [bulk-edit guard](bulk-edits.md) lists the repos whose settings change.
4. A confirmation lists the files and the commands. Choose **Rename** to write the files.
5. A terminal runs `claude plugin marketplace remove`, then `claude plugin marketplace add` with the location, then `claude plugin install <plugin>@<new name> --scope user` for each installed plugin.

The files are written before the terminal opens. The terminal commands finish the rename, so watch its output for errors.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="rules-editor.md">← Back to Rules editor</a></td>
<td align="center"><a href="#marketplace-health">↑ Back to top</a></td>
<td align="right"><a href="configure-tools.md">→ Next: Configure Tools</a></td>
</tr>
</table>
