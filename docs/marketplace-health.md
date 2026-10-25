# Marketplace health

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="rules-editor.md">← Back to Rules editor</a></td>
<td align="center"></td>
<td align="right"><a href="configure-tools.md">→ Next: Configure Tools</a></td>
</tr>
</table>

The Marketplace health page lists each marketplace you have added, with its plugins. It shows which installed plugins are behind their source. Use it before you update plugins or rename a marketplace.

![Marketplace health page with a plugin whose source is ahead of the installed copy](images/marketplace-health.png)

## Read the page

The marketplaces are in two groups: **Local, on disk** for your own directory marketplaces comes first, then **Hosted** for the others. When there is no directory marketplace, the list has no group headings. Each marketplace shows its source kind (`github` or `directory`) and its location. A tag reads "1 ahead" when a plugin's source version is newer than the installed copy.

| Column | Meaning |
| --- | --- |
| Plugin | The plugin name |
| Installed | The installed version, or "not installed" |
| Source | The version in the marketplace |
| State | "source ahead of the installed copy" in yellow, or "current". Also "enabled" when it is on. |

Open the page from the package icon in the sidebar header, the package icon on the **Plugins** row of the activity bar, the **Repositories** node menu, or **Claude Harness: Marketplace Health** in the command palette.

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
