# Harness kinds

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="../README.md#features">← Back to Features</a></td>
<td align="center"></td>
<td align="right"><a href="editing.md">→ Next: Editing</a></td>
</tr>
</table>

Claude Harness lists twelve kinds of harness items. Each kind is a section in the sidebar. The global harness lives in `~/.claude`, or in the folder set by `claudeHarness.root`. Each repository has the same kinds in its own `.claude` folder, plus its `CLAUDE.md` files and `.mcp.json`.

## Kinds

| Kind | Stored in | Edit | Create |
| --- | --- | --- | --- |
| Memory | `CLAUDE.md`. In a repo, also `CLAUDE.local.md` and `.claude/CLAUDE.md`. | Yes | No |
| Rules | `rules/`, including subfolders, as `.md` files | Yes | Yes |
| Agents | `agents/*.md` | Yes | Yes |
| Skills | `skills/<name>/SKILL.md`, plus the other files in that folder | `SKILL.md` only. Other files open in the editor. | Yes |
| Commands | `commands/`, including subfolders. A subfolder becomes part of the name, as in `folder:name`. | Yes | Yes |
| Output styles | `output-styles/*.md` | Yes | Yes |
| Workflows | `workflows/*.js` and `workflows/*.mjs` | Yes, as code | Yes |
| Hooks | `hooks` in `settings.json`, and the script files in the `hooks/` folder, including subfolders, such as `.claude/hooks/` in a repo. The scripts are listed under the group **Scripts**. | Hooks: no, read-only. Scripts: yes, as code. | No |
| Mods | The installed plugins whose hooks file declares a `modules` array; see [Mods](plugins.md#mods). The same entries as in Plugins. | Switch only | No |
| MCP servers | `mcpServers` in `~/.claude.json` for the global harness, and in `.mcp.json` for a repo. Also the list from `claude mcp list`. | Switch and delete | No |
| Plugins | `enabledPlugins` in `settings.json` | Switch only | No |
| Settings | `settings.json` and `settings.local.json` | Yes, as JSON | No |

## Columns of the type pages

Each kind has a page with a table. Every table has Name, Description and Changed, which counts the days since the file changed. The Scope column appears when the list mixes scopes. A column with nothing in it is dropped, and in a narrow panel the low-priority columns drop first. Numbers are right-aligned and text is left-aligned. Where a fact is a word, it is one of a short fixed set, and the details are in the hover card.

| Kind | Columns after Description |
| --- | --- |
| Agents | Model, Tools, Origin, Used |
| Skills | Sync, Files, Origin, Desc, Cost, Used |
| Commands | Tools, Origin, Used |
| Rules | Origin, Loads |
| MCP servers | Source, Status |
| Plugins | Marketplace, Version, Enabled |
| Settings | Keys |

**Origin** reads `global`, `repo`, `linked` (a skill that is a link to another folder, such as one an older version or the skills CLI made), `marketplace` (shipped by a plugin) or `distributor` (a skill with a source). **Sync** reads `current`, `update`, `unchecked` or `gone`; see [Skill sources](skill-sources.md#the-origin-and-sync-columns). In **Used** and **Cost**, a red 0 means the usage has not been counted yet; **Count usage** builds it.

The second line of a row in the sidebar and the tree shows at most three short facts for its kind, such as when it changed, how often it was used and its size. Each has a hover card that says what it is.

## Read-only and switch-only kinds

Hooks show their JSON in the detail view. Click **Open in editor** to change them in the file. The hook scripts in the Hooks list open as code, like workflows, and you edit the text in the detail view. Hook scripts can be copies too; see [Duplicates](duplicates.md). Settings files are edited as JSON in the detail view; see [Settings](settings.md).

MCP servers and plugins have a switch in their detail view. The switch changes which folders use the item, or whether the plugin is enabled. It does not change the server or plugin itself. A server stored in a file can also be deleted from its detail view. See [MCP switches](mcp-toggles.md) and [Plugins](plugins.md).

Agents of an enabled plugin also appear in the global Agents list. Those copies are read-only. See [Plugins](plugins.md#agents-in-the-global-list).

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="../README.md#features">← Back to Features</a></td>
<td align="center"><a href="#harness-kinds">↑ Back to top</a></td>
<td align="right"><a href="editing.md">→ Next: Editing</a></td>
</tr>
</table>
