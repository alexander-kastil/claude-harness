# Changelog

All notable changes to Claude Harness are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions with no version change in the package.json history (0.1.3, 0.1.5 to 0.1.18, 0.1.20 to 0.1.24, 0.1.27, 0.2.1 and 0.2.3 to 0.2.11) and development builds (0.2.14 to 0.2.22, 0.2.24 to 0.2.30, 0.2.32 to 0.2.34, 0.2.36 to 0.2.44, 0.3.0, 0.3.2, 0.4.1 to 0.4.3, 0.5.2 and 0.5.3) have no entry.

## [0.6.5] - 2026-10-26

### Added

- Checkpoints on the Session page's Timeline. A ring marks every prompt where Claude Code saved a checkpoint of the files it edits. Click a ring to list the files Claude changed after that prompt; each file opens in VS Code's side-by-side diff, the file as it was at the prompt on the left and as it is now on the right.
- Restore files to here, in a checkpoint's detail. A card names every file it will overwrite, recreate or remove before anything is written. It undoes the edits Claude made with its own edit tools back to that prompt, not the whole folder: changes from shell commands or by hand are not in a checkpoint.
- Rewind the conversation, beside it in the Claude button group. It opens the session in a terminal, like Continue, where Claude's own rewind takes the conversation back. The extension never edits the transcript.
- Rename Session, on a session row's right-click menu and in the palette. An input box is prefilled with the session's current name. Confirming writes the name the way Claude Code's `/rename` does, so `/resume` shows it too; Escape or an empty name changes nothing. From the palette it first asks which session.
- Retire all in Plugin Hunter, at the foot of a plugin card beside the asset count. It ticks Retire on every listed copy at once, global and repo, and clearing it clears them all; it shows a dash while only some are ticked and follows the single ticks. The Retire ticks themselves still start off.
- Compare on a repo copy of an agent that differs from the global one, in Plugin Hunter. It opens the two files side by side in the editor. Agents are not merged here.
- A Mods section in the sidebar and on the overview, listing the installed plugins that are mods. It replaces the Hook Scripts section.

### Changed

- Plugin Hunter starts on the marketplace you used last, or else on your own marketplace with the most installed plugins, not the first one by name.
- Plugin Hunter shows one count of skills and agents: the page header and the Hunt confirm card agree, and Claude is sent exactly those, from Global and from every known repo, with where each has copies and which installed plugin ships it. Before, Claude saw only Global, the open repos and plugins, and could answer "all global" for an element that also had repo copies.
- A search in Plugin Hunter that finds elements now puts them on a plugin card in the same answer. The empty state says how to start.
- After an answer, Plugin Hunter scrolls to the newest reply with its card below it. While Claude works, the box is emptied so your message shows once, the waiting reply counts the time so far, and Start over and New plugin are disabled.
- Two repos with the same folder name show the folder they sit in on a Plugin Hunter card. A differing repo copy of an agent has one Compare button instead of a repeated note in each row. The card's Description box grows with its text.
- Plugin Hunter's Claude replies are at most two short sentences, since the card already lists every element with its copies. A longer reply is shown cut to two lines.
- Text Claude writes is kept short everywhere it reaches you. A Plugin Hunter reply is cut to two sentences, and a "left out" note says only how many. A plugin card's result or error shows two lines, the whole text in the hover card. A drafted output style is asked for at most eight one-line rules. The Consolidate merge asks Claude for one sentence with a count, not a file list. A session name is one line of at most 100 characters. A sub-agent's report shows two lines on its detail, the full report one click away, and its hover card three lines.
- The Hunt confirm card says "Uses your own Claude account" instead of naming the command.
- The hook scripts of the `hooks/` folder are listed in the Hooks section, under the group Scripts, and the Fleet overview's hook copies count them there.
- A session is named in the order `/resume` uses: its agent name, then its custom title (`/rename`), its AI-generated title, its summary, its first prompt, and last the first 8 characters of its id. Before, a session was always named by its first prompt.

### Fixed

- A created Plugin Hunter card lists every element that went into the plugin. After a refresh it listed only the elements whose copies were not retired, because the retired ones were no longer on disk.

## [0.6.0] - 2026-10-25

### Added

- Claude usage in the status bar: `5h 12% · wk 47%` for the 5-hour session and the weekly limit, read live from your Claude account with the sign-in Claude Code already stores in the global harness folder. The item turns to the warning color at 75% and to the error color at 90%. Its hover card has one bar per limit (the weekly limit of a single model gets its own bar): the fill is the used share, the tick is how much of the window has passed, and two lines mark the warning and critical shares. Next to each bar is the time until the reset, as `hh:mm` for the 5-hour session and `dd:hh:mm` for the weekly limits, and the card ends with when the values were read. Clicking the item opens Claude Harness. While a read fails, the item keeps the last values and says so. See [Settings](https://github.com/alexander-kastil/claude-harness/blob/HEAD/docs/settings.md#claude-usage-in-the-status-bar).
- Five Quota settings: `claudeHarness.quota.enabled` hides the item and stops the requests, `quota.warnPercent` and `quota.criticalPercent` set the two shares, and `quota.activeRefreshSeconds` (60) and `quota.idleRefreshSeconds` (120) set how often the limits are read while Claude was used in the last 10 minutes and while it is idle.
- New Claude Terminal, on Ctrl+F1 and as a Claude mark button in the title bar of the editor. It starts `claude` in a new terminal, in the folder of the active editor's workspace folder (the first workspace folder, or your home folder, when none is open). Every new terminal gets its own name: Claude, Claude (2), Claude (3).
- Paste Image into Claude, on Ctrl+V in a terminal on Windows. When the clipboard holds an image and no text, it saves the image as a PNG in a `claude-harness-images` folder of your temp folder and types its path into the terminal, so Claude Code reads the image. A clipboard with text pastes as before.
- Four Terminals settings: `claudeHarness.terminal.location` (editor or panel), `terminal.openToSide`, `terminal.command` (the command or full path that starts Claude, for example `claude`) and `terminal.args` (extra arguments such as `--model sonnet`, added to every interactive session).
- Four Lists settings for how many rows a list shows before its show all control: `claudeHarness.lists.sessions` (10), `lists.recentRepos` (10), `lists.huntCatalog` (60) and `lists.decisions` (6). A change applies without a reload.

### Changed

- Every terminal Claude Harness opens (Open Claude Here, Review, Slim, Try it, Fix, Consolidate, Analyze, Continue, the MCP sign-in, plugin install and uninstall, marketplace rename) now opens in the editor area, beside the files you have open, instead of in the bottom panel. Set `claudeHarness.terminal.location` to `panel` for the old place, or `terminal.openToSide` to `false` to open it in the group of your files.
- Those terminals start the command from `claudeHarness.terminal.command`, and the sessions also take `claudeHarness.terminal.args`. Plugin install, uninstall and marketplace commands use the command without the extra arguments.
- The settings are grouped in the Settings editor under General, Terminals, Quota and Lists.

## [0.5.0] - 2026-10-25

### Added

- Share, in the right-click menu of agents, skills, commands, output styles, rules, plugins, CLAUDE.md files, hooks and MCP servers. It packs the element in its native format (a zip for a skill or plugin, one file for the rest) and saves it to your Downloads folder, with a Show in folder button. For an item that ships with a plugin, a card asks whether to share only that item or the whole plugin. Values that look like secrets (keys, tokens, passwords) are listed in a card before anything is saved, and are saved as they are only after you agree.
- Import Skill..., Import Plugin..., Import Agent..., Import Command..., Import Output Style..., Import Rule..., Import CLAUDE.md..., Import MCP Server... and Import Hook... take a shared file back in. You pick the scope, and a card lists every file it writes. An element of the same name is replaced after a backup to `~/.claude/repo-sync-backups`, or imported under a new name. An MCP server or hook is merged into the settings file instead of replacing it. A plugin is written into a directory marketplace of yours and installed from it. Each Import button sits in the header of its type page, and the commands are in the Command Palette.
- Sync in the row menu and the sidebar tree for a skill that has a source: it checks the source and, when it is newer, offers the update.
- Sync from Global on a repo skill or agent whose copy in the repo differs from the Global one. A card lists the files, the copy is backed up, then overwritten with the Global version.
- Sync Plugin from Its Marketplace, in the Marketplace health page and the plugin menu, for a plugin whose marketplace is ahead of the installed copy. It updates the marketplace and the plugin.
- Sync to Other Copies for an MCP server that is configured differently in several files. A card asks which configuration to keep, then replaces the entry in each file after a backup.
- A skill with a source shows a chip with its `owner/repo` in the header of its page.
- Skill sources. Add a skill from a skills.sh or GitHub address with the new **Add from skills.sh** button on the Skills page: a card asks for the address, shows the skill's description, its files and a reminder that a skill is third-party text, and installs it into `~/.claude/skills` after you agree. A skill you copied by hand can be connected to its source with **Connect to source**, and its page then shows what the distributor's files replace, with your own files named.
- **Check updates** asks GitHub whether the folder of each skill that has a source changed, with one request per repo and no download. The Origin column on the Skills page reads `distributor` for such a skill, with `owner/repo` in its hover card, and the Sync column shows `current`, `update`, `unchecked` or `gone`. Two new presets, **From a distributor** and **Update available**, filter the page. A skill with a newer version says so in the Sync column and in a banner on its page, with the version pair when its SKILL.md has one.
- **Update** replaces a skill's files in place, for one skill from its page or for every skill a check found newer from the Skills page. The card names the files that are overwritten, added and deleted, and the old files are backed up to `~/.claude/repo-sync-backups`. Setting `GITHUB_TOKEN` or `GH_TOKEN` raises GitHub's limit of 60 requests an hour.
- **Link into repo** on a global skill's page gives the repos you pick a soft link (a directory junction on Windows) to the skill, so updating the global skill updates every linked repo. A repo that already has its own folder of that name is listed as disabled with the reason, and the skill's page says which repos it is linked into.
- The source of each skill is recorded in `~/.claude/.skill-sources.json`. Skills that the skills CLI (`npx skills add -g`) installed show their Origin from its lock file, which is only read, never written, and an update from Claude Harness turns such a link into a real folder in `~/.claude/skills`.
- Five commands: Add Skill from skills.sh or GitHub..., Connect Skill to its Source..., Check Skills for Updates, Update Skills from their Source and Link Global Skill into a Repo.... See the new [Skill sources](docs/skill-sources.md) page.
- Plugin Hunter. The new **Plugin Hunter** button on the Plugins page opens a page where you talk to Claude about the skills and agents you already have. Ask it to search your harness, to create the plugin or to take an element out, and **Start over** clears the conversation. Each proposal is a card with a name, description and category, a tick to include each element, and a **Retire** tick on each global or repo copy it replaces. A repo copy that differs from the global one has a **Merge** button. **New plugin** starts an empty card, and **Add skill or agent** picks from your skills and agents with a search. Only a directory marketplace on your disk can be picked, because Claude Code overwrites its copies of GitHub, git and URL marketplaces. **Create** shows a card that lists every file it writes, then writes the plugin and its marketplace entry, installs it and retires the ticked copies, with a backup in `~/.claude/repo-sync-backups`. See [Plugins](docs/plugins.md#plugin-hunter).
- The Enabled column of the Plugins page is a switch. It enables or disables the plugin in the scope of its row, and clicking it does not open the plugin.

### Changed

- Confirm cards can ask for text and offer a list to pick from, with an inline error under the field, so the address and repo questions of the skill sources stay in the panel instead of a VS Code input box and pick list.
- The buttons in a page header wrap onto a second row in a narrow panel, instead of being cut off or overlapping the title.
- Downloads of a skill that a closed card or window left behind in the temp folder are removed.
- Every action that starts Claude sits in an AI group: a button group led by the Claude mark, with each action as its own button and icon. Review with Claude uses a lightbulb with a sparkle. A lone Claude action gets the same group.
- Detail pages are denser. The info card shows labelled facts (label and value) in two captioned groups, Details and the figures, instead of loose pills. Flags read as words ("Manual only", "Listed" or "Hidden", "Kept" or "Replaced"). The kind kicker and filler sentences are gone, and the status is a single Status fact, boxed only on an error or a warning.
- Page heads show a short count line, for example "13 assets · repos/shop-api", with the full path on hover.
- Effective harness: the Memory table lost its duplicate File column (the path is in the Name hover), and loaded paths show as `~/.claude/...` or relative to the repo.
- The Models tab is a one-line table with Tokens, Cost, Of limit, and Replies or Launches. The harness standard card no longer restates itself.
- The sessions search and the Headless runs list use the same one-line sessions table.
- The cost legend shows "<1%" instead of "0%" next to "<$0.01". Session KPI notes are shorter, with the long text on hover. Findings have no "nothing recorded" chip, the Decisions legend text moved into the tab hover, and output style counts are labelled chips ("1 word").
- Plugin Hunter has a one-line placeholder, "Retire" ticks with the wording on hover, "No plugin cards yet." and a shorter notice when there is no marketplace. Used in and Fired in wording is shorter.
- The second line of a row in the sidebar and the tree shows at most three facts per kind, each with a hover card that says what it is.
- The tables on the type pages use short tokens. Origin reads `global`, `repo`, `linked`, `marketplace` or `distributor`, and Sync reads `current`, `update`, `unchecked` or `gone`, with the details in the hover card. On the Skills page Sync replaces Tools. Changed counts days. An uncounted Cost or Used is a red 0. Text columns are left-aligned, columns with nothing in them are dropped, and a narrow panel drops the low-priority columns first.
- The billing switch reads Team and API, with the full name in its hover card.
- Plainer wording on the overview, the Fleet overview, Marketplace health, the sidebar and the command titles.

### Fixed

- The VSIX no longer bundles the Marketplace film workspace (`assets/film-*`).

## [0.4.0] - 2026-10-24

### Added

- Used in tabs beyond agents and skills. Commands, plugins and output styles get one, listing the sessions that used them. A plugin's tab has a table per element, and its Skills and Agents tabs show a use count on every row. Rules and CLAUDE.md files get a Loaded in tab instead, and a path-scoped rule that no session ever loaded is marked Never matched. Every such tab starts with a strip of the last 7 days of activity.
- A Used column (count and last use) on the Agents, Skills and Commands type pages, with the presets Never used and Not used in 30 days. The column reads the usage index, which is built the first time a Used in tab is opened.
- MCP servers show how often their tools were called: a calls chip on every tool card, and the Tool list tile reads `N tokens every session, M calls`.
- Failing hooks appear as findings on the session page, the repo page's Hooks table has a Failures column, and the sessions list can be filtered by A hook failed and A mod denied a tool.
- The Timeline on the session page has a Mods layer. It shares the Mods toggle of the Delegation map, so the two stay in step.
- The repo page's Memory and Rules tables have a Last session column showing what the latest session actually loaded, and a Loaded by the last session section lists it.
- Review with Claude on skills, agents, commands, rules and output styles opens Claude in a terminal to review the element.
- Try it on agents, skills and commands starts Claude in a terminal with the element already selected (`claude --agent <name>`, `claude "/<name>"`).
- Continue session, next to Analyze, resumes the session itself instead of a copy, and warns first when the session is still live.
- Analyze is also on each row of a Used in tab and on each row of the sessions list.
- Last 7 days in more places. The Models tab has a This repo row and a By agent type group, and the agent page has a tile with its launches and cost over the last 7 days.
- The type tiles of the overview are one line high, with the count beside the icon and the label, and a count of zero is dimmed. The harness tiles of the repo page share the style. The lists of the overview are tabs under the search box: Last sessions, Repositories and Recently changed. The page remembers the last tab, and search results show above the tabs. Last sessions lists the 10 newest sessions over all repos, with title, repository, branch, start, duration, agents and live state; each row opens the session. Each row of Repositories spreads its data over the full width in columns: memory, rules, agents, skills and MCP counts, sessions and cost of the last 7 days, and the time since the last session. The search box is now Search Harness & Sessions, and matching sessions show as a group of their own.
- Ctrl+Alt+A opens Claude Harness.
- The sidebar shows the color of an agent as a swatch, for agents with a `color` in their frontmatter.
- A Fired in tab on the pages of hooks and hook scripts lists the sessions where the hook ran: the run count, the failures with their exit code and the average duration. A run is matched by its command, then by its event and matcher. The tab builds the index when you open it.
- The Used in tab of an agent has a Hooks column, such as `2 denied · 1 failed`, for the tool calls a hook or mod denied and the hook runs that failed inside that agent's own run.
- Each finding on the session page is a card: a kind label, a line of evidence, chips for the time, the tokens and the share of the session it cost, Why it matters, What to do, and a Show on map button that selects the agent's row on the Delegation map and centers it. A stopped run says whether you stopped it on purpose (a prompt shortly before) and becomes a note when a later run of the same type finished the job. Warnings come before notes.
- Draft output style shows the finished draft as one region on the session page: name, description, settings, every instruction in full, and a footer with the file, its cost and Open file. A placeholder holds the space while drafting, an error replaces it when drafting fails, and the Model select has a visible label.
- A Size card on a skill's page flags a long description (over 200 tokens, or past Anthropic's limit of 1024 characters) and a SKILL.md that is too long (over 500 lines or 5000 tokens). The flag is weighted by how often the skill ran, and the card lists the largest `##` sections to move out.
- The References tab of a skill shows a token bar per file, with the flags Giant, Tiny, Not linked and Two levels deep.
- The Skills type page has a Desc column and a Cost column (description tokens times sessions), and the presets Ranked by description cost and Long description.
- Slim with Claude on a skill page appears when something is flagged, and opens Claude in a terminal to say what to move and cut.
- Consolidate, on the page of a repo skill and in the right-click menu of repo skill rows in the sidebar and on the type page, moves the skill to the plugin it ships with (its marketplace source folder, never the installed copy), otherwise to global. An identical copy is retired. A differing copy is merged first, in the diff editor or with Merge with Claude, and retired once the copies match. A skill that exists only in the repo is moved to global.
- The commands of an item page sit below the title in boxed, labelled groups: page, file, Claude, item and draft.
- The page of every harness element has a new header of two lines. The first line has the kind chip, the name and the source chip (the repo, the plugin or Global), and the two chips share one shape. It never wraps, and a name that does not fit is cut, with its full text in the hover card. The second line shows the whole path, wrapping after folder separators, with the file name last.
- Count usage, a button on the Agents, Skills and Commands type pages, builds the usage index on your click. Until it exists, the Used column says `not counted yet`.
- A plugin's Enable control on its page, labeled Enabled for your user.
- The Files tile of a skill says in its sub-line what the files are: SKILL.md, references, scripts and the rest.
- An MCP server that fails to connect shows its error in a box on its page, with Retry that shows it is retrying. A server that needs a sign-in offers Sign in, and a switched-off server shows no sign-in.
- A Configure Tools... lens above the tools fields in the frontmatter of a harness file opens the tool picker, where the built-in tools have a heading of their own.
- The sidebar tree works from the keyboard: arrow keys move between rows and fold them, Home and End jump to the first and last. Repos have a right-click menu.
- The Review group on the session page has the tabs Findings and Output style.

### Changed

- Ran as general-purpose is a finding only when an agent you have fits the run's description, and it names that agent. Main thread made N edits shows only at 10 edits or more that outnumber the agents' edits, with the share of edits as a yardstick.
- A global section header in the sidebar (Agents, Skills, MCP Servers and so on) opens the same page as its tile on the overview, and still folds and unfolds.
- On the Delegation map, agent rows and the type rows of the Sum view show tokens instead of a message count.
- Save changes? (Save, Don't Save, Cancel), delete MCP server, move to trash, uninstall plugin and retire copies ask in a card in the panel instead of a system dialog. The cards that delete or remove something have no Don't ask again. Started from the sidebar or a tree menu, they still use the dialog.
- Saving any item switches back to View mode, with the Save button, with Ctrl+S and with Save on the unsaved-changes card.
- Every action that starts Claude shows the Claude icon, including Open Claude Here in the title bar of the tree.
- The search boxes of the type pages and the sessions page use the full width, and the border of every search box has more contrast in the dark and the light theme.
- Try it asks in a card before it starts Claude, and the Don't ask again switch of every card starts off. A card that deletes or removes something has none.
- The page of an item that a plugin ships is read-only, and the host refuses edits to it as well. A new item opens in View mode.
- View and Revert on an item with unsaved changes ask before they discard them.
- Consolidate reads `Consolidate X into Global`, and the button that removes the repo copy is Retire repo copy.
- The command bar of an item page collapses to icons when the page is narrower than 760 px, and the hover cards say what each one does.
- Error text is red everywhere, and an MCP error no longer repeats its code (`ECONNREFUSED: ECONNREFUSED:`). Secondary text and the weekday labels of the activity strips have more contrast.
- A type page opened from a repo lists only that repo. The items of a plugin are their own scope, so the counts in the header match the list. A global item with a copy in a repo reads `global, with a copy in X`.
- A rule that no session loaded says so in its Loaded in tab, and a hook run is matched to a hook only by its own command, so failures no longer land on a hook that never ran.
- Marketplace health lists Local, on disk above Hosted.
- The Models tab names the scope of its groups: By model and By agent type cover all repos of this account.
- The Fleet table shows a dash or 0 instead of a blank cell, and its count reads 1 repository.
- Below 640 px the sidebar sits above the page instead of beside it.
- The Repositories table of the overview drops its secondary columns to fit a narrow panel.
- The Used, Desc and Cost columns of the type pages have fixed widths, so the Description column keeps the rest.
- The Last 7 days figure of an agent is a chip beside Model and Color instead of a tile on a row of its own. In a narrow panel the tiles are shorter, and an odd last tile spans the row as a slim band.
- The selected row of the sidebar scrolls into view, the hover cards dismiss, and an empty search shows one message. Home clears the search of the overview. Section headers stay on one line, and a section with more than three views gets a View menu.
- On the session page, Delegation is now called How the work ran, and the legend sits inside the view box. The labels of Concurrency and Scatter no longer overlap the axis ticks, the median lines or each other.
- The agent count of a session page matches the list: only runs with a transcript count, and a note names the launches that never started.
- The hover card of a session row shows a heading, the first prompt and the repo, branch, date and agent count, instead of a file path.
- Opening the sessions page from Search sessions in the sidebar no longer shows a blank panel.

## [0.3.1] - 2026-10-23

### Added

- Prompts on the Delegation map's Full timeline: each prompt is its own box on the main thread, above the step it started, with its first line inside and the whole prompt, pasted blocks set apart, in its hover card. Off by default. See [Sessions](docs/sessions.md#delegation-map).
- Mods on the Delegation map's Full timeline: one toggle shows what every mod did, as a chip beside each step and on the connector of each agent it concerns, with one section per mod in the hover card. A hook that denied a tool call shows as a stop sign. It reads the hook traces Claude Code writes into the main and subagent transcripts, so it needs nothing installed: a hook whose text opens with `<name>: ` gets its own mod, any other hook output goes under Hooks. On by default, and shown only when the session has hook traces. See [Sessions](docs/sessions.md#mod-events).
- A mod can ship `.claude-plugin/harness-events.json`, pointing to a per-session event log, to put its own events and labels on the map. A transcript trace that the log already holds shows once. See [Sessions](docs/sessions.md#mod-events).
- Analyze on the Delegation map opens a new Claude in a terminal on a copy of the session, in the folder the session ran in, to ask about it in a chat. The original session stays untouched. When the session started agents, the copy is told where their transcripts are. See [Sessions](docs/sessions.md#delegation-map).
- A live session's page reads the transcript again every 5 seconds while it is in sight, repaints only when something changed, and keeps the scroll position.
- A Used in tab on the page of an agent or skill lists the sessions that used it, newest first: when, the repo, the session (a click opens it) and how often it was launched or used. It reads the transcripts of every account, the agents' own included, and keeps an index, so a later visit reads only what was added since. A global agent or skill leaves out the sessions of repos that have their own copy. See [Sessions](docs/sessions.md#used-in).
- Edit mode of an agent always has a color row: eight swatches, first the colors your agents already use, most used first, then Claude Code's own colors; a field for any hex code, where an invalid code is never saved; and None, which removes the `color` field. See [Editing](docs/editing.md#edit-an-item).
- A contributor guide, [CONTRIBUTE.md](CONTRIBUTE.md), walks through forking the repo, a feature branch, syncing with the owner's master, trying the change in VS Code and the pull request, with a Claude Code command for each step (`/git-contribute-setup`, `/git-contribute-start`, `/git-sideload`, `/git-contribute-sync`, `/git-contribute-pr`, `/git-contribute-finish` and `/git-contribute-cleanup`).

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
