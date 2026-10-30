# Rename, merge or move plugins between marketplaces

A plugin's name is an identifier in more places than its folder. Change all of them in one pass,
or the renamed mod loads with empty state and its skills move to a namespace nothing calls.

## Where the name lives

| Place | What changes |
| --- | --- |
| Folder and `.claude-plugin/marketplace.json` | `name` and `source` of the entry; a merged plugin drops its entry |
| `<plugin>/.claude-plugin/plugin.json` | `name`, and every `dependencies` entry that names a renamed plugin |
| State refs in the module | `{ plugin: "<name>", key }`: the `plugin` field is the plugin name, so every ref changes |
| `types/index.d.ts` | the `interface PluginState` key |
| Tests | `plugin:` fields of mounted UI and band fixtures, `<plugin>:<skill>` command names |
| Constants built from the name | a section id, a deny prefix, a namespaced agent fallback (`<plugin>:<agent>`) |
| Skill and agent namespaces | `<plugin>:<skill>` and `<plugin>:<agent>` change for every caller: global and repo `CLAUDE.md`, hooks, other skills |
| `enabledPlugins` | `~/.claude/settings.json` and every consumer repo's `.claude/settings.json`; find them with `grep -l '@<marketplace>"'` |
| Consumer and product repos | eval scripts, install lines in guides, extension metadata, README links and `CLAUDE.md` naming the checkout path or the `<plugin>@<marketplace>` id; grep for the plugin's name, and for its names from earlier moves (an old marketplace repo, a pre-rename plugin name), never only the current path |

Visible UI text (a band label, a pane title, a held-command message) is copy, not an identifier:
leave it unless the user asks.

Also left alone: a repo that keeps its own copy of a renamed skill (its mentions mean that copy),
history (past `CHANGELOG.md` entries, applied SQL deltas, run logs, benchmark data), and published
or teaching copy (articles, class demos and slides). A sweep that skips dot folders misses
`.claude-plugin/plugin.json` and `marketplace.json`, which hold the name itself: include them.

## A `<stack>-conventions` plugin and its router skill

A stack's conventions plugin is named `<stack>-conventions` (category `conventions` in the README
index) and its router skill is `<stack>`, so callers write `angular-conventions:angular` and
`dotnet-conventions:dotnet`. Never `router`: Angular has a Router. When a plugin takes its router
skill's old name, as `angular-plugin` took `angular-conventions` on 2026-10-29, rename the skill
first, while the plugin still has its old name, then the plugin: a bare-name rewrite of the skill run
afterwards turns `angular-conventions:angular-conventions` into `angular:angular`.

The harness CLI does both with backups (`harness:cli`, from the release after 0.12.2): `plugins rename
--from <old>@<market> --to <new>` and `skills rename --from <old> --to <new> --market <dir>`, the
latter leaving a name before `:` alone. Run each with `--dry-run` first.

## Merging a mod into its skill plugin

Move `hooks/`, `tests/`, `types/`, `tsconfig.json` and the `.gitignore` for `.claude-plugin/types/`
into the surviving plugin, add `"types"` and any `userConfig` to its `plugin.json`, and fold the
README in as a section. Keep optional add-ons as separate plugins with a `dependencies` entry on the
merged core. A mod that finds its skill by `name === X || name.endsWith(":X")` survives the
namespace change untouched.

## Merging one mod into another mod's plugin

Two hooks modules cannot simply share a plugin: `hooks.json` lists one module, and the engine takes
one hook per event and matcher, so calling the guest's `register(on)` from the host registers a
second hook on events the host already holds.

1. Turn each guest hook into an exported function, `guardToolCall($, e, next)`, and chain it in the
   host's hook for that event beneath the host's own work, in the `.catch` fallback chain too:
   `creativeToolCall($, x, (y) => reportToolCall($, y, (z) => guardToolCall($, z, engineNext)))`.
   A guest hook on a matcher the host does not use (its own pane,
   `{ component: "Pane", requestId }`) stays its own `on(...)`.
2. Move the guest's state refs under the host's plugin name and prefix its keys
   (`guardHeld`, `guardAnswer`): both mods kept a `lastAnswer`. Merge the `PluginState` interfaces.
3. Run the host's tests through the guest. A host test that runs a command the guest holds
   (`npm test` under Intent Guard's test-run family) now times out or is denied: point the test at a
   command the guest passes (`npm run build`), never weaken the guest.
4. Carry the guest's branch-only work across its folder rename (`git-flow-plugin:git-flow` leaf update-from-master
   `crlf-remerge.py --ours WORKTREE --changed --map <old>/=<new>/`).

Proof: run both plugins' tests at `HEAD` first (`git archive HEAD <folders> | tar -x -C <scratch>`,
then `claude plugin test` there); the merged plugin passes the sum of both counts with the same
failures as those two baselines. Done on 2026-10-29: intent-guard-plugin into agent-control-plugin.

## Moving a plugin to its own marketplace

When a plugin becomes part of a product, it moves into the product repo and that repo becomes a
marketplace of its own. The id changes from `<plugin>@<old>` to `<plugin>@<new>`, a rename of the
marketplace half, so the table above applies.

1. Copy the folder, `.claude-plugin/` included, beside the product's other tooling (here
   `<product>/tools/<plugin>`); `diff -rq <src> <dst>` must print nothing. Then `git rm -r -f` it in the old marketplace and drop its
   `marketplace.json` entry and README row.
2. Write `<product>/.claude-plugin/marketplace.json` (`name`, `owner`, one entry with
   `"source": "./tools/<plugin>"`) and run `claude plugin validate` on both roots.
3. Sweep the product repo and every consumer repo (last row of the table). The sweep that only
   greps the current path misses everything left from earlier moves.
4. Switch the install and prove it:

```bash
claude plugin marketplace add <product-root>
claude plugin install <plugin>@<new> --scope user
claude plugin uninstall <plugin>@<old> --scope user --keep-data
claude plugin marketplace update <old>
claude plugin list   # the plugin once, under @<new>, "Read from:" the new folder
```

`uninstall` deletes the data folder `~/.claude/plugins/data/<plugin>-<old>/` unless `--keep-data`
is passed; when the mod keeps state there, copy it to `<plugin>-<new>/` first. The move held when
`claude plugin list` shows the plugin once and a grep for `@<old>` and the old paths over the
consumer repos prints nothing.

## Switch the installs

```bash
claude plugin validate <marketplace-root>
claude plugin marketplace update <marketplace>
claude plugin uninstall <old>@<marketplace>
claude plugin install <new>@<marketplace>
```

Then `/reload-plugins` in a running session. Project-scope install records of the old names stay
listed until each consumer repo is opened: its settings already name the new plugins, so Claude Code
offers the install there.

Moving plugin folders inside one marketplace (into category subfolders) changes only each entry's
`source`: `claude plugin validate` and `claude plugin marketplace update <marketplace>` are the whole
switch, run in the same turn as the move, for every marketplace the move touched.
