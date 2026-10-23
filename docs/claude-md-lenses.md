# CLAUDE.md lenses

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="repositories.md">← Back to Repositories</a></td>
<td align="center"></td>
<td align="right"><a href="effective-harness.md">→ Next: Effective harness</a></td>
</tr>
</table>

Claude Harness adds CodeLens lines and quick fixes to a repo's root `CLAUDE.md` and to its `.claude/rules/*.md` files. Each line names a problem and offers a fix. Provider features appear when a harness standard provider plugin is installed, and they add lenses for restated rules, boilerplate headings and dead paths in `CLAUDE.md`.

![CLAUDE.md with an Agent not found lens above a line that names a missing agent](images/claude-md-lenses.png)

## Dead pointers

A pointer is a path, skill or agent named in backticks. A pointer that does not exist on disk shows a lens:

- `Path not found: db/deltas/: Repoint... | Drop line` for a path in a rules file
- `Pointer not found: db/deltas/: Repoint... | Drop line` for a pointer that the harness check reports
- `Skill ... not found: Repoint... | Drop line` for a skill
- `Agent not found: weather-reviewer: Repoint... | Drop line` for an agent

Skills and agents in `CLAUDE.md`, and every pointer in a rules file, are checked by Claude Harness. Skills of plugins from directory marketplaces count as existing.

**Repoint...** opens a list of the closest existing names or paths, and **Type a value...** at the end of the list. Choose one to replace the name in backticks. **Drop line** deletes the line.

## Quick fixes

Put the cursor on a flagged line and open the lightbulb. The menu offers:

| Problem | Quick fixes |
| --- | --- |
| Dead path, skill or agent | **Repoint to** each close name, and **Drop line** |

The lenses refresh when you save the file.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="repositories.md">← Back to Repositories</a></td>
<td align="center"><a href="#claudemd-lenses">↑ Back to top</a></td>
<td align="right"><a href="effective-harness.md">→ Next: Effective harness</a></td>
</tr>
</table>
