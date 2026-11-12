# Skills catalog

The Browse page searches the public skills on [skills.sh](https://skills.sh), the registry behind the skills CLI. You find a skill there and install it into your Claude folder without leaving VS Code.

## Open the page

On the **Skills** page, press **Browse**.

## What you see

- A search box. Type a word, for example `pdf` or `testing`, and press Enter or the search button.
- A table of the results:

| Column | Meaning |
| --- | --- |
| Name | The skill's name. Its hover shows the source and, when skills.sh gives one, the description. |
| Source | The GitHub repository the skill's files come from. On a narrow panel this column is hidden; the source then shows in the name's hover. |
| Installs | How many installs skills.sh counts, such as `228K` |
| State | **Installed** when a skill of that name is already in one of your scopes |
| Install | The download button at the right end of each row |

- Three chips filter the results: **All**, **Not installed** and **Installed**. Each shows its count.

The page says so when a search has no results, or when skills.sh could not be reached.

## What you can do

- Search, and filter the results with the chips.
- Install a skill with its row's download button.

## What is asked first

Nothing reaches the network until you search. The search is the only call to skills.sh.

An install opens the **Add from skills.sh** confirm card before any file is written. It is the same card as the Skills page's **Add from skills.sh** button. After you confirm, the skill's files are copied into `~/.claude/skills` and the source is recorded, so checks and updates know where it came from. The files are copied, never linked.
