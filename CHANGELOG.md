# Changelog

All notable changes to Claude Harness are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions with no version change in the package.json history (0.1.3, 0.1.5 to 0.1.18, 0.1.20 to 0.1.24, 0.1.27, 0.2.1 and 0.2.3 to 0.2.11) and development builds (0.2.14 to 0.2.22, 0.2.24 to 0.2.30, 0.2.32 to 0.2.34, 0.2.36 to 0.2.44 and 0.3.0) have no entry.

## [0.3.1] - 2026-10-23

### Added

- Prompts on the Delegation map's Full timeline: each prompt is its own box on the main thread, above the step it started, with its first line inside and the whole prompt, pasted blocks set apart, in its hover card. Off by default. See [Sessions](docs/sessions.md#delegation-map).
- Mods on the Delegation map's Full timeline: one toggle shows what every mod did, as a chip beside each step and on the connector of each agent it concerns, with one section per mod in the hover card. A hook that denied a tool call shows as a stop sign. It reads the hook traces Claude Code writes into the main and subagent transcripts, so it needs nothing installed: a hook whose text opens with `<name>: ` gets its own mod, any other hook output goes under Hooks. On by default, and shown only when the session has hook traces. See [Sessions](docs/sessions.md#mod-events).
- A mod can ship `.claude-plugin/harness-events.json`, pointing to a per-session event log, to put its own events and labels on the map. A transcript trace that the log already holds shows once. See [Sessions](docs/sessions.md#mod-events).
- Analyze on the Delegation map opens a new Claude in a terminal on a copy of the session, in the folder the session ran in, to ask about it in a chat. The original session stays untouched. When the session started agents, the copy is told where their transcripts are. See [Sessions](docs/sessions.md#delegation-map).
- A live session's page reads the transcript again every 5 seconds while it is in sight, repaints only when something changed, and keeps the scroll position.
- A Used in tab on the page of an agent or skill lists the sessions that used it, newest first: when, the repo, the session (a click opens it) and how often it was launched or used. It reads the transcripts of every account, the agents' own included, and keeps an index, so a later visit reads only what was added since. A global agent or skill leaves out the sessions of repos that have their own copy. See [Sessions](docs/sessions.md#used-in).
- Edit mode of an agent always has a color row: eight swatches, first the colors your agents already use, most used first, then Claude Code's own colors; a field for any hex code, where an invalid code is never saved; and None, which removes the `color` field. See [Editing](docs/editing.md#edit-an-item).
- A contributor guide, [CONTRIBUTE.md](CONTRIBUTE.md), walks through forking the repo, a feature branch, syncing with the owner's master, trying the change in VS Code and the pull request, with a Claude Code command for each step (`/ext-contribute-setup`, `/ext-contribute-start`, `/ext-sideload`, `/ext-contribute-sync`, `/ext-contribute-pr`, `/ext-contribute-finish` and `/ext-contribute-cleanup`).

### Changed

- A click on a section header in the sidebar folds or unfolds it, and so does a click on a repo's Sessions row, instead of opening the type page or the sessions page. The type pages open from the tiles of the overview and the repo page, the sessions page from the repo page's Search and filter button.
- The eight named agent colors are fixed values instead of theme colors, so an agent has the same color in every theme. A hex value or CSS color name in an agent's `color` field shows as that color in the tables, the session lanes and on its page.
- The VSIX ships only the files its runtime packages need, so the download is smaller.
- The last 7 days by model moved from the sessions page to a Models tab on the repo page, still over all repos of each account.
- The cost card and the weekly summary say less: a shorter billing description, no asterisks, and no hover cards repeating how the limits were measured.
- Draft output style asks in a card under its button instead of a system dialog, like Analyze, with a Don't ask again switch that remembers the answer.
- A type page opened from a repo starts filtered to Global and that repo, the elements that load there, instead of the repo alone.
- The license is the Claude Harness License 1.0, replacing CC BY-NC-SA 4.0: free for internal use in your company, no redistribution or derived works. See [LICENSE](LICENSE).

## [0.2.35] - 2026-10-22

### Added

- The Billing switch on the session page lists Pro and Team Standard next to Max 5x, Max 20x, Team Premium and API billing. Both new limits are derived estimates, one fifth of Max 5x and of Team Premium. For a Team plan, the weekly summary's hover card notes that Claude Code's status line carries no rate limits for it. See [Sessions](docs/sessions.md#session-page).
- The settings `claudeHarness.plan` and `claudeHarness.accounts` set the plan of each Claude account, and list more config folders (`CLAUDE_CONFIG_DIR`) on one machine. The sessions of every account are listed together, each labeled with its account, and the cost row starts on the account's plan. Default is empty, which changes nothing. See [Settings](docs/settings.md#several-accounts).
- The sessions page opens with the last 7 days of each account: tokens and cost at API list prices per model, over all repos and agents, and the share of the plan's estimated weekly limit when a plan is set. See [Sessions](docs/sessions.md#last-7-days).
- The settings `claudeHarness.weekStart` and a `weekStart` per account (`Mon 11:00`, UTC) align the weekly summary to the plan's reset. It then counts since the last reset and its heading says Since. Empty keeps the rolling 7 days. See [Settings](docs/settings.md#several-accounts).
- Model rows of the weekly summary say `of limit` for the share, and show dollars when no plan is set.
- A plan can carry a limit for one model family. Team Premium and Team Standard get a Fable line, as a share of their own limit (about $215 and $43), estimated from the same single measurement. See [Sessions](docs/sessions.md#last-7-days).
- A Tools tab for skills and commands. Pre-approved lists the `allowed-tools`, which run without a permission prompt while every other tool stays available under your permission settings. Named in SKILL.md (Named in the prompt for a command) lists the tools the instructions name. A skill with `context: fork` also shows the agent it runs in and that agent's tools.
- A References tab for skills: the markdown files beside SKILL.md that Claude reads when the instructions send it there. The Files tab keeps the scripts, templates, assets, examples and evals.

### Changed

- The Team Premium weekly limit is 1010 $ at API list prices, up from 861 $, and Team Standard 202 $. Measured against the Claude app's usage card on one Team Premium seat, 2026-10-22; one sample, still an estimate. See [Sessions](docs/sessions.md#session-page).
- Every page in View mode is laid out like the session page: the summary card and KPI tiles on top, then a tab bar that shows one view at a time. Each tab shows its count, the page remembers the last tab per kind, and switching tabs keeps the scroll position. Edit mode is unchanged.
- The View: picker in a sidebar header is a row of toggle buttons, one per grouping and sort, and the section headers are taller.
- Links is now Connections, split into Refers to and Referred to by.
- A permission rule such as `Bash(git:*)` shows the tool, with what it is limited to in a muted color.
- A command's tools tile is now Pre-approved.
- The session page's cost card no longer shows the explanation under the Billing switch; each plan's hover card says what its share measures.

## [0.2.31] - 2026-10-22

### Added

- Type pages for every kind of harness element. A click on a section in the sidebar, or on a tile of the overview or a repo page, lists every element of that kind in a table instead of opening the first one. The search filters as you type; quick filters with counts (such as Restricted tools, From plugins, Changed this week and Has copies) and field filters (Tool, Model, Color, Source, Plugin, Marketplace, Event, Scope) narrow the list. Typing `tool:` in the search lists the tools to pick from. The scope you came from is a removable filter. The chevron still folds the list in the sidebar.
- Repo page tabs: Overview, Effective harness and Sessions. Overview shows sessions, agents launched, what every session loads, copies, the harness by kind, recently changed elements and the harness standard. Effective harness lists memory with its imports, rules, plugins switched on for user, project and local, and hooks.
- Grouped lists in the sidebar and on the type pages, with a View: picker and collapsible group headers. MCP servers group by origin (Registered manually, claude.ai connectors, From plugins), skills into Own skills, Linked and From plugins, agents into Own agents and From plugins, rules into Always loaded and Path-scoped, hooks by event, plugins by marketplace, and a repo's sessions by day.
- Skills of enabled plugins appear in the global Skills list, read-only, the way plugin agents already do.
- Duplicate MCP servers are flagged, for example a server registered both as a claude.ai connector and in `~/.claude.json`, or by several plugins.
- View mode for detail pages, beside Edit. A summary card shows the description, trigger phrases and example tasks as chips, and the frontmatter in words. Tiles show what the element costs in context: its description in every session and its body when it runs. The body renders as a document with an outline. Side cards show tools grouped by MCP server, preloaded skills, files, what the element mentions and what mentions it.
- Names of skills, agents and commands in a document link to them. Hovering or focusing one shows a card with its origin, description and key numbers; a click opens it and adds a Back button, and Alt+click opens its file. A skill's own files named in the text open in the editor.
- View mode for MCP servers: where it is registered, status, its tools with descriptions and the tokens the tool list costs. View mode for plugins: the skills, agents and MCP servers the plugin adds.
- The harness standard card on the repo page says in plain words what the provider found, lists the findings to fix, to review and to note with links to the file and line, offers the fixes that apply, and shows the provider's standard document.

### Changed

- The MCP Servers sort picker is now View: and starts on source. On the MCP page, Source names the config file, claude.ai or the plugin, and Status is one word with the full text in its hover card.
- A skill row in the sidebar shows facts under its name (plugin, link, version, file count, copies) instead of its description.
- Hover cards in the sidebar stop at a quarter of the window height and fade out where the text is cut. Skill, agent and command cards leave out trigger phrases.
- Sidebar headers line up in columns: every count has the same width, with the buttons to its left.
- With unsaved edits, View mode shows them as a preview; Save and Revert stay available.

## [0.2.23] - 2026-10-21

### Added

- Billing picker on the session page's cost card: Max 5x, Max 20x, Team Premium or API billing. A plan shows the session as a share of its weekly limit, marked with a `*` because the limits are third-party estimates.
- Output style section on the session page: prompts, corrections, interrupts, reply lengths and how many replies used headings, tables or lists. Draft output style asks first, then lets your own Claude Code draft a style for the repo with the model you pick.
- Export a session transcript as JSONL, and import one into a repo so `claude --resume` finds it there.

### Changed

- Every hint in the main window shows as a hover card in the panel's style instead of the browser's tooltip.

## [0.2.13] - 2026-10-21

### Fixed

- The Delegation map fits a narrow panel. Its rows shrink to the panel width instead of showing a horizontal scrollbar that hid the messages column.

## [0.2.12] - 2026-10-21

### Added

- Delegation map has two modes above the diagram, Sum and Full timeline. Sum adds up the agents by type under whoever started them, and a click on a type drills down to its runs. Full timeline reads your prompts from top to bottom, with each delegation branching into the agents it started. Each mode button has a hover tip. See [Sessions](docs/sessions.md#delegation-views).
- Every row of the Delegation map shows the model, run time, tools and messages in the same columns. A type row shows its run count in the model column, with the summed run time, tools and messages of its runs.
- Repositories in the main window sidebar sort by last used, the default, or A-Z, with two buttons in the section header. Repos open in this window come first. See [Main window](docs/main-window.md#sidebar).
- Agents of enabled plugins appear in the global Agents list as read-only copies. See [Plugins](docs/plugins.md).

### Changed

- Lane colors on the session page: a type without its own color takes a palette hue that no named type uses, while one is left. Types that share a hue get a lighter and a deeper shade. See [Sessions](docs/sessions.md#delegation-views).
- The Fleet overview button in the activity bar uses the dashboard icon and sits before Open Claude. See [Fleet overview](docs/fleet-overview.md).
- The Concurrency view draws one bar per agent run, in its agent type's color. See [Sessions](docs/sessions.md#delegation-views).
- The Scatter view sizes each dot by the agent's cost instead of its tool uses. The costliest agent is drawn first, so the smaller dots stay on top. See [Sessions](docs/sessions.md#delegation-views).

## [0.2.2] - 2026-10-20

### Added

- Decisions view on the session page has two modes, Sum and Full timeline, each with a hover tip. Sum lists your prompts summed up: what the main thread did, which agent or team it launched and how it ended. Full timeline lists every prompt in order, with the agent or team each one launched. See [Sessions](docs/sessions.md#decisions).
- Decisions nodes drill down. Click a node with children to open or fold it. Sum opens three levels by default, and Full timeline opens every level.

## [0.2.0] - 2026-10-20

### Added

- Align CLAUDE.md, for a harness standard provider that declares an align prompt. It runs the bulk-edit guard for the repo, then opens a terminal in the repo that runs the prompt.
- Sessions under each repo in the activity bar: every Claude Code session that ran in the repo, newest first, with its first prompt, date, duration, agent count and whether it is running now. Headless `claude -p` runs started from a session's scratchpad folder appear under that session.
- Sessions section on each repo page: the 10 newest sessions, with Show all.
- Session page with a delegation timeline. The main thread lane marks your prompts and when results came back. Each subagent is a bar from start to end, coloured by agent type, with a line from the thread that launched it. Agents launched together are marked ×N. Messages, stops and failures show on the bar. Headless runs are dashed bars. Long idle stretches are shortened to a shaded band. Clicking a lane shows the agent's brief, report, tools, turns and tokens.
- Session page tiles count prompts, agents, peak parallel agents, main-thread tool calls and output tokens.
- Session page findings list failed launches, agents that never reported back, general-purpose agents, messages sent after an agent reported, repeated launches and the main thread's own file edits.
- Open Session command, used by the session rows in the tree.
- Sessions page with one search box. Suggestions show on focus and narrow as you type: Running now, Started today, With agents, With headless runs, Agent: type, Branch: name, and matching sessions. A chosen filter becomes a chip. Backspace on an empty box removes the last chip, and Esc clears the text and all chips. Matches are highlighted in the results. See [Sessions](docs/sessions.md#sessions-page).
- Sessions node in the main window sidebar, above Memory, with its count for an open repo. The chevron expands the 10 newest sessions, with Show all.
- Cost row on the session page, estimated at Anthropic API list prices, with bars for who spent it and what it was spent on. Four KPIs: Agents, Peak parallel, Delegated and Cache hits. See [Sessions](docs/sessions.md#session-page).
- Six delegation views on the session page behind one toggle bar: Timeline, Delegation map, Decisions, Concurrency, Token flow and Scatter. Each toggle has a short hover, and each view has a legend. See [Sessions](docs/sessions.md#delegation-views).
- Hover cards for agent lanes and the main thread lane on the session page, with the agent's type, status, run time, tokens, prompt and report.
- Hover card on a repo row in the main window sidebar, with its path, check status, harness counts, session and agent totals, and the first prompt of its latest session. See [Sessions](docs/sessions.md#hover-cards).

### Changed

- Provider features appear only when a harness standard provider plugin is installed. Without one, the harness standard check, its badges, the restated-rule and boilerplate lenses, the Layout, Standard, Em dashes and Review columns, Fix Settings and Hooks, Scaffold Repo Harness and the owner agent check stay hidden.
- Init Product Repo is renamed Scaffold Repo Harness. Check Harness Standard is renamed Check Harness.
- The Fleet overview's Restated column is now Review, and it comes from the provider.
- Retire is offered in every repo, with its backup and confirmation. A harness standard provider can mark repos that keep their copies.
- Repo rows in the activity bar expand to list their sessions.
- Marketplace health shows the marketplace's source type (GitHub, git, directory, file, URL) as an icon next to Source.
- Lane colors on the session page come from the agent definition's own color field, or from the color a teammate was given. Other agents use a palette.
- Repo rows in the activity bar keep their badges and counts in one column.

### Fixed

- A directory marketplace source of a provider is preferred over an older installed copy.

## [0.1.30] - 2026-10-20

### Added

- Harness standard check for each repo, when a harness standard provider is installed. FAIL and REVIEW lines show in the Problems panel on the file and line they concern.
- Repositories node in the activity bar, with a check badge for each repo when a provider is installed. See [Repositories](docs/repositories.md#activity-bar-node).
- CodeLens and quick fixes on `CLAUDE.md` and `.claude/rules/*.md` for dead pointers. With a provider, they also cover restated house rules and boilerplate headings. See [CLAUDE.md lenses](docs/claude-md-lenses.md).
- Effective harness section on each repo page, listing the memory, rules, plugins and hooks that a session loads. See [Effective harness](docs/effective-harness.md).
- Duplicate finder covers hook scripts and copies inside plugins, and marks a copy as nearly identical when only whitespace or version lines differ. See [Duplicates](docs/duplicates.md).
- Retire Copy and Retire Clean Copies back up a repo copy that matches a global or plugin copy, then delete it. See [Duplicates](docs/duplicates.md#retire-a-copy).
- Fleet overview: one table of every repo. See [Fleet overview](docs/fleet-overview.md).
- Fix Settings and Hooks previews the settings and hook fixes of a repo, shows diffs, and applies after a confirmation, when a provider is installed.
- Init Product Repo form with a preview, when a provider is installed. It creates only missing files.
- Rules editor shows the files each rule path matches, and checks the owner agent on disk when a provider is installed. See [Rules editor](docs/rules-editor.md).
- Marketplace health page, and Rename Marketplace for directory marketplaces. See [Marketplace health](docs/marketplace-health.md).
- Bulk-edit guard: a pick list before a bulk change, such as Retire Clean Copies and Rename Marketplace. It unticks repos with uncommitted harness files, a busy Claude session or stale worktree copies. See [Bulk-edit guard](docs/bulk-edits.md).
- Hook Scripts kind, for the files in the `hooks` folder. There are now twelve kinds. See [Harness kinds](docs/harness-kinds.md).
- Commands: Fleet Overview, Marketplace Health, Retire Clean Copies, Rename Marketplace, Retire Copy, Open Repo, Remove Line and Repoint, and, with a provider, the harness standard check, fixing settings and hooks, scaffolding a repo and opening the harness standard. See [Commands](docs/commands.md).

### Changed

- The main window sidebar header has two new buttons: Fleet overview and Marketplace health. See [Main window](docs/main-window.md#sidebar).
- Repo pages show the Effective harness section. With a provider, they also show the Harness standard section and buttons to check, fix settings and scaffold a repo.
- Copy labels read identical, nearly identical or differs.

## [0.1.29] - 2026-10-13

### Added

- Compare with Copy command opens the diff editor for an item and its copy in another scope.
- The frontmatter version shows next to the name.

### Changed

- Same-name assets across scopes are marked identical or differs. The check uses SHA-256 and ignores line ending differences.

## [0.1.28] - 2026-10-13

### Added

- Search box on the overview page.
- Animated demo of the main window in the README.

### Changed

- The README shows the demo in place of the footer logo.

## [0.1.26] - 2026-10-12

### Changed

- Version bump. The commit has no other change.

## [0.1.25] - 2026-10-12

### Changed

- Documentation for MCP servers and plugins is updated.

## [0.1.19] - 2026-10-12

### Changed

- The repo adopts conventional commit messages. The commit has no change to the extension.

## [0.1.4] - 2026-10-12

### Changed

- The Claude orange mark shows on the panel tab, the sidebar head and the overview header.
- The status bar entry reads Claude Harness.
- The `.time` ledger is left out of the package.

## [0.1.2] - 2026-10-12

### Fixed

- Workspace folders are listed even when they live under the temp folder.
- The editor header title stays on one line.

## [0.1.1] - 2026-10-12

### Added

- Repo harnesses in the main window, below the global harness.
- Create, rename, duplicate and plugin toggle work per scope.

### Changed

- Sections are collapsed by default.

## [0.1.0] - 2026-10-12

### Added

- First release: a VS Code extension to visualize and edit the global Claude Code harness and the repo harnesses below it. It has an activity bar tree and an editor panel.
