# Bulk-edit guard

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="duplicates.md">← Back to Duplicates</a></td>
<td align="center"></td>
<td align="right"><a href="fleet-overview.md">→ Next: GitHub Repo overview</a></td>
</tr>
</table>

Two commands can change several repos at once: [Retire Clean Copies](duplicates.md#retire-clean-copies) and [Rename Marketplace](marketplace-health.md#rename-a-directory-marketplace). Before either writes, a pick list shows every repo involved. The guard unticks the repos that may not be safe to change now. Provider commands that change several repos use the guard too, and they appear when a harness standard provider plugin is installed.

## When the list appears

- If only one repo is involved and it is clean, no list appears.
- Otherwise the list shows each repo with its reasons. Clean repos are ticked. Repos with a reason are unticked.

## Reasons

| Reason | What it means |
| --- | --- |
| Uncommitted harness files | `git status` reports changes in `CLAUDE.md`, `CLAUDE.local.md` or `.claude`. The check is read-only. |
| Claude session active | A Claude Code session in the repo was active in the last 10 minutes. |
| Stale worktree copies | `.claude/worktrees` holds copies. |

To change a repo that has a reason, tick it. It is then included.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="duplicates.md">← Back to Duplicates</a></td>
<td align="center"><a href="#bulk-edit-guard">↑ Back to top</a></td>
<td align="right"><a href="fleet-overview.md">→ Next: GitHub Repo overview</a></td>
</tr>
</table>
