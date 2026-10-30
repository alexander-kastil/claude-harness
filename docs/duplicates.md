# Duplicates

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="effective-harness.md">← Back to Effective harness</a></td>
<td align="center"></td>
<td align="right"><a href="bulk-edits.md">→ Next: Bulk-edit guard</a></td>
</tr>
</table>

Claude Harness finds copies of the same item in different scopes. A copy can be a rule, agent, skill, command, output style, workflow or hook script. It can sit in the global harness, in a repo, or in a plugin or directory marketplace. You can compare a copy with the original, and retire a repo copy that is identical to a global or plugin copy.

## What counts as a copy

Items with the same name are compared across all scopes. Each copy reads one of three states:

| State | Meaning |
| --- | --- |
| identical | The same file content. Line endings do not count. |
| nearly identical | Only whitespace or version lines differ. |
| differs | The content is different. |

The hover card of an item in the activity bar tree ends with the copies, for example **also in Global (identical)** or **also in docs-kit (differs)**. In the main window, the page of a repo skill or agent offers **Retire** when an identical copy exists and **Sync from Global** when the Global copy differs, and the **Copies** tile of the repo page counts the copies. **Compare with Copy...** on the tree's right-click menu opens the two files in the diff editor.

## Retire a copy

**Retire Copy** is the **Retire** button in the command bar of a repo skill or agent. It is offered only when a global or plugin copy is identical. Retiring does this:

1. Copies the file or skill folder to `repo-sync-backups/<yyyymmdd-hhmmss>/<repo>/<path>` in the global harness folder: `~/.claude`, or the folder set by `claudeHarness.root`.
2. Deletes it from the repo.

A confirmation card under the button shows the identical copy, the backup path and the file that goes. Started from a tree menu, it is a VS Code dialog. When the repo has uncommitted harness files, a busy Claude session or stale worktree copies, the confirmation also names them under **Careful**. Nothing else changes.

![Repo skill with an identical Global copy, with the Retire button in the command bar](images/retire-copy.png)

Retire is offered in every repo. A harness standard provider plugin can mark repos that keep their copies, and Retire is then hidden there.

## Consolidate

**Consolidate** moves a repo skill up to the place it comes from and retires the repo copy. It is the **Consolidate** button in the command bar of a repo skill, and the **Consolidate...** entry in the right-click menu of a repo skill row, in the sidebar and on the Skills type page. The whole skill folder counts, not only SKILL.md.

A card (a VS Code dialog from a menu) reads **Consolidate X into Global**, or into the plugin, and names what is different. When there is more than one target you choose on the card. The target is the source folder of the marketplace plugin that ships the skill, otherwise global.

| The repo copy is | What happens |
| --- | --- |
| Identical, nearly identical, or contained in the target | **Retire repo copy**: it is backed up as in [Retire a copy](#retire-a-copy), then deleted. |
| Different from the target | Merge it first: **Compare in editor** opens the two in the diff editor, the repo copy on the left, or **Consolidate with Claude** opens a terminal where Claude merges them. Then run Consolidate again, which retires it. |
| Only in the repo | **Move to global** moves it up. The move is refused when a skill of that name already exists there. |

The card has no **Don't ask again**, since it deletes the repo copy.

![Consolidate card for a repo skill that global holds unchanged](images/consolidate-card.png)

## Sync

Sync brings one copy in step with another. Each variant asks first, and backs up what it overwrites to `~/.claude/repo-sync-backups`.

| Command | When it is offered | What it does |
| --- | --- | --- |
| **Sync from Global...** | A repo skill or agent whose Global copy differs. Not for a skill linked to Global, which already is the Global version. | Lists the files, then overwrites the repo copy with the Global version. It is the **Sync from Global** button in the command bar of the copy, and in the right-click menu of its row. |
| **Sync** | A skill that has a source on skills.sh or GitHub. | Checks the source and goes on to the update card when it is newer. See [Skill sources](skill-sources.md#check-for-updates). |
| **Sync Plugin from Its Marketplace...** | A plugin whose marketplace source is ahead of the installed copy. | Refreshes the marketplace and updates the plugin. **Sync all** on Marketplace health and **Sync N plugins** on a marketplace's page do it for every plugin that is ahead, after one card. See [Marketplace health](marketplace-health.md#sync-every-plugin-that-is-ahead). |
| **Sync to Other Copies...** | An MCP server configured differently in several files. | Asks which configuration to keep, then writes that entry into the other files. See [MCP servers](mcp-servers.md#share-and-sync). |

## Retire clean copies

**Retire Clean Copies...** lists every repo copy that has an identical global or plugin copy, all ticked. Clear the ones to keep, then confirm. Each copy is backed up to one timestamped folder first. The [bulk-edit guard](bulk-edits.md) can leave out repos with uncommitted harness files, busy sessions or stale worktree copies.

The **Delete** command still moves an item to the trash, as before. Retire does not use the trash.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="effective-harness.md">← Back to Effective harness</a></td>
<td align="center"><a href="#duplicates">↑ Back to top</a></td>
<td align="right"><a href="bulk-edits.md">→ Next: Bulk-edit guard</a></td>
</tr>
</table>
