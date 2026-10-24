# Configure Tools

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="marketplace-health.md">← Back to Marketplace health</a></td>
<td align="center"></td>
<td align="right"><a href="mcp-servers.md">→ Next: MCP servers</a></td>
</tr>
</table>

Agents, skills and commands list the tools they may use in their frontmatter. The fields are `tools`, `disallowedTools` and `allowed-tools`. Configure Tools opens a picker, so you select tool names without typing them.

## Open the picker

| Where | How |
| --- | --- |
| Detail view | Click **Configure Tools...** under a tools field. The field fills with your picks. Click **Save** to write them to the file. |
| Editor | Open the item's file. Above each tools line in the frontmatter, click **Configure Tools...**. The link appears when the file starts with `---`, in agent files as well as skill and command files. |

## Pick tools

The picker groups the tools in three parts:

- **Built-in tools** lists the built-in tools, such as Read, Write, Edit, Bash, Glob, Grep, WebFetch and WebSearch.
- **MCP Server: name** has one group for each MCP server in the global list, and for each server in the item's repo. Each group has an **all tools** entry, which is written as `mcp__<server>__*`. A single MCP tool appears only when a harness file already uses it.
- **Other** lists tool names that are used in harness files but are neither built-in nor MCP tools.

The first row is a heading, **Built-in tools**, that says where the MCP server groups are; it is not a tool, and you can type `mcp__` to show only the server groups. Select the tools you want and confirm.

## How the list is saved

- In the editor, a field written as a YAML list stays a list, in the same block or flow style it had.
- In the editor, the tools you keep stay in their order, and new picks go at the end.
- In the editor, a field written as a comma-separated string stays one, with the picks joined by commas.
- The detail view fills the field with the picks as one comma-separated value.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="marketplace-health.md">← Back to Marketplace health</a></td>
<td align="center"><a href="#configure-tools">↑ Back to top</a></td>
<td align="right"><a href="mcp-servers.md">→ Next: MCP servers</a></td>
</tr>
</table>
