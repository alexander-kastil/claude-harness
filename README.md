# Claude Harness

Visualize and edit your Claude Code harness in VS Code: memory, rules, agents, skills, commands, output styles, workflows, hooks, MCP servers and plugins, globally and per repository.

![Claude Harness in action](docs/images/harness-demo.gif)

## Quick start

1. Open the Extensions view (Ctrl+Shift+X), search for **Claude Harness**, and click **Install**. You can also run `code --install-extension integrations-at.claude-harness` in a terminal.
2. Click **Claude Harness** in the status bar, or its icon in the activity bar. The main window opens.
3. Pick an item in the sidebar to view and edit it. The global harness is read from `~/.claude`.

> Note: Claude Harness needs Claude Code and VS Code 1.100 or newer. The global MCP server list comes from `claude mcp list`, so the `claude` command must be on your PATH. The harness standard features need the harness-plugin (`claude plugin install harness-plugin@integrations-marketplace`) and Python 3 on PATH. When either is missing, those features stay off and show a one-line hint.

## Features

| Feature | Summary |
| --- | --- |
| [Main window](docs/main-window.md) | Browses the global harness and each repository in one window, with search and an overview |
| [Harness kinds](docs/harness-kinds.md) | The twelve kinds of harness items, where they are stored and which ones you can change |
| [Editing](docs/editing.md) | Edits frontmatter and instructions, saves or reverts, and creates, renames, duplicates or deletes items |
| [Repositories](docs/repositories.md) | Shows the harness of each repo, and adds or removes repos |
| [Harness standard](docs/harness-standard.md) | Checks each repo against the harness standard, shows the findings in the Problems panel and a badge per repo |
| [CLAUDE.md lenses](docs/claude-md-lenses.md) | Flags restated house rules and dead pointers in CLAUDE.md and rules files, with quick fixes |
| [Effective harness](docs/effective-harness.md) | Lists the memory, rules, plugins and hooks that a session in a repo loads |
| [Duplicates](docs/duplicates.md) | Finds copies of an item across scopes and plugins, compares them, and retires repo copies |
| [Fix settings and hooks](docs/fix-settings.md) | Previews the settings and hook fixes of a repo, and applies them after a review |
| [Bulk-edit guard](docs/bulk-edits.md) | Leaves out repos with uncommitted harness files, busy sessions or stale worktree copies before a bulk change |
| [Fleet overview](docs/fleet-overview.md) | One table of every repo, with its layout, standard, copies and plugins |
| [Init product repo](docs/init-product-repo.md) | Creates the harness files of a new product repo, after a preview |
| [Rules editor](docs/rules-editor.md) | Shows which files a rule's paths match, and whether its owner agent exists |
| [Marketplace health](docs/marketplace-health.md) | Lists marketplaces and plugins, flags sources ahead of the installed copy, and renames directory marketplaces |
| [Configure Tools](docs/configure-tools.md) | Picks the tools an agent, skill or command may use |
| [MCP servers](docs/mcp-servers.md) | Lists MCP servers with their source and status, sorts them, shows their tools, and adds, copies or deletes them |
| [MCP switches](docs/mcp-toggles.md) | Turns an MCP server on or off for one repo or in every folder |
| [Plugins](docs/plugins.md) | Enables, disables, installs and uninstalls plugins, and marks mods |
| [Settings](docs/settings.md) | Sets the global harness folder and the repo lists the extension keeps, and edits the settings files |
| [Commands](docs/commands.md) | Every Claude Harness command, what it does and where to find it |

## License

Creative Commons Attribution-NonCommercial-ShareAlike 4.0, (c) 2026 Alexander Kastil, [integrations.at](https://integrations.at). See [LICENSE](LICENSE).
