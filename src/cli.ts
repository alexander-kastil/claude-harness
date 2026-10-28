#!/usr/bin/env node
import * as path from 'path';
import { Asset, Kind, backupStamp, retireAsset, retireBlock } from './harness';
import { buildCatalog, samePath } from './hunt-catalog';
import { CreatePlan, installPlugin, planCreate, retireCopies, unwritePlugin, writePlugin } from './hunt-create';
import { readMarkets } from './hunt-market';
import type { HuntAsset, HuntCatalogItem, HuntMarket, HuntProposal } from './shared/hunt';
import { Args, Io, Stop, World, emit, headline, list, load, one, parse, table } from './cli-core';
import { agentsCommand } from './cli-agents';
import { mediaCommand } from './cli-media';
import { delegationCommand, usageCommand } from './cli-insights';
import { skillsCommand } from './cli-skills';
import { completeCommand, completionCommand } from './cli-complete';
import { marketplacesCommand } from './cli-markets';
import { checkCommand } from './cli-check';
import { fleetCommand } from './cli-fleet';
import { syncCommand } from './cli-sync';
import { sessionsCommand } from './cli-sessions';
import { modsCommand } from './cli-mods';
import { lessonsCommand, timeCommand } from './cli-learn';
import { sourcesCommand } from './cli-sources';

export { parse };

// The harness features of the extension without VS Code: plain Node, no `vscode` import, directly or through a module.

const HELP = `claude-harness (preview): the Claude Harness features from a terminal or a skill.

Usage: node cli.js <command> [options]

  inventory [--repo <dir>]            The harness of Global or one repo: memory, rules, agents, skills, commands, hooks, MCP servers, plugins.
  consolidate [--name <n>]            Every skill, agent, rule, command or workflow that exists in more than one place, with its copies.
  consolidate retire --name <n> --kind skill|agent --from <global|repo dir> [--dry-run]
                                      Retire one copy, backed up first (same backup as the extension).
  hunt catalog                        The skills and agents across Global and repos that a plugin can be made from.
  hunt plan --name <plugin> --category <c> --skills a,b --agents x,y [--files <file>=<path in plugin>,...] [--drop-files] [--market <m>] [--description <t>] [--retire]
                                      The same as hunt create --dry-run. --files rides a hooks.json, a hook script or an .mcp.json into the plugin; --drop-files retires them too.
  hunt create <same options> [--dry-run]
                                      Write the plugin, install it, retire the copies (--retire). Rolls back if the install fails.
  agents list                         The agents of Global, the plugins and the repos, with the copies that differ and the gated ones.
  agents route "<prompt>" [--repo <dir>]
                                      Which agents the delegation plugin would route a prompt to, and which it drops.
  usage --session latest|previous|<id> [--repo <dir>] [--week] [--week-used <pct>]
                                      The tokens and cost of one session by model and by agent, and its share of the week.
  delegation --session latest|previous|<id> [--repo <dir>]
                                      The agents a session launched, with their decisions, slips and findings.
  media doctor <dir>                  Checks a film or an images folder under assets/films or assets/images.
  skills move --leaf <skill>/<path> --to <skill>[/<path>] [--market <dir>] [--dry-run]
                                      Move a leaf (file or folder) to another skill, or drop it when the target holds the same file; repoints references, backed up first.
  skills split --from <skill> --name <new> --leaves a,b [--description <t>] [--market <dir>] [--dry-run]
                                      Make a new skill from leaves of one skill and repoint the references.
  skills put --file <file> --to <skill>/<path>|agents/<name>.md [--dry-run]
                                      Put a file into a skill: new or rewritten text no move can make (an existing file is backed up).
  skills remove --name <skill>|--leaf <skill>/<path> [--market <dir>] [--dry-run]
                                      Delete a skill or one leaf of it, backed up first, and list what still mentions it.
  skills repoint --from <skill> --to <skill> [--skills a,b] [--agents x,y] [--market <dir>] [--dry-run]
                                      Rewrite the mentions of one skill name to another in skills and agents.
  marketplaces                        Every marketplace with its plugins and their health.
  marketplaces rename --from <name> --to <name> [--dry-run]
                                      Rename a marketplace in its catalog, the settings and the commands that name it.
  check [--repo <dir>]                The harness checks of the known repos (or one) against the harness standard.
  check fix [--repo <dir>] [--dry-run]
                                      Apply the fixes the checks offer for settings and hooks.
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
  sources                             The skills installed from a source, with their source and version.
  sources check                       Which of those skills have an update at their source.
  sources update --name <skill> [--dry-run]
                                      Update one skill from its source, backed up first.
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
function inventoryOf(w: World, repo?: string): InventoryOut {
  const view = repo ? w.views.find(v => v.id !== 'global' && samePath(v.path, repo)) : w.views[0];
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

const catalogLines = (catalog: HuntCatalogItem[]): string[] => [
  headline(`${catalog.length} skills and agents can go into a plugin`),
  '',
  ...table(
    ['Kind', 'Name', 'Where', 'Shipped by', 'Description'],
    catalog.map(c => [c.asset.kind, c.asset.name, [c.asset.global ? 'global' : '', ...c.asset.repos.map(r => r.repo)].filter(Boolean).join(', '), c.asset.inPlugin ?? '', c.description.replace(/\s+/g, ' ').slice(0, 160)]),
  ),
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
  source: string;
  dir: string;
}

function proposal(a: Args, w: World, catalog: HuntCatalogItem[]): { p: HuntProposal; market: HuntMarket } {
  const name = one(a, 'name');
  if (!name) throw new Stop('hunt needs --name <plugin>.', 2);
  const retire = !!one(a, 'retire');
  const assets: HuntAsset[] = [];
  for (const [kind, names] of [['skill', list(a, 'skills')], ['agent', list(a, 'agents')]] as const)
    for (const n of names) {
      const hit = catalog.find(c => c.asset.kind === kind && c.asset.name === n);
      if (!hit) throw new Stop(`There is no ${kind} named ${n} in Global or the repos.`);
      assets.push({ ...hit.asset, include: true, why: '', global: hit.asset.global && { ...hit.asset.global, retire }, repos: hit.asset.repos.map(r => ({ ...r, retire })) });
    }
  const markets = readMarkets(w.root).filter(m => m.owned);
  const wanted = one(a, 'market');
  const installed = (m: string) => w.plugins.filter(p => p.id.endsWith(`@${m}`)).length;
  // As the extension picks it: the own marketplace that holds the most installed plugins.
  const market = wanted ? markets.find(m => m.name === wanted || samePath(m.location, wanted)) : [...markets].sort((x, y) => installed(y.name) - installed(x.name))[0];
  if (!market) throw new Stop(wanted ? `${wanted} is not a marketplace folder of yours on disk.` : 'There is no marketplace folder of yours on disk; pass --market.');
  return { p: { id: name, prompt: '', created: 0, name, description: one(a, 'description') ?? name, category: one(a, 'category') ?? '', assets }, market };
}

/** `hunt plan` and `hunt create` answer with this; `backup` is the folder the retired copies go to, null when none are retired. */
export type HuntResult = HuntPlanOut & { installed: string; backup: string | null; applied?: boolean };

const planOut = (p: HuntProposal, market: HuntMarket, plan: CreatePlan): HuntPlanOut => ({ name: p.name, market: market.name, problems: plan.problems, files: plan.files, retired: plan.retired, kept: plan.kept, source: plan.source, dir: plan.dir });

const planLines = (o: HuntPlanOut): string[] => [
  `Plugin ${o.name} in ${o.market}: ${o.dir}`,
  ...(o.problems.length ? ['Problems:', ...o.problems.map(x => `  ${x}`)] : []),
  'Writes:',
  ...o.files.map(f => `  ${f}`),
  ...(o.retired.length ? ['Retires (each backed up first):', ...o.retired.map(x => `  ${x}`)] : []),
  ...(o.kept.length ? ['Stays:', ...o.kept.map(x => `  ${x}`)] : []),
];

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
    } else if (cmd === 'complete') {
      return await completeCommand(a, io);
    } else if (cmd === 'completion') {
      return await completionCommand(a, io);
    } else if (cmd === 'marketplaces') {
      return await marketplacesCommand(a, io);
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
      const catalog = buildCatalog(w.views, w.plugins);
      emit(io, a, { catalog, markets: readMarkets(w.root) }, catalogLines(catalog));
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
      const out: HuntResult = { ...planOut(p, market, plan), installed: key, backup: plan.retired.length ? path.join(backupRoot, stamp) : null };
      if (plan.problems.length) {
        emit(io, a, out,planLines(out));
        return 1;
      }
      if (sub === 'plan' || one(a, 'dry-run')) {
        emit(io, a, out,[...plan.files.map(f => `[dry-run] write ${f}`), `[dry-run] claude plugin install ${key} --scope user`, ...plan.retired.map(r => `[dry-run] back up and retire ${r}`)]);
        return 0;
      }
      await writePlugin(p, plan, market);
      try {
        await installPlugin(p, market, w.root);
      } catch (e) {
        unwritePlugin(p, plan, market);
        throw new Stop(`${(e as Error).message} The plugin folder and its marketplace entry were removed again; no copy was retired.`);
      }
      if (plan.retired.length) retireCopies(plan, backupRoot, stamp);
      emit(io, a, out,[`Created and installed ${key}.${out.backup ? ` Retired ${plan.retired.length} copies, backed up in ${out.backup}.` : ''}`], true);
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
