# Permissions

The Permissions page edits what Claude Code may do without asking. It reads and writes the `permissions` block of each settings file, and it lists the tools that asked you for permission in your recent sessions, so you can allow them with one press.

## Where to open it

In the sidebar, open **Settings**, then **Permissions**.

## What you see

The page has two tabs.

### Rules

- A **Repository** row of chips appears when you have a repo open. Pick the repo whose project and local settings you want to see.
- A **Scope** row of chips: **User**, **Project**, **Local** and **Managed**. Project and Local appear only with a repo. Managed appears only when your organisation has a managed settings file on this PC.
  - **User**: your own settings for every repo, in `~/.claude/settings.json`.
  - **Project**: the repo's shared settings, in `.claude/settings.json`.
  - **Local**: your private settings for the repo, in `.claude/settings.local.json`, kept out of git.
  - **Managed**: set by your organisation and read only here.
- A line with the file's path and a tag: **on disk**, **not created yet** or **read only**. A file that is not valid JSON shows an error tag, and nothing can be added to it until it is fixed.
- **Default mode**: a row of chips. **Not set** removes the key, so Claude Code uses its own default. The other chips are Default, Accept edits, Plan, Auto, Don't ask and Bypass. Hover a chip for what it does.
- Four lists, each with its rows and a field to add an entry:
  - **Allow**: used without asking.
  - **Ask**: always asks first.
  - **Deny**: never used.
  - **Additional directories**: folders Claude may work in besides the repo.

### Prompted in

Lists the tools that asked you for permission in your sessions, one row per rule. A rule reads like `Bash(git push *)` or a tool name such as `WebFetch(domain:example.com)`.

- A **Period** row: 24 hours, 7 days (the default), 30 days or All.
- An **Allow in** row: which settings file **Allow** writes to, User by default, or Project and Local with a repo.
- A table with each rule, its tool, the number of prompts, how they were answered (**Allowed**, **Mixed** or **Denied**), when it was last prompted, and an **Allow** button. A rule that is already in the allow list of the chosen file shows **In rules** instead.

## What you can do

- **Rules tab**: switch a scope, choose a default mode, type an entry in a list and press Enter or **Add**, or press the trash icon on a row to remove it.
- **Prompted in tab**: change the period, change the file **Allow** writes to, and press **Allow** on a row to allow that rule.
- **Reload** in the page header reads the files again.

Managed settings can be viewed but not changed.

## What is asked before any write

Every change opens a confirm card first. The card says what changes and in which file, for example "Adds Bash(npm test *) to permissions.allow" in the project settings, and that every other key and the layout of the file stay as they are. Removing an entry shows the card as a danger action. Choose the action on the card to write. Closing the card writes nothing.

If a write cannot happen, for example because the file is not valid JSON, the page shows a single line saying why, and the file is left alone.
