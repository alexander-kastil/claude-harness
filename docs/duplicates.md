# Duplicates

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="effective-harness.md">← Back to Effective harness</a></td>
<td align="center"></td>
<td align="right"><a href="fix-settings.md">→ Next: Fix settings and hooks</a></td>
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

A copy shows in the sidebar and tree as **also in Global (identical)**, or with the state of the copy, for example **also in docs-kit (differs)**. **Compare with Copy...** on the tree's right-click menu opens the two files in the diff editor.

## Retire a copy

**Retire Copy** is the archive button in the toolbar of a repo skill or agent. It is offered only when a global or plugin copy is identical. Retiring does this:

1. Copies the file or skill folder to `~/.claude/repo-sync-backups/<yyyymmdd-hhmmss>/<repo>/<path>`.
2. Deletes it from the repo.

A confirmation shows the identical copy, the backup path and the file that goes. Nothing else changes.

![Repo skill marked as also in Global (identical), with the Retire button in the toolbar](images/retire-copy.png)

Retire is not offered in these cases:

- A class repo, which has `demos/` and `labs/` folders at its root. A class repo keeps its copies.
- A repo whose `CLAUDE.md` says that copies are kept.

## Retire clean copies

**Retire Clean Copies...** lists every repo copy that has an identical global or plugin copy, all ticked. Clear the ones to keep, then confirm. Each copy is backed up to one timestamped folder first. The [bulk-edit guard](bulk-edits.md) can leave out repos with uncommitted harness files, busy sessions or stale worktree copies.

The **Delete** command still moves an item to the trash, as before. Retire does not use the trash.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="effective-harness.md">← Back to Effective harness</a></td>
<td align="center"><a href="#duplicates">↑ Back to top</a></td>
<td align="right"><a href="fix-settings.md">→ Next: Fix settings and hooks</a></td>
</tr>
</table>
