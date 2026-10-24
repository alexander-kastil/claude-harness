# Editing

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="harness-kinds.md">← Back to Harness kinds</a></td>
<td align="center"></td>
<td align="right"><a href="repositories.md">→ Next: Repositories</a></td>
</tr>
</table>

Select an item in the sidebar to open its detail view. You can change its frontmatter fields and its instructions, then save the change to the file. Opening another item, or creating a new one, shows it in View mode. The header shows the kind chip, the name and the source chip (the repo, the plugin or Global) on one line, and the whole file path below it. A long path wraps after a folder separator and keeps the file name last. A command bar under the path has the buttons to open the file, ask Claude, rename, duplicate and delete it.

## Command bar

The commands of an item page sit in the bar under its path, as buttons with an icon and a label. Each group is in its own box, and a button that does not apply to the kind is left out:

| Group | Buttons |
| --- | --- |
| Page | **Back**, **View**, **Edit** |
| File | **Open in editor**, **Reveal** |
| Claude | **Review with Claude**, **Slim with Claude**, **Try it** |
| Item | **Rename**, **Duplicate**, **Retire**, **Consolidate**, **Delete** (**Uninstall** on a plugin) |
| Draft | **Revert**, **Save**. Shown in Edit mode and while there are unsaved changes. |

Every button that starts Claude shows the Claude icon. When the page is narrower than 760 px, the buttons shrink to their icons and the hover card of each says what it does.

![The command bar of a skill page](images/command-bar.png)

## Edit an item

Pressing **View** with unsaved changes shows the same **Save changes** card as switching to another item: **Save** writes them and shows the page, **Don't Save** drops them, **Cancel** stays in Edit mode. **Revert** asks too: a **Discard your changes?** card with **Cancel** and **Discard**, without a **Don't ask again** switch.

What a plugin ships is read-only: its page has no **View**, **Edit**, **Rename**, **Duplicate** or **Delete**, and the extension refuses a change that arrives another way, with a message that the item is read-only because an update overwrites the installed copy.

Markdown items (memory, rules, agents, skills, commands and output styles) show their frontmatter as fields above the instructions. Workflows open as code, and you edit the text directly.

- Change a field in its box. A boolean field is a checkbox.
- To add a field, type its name in **field name** and click **Add field**. The box suggests the fields that kind usually has.
- To remove a field, click its close button.
- For a tools field, click **Configure Tools...** below it. See [Configure Tools](configure-tools.md).
- An agent has a **color** row in edit mode. **None** removes the color field. The eight swatches are the colors your agents already use, most used first, then Claude Code's own colors (red, blue, green, yellow, purple, orange, pink and cyan) until there are eight. For any other color, type a hex code (`#rgb` or `#rrggbb`) in the code box. The picked color is written when you click **Save**. A color that an agent already uses, a hex code or a CSS color name, is drawn as itself in the tables, the session lanes and the detail page.

## Save or revert

| Action | How |
| --- | --- |
| Save | Click **Save**, or press Ctrl+S (Cmd+S on macOS). The button is enabled only when there are unsaved changes. Any save, including **Save** on the unsaved-changes card, returns the page to View mode. |
| Revert | Click **Revert** to discard the changes since the last save. A card asks first. |
| Switch to another item | A **Save changes** card with the item's name appears under the button you pressed, with **Save**, **Don't Save** and **Cancel**. **Cancel**, or Esc, stays on the current item. When you start the switch from a tree menu in the activity bar, the question is a VS Code dialog instead. |

![Save changes card](images/save-card.png)

After a save, the status bar shows "Saved" with the item name. If the file cannot be written, an error names the item.

## Open files

- **Open in editor** opens the item's file in VS Code. It is on every item.
- **Reveal** opens the file's folder in Windows File Explorer. In the activity bar menu it is **Reveal in File Explorer**.
- For a skill, the **Files** list shows the other files in its folder. Click one to open it. The **Files** tile counts them and its line reads, for example, `SKILL.md · 3 references · 1 script`.

## Create, rename, duplicate and delete

To create an item, click **New...** in the sidebar, or the plus icon on a section, or **Claude Harness: New...** in the command palette. You can also click **New in** a repo to create an item in that repo. If Claude Harness does not know the kind yet, it asks for it. It then asks for the name and opens the new file.

Rules, agents, skills, commands, output styles and workflows can be created. Names use lowercase letters, digits, dots, dashes and underscores. A name starts with a letter or a digit. Commands also accept colons, which become subfolders. A name that is already taken shows an error.

| Action | Applies to | What it does |
| --- | --- | --- |
| Rename | Agents, skills, commands, output styles, rules and workflows | Moves the file or skill folder to the new name. It also updates the `name` field, except for output styles. |
| Duplicate | The same kinds as rename | Copies the file or skill folder under a new name. The default name is the original name with `-copy`. |
| Delete | The same kinds as rename | Asks you to confirm, then moves the file or skill folder to the trash. |

The confirmation for delete, and for deleting an MCP server, uninstalling a plugin and retiring a copy, is a card under the button on the item page. These cards have no **Don't ask again**, and they start with **Cancel** selected. From a tree menu in the activity bar the question is a VS Code dialog.

![Confirmation card for retiring a copy](images/confirm-card.png)

## Ask Claude about an item

Three buttons in the item's command bar open a new Claude in a terminal:

| Button | Kinds | What it does |
| --- | --- | --- |
| **Review with Claude** | Skills, agents, commands, rules, output styles | Claude reads the file and says what to improve. It changes nothing until you agree. A card says what happens first, and a switch on it remembers the answer. |
| **Slim with Claude** | Skills, when something is flagged on the Size card or the References tab | Claude gets the skill's files and what is flagged, and says what to move and cut. See [Skill size](#skill-size). |
| **Try it** | Agents, skills, commands | Starts Claude as the agent (`claude --agent <name>`), or runs the skill or command (`claude "/name"`). A card says what happens first. |

The run counts against your plan. On every card that starts Claude, the **Don't ask again** switch starts off, so a question is skipped only after you turn the switch on.

## Skill size

A skill page measures what the skill costs in context, against Anthropic's public guidance for skills.

- A **Size** card on the Instructions tab appears when something is flagged. It flags a long description (over 200 tokens, or past 1024 characters) and a SKILL.md that is too long (over 500 lines or 5000 tokens). Once the usage index is built, it weights the flag by use: the description is paid in every session, SKILL.md only when the skill runs, and a SKILL.md that never ran is shown quiet. For a long SKILL.md it lists the largest `##` sections, each of which opens SKILL.md at its line.
- The **References** tab shows a token bar for each markdown file beside SKILL.md, largest first. Flags: **Giant** (over 5000 tokens), **Tiny** (under 150), **Not linked** (nothing points to it, so Claude never reads it) and **Two levels deep** (only another reference links to it).
- The **Skills** type page has **Desc** and **Cost** columns. Cost is the description tokens times the indexed sessions, and needs the usage index; see [Used column on the type pages](sessions.md#used-column-on-the-type-pages). Two presets, **Ranked by description cost** and **Long description**, sort and filter by them.
- **Slim with Claude** shows while anything is flagged.

![Size card of a skill with a long description and a long SKILL.md](images/skill-size.png)

![References tab with a token bar for each file and its flags](images/skill-references.png)

![Skills page with the Desc and Cost columns and the new presets](images/skills-page.png)

Rename, duplicate and delete are in the detail view and in the right-click menu of the activity bar view.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="harness-kinds.md">← Back to Harness kinds</a></td>
<td align="center"><a href="#editing">↑ Back to top</a></td>
<td align="right"><a href="repositories.md">→ Next: Repositories</a></td>
</tr>
</table>
