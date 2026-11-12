# Usage history

Usage history shows what your Claude Code work cost, per day and per month, at API list prices. It also says which plan, Pro, Max or Ultra, would have cost less than paying by the token. The page only reads your session transcripts. It writes nothing.

## Where to open it

- **History** tab on a repo page, beside **Models**. It shows the usage of that repo only.
- **Usage history** page from the sidebar header. It shows every repo together, with a **By project** table.

## What you see

**Period chips** at the top: **30 days**, **90 days** and **12 months**. The first two count back from today, one bar per day. **12 months** shows the last 12 calendar months, one bar per month.

**Cost chart**: one bar per day, or per month for 12 months. The top label is the highest bar. Hover a bar for its date, its cost at API prices and its tokens. Days with no usage show as an empty slot.

**By month and plan**: one row per month with:

| Column | Meaning |
| --- | --- |
| Month | The calendar month. The current month counts only the days that have passed. |
| Tokens | Input, output and cache tokens of the month, such as `436K` or `8.8M`. |
| API price | What the month cost at API list prices. |
| Pro $20, Max $100, Ultra $200 | The API price divided by the plan price. Above `1x` the plan costs less than paying by the token. |
| Best fit | The plan to take, or **API** when paying by the token costs less than the cheapest plan. |

A plan's hover gives its monthly price and the amount of work its weekly limit allows in a month. A month marked as more work than its plan's limit allows is flagged in the hover of its Best fit tag.

**By project** (All repos page only): one row per project with its tokens, API price, number of days with work and its share of the total.

When you have more than one Claude account, each account gets its own block with its total in the heading.

## How the numbers are counted

- Prices are API list prices, the figures Anthropic publishes for the tokens used. They are an estimate of the value of the work, not a bill. Your plan's real charge is its monthly price.
- Each response counts once, including responses of subagents.
- Plan prices were read from the Anthropic pricing page on 2026-11-12: Pro $20 a month (billed monthly), Max $100 and Ultra $200. The weekly limits used for the advice are estimates.
- Days are local calendar days.

## What you can do

Change the period, and hover any number for its source. There is nothing to save or confirm on this page.
