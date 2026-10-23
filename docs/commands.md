# Commands

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="settings.md">← Back to Settings</a></td>
<td align="center"></td>
<td align="right"><a href="../README.md#features">↑ Back to Features</a></td>
</tr>
</table>

Every command is in the **Claude Harness** category. Commands marked *hidden* do not show in the Command Palette; they act on the item you right-click or the page you have open.

| Command | What it does | Where |
| --- | --- | --- |
| Open Claude Harness | Opens the main window | Palette, tree title bar, status bar |
| Add Repo... | Adds a repo folder, or a parent folder that holds several repos | Palette, Repositories header |
| Remove Repo... | Hides repos or added parent folders. Nothing is deleted on disk. | Palette, Repositories header |
| Refresh | Reloads the harness and the `claude mcp list` servers | Palette, tree title bar |
| New... | Creates a rule, agent, skill, command, output style or workflow | Palette, tree title bar, category headers |
| Configure Tools... (*hidden*) | Picks the tools an agent, skill or command may use | Code lens on `tools` lines, item page |
| Open File (*hidden*) | Opens the item's file in the editor | Tree, item page |
| Rename... (*hidden*) | Renames an item and its file | Tree right-click, item page |
| Duplicate... (*hidden*) | Copies an item under a new name | Tree right-click, item page |
| Compare with Copy... (*hidden*) | Opens an item and its copy in another scope in the diff editor. See [Duplicates](duplicates.md). | Tree right-click |
| Delete (*hidden*) | Moves an item to the trash, or removes an MCP server's entry from its file | Tree right-click, item page |
| Reveal in File Explorer (*hidden*) | Shows the item's file or folder in the file explorer | Tree right-click, item page |
| Enable / Disable Plugin (*hidden*) | Turns a plugin on or off | Tree inline, plugin page |
| Add MCP Server... | Asks for the scope, a name, and a command line or URL, then adds the server to `~/.claude.json` or the repo's `.mcp.json` | Palette, MCP Servers header, tree inline |
| Copy as claude mcp add Command (*hidden*) | Copies a `claude mcp add` line for the server to the clipboard | Tree right-click, server page |
| Open Claude Here | Opens a terminal in a repo, or in your home folder, running `claude` | Palette, tree title bar, repo rows |
| Install Plugin... | Picks a plugin from your marketplaces and the scope, then runs `claude plugin install` in a terminal | Palette, Plugins header, tree inline |
| Uninstall Plugin... | Confirms, then runs `claude plugin uninstall` in a terminal | Palette, tree right-click, plugin page |
| Open Settings File... | Picks any `settings.json` or `settings.local.json` and opens it in the editable JSON view | Palette, tree inline on Settings |
| Fleet Overview | Opens the table of every repo. See [Fleet overview](fleet-overview.md). | Palette, tree title bar, Repositories node |
| Marketplace Health | Opens the marketplaces and their plugins. See [Marketplace health](marketplace-health.md). | Palette, Plugins header, Repositories node |
| Retire Copy (*hidden*) | Backs up a repo copy of a skill or agent that matches a global or plugin copy, then deletes it. See [Duplicates](duplicates.md#retire-a-copy). | Archive button on an item page |
| Retire Clean Copies... | Retires identical repo copies of skills and agents after you pick them. See [Duplicates](duplicates.md#retire-clean-copies). | Palette, Repositories node, Fleet overview |
| Rename Marketplace... | Renames a directory marketplace in the settings files, then re-registers it in a terminal. See [Marketplace health](marketplace-health.md#rename-a-directory-marketplace). | Palette, Marketplace health page |
| Open Repo (*hidden*) | Opens a repo's page | Right-click on a repo row |
| Open Session | Opens a Claude Code session's page. See [Sessions](sessions.md). | Session rows in the tree |
| Remove Line (*hidden*) | Deletes a line that a CodeLens or quick fix flags. See [CLAUDE.md lenses](claude-md-lenses.md). | CodeLens, quick fix |
| Repoint... (*hidden*) | Replaces a dead pointer with a name you pick. See [CLAUDE.md lenses](claude-md-lenses.md#dead-pointers). | CodeLens |
| Check Harness | Runs the harness standard checks of the provider plugin. A repo row checks that repo. | Palette, repo rows |
| Fix Settings and Hooks... | Applies the provider plugin's fixes to a repo's settings and hooks | Palette, repo rows |
| Scaffold Repo Harness... | Scaffolds a repo's harness with the provider plugin | Palette, repo rows |
| Align CLAUDE.md... | Aligns a repo's `CLAUDE.md` with the provider plugin | Palette, repo rows |
| Open the Harness Standard | Opens the harness standard that the provider plugin ships | Palette |

Provider commands appear when a harness standard provider plugin is installed.

## Plugin agents

In the tree, a plugin agent offers only **Open File** and **Reveal in File Explorer** on right-click. **Rename**, **Duplicate**, **Compare with Copy** and **Delete** are hidden for it. See [Plugins](plugins.md#agents-in-the-global-list).

## Add MCP Server

Pick a repo or **Global**, type a name, then choose **Local command** or **HTTP URL** and enter the command line or the URL. A global server goes into `~/.claude.json`, a repo server into that repo's `.mcp.json`. A name that already exists in that file is refused. The new server opens when it is added. See [MCP servers](mcp-servers.md).

## Copy as claude mcp add Command

Builds the command that adds the same server on another machine, for example `claude mcp add --scope user weather -- npx -y @example/weather-mcp`. The scope follows where the server is stored: `user`, `project` or `local`. Environment variables become `-e` and headers become `--header`, values included. Servers from claude.ai or a plugin have no such command.

## Open Claude Here

Opens a new terminal in the chosen repo and starts `claude`. **Home folder** starts it in your home folder. See [Repositories](repositories.md).

## Install and uninstall plugins

**Install Plugin...** lists the plugins of every marketplace you have added, with installed ones marked. Pick a repo to install it for that repo (`--scope project`), or **You, in every folder** to install it for yourself (`--scope user`). The install runs in a terminal so you can answer its questions. **Uninstall Plugin...** asks first, then runs the uninstall for the scope the plugin is listed in. See [Plugins](plugins.md).

## Open Settings File

Lists every `settings.json` and `settings.local.json`, global and per repo, and opens the one you pick in the editable JSON view. See [Settings](settings.md).

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="settings.md">← Back to Settings</a></td>
<td align="center"><a href="#commands">↑ Back to top</a></td>
<td align="right"><a href="../README.md#features">↑ Back to Features</a></td>
</tr>
</table>
