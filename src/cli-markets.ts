import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { knownRepos } from './harness';
import { FileEdit, MarketHealth, MarketPlugin, marketplaceHealth, renameCatalog, renameCommands, renameInSettings } from './fleet';
import { Args, Io, Stop, emit, headline, list, one, table } from './cli-core';

// `marketplaces`: every marketplace with its plugins and their health; `marketplaces rename` renames one, as the extension's Rename Marketplace does, without its dialogs.

const NAME = /^[a-z0-9][a-z0-9-]*$/;

export interface MarketRow {
  name: string;
  kind: string;
  source: string;
  location: string;
  plugins: number;
  installed: number;
  enabled: number;
  updates: number;
  /** Plugins available in Code only. */
  notInCowork: number;
  /** Every plugin with where it is available: code, cowork, both or none. */
  harness: { plugin: string; state: string }[];
}

export interface MarketProblem {
  marketplace: string;
  plugin: string;
  problem: 'Update available' | 'Enabled, not installed';
  installed: string | null;
  source: string | null;
}

export interface MarketplacesOut {
  marketplaces: MarketRow[];
  problems: MarketProblem[];
}

export interface RenameOut {
  from: string;
  to: string;
  kind: string;
  changes: { file: string; detail: string }[];
  commands: string[];
}

const rootOf = (a: Args) => path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));

export async function marketplacesCommand(a: Args, io: Io): Promise<number> {
  const [, sub] = a.words;
  if (!sub) return marketplacesList(a, io);
  if (sub === 'rename') return marketplacesRename(a, io);
  throw new Stop('marketplaces takes no word, or rename. Run with --help.', 2);
}

// ---- list ----

/** The health the extension shows: a source ahead of the installed copy, and an enabled plugin with no installed copy. */
function problemOf(marketplace: string, p: MarketPlugin): MarketProblem | undefined {
  if (p.ahead) return { marketplace, plugin: p.name, problem: 'Update available', installed: p.installed ?? null, source: p.source ?? null };
  if (p.enabled && !p.installed) return { marketplace, plugin: p.name, problem: 'Enabled, not installed', installed: null, source: p.source ?? null };
  return undefined;
}

function marketplacesList(a: Args, io: Io): number {
  const markets: MarketHealth[] = marketplaceHealth(rootOf(a));
  const out: MarketplacesOut = {
    marketplaces: markets.map(m => ({
      name: m.name,
      kind: m.kind,
      source: m.source,
      location: m.location,
      plugins: m.plugins.length,
      installed: m.plugins.filter(p => p.installed).length,
      enabled: m.plugins.filter(p => p.enabled).length,
      updates: m.plugins.filter(p => p.ahead).length,
      notInCowork: m.plugins.filter(p => p.harness === 'code').length,
      harness: m.plugins.map(p => ({ plugin: p.name, state: p.harness ?? 'code' })),
    })),
    problems: markets.flatMap(m => m.plugins.map(p => problemOf(m.name, p)).filter((x): x is MarketProblem => !!x)),
  };
  const rows = out.marketplaces.map(m => [m.name, m.kind, m.source, m.plugins, m.installed, m.enabled, m.updates, m.notInCowork]);
  const problems = out.problems.length
    ? [
        '',
        headline('Problems'),
        '',
        ...table(
          ['Marketplace', 'Plugin', 'Problem', 'Installed', 'Source'],
          out.problems.map(p => [p.marketplace, p.plugin, p.problem, p.installed ?? '-', p.source ?? '-'])
        ),
      ]
    : [];
  emit(io, a, out, [
    headline(`Marketplaces: ${markets.length}, ${out.problems.length} problem${out.problems.length === 1 ? '' : 's'}`),
    '',
    ...table(['Marketplace', 'Kind', 'Source', 'Plugins', 'Installed', 'Enabled', 'Updates', 'Not in Cowork'], rows.length ? rows : [['(none)', '', '', '', '', '', '', '']], [false, false, false, true, true, true, true, true]),
    ...(markets.some(m => m.plugins.length)
      ? [
          '',
          headline('Harness'),
          '',
          ...table(
            ['Marketplace', 'Plugin', 'Harness'],
            markets.flatMap(m => m.plugins.map(p => [m.name, p.name, { code: 'Code', cowork: 'Cowork', both: 'Both', none: 'None' }[p.harness ?? 'code']]))
          ),
        ]
      : []),
    ...problems,
  ]);
  return 0;
}

// ---- rename ----

const renameLines = (o: RenameOut, dry: boolean): string[] => [
  headline(`Rename ${o.from} to ${o.to}: ${o.changes.length} file${o.changes.length === 1 ? '' : 's'}`),
  '',
  ...table(['Action', 'File', 'Detail'], o.changes.length ? o.changes.map(c => ['rewrite', c.file, c.detail]) : [['(none)', '', '']]),
  ...(dry ? o.changes.map(c => `[dry-run] rewrite ${c.file}: ${c.detail}`) : []),
  '',
  headline('Re-register in a terminal'),
  '',
  ...table(['Step', 'Command'], o.commands.map((c, i) => [i + 1, c]), [true, false]),
];

function marketplacesRename(a: Args, io: Io): number {
  const from = one(a, 'from');
  const to = one(a, 'to');
  if (!from || !to) throw new Stop('marketplaces rename needs --from <name> --to <name>.', 2);
  if (!NAME.test(to)) throw new Stop(`--to takes lowercase letters, digits and dashes, got "${to}".`, 2);
  const root = rootOf(a);
  const markets = marketplaceHealth(root);
  const market = markets.find(m => m.name === from);
  if (!market) throw new Stop(`There is no marketplace named ${from}.`);
  if (markets.some(m => m.name === to)) throw new Stop(`${to} already exists.`);
  if (market.kind !== 'directory') {
    throw new Stop(`${from} is a ${market.kind} marketplace: its name comes from the marketplace.json at its source, so it can only be renamed there.`);
  }
  // The same order as the extension: the global settings, the catalog, then each known repo's settings.
  const userConfig = one(a, 'user-config') ?? path.join(os.homedir(), '.claude.json');
  const repos = knownRepos([...(a.flags.get('repo') ?? []), ...list(a, 'repos')], userConfig);
  const edits = [
    renameInSettings(path.join(root, 'settings.json'), from, to),
    renameCatalog(market.location, to),
    ...repos.flatMap(dir => ['settings.json', 'settings.local.json'].map(f => renameInSettings(path.join(dir, '.claude', f), from, to))),
  ].filter((e): e is FileEdit => !!e);
  const dry = !!one(a, 'dry-run');
  const out: RenameOut = {
    from,
    to,
    kind: market.kind,
    changes: edits.map(e => ({ file: e.file, detail: `@${from} to @${to}` })),
    commands: renameCommands(market, to),
  };
  if (!dry) for (const e of edits) fs.writeFileSync(e.file, e.after, 'utf8');
  emit(io, a, out, renameLines(out, dry), !dry);
  return 0;
}
