# Settings

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="plugins.md">← Back to Plugins</a></td>
<td align="center"></td>
<td align="right"><a href="../README.md#features">↑ Back to Features</a></td>
</tr>
</table>

Six VS Code settings control what Claude Harness lists. Find them under **Claude Harness** in the Settings editor. The two repo lists are stored in your user settings. Use **Add Repo** and **Remove Repo** to change them, because those commands update the settings for you.

| Setting | What it does | Default |
| --- | --- | --- |
| `claudeHarness.root` | The folder of the global harness. Empty means `~/.claude`. | Empty |
| `claudeHarness.repoFolders` | Folders added with **Add Repo**. Each is a repo folder or a parent folder. | `[]` |
| `claudeHarness.removedRepos` | Repo folders hidden with **Remove Repo**. Adding the repo or its parent folder again shows it. | `[]` |
| `claudeHarness.plan` | The plan of the account in the global harness folder: Pro, Max 5x, Max 20x, Team Standard, Team Premium or API billing. | Empty |
| `claudeHarness.weekStart` | When the weekly limit of the main account resets, as weekday and UTC hour, for example `Mon 11:00`. | Empty |
| `claudeHarness.accounts` | More Claude accounts on this machine, each `{ "label", "path", "plan" }`. | `[]` |

Changing `claudeHarness.root` reloads the global harness from the new folder, and the new folder is watched for changes.

### Several accounts

Claude Code reads its config folder from `CLAUDE_CONFIG_DIR`, so a machine with two seats can keep `~/.claude` and `~/.claude-work`. List each extra folder in `claudeHarness.accounts`:

```json
"claudeHarness.accounts": [
  { "label": "Work", "path": "~/.claude-work", "plan": "team-standard", "weekStart": "Mon 11:00" }
]
```

`path` is required, and a leading `~` is your home folder. The label defaults to the folder name, and an unknown plan counts as none. The main account, from `claudeHarness.root`, is labeled **Default**; give it a plan with `claudeHarness.plan`. A folder that repeats an earlier one is ignored. `weekStart` is the weekday (`Mon`, `Tue` and so on, or the full name) and the UTC hour, with optional minutes, at which the weekly limit of the plan resets, for example `Mon 11:00` or `Thu 9:30`. Find it in the usage card of the Claude app, and convert to UTC. A value in another form is ignored. With the list empty nothing changes. Only the sessions come from the extra folders: the harness items you edit still come from the main folder.

With more than one account, each session in the tree, the sessions page and the session header shows the label of its account, and the cost row starts on that account's plan. See [Sessions](sessions.md#several-accounts).

See [Repositories](repositories.md) for how the two repo lists are used.

## Edit settings files

The **Settings** category lists `settings.json` and `settings.local.json` for the global harness and for each repo, when the file exists. Click a file to open it in an editable JSON box.

| Action | How |
| --- | --- |
| Save | Click **Save**, or press Ctrl+S. Save is available only when the text has changed. |
| Revert | Click **Revert** to drop your changes |

Save checks the JSON first. Invalid JSON shows an error with the parser message, and the file stays unchanged. The file keeps its line endings, whether they are CRLF or LF.

![settings.json open in the editable JSON box](images/settings-edit.png)

**Claude Harness: Open Settings File...** lists every settings file, global and per repo, and opens the one you pick. See [Commands](commands.md#open-settings-file).

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="plugins.md">← Back to Plugins</a></td>
<td align="center"><a href="#settings">↑ Back to top</a></td>
<td align="right"><a href="../README.md#features">↑ Back to Features</a></td>
</tr>
</table>
