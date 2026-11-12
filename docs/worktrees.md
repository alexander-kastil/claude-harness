# Worktrees

The Worktrees tab lists every git worktree of a repository, with its branch, its changes, the Claude sessions that ran in it, and whether it looks stale. From the tab you can remove a worktree or prune git's records of worktrees whose folder is gone.

## Open the tab

On a repository page, open the **Worktrees** tab.

## What you see

A toolbar with the period chips **7 days**, **30 days** and **90 days**, and the **Prune** button. Below it, one row per worktree:

| Column | Meaning |
| --- | --- |
| Worktree | The folder's name. The hover shows the full path. |
| Branch | The branch checked out. It reads `detached` when HEAD is detached and `bare` for a bare repository. The hover shows the upstream branch. |
| HEAD | The first seven characters of the commit |
| Changes | The number of changed or untracked files, or **Clean** |
| Ahead, Behind | Commits ahead of and behind the upstream branch. A dash when there is no upstream. |
| Sessions | How many Claude sessions ran in that exact folder. The hover lists their titles. |
| State | **Main** for the repository folder, **Stale** with its reasons in the hover, or **Locked** when git locks the worktree |
| Remove | A trash button on each row, except the main folder |

## Stale

A worktree is tagged **Stale** when one of these is true:

- Git reports it prunable, because its folder is gone.
- The upstream branch of its branch is gone.
- No Claude session ran in it within the chosen period.

The period is the 7, 30 or 90 day chip, and 30 days is the default. The hover of the Stale tag lists the reasons that apply. The main folder is never tagged Stale.

## What you can do

- **Remove** a worktree with its row's trash button. This runs `git worktree remove` without `--force`. Git refuses a worktree that has changes or is locked; its refusal shows in the note above the table.
- **Prune** from the toolbar. This runs `git worktree prune`, which deletes only git's records of worktrees whose folder is gone. If there is nothing to prune, the note says so.
- Change the period to see which worktrees are stale for it.

The main folder of the repository has no Remove button and is never removed from here.

## What is asked first

Remove and Prune both ask on a confirm card first.

- **Remove worktree** names the path. It says how many files have changes, which means git refuses until they are committed or discarded; or that the folder is deleted and the branch stays. A locked worktree is named as one git refuses.
- **Prune worktrees** lists the folders git reports as prunable and says only records of missing folders are deleted.

Nothing is removed until you press the card's button. A line above the table then says what happened, or why git refused.
