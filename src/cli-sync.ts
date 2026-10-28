import * as os from 'os';
import * as path from 'path';
import { Asset, backupStamp } from './harness';
import { Args, Io, Stop, World, emit, headline, load, one, table } from './cli-core';
import { marketplaceHealth } from './fleet';
import { SyncFiles, syncApply, syncFiles, syncSource, updatePluginFromMarket } from './sync';

// `sync`: the repo copies of skills and agents that differ from Global; `sync apply` syncs them, `sync plugin` updates a plugin from its marketplace.

/** A repo copy that differs from its Global copy, and what the sync would change in its files. */
export interface SyncCopy {
  repo: string;
  kind: 'skill' | 'agent';
  name: string;
  state: 'differs' | 'nearly identical';
  files: SyncFiles;
}

export interface SyncApplyCopy extends SyncCopy {
  /** The backup folder of the repo copy before it was replaced; null on a dry run or when the sync failed. */
  backup: string | null;
  error?: string;
}

interface Found {
  row: SyncCopy;
  asset: Asset;
  source: Asset;
}

const rootOf = (a: Args) => path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));

/** A folder as one comparable key: Windows folders are compared without case. */
const folderKey = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

/** The repo copies that differ from Global, in the repos that `--repo` names or else in every known repo. */
function findCopies(w: World, a: Args): Found[] {
  const only = (a.flags.get('repo') ?? []).map(folderKey);
  const globals = w.views.flatMap(v => v.categories.flatMap(c => c.items));
  const found: Found[] = [];
  for (const view of w.views) {
    if (view.id === 'global' || (only.length && !only.includes(folderKey(view.path)))) continue;
    for (const category of view.categories) {
      if (category.kind !== 'skill' && category.kind !== 'agent') continue;
      for (const asset of category.items) {
        const { source } = syncSource(asset, view.path);
        const from = source && globals.find(g => g.id === source.id);
        if (!source || !from) continue;
        found.push({
          row: { repo: view.path, kind: category.kind, name: asset.name, state: source.near ? 'nearly identical' : 'differs', files: syncFiles(asset, from) },
          asset,
          source: from,
        });
      }
    }
  }
  return found.sort((x, y) => x.row.repo.localeCompare(y.row.repo) || x.row.name.localeCompare(y.row.name));
}

const HEAD = ['Repo', 'Kind', 'Name', 'State', 'Replaced', 'Added', 'Deleted'];
const RIGHT = [false, false, false, false, true, true, true];

const copyCells = (r: SyncCopy) => [r.repo, r.kind, r.name, r.state, r.files.replaced.length, r.files.added.length, r.files.deleted.length];

const noneRow = (width: number) => [['(none)', ...Array(width - 1).fill('')]];

async function listCommand(a: Args, io: Io): Promise<number> {
  const rows = findCopies(load(a), a).map(f => f.row);
  const copies = `${rows.length} ${rows.length === 1 ? 'copy differs' : 'copies differ'}`;
  emit(io, a, { copies: rows }, [
    headline(`Sync · ${copies} from Global`),
    '',
    ...table(HEAD, rows.length ? rows.map(copyCells) : noneRow(HEAD.length), RIGHT),
  ]);
  return 0;
}

async function applyCommand(a: Args, io: Io): Promise<number> {
  const w = load(a);
  const name = one(a, 'name');
  const dry = !!one(a, 'dry-run');
  const found = findCopies(w, a).filter(f => !name || f.asset.name === name);
  if (name && !found.length) throw new Stop(`No repo copy named ${name} differs from Global.`, 1);
  const backupRoot = path.join(w.root, 'repo-sync-backups');
  const stamp = backupStamp();
  const copies: SyncApplyCopy[] = [];
  for (const f of found) {
    if (dry) {
      copies.push({ ...f.row, backup: null });
      continue;
    }
    try {
      copies.push({ ...f.row, backup: syncApply(f.asset, f.source, f.row.repo, backupRoot, stamp) });
    } catch (e) {
      copies.push({ ...f.row, backup: null, error: (e as Error).message });
    }
  }
  const failed = copies.filter(c => c.error).length;
  const verb = dry ? 'Would sync' : 'Synced';
  const text = [
    headline(`${verb} ${copies.length} ${copies.length === 1 ? 'copy' : 'copies'} from Global${failed ? `, ${failed} failed` : ''}`),
    '',
    ...table(
      [...HEAD, 'Result', 'Backup'],
      copies.length ? copies.map(c => [...copyCells(c), c.error ? `failed: ${c.error}` : dry ? 'would sync' : 'synced', c.backup ?? '']) : noneRow(HEAD.length + 2),
      [...RIGHT, false, false],
    ),
    ...(dry ? copies.map(c => `[dry-run] sync ${c.kind} ${c.name} in ${c.repo}: ${c.files.replaced.length} replaced, ${c.files.added.length} added, ${c.files.deleted.length} deleted.`) : []),
  ];
  emit(io, a, { copies }, text, !dry && copies.some(c => c.backup));
  return failed ? 1 : 0;
}

async function pluginCommand(a: Args, io: Io): Promise<number> {
  const key = one(a, 'name');
  if (!key || !key.includes('@')) throw new Stop('sync plugin needs --name <plugin@market>.', 2);
  const root = rootOf(a);
  const market = marketplaceHealth(root).find(m => m.plugins.some(p => p.key === key));
  const plugin = market?.plugins.find(p => p.key === key);
  if (!market || !plugin) throw new Stop(`${key} is not in a registered marketplace.`, 1);
  const dry = !!one(a, 'dry-run');
  let action: 'current' | 'would update' | 'updated' = 'current';
  if (plugin.ahead) {
    action = dry ? 'would update' : 'updated';
    if (!dry) {
      try {
        await updatePluginFromMarket(key, market.name, plugin.source, root);
      } catch (e) {
        throw new Stop((e as Error).message, 1);
      }
    }
  }
  const out = { plugin: key, market: market.name, installed: plugin.installed ?? null, source: plugin.source ?? null, action };
  const text = [
    headline(`Sync plugin · ${key} · ${action}`),
    '',
    ...table(['Plugin', 'Market', 'Installed', 'Source', 'Action'], [[key, market.name, plugin.installed ?? '', plugin.source ?? '', action]]),
    ...(action === 'would update'
      ? [`[dry-run] claude plugin marketplace update ${market.name}, then claude plugin update ${key}.`]
      : []),
  ];
  emit(io, a, out, text, action === 'updated');
  return 0;
}

export async function syncCommand(a: Args, io: Io): Promise<number> {
  const [, sub] = a.words;
  if (sub === undefined) return listCommand(a, io);
  if (sub === 'apply') return applyCommand(a, io);
  if (sub === 'plugin') return pluginCommand(a, io);
  throw new Stop('sync needs apply or plugin, or no word for the list. Run with --help.', 2);
}
