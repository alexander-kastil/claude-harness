# Sessions

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="repositories.md">← Back to Repositories</a></td>
<td align="center"></td>
<td align="right"><a href="../README.md#features">↑ Back to Features</a></td>
</tr>
</table>

Claude Harness lists the Claude Code sessions that ran in each repo. A session page shows what the run cost, which agents it started and how the work was delegated. Open a session from the activity bar, the main window or a repo page.

| Section | Description |
| --- | --- |
| [Sessions in the tree](#sessions-in-the-tree) | The session rows under each repo in the activity bar |
| [Sessions page](#sessions-page) | The search box, its suggestions, filters and chips |
| [Several accounts](#several-accounts) | Sessions of more than one Claude config folder |
| [Session page](#session-page) | The header, the cost, the four KPIs and the agent details |
| [Delegation views](#delegation-views) | The six views of how the work was delegated |
| [Used in](#used-in) | The sessions that launched an agent or used a skill |
| [Hover cards](#hover-cards) | The cards for agents, the main thread and repos |

## Sessions in the tree

Each repo in the activity bar expands to its sessions, newest first. A session row shows its first prompt, its date, its duration, its agent count and whether it is running now. Headless `claude -p` runs started from a session's scratchpad folder appear under that session.

Click a session row to open its session page. The **Open Session** command runs from these rows. See [Commands](commands.md).

The **Sessions** node has an import button. It adds a Claude Code transcript (a `.jsonl` file) to that repo's account, so the session can be resumed there with `claude --resume`.

## Sessions page

An open repo in the main window shows a **Sessions** node first, above **Memory**, with its count. Click the search icon to open the Sessions page. Click the row, or its chevron, to fold or unfold the 10 newest sessions inline, with **Show all**. The repo page's **Sessions** tab lists its sessions the same way, with the 10 newest and **Show all**. See [Main window](main-window.md#sidebar) and [Repositories](repositories.md#repository-page).

The Sessions page has one search box. Suggestions appear when you focus it, and they narrow as you type:

| Suggestion | Narrows to |
| --- | --- |
| Running now | Sessions that are running |
| Started today | Sessions that started today |
| With agents | Sessions that started at least one agent |
| With headless runs | Sessions that have headless `claude -p` runs |
| `Agent: <type>` | Sessions with an agent of that type |
| `Branch: <name>` | Sessions on that branch |
| Matching sessions | Sessions whose title matches what you typed. Choose one to open it. |

A chosen filter becomes a chip. Press Backspace in an empty box to remove the last chip. Press Esc to clear the text and all chips. Matches are highlighted in the results.

![Sessions page with the search box and its suggestions](images/sessions-search.png)

## Several accounts

When `claudeHarness.accounts` lists more than one Claude config folder, the sessions of every account are listed together, newest first, and each session shows the label of its account before its date. The session header shows it too, and the **Billing** switch of the cost row starts on the plan set for that account. See [Settings](settings.md#several-accounts) for the setting. With one account, nothing is labeled.

### Last 7 days

The top of the sessions page sums what each account used in the last 7 days, or since the last reset of its weekly limit when `weekStart` is set for it (see [Settings](settings.md#several-accounts)); the heading then reads **Since** and the date, over all its repos and including the agents' transcripts. One block per account shows the tokens and, per model, the tokens, the cost at Anthropic API list prices and the number of replies, costliest model first. A reply that appears in more than one transcript, as after a resumed session, counts once. When the account has a plan, the cost is shown as a share of that plan's weekly limit, marked `*`, and each model row reads for example `67.5% of limit`; without a plan the rows show dollars. A plan can also carry the limit of one model family: Team Premium and Team Standard have a Fable limit of their own (about $215 and $43), and an extra line shows the Fable cost as a share of it. The Fable figures come from the same single measurement as Team Premium, so they are estimates too: Anthropic publishes no figure for it, so the limit is an estimate. Team plans expose no rate limits to Claude Code's status line, so their share cannot be checked against it. The refresh button reads the week again.

## Session page

The header shows the repo, the start and end, the duration, the branch and the model. Its export button saves the transcript as a JSONL file. Below it, the cost row shows an estimated cost at Anthropic API list prices. A Claude subscription bills differently. Two bars split the cost by **Who spent it** (the main thread and each agent type) and by **Spent on** (cache reads, cache writes, output and input).

The **Billing** switch in the cost row shows the same cost as a share of one weekly limit of your plan: Pro, Max 5x, Max 20x, Team Standard, Team Premium, or API billing for dollars. Anthropic publishes no figure for a weekly limit, so the limits are estimates, marked with `*`. Max 5x and Max 20x come from third-party measurements. Team Premium (about $1,010 a week) was measured against the Claude app's usage card on one Team Premium seat on 2026-10-22: one sample, still an estimate. Pro and Team Standard are derived as one fifth of Max 5x and of Team Premium, following the plan prices. Team plans expose no rate limits to Claude Code's status line, so the share cannot be read from there.
Four KPIs follow the cost row:

| KPI | Shows |
| --- | --- |
| Agents | The agent count, with the count of failed or without-report agents |
| Peak parallel | The most agents that ran at the same time |
| Delegated | The share of the cost that ran in agents |
| Cache hits | The share of input tokens read from cache |

![Session page with the cost row, the four KPIs and the Timeline view](images/session-overview.png)

Below the KPIs, the **Delegation** section shows how the work was split. Then come the agent details, the findings and, when there are any, the headless runs. Click a lane or a node in the delegation views to see that agent's brief, report, tools and tokens.

## Delegation views

The Delegation section has six views behind one toggle bar. Each toggle shows a short hover. A legend under the diagram explains its marks.

| View | Shows |
| --- | --- |
| Timeline | A lane per agent, next to your prompts. A red circle with a white x marks a stopped agent. |
| Delegation map | Who started which agent. Its **Sum** and **Full timeline** modes are described below. |
| Decisions | What happened after each prompt: delegated, worked itself, followed up an agent, or answered. Its **Sum** and **Full timeline** modes are described below. |
| Concurrency | The agents that ran at the same time. Each agent run is one bar in its own lane, so the height is the number of agents running, and the peak is marked. |
| Token flow | The tokens from the session, through the main thread and each agent type, to the outcome. |
| Scatter | Each agent by run time and tokens. Dot area is the agent's cost, and the costliest dots are drawn first so smaller ones stay visible. Dashed lines are medians. Both scales are logarithmic. |

Lane colors come from the agent definition's own color field, or from the color a teammate was given. A color can be one of the eight names, a hex code or a CSS color name, and each is drawn as itself. A type without its own color takes a palette hue that no named type uses, for as long as one is left. Types that share a hue get a lighter and a deeper shade of it.

### Delegation map

The map shows who started each agent. Use it to follow a chain of agents back to the main thread. Two buttons above the diagram switch its mode. Each button shows a short hover. Three more buttons sit beside them: **Prompts**, **Mods** and **Analyze**.

| Mode | Shows |
| --- | --- |
| Sum | Agents summed up by type under whoever started them. Click a type to drill down to its runs. |
| Full timeline | Your prompts as a process from top to bottom. Each delegation branches into the agents it started, and their reports join the main thread again. A team that ran together forks at a parallel gateway beside its prompt. |

The Full timeline opens by default. Every row, a type or a run, shows the same four facts in fixed right-aligned columns: the model (the runs for a type), the run time, the tool uses and the messages. A value of zero or `-` still shows.

The three toggles beside the mode buttons work in the Full timeline:

| Toggle | Shows | Starts |
| --- | --- | --- |
| Prompts | Each prompt as its own box on the main thread, above the step it started. Its first line shows inside the box, and the whole prompt is in its hover card. | Off |
| Mods | The events of every mod, one chip beside each step and on each agent connector the events concern. Click the toggle to switch all mods off or on together. | On. It appears only when a mod has events for the session. |
| Analyze | Opens a new Claude in a terminal with a copy of this session, to ask about it in a chat. The first use shows a card, which says what happens. A switch on the card remembers the answer, so the card is skipped from then on. The original session stays untouched. | Always, on a session page |

Analyze runs `claude --resume <session-id> --fork-session` in the folder the session ran in, so the copy starts with the session's history. The first message tells the copy where the agents' transcripts are, so it can read the work inside an agent when you ask about it. The copy is a separate session, so it counts against your plan when Claude first answers.

### Mod events

A mod can log what its hooks did in each session. The Mods toggle shows those events on the steps and agents they concern. A mod needs no manifest for this: its hook traces in the transcript already appear under the Mods toggle. A manifest adds a log with more detail.

A plugin adds its log by shipping `.claude-plugin/harness-events.json` in its plugin folder:

```json
{
  "label": "My mod",
  "events": "{sessionDir}/my-mod-events.jsonl"
}
```

| Manifest field | Required | Meaning |
| --- | --- | --- |
| `label` | Yes | The name of the mod's layer. It names the chips and the group on the Mods toggle. |
| `events` | Yes | The path of the session's log, as a template. The placeholders are `{sessionDir}` (the transcript path without `.jsonl`), `{sessionId}` and `{home}` (your home folder). Use forward slashes. A relative result resolves against the plugin folder. |

Both fields must be non-empty strings. Without both, the plugin adds no layer. A session has a layer only when its log exists and holds at least one event.

The log holds one JSON object per line:

```json
{"at":"2026-10-23T09:14:02Z","hook":"PreToolUse","text":"Blocked an edit to a generated file.","label":"guard","tone":"warn","agentId":"a1b2c3","detail":"generated/schema.ts is written by the build."}
```

| Log field | Required | Meaning |
| --- | --- | --- |
| `at` | Yes | When the hook decided, as an ISO 8601 time in UTC. It must parse as a date. |
| `hook` | Yes | The hook that acted, as text. |
| `text` | Yes | One plain sentence: what the plugin did. |
| `label` | No | A short chip label. Events without one show only in the hover card. |
| `tone` | No | `act` (the default), `warn` or `quiet`. A `quiet` event does not add its label to the chip. |
| `agentId` | No | The subagent the event concerns. The event shows on that agent's row. Other events show on the prompt whose time window holds them. |
| `detail` | No | Verbatim text the plugin injected or answered with. The hover card shows it in full. |

Lines that are not JSON, or lack `at`, `hook` or `text`, are skipped. Other fields are dropped. The events are shown in time order.

Without a manifest, the Mods toggle shows the hook traces of the transcript: what a hook added as context, wrote as output, showed as a message, blocked or failed, and each tool call that a hook denied. A trace is grouped under the `<name>: ` that its text opens with, where the name is lowercase, such as `my-mod: `. When that name is a plugin with a manifest, the trace joins the manifest's `label`. A trace with no such prefix goes under **Hooks**. A trace whose text a log already holds is shown once.

![Delegation map view](images/session-map.png)

### Decisions

The Decisions view shows what the main thread did after each of your prompts. Two buttons above the diagram switch its mode. Each button shows a short hover.

| Mode | Shows |
| --- | --- |
| Sum | Your prompts summed up by what the main thread did, which agent or team it used, and how that ended. |
| Full timeline | Every prompt in order, with what the main thread did, the agent it launched or its team, and each team member. This is the default. |

Click a node with a `▸` to open it and see what is below it. Click a node with a `▾` to fold it again. The Sum mode opens its first three levels, and the Full timeline opens every level.

![Decisions view](images/session-decisions.png)

### Token flow

The Token flow view traces the tokens from the session to the outcome.

![Token flow view](images/session-flow.png)

## Used in

On an agent or skill page, the **Used in** tab lists the sessions that used the element, newest first. Its count is the number of sessions.

| Column | Shows |
| --- | --- |
| Last used | When the element was last used in that session |
| Repo | The repo the session ran in |
| Session | The session's first prompt. Click it to open the session page, when a repo in the harness holds the session. |
| Launches or Uses | Agent launches, on an agent page. Skill calls and typed slash commands, on a skill page. |

Opening the tab reads the Claude Code transcripts of every account, with the transcripts of their agents beside them, and keeps an index in the extension's global storage. The first open builds the index and shows its progress, such as `Indexing 120 of 800 transcripts`. Later opens read only the transcripts that changed. The transcripts are never changed.

An agent counts each launch by the agent type it named, and a launch without a type counts as `general-purpose`. A plugin's element counts under the name its transcripts use, `plugin-name:element`. A headless run started from a session's scratchpad counts under the repo of that session.

A global agent or skill leaves out the sessions of any repo that has its own copy of it. A repo's copy of a global element counts only the sessions run in that repo.

## Hover cards

Hover an agent lane to see its card. It shows the agent type and teammate name, the status, the description, the model, the run time, the tool uses, the tokens in and out, and the cache reads with a bar. It also shows 3 lines of the prompt and 6 lines of what it did, which is the agent's report. A fork lane adds a note on what a fork is.

The card on the **Main thread** lane shows the model, the run time, the prompt count, the tool uses, the file edits, the agents started, the tokens, the top tools and the estimated cost.

![Hover card on an agent lane](images/session-agent-hover.png)

Hovering a repo row in the main window sidebar shows a card with the repo path, its check status (with a harness standard provider), its harness item counts, its session and agent totals, and the first prompt of its latest session.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="repositories.md">← Back to Repositories</a></td>
<td align="center"><a href="#sessions">↑ Back to top</a></td>
<td align="right"><a href="../README.md#features">↑ Back to Features</a></td>
</tr>
</table>
