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
| Hooks | `hooks` in `settings.json` | No, read-only | No |
| Hook Scripts | Files in the `hooks/` folder, including subfolders, such as `.claude/hooks/` in a repo | Yes, as code | No |
| MCP servers | `mcpServers` in `~/.claude.json` for the global harness, and in `.mcp.json` for a repo. Also the list from `claude mcp list`. | Switch and delete | No |
| Plugins | `enabledPlugins` in `settings.json` | Switch only | No |
| Settings | `settings.json` and `settings.local.json` | Yes, as JSON | No |

## Read-only and switch-only kinds

Hooks show their JSON in the detail view. Click **Open in editor** to change them in the file. Hook Scripts open as code, like workflows, and you edit the text in the detail view. Hook scripts can be copies too; see [Duplicates](duplicates.md). Settings files are edited as JSON in the detail view; see [Settings](settings.md).

MCP servers and plugins have a switch in their detail view. The switch changes which folders use the item, or whether the plugin is enabled. It does not change the server or plugin itself. A server stored in a file can also be deleted from its detail view. See [MCP switches](mcp-toggles.md) and [Plugins](plugins.md).

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="../README.md#features">← Back to Features</a></td>
<td align="center"><a href="#harness-kinds">↑ Back to top</a></td>
<td align="right"><a href="editing.md">→ Next: Editing</a></td>
</tr>
</table>
