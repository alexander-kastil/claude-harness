# Routines

The Routines page lists the scheduled work that runs on your behalf: the cloud routines of your claude.ai account, and the scheduled tasks each repository keeps for Claude Code. You can switch a cloud routine on or off, rename it, reschedule it, and edit a repository task's prompt and schedule.

## Open the page

In the sidebar header, press the **Routines** button.

## What you see

One table with a row for each routine and each repository task:

| Column | Meaning |
| --- | --- |
| Name | The routine's name, or the first line of a repository task's prompt |
| Schedule | How often it runs, in words. Cloud routines also show their cron fields and say they are in UTC. |
| Repository | The repository the routine works on |
| Last run | When it last ran, with its status |
| Source | **Cloud** for a routine on claude.ai, **Repo** for a task in a repository |
| State | The routine's status. A repository task shows **Recurring** or **One-off**. |
| On | A switch for a cloud routine. A repository task shows a dash, since Claude Code has no off switch for it. |

Three chips filter the table: **All**, **Cloud** and **Repos**. Each shows its count.

Cloud routines are the Claude Code ones only; Cowork's scheduled tasks are not listed here. Repository tasks come from each repository's `.claude/scheduled_tasks.json`.

Press a row to open it below the table. Press it again to close it.

## Without a claude.ai sign-in

The page still lists the repository tasks. A note above the table says why the cloud routines are missing:

- **Not signed in**: sign in to Claude Code with your claude.ai account.
- **Sign-in expired**: start Claude Code once to renew it.
- **Not accepted** or **not reachable**: claude.ai refused the sign-in or could not be reached.

The **Reload** button in the page header asks again.

## What you can do

- **Cloud routine**: switch it on or off. Open it to change its name or its schedule, in UTC. Its prompt is shown but is edited on claude.ai.
- **Repository task**: open it to change its prompt or its schedule. Claude Code keeps the task in the repository's file. Edit or delete it there to turn it off.

A routine whose status reads **Auto-disabled** has its switch locked. The switch's hover says that Claude Code switched it off; fix the cause on claude.ai first.

## What is asked first

Every change asks on a confirm card before anything is written. The **Save** button stays off until a field differs from the saved value.

- **Switch a cloud routine on or off**: the card says whether it runs on its schedule again or stops until you enable it, and that the change is made on claude.ai. Its prompt and runs stay as they are.
- **Save a cloud routine**: the card lists the changed fields, the name and the schedule, and that the change is made on claude.ai.
- **Save a repository task**: the card lists the changed fields and the file it rewrites. Every other task and field stays as it is. Nothing is committed.

A result line shows for a few seconds after each change: "Saved." or the reason it failed.
