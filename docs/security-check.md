# Security check

The Security check reads your Claude Code configuration on this PC and lists what could run foreign code, leak a secret or switch off the permission prompts. It reads only. The one exception is **Resolve**, which edits a single value, and only after you confirm.

## Open the page

On the overview, press **Security** beside the tabs.

## What you see

The page title counts the findings and the files read. Each finding shows:

- A severity tag: **High**, **Medium** or **Low**.
- The check it belongs to: **Hooks**, **MCP servers**, **Permissions** or **Sources**.
- The title, where it lives (Global, a repository's name or a plugin), and the file and line.
- The offending text, with every secret masked.
- **Why it matters**, and what Resolve does, or what to do when there is no fix.

Severity and check are two rows of chips. **All** is the first chip of each. The severity chips show how many findings each level has, and the check chips show how many findings each check has.

The checks:

| Check | What it looks at |
| --- | --- |
| Hooks | Hook commands that download code and run it, and hooks that read secrets, sending them over the network when they do |
| MCP servers | Secrets written as literal values in an MCP server's env, headers, URL or arguments |
| Permissions | Allow rules that allow every command, a default mode that skips every prompt, and a switched-off bypass warning |
| Sources | Skills and plugins that fetch and run remote code, plugins from an unregistered marketplace, and marketplaces or skills from outside Anthropic |

## What you can do

- Read each finding and decide what to do.
- **Resolve**, where the finding has a fix. It is offered for the mechanical cases: removing an allow-everything rule, removing the skip-prompts mode or the switched-off warning, or, in a project's `.mcp.json`, replacing a literal secret with an environment variable reference such as `${NAME}`. You then set that variable in your environment before Claude starts.
- The refresh button in the page header reads the configuration again.

## What is asked first

Resolve asks on the **Resolve this finding** confirm card first. The card names the file, the line and what the fix does. After you confirm, the check runs again and the fix is applied to that one value only; the rest of the file stays as it is. Findings without a fix show no Resolve button; you change those yourself.
