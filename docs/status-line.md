# Status line

The Status line page builds the line that Claude Code shows under the prompt. You pick the fields and their order, watch a preview, and save. Saving writes a small Node script and points the `statusLine` setting at it.

## Open the page

In the sidebar, open **Settings** and choose **Status line**.

## What you see

- **Scope**: **User** is every session of yours, in the settings file of your Claude folder. **Project** is the open folder, in its `.claude/settings.json`. Project needs an open folder.
- **Preview**: the line for a sample session. Claude Code shows the real figures.
- **Fields**: one row per field with a switch, its position number and up and down arrows. The fields are listed in the order the line shows them. A row's title says where Claude Code gets the figure.

The fields are:

| Field | What it shows |
| --- | --- |
| Model | The model's display name |
| Context used | The share of the context window in use |
| 5-hour limit | The share of the 5-hour limit used |
| Weekly limit | The share of the weekly limit used |
| Session cost | The estimated session cost in US dollars |
| Git branch | The branch of the working folder, or its short commit when HEAD is detached |
| Folder | The name of the working folder |

When Claude Code sends no limit figures, the script asks the usage endpoint with your sign-in token, the same way the status bar does. It keeps the answer for five minutes in a cache file beside itself.

## What you can do

- Turn fields on or off and move them up or down. The preview follows at once.
- **Save** writes the line for the chosen scope.
- **Remove** puts back the status line that was set before your first Save, and deletes the script.

## What is asked first

Both writes ask on a confirm card first.

- **Save** names the script it writes, the settings file whose `statusLine` it sets, and any status line it replaces. Nothing else in the settings file changes: comments, order and line endings stay as they are.
- **Remove** names the settings file and the script it deletes. If you had no status line before, the `statusLine` key is removed.

Saving again keeps the first record of the earlier value, so Remove still puts back what was there before the builder first wrote.
