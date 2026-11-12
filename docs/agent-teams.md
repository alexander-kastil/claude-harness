# Agent teams

When a session ran an agent team, the session page shows a **Team** view: who the teammates were, the team's task list and the messages between the lead and the teammates. The view only reads. It changes nothing in the session or in your files.

## Where to open it

Open a session that had teammates. In the session page, the **How the work ran** toggle bar has a **Team** view. The view appears only for sessions that had at least one teammate, so other sessions do not show it.

## What you see

The view has three sections, each with a count badge.

**Teammates** is the roster. One row per teammate:

| Column | Meaning |
| --- | --- |
| Name | The teammate's name, with its colour dot |
| Agent type | The kind of agent it was spawned as |
| Color | The colour Claude Code gave it when it was spawned |
| Model | The model it ran on |
| Tokens | Input, cache writes and output tokens it used |
| Run time | From its start to its end |
| State | Its end state, as a tag |

**Tasks** is the team's task list: the task number, its subject, its owner and its status. A status is one of **pending** (not started), **in progress** (a teammate is working on it) or **completed**. When the session has no task list, the section says so.

**Messages** lists the messages between the lead and the teammates, oldest first. Each row shows the time, who sent it and to whom, and the message. A summary, when the message has one, is shown in bold before the text. Long messages are cut short on screen; hover the text to read the full message. Messages that Claude Code sends as internal protocol, such as idle notices, are left out.

## Where the data comes from

The view reads the session's transcript, the record Claude Code keeps of the session. Claude Code also keeps the team's task and inbox files while the session is alive. When those files still exist, the task list comes from them; otherwise the view rebuilds the list from the transcript. The page reads the files again when you open the view, so what you see is the team as it stands on disk.

## What you can do

Read the roster, the tasks and the messages. There is no button in this view that writes anything. To continue the session, use **Continue** or **Remote** on the session page.
