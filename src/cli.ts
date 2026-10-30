#!/usr/bin/env node
import * as path from 'path';
import { Asset, Kind, backupStamp, retireAsset, retireBlock } from './harness';
import { HuntStray, buildCatalog, samePath, straysOf } from './hunt-catalog';
import {
  CreatePlan,
  MentionRow,
  installPlugin,
  isInstalled,
  planAdd,
  planCreate,
  pluginElement,
  retireCopies,
  runClaude,
  staleMentions,
  unwritePlugin,
  writeAddition,
  writeMoves,
  writePlugin,
} from './hunt-create';
import { catalogOf, readMarkets } from './hunt-market';
import { installedVersion, updatePluginFromMarket } from './sync';
import type { HuntAsset, HuntCatalogItem, HuntMarket, HuntProposal } from './shared/hunt';
import { Args, Io, Stop, World, emit, headline, list, load, one, parse, table } from './cli-core';
import { agentsCommand } from './cli-agents';
import { mediaCommand } from './cli-media';
import { delegationCommand, usageCommand } from './cli-insights';
import { skillsCommand } from './cli-skills';
import { completeCommand, completionCommand } from './cli-complete';
import { buildCommand } from './cli-build';
import { marketplacesCommand } from './cli-markets';
import { pluginsCommand } from './cli-plugins';
import { checkCommand } from './cli-check';
import { fleetCommand } from './cli-fleet';
import { syncCommand } from './cli-sync';
import { sessionsCommand } from './cli-sessions';
import { modsCommand } from './cli-mods';
import { lessonsCommand, timeCommand } from './cli-learn';
import { sourcesCommand } from './cli-sources';
import { coworkCommand } from './cli-cowork';

export { parse };

// The harness features of the extension without VS Code: plain Node, no `vscode` import, directly or through a module.

export const HELP = `claude-harness (preview): the Claude Harness features from a terminal or a skill.

Usage: node cli.js <command> [options]

  inventory [--repo <dir>] [--cowork] The harness of Global or one repo: memory, rules, agents, skills, commands, hooks, MCP servers, plugins. --cowork lists what Claude.ai synced into the root (skills/synced, plugins/synced), read-only.
  consolidate [--name <n>]            Every skill, agent, rule, command or workflow that exists in more than one place, with its copies.
  consolidate retire --name <n> --kind skill|agent --from <global|repo dir> [--dry-run]
                                      Retire one copy, backed up first (same backup as the extension).
  hunt catalog [--kind skill|agent] [--query <text>]
                                      The skills and agents across Global and repos that a plugin can be made from; --kind and --query keep the ones whose type or name and description match. Also lists the strays: folders under a skills root with no SKILL.md.
  hunt plan --name <plugin> --skills a,b --agents x,y [--category <c>] [--files <file>=<path in plugin>,...] [--drop-files] [--market <m>] [--description <t>] [--retire]
                                      The same as hunt create --dry-run. The plugin goes to plugins/<plugin>; --category is needed only by a marketplace that keeps category folders. A <plugin>:<name> in --skills or --agents moves that element out of another plugin of the marketplace (backed up, that plugin's version bumped and updated). --files rides a hooks.json, a hook script or an .mcp.json into the plugin; --drop-files retires them too.
  hunt create <same options> [--dry-run]
                                      Write the plugin, install it, retire the copies (--retire). Rolls back if the install fails. A copied skill's own absolute path becomes <this skill>/; the lines that still name a retired copy or another skill's absolute path are listed.
  hunt add --name <plugin> [--skills a,b] [--agents x,y] [--market <m>] [--retire] [--dry-run]
                                      Copy skills and agents into a plugin a marketplace of yours already has, bump its patch version, update it when installed, retire the copies (--retire) and move <plugin>:<name> elements out of their plugin as hunt create does. Rolls back if an update fails.
  agents list                         The agents of Global, the plugins and the repos, with the copies that differ and the gated ones.
  agents route "<prompt>" [--repo <dir>]
                                      Which agents the delegation plugin would route a prompt to, and which it drops.
  usage --session latest|previous|<id> [--repo <dir>] [--week] [--week-used <pct>]
                                      The tokens and cost of one session by model and by agent, and its share of the week.
  delegation --session latest|previous|<id> [--repo <dir>]
                                      The agents a session launched, with their decisions, slips and findings.
  media doctor <dir>                  Checks a film or an images folder under assets/films or assets/images.
  skills move --leaf <skill>/<path> --to <skill>[/<path>] [--market <dir>] [--dry-run]
                                      Move a leaf (file or folder) to another skill, or drop it when the target holds the same file; repoints references, backed up first. With --market either skill may be a plugin's; <plugin>:<skill> picks one when the name is in two places.
  skills split --from <skill> --name <new> --leaves a,b [--description <t>] [--market <dir>] [--dry-run]
                                      Make a new skill from leaves of one skill and repoint the references.
  skills put --file <file> --to <skill>/<path>|agents/<name>.md [--market <dir>] [--dry-run]
                                      Put a file into a skill: new or rewritten text no move can make (an existing file is backed up). The skill is found as skills move finds it.
  skills remove --name <skill>|--leaf <skill>/<path> [--repo <dir>] [--market <dir>] [--dry-run]
                                      Delete a skill, one leaf of it or a stray folder with no SKILL.md, backed up first, and list what still mentions it; --repo takes it from the repo's .claude/skills.
  skills repoint --from <skill> --to <skill>|<plugin>:<skill> [--skills a,b] [--agents x,y] [--market <dir>] [--dry-run]
                                      Rewrite the mentions of one skill name to another in skills and agents; the plugin folder that ships the skill and the synced skills stay as they are. To a plain name only reference forms change (name in backticks, <plugin>:name, skills/name, name/references/..., a link into the skill, "name skill"), never an agent's; every other mention is a check row.
  skills rename --from <skill>|<plugin>:<skill> --to <name> [--market <dir>] [--dry-run]
                                      Rename a skill's folder and its name: line, and rewrite its reference forms as repoint to a plain name does; backed up first.
  skills fix-paths --market <dir> [--plugin <p>] [--dry-run]
                                      In the market's plugin skills, a skill's own absolute path (~/.claude/skills/<name>/...) becomes <this skill>/, a path into a skill another plugin ships <plugin:skill>/; one that still exists under the root stays, the rest are check rows. Markdown only, backed up first.
  generate agent <name> [--scope repo|user] [--model <m>] [--tools a,b] [--description <t>] [--from <file>] [--dry-run]
                                      Make sure an agent exists as given in the repo (or ~/.claude); a rerun with nothing changed writes nothing. Alias g.
  generate rule <name> [--scope repo|user] [--paths a,b] [--from <file>] [--dry-run]
                                      Make sure a rule exists; --from takes the text of a template file.
  generate skill <name> [--scope repo|user] [--description <t>] [--from <file>] [--dry-run]
                                      Make sure a skill exists (a SKILL.md); --from takes the text of a template file.
  generate command <name> [--scope repo|user] [--description <t>] [--from <file>] [--dry-run]
                                      Make sure a slash command exists; a name with : goes into folders.
  generate hook <event> --command <c> [--matcher <m>] [--scope repo|user] [--dry-run]
                                      Make sure settings.json has a hook for the event (PreToolUse, PostToolUse, Stop ...) that runs the command.
  generate mcp <name> --url <u>|--command <c> [--args a,b] [--transport http|sse] [--scope repo|user] [--dry-run]
                                      Make sure an MCP server is configured, through claude mcp add.
  add <plugin>@<marketplace> [--scope repo|user] [--dry-run]
                                      Make sure a plugin is installed (claude plugin install) and enabled.
  new <repo> --summary <t> [--area name=glob[,glob]:owner]... [--rule <t>]... [--dry-run]
                                      Scaffold a repo's harness with the harness standard's scaffold script; files that exist are skipped.
  update [--repo <dir>] [--dry-run]   Bring installed plugins up to their marketplace version and the repo's skills and agents up to their Global copy.
  validate [<file>] [--repo <dir>]   Checks a .harness script line by line, and the harness of --repo (the standard's check and the CLAUDE.md pointers); writes nothing. Exit 2 script error, 1 harness problem.
  run <file> [--dry-run]              Validates a .harness script, then applies it step by step; stops at the first failing step and ends with a summary table.
  marketplaces                        Every marketplace with its plugins and their health.
  marketplaces rename --from <name> --to <name> [--dry-run]
                                      Rename a marketplace in its catalog, the settings and the commands that name it.
  plugins rename --from <plugin>@<market> --to <name> [--dry-run]
                                      Rename a plugin of a directory marketplace: its folder, plugin.json, catalog entry, dependents, enabledPlugins keys and the namespace, id and path in the text that names it (Markdown, the plugin's own json, mjs, ts, js and py files, and the plugin list's [name](name) link); bare mentions are listed by line; backed up first, the claude commands listed. A second run after the rename finishes what is left.
  check [--repo <dir>]                The harness checks of the known repos (or one) against the harness standard, and whether git ignores and no longer tracks .time/, .claude/settings.local.json and .claude/scheduled_tasks.lock.
  check fix [--repo <dir>] [--dry-run]
                                      Apply the fixes the checks offer for settings and hooks, add the missing session files to .gitignore and untrack the tracked ones (they stay on disk).
  fleet                               One row per repo: its harness, its checks and its CLAUDE.md.
  sync [--repo <dir>]                 The repo copies of skills and agents that differ from Global.
  sync apply [--repo <dir>] [--name <n>] [--dry-run]
                                      Sync those copies from Global, backed up first.
  sync plugin --name <plugin@market> [--dry-run]
                                      Update an installed plugin from its marketplace.
  sessions [--repo <dir>] [--limit <n>]
                                      The sessions of a repo in /resume order, with their names, start, minutes and agents.
  sessions rename --session latest|previous|<id> --title <t> [--repo <dir>] [--dry-run]
                                      Rename a session the way /rename does.
  mods --session latest|previous|<id> [--repo <dir>]
                                      Which mods and guards acted in a session, how often and what they held.
  time [--repo <dir>] [--days <n>]    The repo's time ledger (.time/working-time.md) by day, with the total.
  lessons [--repo <dir>] [--find <text>]
                                      The entries of the repo's tasks/lessons.md, optionally only those that mention a text.
  sources                             The skills installed from a source, with their source and version, and the plugin that ships each one linked to a plugin.
  sources check                       Which of those skills have an update at their source (a plugin's skill: a newer release tag than its recorded version).
  sources update --name <skill> [--plugin <plugin>] [--dry-run]
                                      Update one skill from its source, backed up first. A plugin-linked skill is staged (its recorded command, else downloaded), compared with the plugin's copy and, when it differs, replaces the plugin's skill folder whole (backed up), bumps the plugin's patch version and updates the installed plugin.
  sources link --name <skill> --source <owner/repo> --plugin <plugin> [--market <dir>] [--stage "<command>"] [--version <v>] [--dry-run]
                                      Record the source of a skill a plugin of your marketplace ships, so sources check and sources update follow it. --stage is run in an empty folder and must leave .claude/skills/<skill> there (e.g. npx -y ui-ux-pro-max-cli@latest init --ai claude --force).
  cowork pull <name> [--repo <dir>] [--kind skill|plugin] [--dry-run]
                                      Copy a Cowork skill, or the skills of a Cowork plugin, from the folders Claude.ai synced into the root to Global, or to the repo's .claude/skills, as a copy of your own. An existing copy is backed up first, the origin and content hash are recorded in .cowork-origins.json, and the synced folders are never written.
  complete --line "<command line>" [--position <n>]
                                      The candidates for the word at the cursor, one per line (--json for a list); the shell completers call it.
  completion powershell|bash          The script a shell profile evaluates to register Tab completion for harness.

Options:
  --root <dir>      Claude's folder (default ~/.claude)
  --repo <dir>      A repo to include besides the known ones (repeatable)
  --repos a,b       More repos to include, like the extension's repoFolders setting
  --json            JSON instead of text
  --dry-run         A command that writes prints each action as "[dry-run] ..." and writes nothing (--yes and --apply are accepted and do nothing)
  --help            This text

With --json every command ends in one JSON object with "applied": true|false; a dry run and a real run have the same shape.
Exit codes: 0 done, 1 error, 2 unknown flag or bad arguments.
`;

// ---- inventory ----

export interface InventoryItem {
  kind: Kind;
  name: string;
  description: string;
  file: string;
  enabled?: boolean;
  source?: string;
  version?: string;
  /** Cowork items only: who provides it. */
  owner?: string;
  copies?: { label: string; state: 'identical' | 'nearly identical' | 'differs' }[];
}
export interface InventoryOut {
  scope: { id: string; label: string; path: string };
  categories: { kind: Kind; label: string; count: number; items: InventoryItem[] }[];
  /** The repos the extension knows, which `--repo` can name. */
  repos: string[];
}

const stateOf = (c: { same: boolean; near?: boolean }) => (c.same ? 'identical' : c.near ? 'nearly identical' : 'differs');

/** One scope's inventory: Global when no repo is named. */
function inventoryOf(w: World, repo?: string, cowork = false): InventoryOut {
  const view = cowork ? w.cowork : repo ? w.views.find(v => v.id !== 'global' && samePath(v.path, repo)) : w.views[0];
  if (!view) throw new Stop(`${repo} is not a repo with a .claude folder or a CLAUDE.md.`);
  return {
    scope: { id: view.id, label: view.label, path: view.path },
    categories: view.categories.map(c => ({
      kind: c.kind,
      label: c.label,
      count: c.items.length,
      items: c.items.map((i: Asset) => ({
        kind: i.kind,
        name: i.name,
        description: i.description,
        file: i.file,
        ...(i.enabled !== undefined && { enabled: i.enabled }),
        ...(i.source && { source: i.source }),
        ...(i.version && { version: i.version }),
        ...(i.owner && { owner: i.owner }),
        ...(i.copies?.length && { copies: i.copies.map(c => ({ label: c.label, state: stateOf(c) })) }),
      })),
    })),
    repos: w.repos,
  };
}

/** Global, or the one repo given; every repo when --repo is repeated, one inventory each. */
export function inventory(a: Args): InventoryOut | InventoryOut[] {
  const w = load(a);
  const repos = a.flags.get('repo') ?? [];
  if (a.flags.has('cowork')) return inventoryOf(w, undefined, true);
  return repos.length > 1 ? repos.map(r => inventoryOf(w, r)) : inventoryOf(w, repos[0]);
}

const inventoryLines = (o: InventoryOut): string[] => [
  headline(`${o.scope.label} (${o.scope.path})`),
  ...o.categories.filter(c => c.count).flatMap(c => [
    '',
    headline(`${c.label} (${c.count})`),
    '',
    ...table(
      ['Name', 'Description', 'Status', 'Also in'],
      c.items.map(i => [i.name, i.description.slice(0, 100), i.enabled === false ? 'off' : '', i.copies?.map(x => `${x.label} (${x.state})`).join(', ') ?? '']),
    ),
  ]),
];

// ---- consolidate ----

export interface ConsolidateCopy {
  scope: string;
  label: string;
  file: string;
  /** Against the first copy, which is the reference. */
  state: 'reference' | 'identical' | 'nearly identical' | 'differs';
}
export interface ConsolidateElement {
  kind: Kind;
  name: string;
  copies: ConsolidateCopy[];
  allIdentical: boolean;
}
export interface ConsolidateOut {
  elements: ConsolidateElement[];
}

export function consolidate(a: Args): ConsolidateOut {
  const w = load(a);
  const name = one(a, 'name');
  const groups = new Map<string, Asset[]>();
  for (const view of w.views)
    for (const category of view.categories)
      for (const asset of category.items) if (asset.copies?.length && (!name || asset.name === name)) groups.set(`${asset.kind}:${asset.name}`, [...(groups.get(`${asset.kind}:${asset.name}`) ?? []), asset]);
  const labelOf = (scope: string) => w.views.find(v => v.id === scope)?.label ?? w.plugins.find(v => v.id === scope)?.label ?? scope;
  const elements = [...groups.values()].map(shown => {
    // The reference is the Global copy, else the first copy of a repo.
    const ref = shown.find(s => s.scope === 'global') ?? shown[0];
    const copies: ConsolidateCopy[] = [
      { scope: ref.scope, label: labelOf(ref.scope), file: ref.file, state: 'reference' },
      ...ref.copies!.map(c => ({ scope: c.scope, label: c.label, file: c.file, state: stateOf(c) as ConsolidateCopy['state'] })),
    ];
    return { kind: ref.kind, name: ref.name, copies, allIdentical: copies.every(c => c.state === 'reference' || c.state === 'identical') };
  });
  return { elements: elements.sort((x, y) => x.kind.localeCompare(y.kind) || x.name.localeCompare(y.name)) };
}

const consolidateLines = (o: ConsolidateOut): string[] =>
  o.elements.length
    ? [headline(`${o.elements.length} elements exist in more than one place`), '', ...table(['Kind', 'Name', 'Place', 'State', 'File'], o.elements.flatMap(e => e.copies.map(c => [e.kind, e.name, c.label, c.state, c.file])))]
    : [headline('No element exists in more than one place.')];

const catalogLines = (catalog: HuntCatalogItem[], strays: HuntStray[]): string[] => [
  headline(`${catalog.length} skills and agents can go into a plugin`),
  '',
  ...table(
    ['Kind', 'Name', 'Where', 'Shipped by', 'Description'],
    catalog.map(c => [c.asset.kind, c.asset.name, [c.asset.global ? 'global' : '', ...c.asset.repos.map(r => r.repo)].filter(Boolean).join(', '), c.asset.inPlugin ?? '', c.description.replace(/\s+/g, ' ').slice(0, 160)]),
  ),
  ...(strays.length
    ? ['', headline(`${strays.length} ${strays.length === 1 ? 'folder' : 'folders'} under a skills root ${strays.length === 1 ? 'has' : 'have'} no SKILL.md`), '', ...table(['Scope', 'Path', 'Why'], strays.map(s => [s.scope, s.path, s.why]))]
    : []),
];

export interface RetirePlan {
  kind: Kind;
  name: string;
  from: string;
  /** What is backed up and deleted. */
  path: string;
  backup: string;
  identicalTo: string[];
}

/** Resolves the copy to retire and checks it the way the extension does; the backup folder is stamped when it is carried out. */
function retirePlan(a: Args, w: World, stamp: string): { plan: RetirePlan; asset: Asset; base: string } {
  const name = one(a, 'name');
  const kind = one(a, 'kind');
  const from = one(a, 'from');
  if (!name || !from || (kind !== 'skill' && kind !== 'agent')) throw new Stop('consolidate retire needs --name <n> --kind skill|agent --from <global|repo dir>.', 2);
  const isGlobal = from === 'global';
  const view = isGlobal ? w.views[0] : w.views.find(v => v.id !== 'global' && samePath(v.path, from));
  if (!view) throw new Stop(`${from} is not a repo with a .claude folder or a CLAUDE.md.`);
  const asset = view.categories.find(c => c.kind === kind)?.items.find(i => i.name === name);
  if (!asset) throw new Stop(`${view.label} has no ${kind} named ${name}.`);
  const base = isGlobal ? w.root : view.path;
  const twins = (asset.copies ?? []).filter(c => c.same && (isGlobal ? c.scope.startsWith('plugin:') : c.scope === 'global' || c.scope.startsWith('plugin:')));
  const block = isGlobal ? (twins.length ? undefined : 'It has no identical plugin copy.') : retireBlock(asset, view.path, w.keep);
  if (block) throw new Stop(`${name} cannot be retired. ${block}`);
  const target = asset.dir ?? asset.file;
  const backup = path.join(w.root, 'repo-sync-backups', stamp, path.basename(base), path.relative(base, target));
  return { plan: { kind, name, from: view.label, path: target, backup, identicalTo: twins.map(c => c.label) }, asset, base };
}

// ---- hunt ----

export interface HuntPlanOut {
  name: string;
  market: string;
  problems: string[];
  /** Every file written, relative to the marketplace folder. */
  files: string[];
  /** Every copy retired, in words. */
  retired: string[];
  /** Copies that stay, with why. */
  kept: string[];
  /** The lines that still name a retired copy, by its old place or its bare name; only reported. */
  check: MentionRow[];
  source: string;
  dir: string;
}

/** `adding`: the plugin exists, so without --market the marketplace is the one of yours that lists it. */
function proposal(a: Args, w: World, catalog: HuntCatalogItem[], adding = false): { p: HuntProposal; market: HuntMarket } {
  const name = one(a, 'name');
  if (!name) throw new Stop('hunt needs --name <plugin>.', 2);
  const markets = readMarkets(w.root).filter(m => m.owned);
  const wanted = one(a, 'market');
  const installed = (m: string) => w.plugins.filter(p => p.id.endsWith(`@${m}`)).length;
  // As the extension picks it: the own marketplace that holds the most installed plugins.
  const market = wanted
    ? markets.find(m => m.name === wanted || samePath(m.location, wanted))
    : adding
      ? markets.find(m => catalogOf(m.location).some(e => e.name === name))
      : [...markets].sort((x, y) => installed(y.name) - installed(x.name))[0];
  if (!market)
    throw new Stop(
      wanted ? `${wanted} is not a marketplace folder of yours on disk.` : adding ? `No marketplace folder of yours lists a plugin called ${name}; pass --market.` : 'There is no marketplace folder of yours on disk; pass --market.'
    );
  const retire = !!one(a, 'retire');
  const assets: HuntAsset[] = [];
  for (const [kind, names] of [['skill', list(a, 'skills')], ['agent', list(a, 'agents')]] as const)
    for (const n of names) {
      // <plugin>:<name> moves the element out of another plugin of the same marketplace.
      const colon = n.indexOf(':');
      if (colon > 0) {
        const moved = pluginElement(market, kind, n.slice(0, colon), n.slice(colon + 1));
        if (typeof moved === 'string') throw new Stop(moved);
        assets.push(moved);
        continue;
      }
      const hit = catalog.find(c => c.asset.kind === kind && c.asset.name === n);
      if (!hit) throw new Stop(`There is no ${kind} named ${n} in Global or the repos.`);
      assets.push({ ...hit.asset, include: true, why: '', global: hit.asset.global && { ...hit.asset.global, retire }, repos: hit.asset.repos.map(r => ({ ...r, retire })) });
    }
  return { p: { id: name, prompt: '', created: 0, name, description: one(a, 'description') ?? name, category: one(a, 'category') ?? '', assets }, market };
}

/** `hunt plan` and `hunt create` answer with this; `backup` is the folder the retired copies go to, null when none are retired. */
export type HuntResult = HuntPlanOut & { installed: string; backup: string | null; applied?: boolean };

/** `hunt add` answers with this: `version` is the plugin's after the patch bump, `installed` the plugin key when it is installed and updated, else null. */
export interface HuntAddResult {
  name: string;
  market: string;
  problems: string[];
  files: string[];
  retired: string[];
  kept: string[];
  check: MentionRow[];
  version: string | null;
  installed: string | null;
  backup: string | null;
  applied?: boolean;
}

const planOut = (p: HuntProposal, market: HuntMarket, plan: CreatePlan, check: MentionRow[]): HuntPlanOut => ({
  name: p.name,
  market: market.name,
  problems: plan.problems,
  files: plan.files,
  retired: plan.retired,
  kept: plan.kept,
  check,
  source: plan.source,
  dir: plan.dir,
});

const checkLines = (check: MentionRow[]): string[] =>
  check.length
    ? ['', headline(`${check.length} ${check.length === 1 ? 'line still names' : 'lines still name'} a retired copy`), '', ...table(['File', 'Line', 'Text'], check.map(c => [c.file, c.line, c.text]), [false, true, false])]
    : [];

const planLines = (o: Pick<HuntPlanOut, 'name' | 'market' | 'problems' | 'files' | 'retired' | 'kept' | 'check'> & { dir?: string }): string[] => [
  `Plugin ${o.name} in ${o.market}${o.dir ? `: ${o.dir}` : ''}`,
  ...(o.problems.length ? ['Problems:', ...o.problems.map(x => `  ${x}`)] : []),
  'Writes:',
  ...o.files.map(f => `  ${f}`),
  ...(o.retired.length ? ['Retires (each backed up first):', ...o.retired.map(x => `  ${x}`)] : []),
  ...(o.kept.length ? ['Stays:', ...o.kept.map(x => `  ${x}`)] : []),
  ...checkLines(o.check),
];

/** One install or update of a create or add; `fresh` is a plugin this run installs for the first time. */
interface InstallStep {
  key: string;
  fresh: boolean;
  run: () => Promise<void>;
}

/** The plugins elements move out of that Claude Code has installed: each is updated from the marketplace after the target. */
function sourceSteps(plan: CreatePlan, market: HuntMarket, root: string): InstallStep[] {
  return (plan.sources ?? [])
    .map(b => ({ b, key: `${b.name}@${market.name}` }))
    .filter(x => isInstalled(root, x.key))
    .map(({ b, key }) => ({ key, fresh: false, run: () => updatePluginFromMarket(key, market.name, b.version ?? undefined, root) }));
}

/**
 * Runs the installs and updates in order. On a failure the files go back first (`undo`), then what the earlier steps changed in Claude
 * Code: a plugin installed by this run is uninstalled, an updated one is installed again at its restored version.
 */
async function runSteps(steps: InstallStep[], undo: () => void, market: HuntMarket, root: string, rolledBack: string): Promise<void> {
  const before = new Map(steps.map(s => [s.key, installedVersion(root, s.key)]));
  const done: InstallStep[] = [];
  for (const s of steps) {
    try {
      await s.run();
      done.push(s);
    } catch (e) {
      undo();
      // The failing step too, when it got as far as moving the installed version.
      if (installedVersion(root, s.key) !== before.get(s.key)) done.push(s);
      throw new Stop(`${(e as Error).message} ${rolledBack}${await putBack(done, market, root)}`);
    }
  }
}

async function putBack(done: InstallStep[], market: HuntMarket, root: string): Promise<string> {
  if (!done.length) return '';
  await runClaude(['plugin', 'marketplace', 'update', market.name], root);
  const failed: string[] = [];
  for (const s of done) {
    const off = await runClaude(['plugin', 'uninstall', s.key, '--scope', 'user'], root);
    const on = s.fresh || off.code !== 0 ? off : await runClaude(['plugin', 'install', s.key, '--scope', 'user'], root);
    if (off.code !== 0 || on.code !== 0) failed.push(s.key);
  }
  const keys = done.map(s => s.key).join(', ');
  return failed.length ? ` Putting ${failed.join(', ')} back in Claude Code failed; run claude plugin install for ${failed.length === 1 ? 'it' : 'them'}.` : ` Claude Code has ${keys} as before.`;
}

/** What a create or add moved and retired besides the target, for its last line. */
function doneText(plan: CreatePlan, sources: InstallStep[], backup: string | null): string {
  const moved = plan.moves?.length ?? 0;
  const retired = plan.retired.length - moved;
  const from = [...new Set((plan.moves ?? []).map(m => m.asset.plugin!.name))];
  return [
    moved ? ` Moved ${moved} ${moved === 1 ? 'element' : 'elements'} out of ${from.join(', ')}${sources.length ? `, updated ${sources.map(s => s.key).join(', ')}` : ''}.` : '',
    retired > 0 ? ` Retired ${retired} ${retired === 1 ? 'copy' : 'copies'}.` : '',
    backup ? ` Backed up in ${backup}.` : '',
  ].join('');
}

// ---- run ----

export async function run(argv: string[], io: Io): Promise<number> {
  try {
    const a = parse(argv);
    const [cmd, sub] = a.words;
    if (!cmd || one(a, 'help')) {
      io.out(HELP);
      return one(a, 'help') ? 0 : 1;
    }
    if (cmd === 'inventory') {
      const o = inventory(a);
      if (Array.isArray(o)) emit(io, a, { inventories: o }, o.flatMap((x, i) => [...(i ? [''] : []), ...inventoryLines(x)]));
      else emit(io, a, o, inventoryLines(o));
    } else if (cmd === 'agents') {
      return await agentsCommand(a, io);
    } else if (cmd === 'usage') {
      return await usageCommand(a, io);
    } else if (cmd === 'delegation') {
      return await delegationCommand(a, io);
    } else if (cmd === 'media') {
      return await mediaCommand(a, io);
    } else if (cmd === 'skills') {
      return await skillsCommand(a, io);
    } else if (cmd === 'generate' || cmd === 'g' || cmd === 'add' || cmd === 'new' || cmd === 'update' || cmd === 'validate' || cmd === 'run') {
      return await buildCommand(a, io);
    } else if (cmd === 'complete') {
      return await completeCommand(a, io);
    } else if (cmd === 'completion') {
      return await completionCommand(a, io);
    } else if (cmd === 'marketplaces') {
      return await marketplacesCommand(a, io);
    } else if (cmd === 'plugins') {
      return await pluginsCommand(a, io);
    } else if (cmd === 'check') {
      return await checkCommand(a, io);
    } else if (cmd === 'fleet') {
      return await fleetCommand(a, io);
    } else if (cmd === 'sync') {
      return await syncCommand(a, io);
    } else if (cmd === 'sessions') {
      return await sessionsCommand(a, io);
    } else if (cmd === 'mods') {
      return await modsCommand(a, io);
    } else if (cmd === 'time') {
      return await timeCommand(a, io);
    } else if (cmd === 'lessons') {
      return await lessonsCommand(a, io);
    } else if (cmd === 'sources') {
      return await sourcesCommand(a, io);
    } else if (cmd === 'cowork') {
      return await coworkCommand(a, io);
    } else if (cmd === 'consolidate' && sub === 'retire') {
      const w = load(a);
      const stamp = backupStamp();
      const { plan, asset, base } = retirePlan(a, w, stamp);
      if (one(a, 'dry-run')) {
        emit(io, a, plan,[`[dry-run] back up ${plan.path} to ${plan.backup}`, `[dry-run] delete ${plan.path} (identical to ${plan.identicalTo.join(', ')})`]);
        return 0;
      }
      retireAsset(asset, base, path.join(w.root, 'repo-sync-backups'), stamp);
      emit(io, a, plan,[`Retired ${plan.name}. Backup: ${plan.backup}`], true);
    } else if (cmd === 'consolidate' && !sub) {
      const o = consolidate(a);
      emit(io, a, o, consolidateLines(o));
    } else if (cmd === 'hunt' && sub === 'catalog') {
      const w = load(a);
      const kind = one(a, 'kind');
      if (kind && kind !== 'skill' && kind !== 'agent') throw new Stop(`hunt catalog --kind takes skill or agent, got "${kind}".`, 2);
      const query = (one(a, 'query') ?? '').toLowerCase();
      const catalog = buildCatalog(w.views, w.plugins).filter(c => (!kind || c.asset.kind === kind) && (!query || `${c.asset.name} ${c.description}`.toLowerCase().includes(query)));
      const strays = straysOf(w.views);
      emit(io, a, { catalog, markets: readMarkets(w.root), strays }, catalogLines(catalog, strays));
    } else if (cmd === 'hunt' && (sub === 'plan' || sub === 'create')) {
      const w = load(a);
      const { p, market } = proposal(a, w, buildCatalog(w.views, w.plugins));
      const backupRoot = path.join(w.root, 'repo-sync-backups');
      const files = list(a, 'files').map(x => {
        const i = x.lastIndexOf('=');
        if (i < 1 || i === x.length - 1) throw new Stop(`--files needs <file>=<path in the plugin>, got "${x}".`, 2);
        const from = x.slice(0, i);
        // Only a file of Claude's own folder is retired; one from anywhere else stays.
        return { from, to: x.slice(i + 1), drop: !!one(a, 'drop-files') && !path.relative(w.root, path.resolve(from)).startsWith('..') };
      });
      const plan = planCreate(p, { root: w.root, views: w.views, market, backupRoot, keep: w.keep, files });
      const stamp = backupStamp();
      const key = `${p.name}@${market.name}`;
      const out: HuntResult = { ...planOut(p, market, plan, staleMentions(plan, { root: w.root, views: w.views, market })), installed: key, backup: plan.retired.length ? path.join(backupRoot, stamp) : null };
      if (plan.problems.length) {
        emit(io, a, out,planLines(out));
        return 1;
      }
      if (sub === 'plan' || one(a, 'dry-run')) {
        emit(io, a, out, [
          ...plan.files.map(f => `[dry-run] write ${f}`),
          `[dry-run] claude plugin install ${key} --scope user`,
          ...sourceSteps(plan, market, w.root).map(s => `[dry-run] claude plugin marketplace update ${market.name}, then claude plugin update ${s.key}`),
          ...plan.retired.map(r => `[dry-run] back up and retire ${r}`),
          ...checkLines(out.check),
        ]);
        return 0;
      }
      const sources = sourceSteps(plan, market, w.root);
      await writePlugin(p, plan, market);
      let unmove: () => void;
      try {
        unmove = writeMoves(plan, market, backupRoot, stamp);
      } catch (e) {
        unwritePlugin(p, plan, market);
        throw e;
      }
      await runSteps(
        [{ key, fresh: true, run: () => installPlugin(p, market, w.root) }, ...sources],
        () => {
          unmove();
          unwritePlugin(p, plan, market);
        },
        market,
        w.root,
        `The plugin folder and its marketplace entry were removed again${plan.moves?.length ? ', and the moved elements are back in their plugins' : ''}; no copy was retired.`
      );
      if (plan.retired.length) retireCopies(plan, backupRoot, stamp);
      emit(io, a, out, [`Created and installed ${key}.${doneText(plan, sources, out.backup)}`, ...checkLines(out.check)], true);
    } else if (cmd === 'hunt' && sub === 'add') {
      const w = load(a);
      const { p, market } = proposal(a, w, buildCatalog(w.views, w.plugins), true);
      const backupRoot = path.join(w.root, 'repo-sync-backups');
      const plan = planAdd(p, { root: w.root, views: w.views, market, backupRoot, keep: w.keep });
      const stamp = backupStamp();
      const key = `${p.name}@${market.name}`;
      const installed = isInstalled(w.root, key);
      const out: HuntAddResult = {
        name: p.name,
        market: market.name,
        problems: plan.problems,
        files: plan.files,
        retired: plan.retired,
        kept: plan.kept,
        check: staleMentions(plan, { root: w.root, views: w.views, market }),
        version: plan.version,
        installed: installed ? key : null,
        backup: plan.retired.length ? path.join(backupRoot, stamp) : null,
      };
      if (plan.problems.length) {
        emit(io, a, out, planLines({ ...out, dir: plan.dir }));
        return 1;
      }
      const sources = sourceSteps(plan, market, w.root);
      const steps: InstallStep[] = [...(installed ? [{ key, fresh: false, run: () => updatePluginFromMarket(key, market.name, plan.version ?? undefined, w.root) }] : []), ...sources];
      if (one(a, 'dry-run')) {
        emit(io, a, out, [
          ...plan.files.map(f => `[dry-run] write ${f}`),
          ...steps.map(s => `[dry-run] claude plugin marketplace update ${market.name}, then claude plugin update ${s.key}`),
          ...plan.retired.map(r => `[dry-run] back up and retire ${r}`),
          ...checkLines(out.check),
        ]);
        return 0;
      }
      const undo = await writeAddition(plan, market);
      let unmove: () => void;
      try {
        unmove = writeMoves(plan, market, backupRoot, stamp);
      } catch (e) {
        undo();
        throw e;
      }
      await runSteps(
        steps,
        () => {
          unmove();
          undo();
        },
        market,
        w.root,
        `The added elements and the version bump were taken out again${plan.moves?.length ? ', and the moved elements are back in their plugins' : ''}; no copy was retired.`
      );
      if (plan.retired.length) retireCopies(plan, backupRoot, stamp);
      const n = plan.chosen.length;
      emit(
        io,
        a,
        out,
        [
          `Added ${n} ${n === 1 ? 'element' : 'elements'} to ${key}${plan.version ? ` at ${plan.version}` : ''}; ${installed ? 'the installed plugin is updated' : 'it is not installed, so there is nothing to update'}.${doneText(plan, sources, out.backup)}`,
          ...checkLines(out.check),
        ],
        true
      );
    } else throw new Stop(`Unknown command: ${a.words.join(' ')}. Run with --help.`);
    return 0;
  } catch (e) {
    io.err((e as Error).message);
    return e instanceof Stop ? e.code : 1;
  }
}

if (require.main === module) {
  void run(process.argv.slice(2), { out: t => process.stdout.write(`${t}\n`), err: t => process.stderr.write(`${t}\n`) }).then(code => {
    process.exitCode = code;
  });
}
