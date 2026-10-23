# Editing

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="harness-kinds.md">← Back to Harness kinds</a></td>
<td align="center"></td>
<td align="right"><a href="repositories.md">→ Next: Repositories</a></td>
</tr>
</table>

Select an item in the sidebar to open its detail view. You can change its frontmatter fields and its instructions, then save the change to the file. The same view has buttons to open the file, rename, duplicate and delete it.

## Edit an item

Markdown items (memory, rules, agents, skills, commands and output styles) show their frontmatter as fields above the instructions. Workflows open as code, and you edit the text directly.

- Change a field in its box. A boolean field is a checkbox.
- To add a field, type its name in **field name** and click **Add field**. The box suggests the fields that kind usually has.
- To remove a field, click its close button.
- For a tools field, click **Configure Tools...** below it. See [Configure Tools](configure-tools.md).
- An agent has a **color** row in edit mode. **None** removes the color field. The eight swatches are the colors your agents already use, most used first, then Claude Code's own colors (red, blue, green, yellow, purple, orange, pink and cyan) until there are eight. For any other color, type a hex code (`#rgb` or `#rrggbb`) in the code box. The picked color is written when you click **Save**. A color that an agent already uses, a hex code or a CSS color name, is drawn as itself in the tables, the session lanes and the detail page.

## Save or revert

| Action | How |
| --- | --- |
| Save | Click **Save**, or press Ctrl+S (Cmd+S on macOS). The button is enabled only when there are unsaved changes. |
| Revert | Click **Revert** to discard the changes since the last save. |
| Switch to another item | Claude Harness asks whether to save. Choose **Save** or **Don't Save**. Close the prompt to stay on the current item. |

After a save, the status bar shows "Saved" with the item name. If the file cannot be written, an error names the item.

## Open files

- **Open in editor** opens the item's file in VS Code. It is on every item.
- **Reveal in File Explorer** opens the file's folder in Windows File Explorer.
- For a skill, the **Files** list shows the other files in its folder. Click one to open it.

## Create, rename, duplicate and delete

To create an item, click **New** in the sidebar, or the plus icon on a section, or **Claude Harness: New...** in the command palette. You can also click **New in** a repo to create an item in that repo. If Claude Harness does not know the kind yet, it asks for it. It then asks for the name and opens the new file.

Rules, agents, skills, commands, output styles and workflows can be created. Names use lowercase letters, digits, dots, dashes and underscores. A name starts with a letter or a digit. Commands also accept colons, which become subfolders. A name that is already taken shows an error.

| Action | Applies to | What it does |
| --- | --- | --- |
| Rename | Agents, skills, commands, output styles, rules and workflows | Moves the file or skill folder to the new name. It also updates the `name` field, except for output styles. |
| Duplicate | The same kinds as rename | Copies the file or skill folder under a new name. The default name is the original name with `-copy`. |
| Delete | The same kinds as rename | Asks you to confirm, then moves the file or skill folder to the trash. |

Rename, duplicate and delete are in the detail view and in the right-click menu of the activity bar view.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="harness-kinds.md">← Back to Harness kinds</a></td>
<td align="center"><a href="#editing">↑ Back to top</a></td>
<td align="right"><a href="repositories.md">→ Next: Repositories</a></td>
</tr>
</table>
