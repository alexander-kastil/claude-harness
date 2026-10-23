import * as path from 'path';
import { projectSlug } from './fleet';
import type { Asset, ScopeView } from './harness';
import type { HitKind } from './usage-scan';
import type { IndexData } from './usage';

// What the detail page's Used in tab shows: the target of one agent or skill, and the sessions of the index that match it.

/** One session that used an element, for the detail page's Used in tab. */
export interface UsageSession {
  id: string;
  title: string;
  /** Display name of the repo the session ran in. */
  repo: string;
  /** The repo view the session page opens under; absent when no listed repo holds the session. */
  scope?: string;
  /** Set only when more than one account is configured. */
  account?: string;
  /** The last use in this session, ms. */
  last: number;
  /** Uses in this session: agent launches, or skill calls and slash commands. */
  count: number;
}

/** What counts as a use of one element. */
export interface UsageTarget {
  kind: 'agent' | 'skill';
  /** The name transcripts use: `plugin:name` for a plugin's element, the bare name for an own one. */
  name: string;
  /** Count only sessions whose cwd is inside this folder: a repo's copy of a global element. */
  inside?: string;
  /** Leave out sessions whose cwd is inside one of these folders: repos with their own copy of a global element. */
  outside: string[];
}

const ownIn = (view: ScopeView | undefined, kind: string, name: string) =>
  !!view && (view.categories.find(c => c.kind === kind)?.items ?? []).some(a => a.name === name && a.scope === view.id && a.source !== 'plugin');

/** The target of an agent or skill; `views` starts with the global one, as the host lists them. */
export function usageTarget(asset: Asset, views: ScopeView[]): UsageTarget | undefined {
  if (asset.kind !== 'agent' && asset.kind !== 'skill') return undefined;
  const kind = asset.kind;
  if (asset.source === 'plugin' && asset.scope.startsWith('plugin:')) return { kind, name: `${asset.scope.slice('plugin:'.length).split('@')[0]}:${asset.name}`, outside: [] };
  const global = views.find(v => v.id === 'global');
  if (asset.scope === 'global') return { kind, name: asset.name, outside: views.filter(v => v !== global && ownIn(v, kind, asset.name)).map(v => v.path) };
  const repo = views.find(v => v.id === asset.scope);
  return { kind, name: asset.name, inside: repo && ownIn(global, kind, asset.name) ? repo.path : undefined, outside: [] };
}

const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

const within = (cwd: string | undefined, dir: string) => {
  if (!cwd) return false;
  const c = norm(cwd);
  const d = norm(dir);
  return c === d || c.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/**
 * One row per session that used the target, newest use first. A session opens under the repo whose project folder
 * holds it, or, for a headless run started from a session's scratchpad, under that session's repo.
 */
export function usageRows(data: IndexData, target: UsageTarget, repos: { id: string; label: string; path: string }[], accounts: { label: string; root: string }[]): UsageSession[] {
  const kinds: HitKind[] = target.kind === 'agent' ? ['agent'] : ['skill', 'command'];
  const used = new Map<string, { keys: Set<string>; last: number }>();
  for (const [file, e] of Object.entries(data.files)) {
    for (const h of e.hits) {
      if (h.name !== target.name || !kinds.includes(h.kind)) continue;
      const main = e.main ?? file;
      let s = used.get(main);
      if (!s) used.set(main, (s = { keys: new Set(), last: 0 }));
      s.keys.add(h.key);
      s.last = Math.max(s.last, h.at);
    }
  }
  if (!used.size) return [];
  const bySlug = new Map(repos.map(r => [projectSlug(r.path).toLowerCase(), r]));
  const folderOf = (main: string) => path.basename(path.dirname(main));
  // The folder of each main transcript by session id, for a run whose own folder is named after a scratchpad; built when one is met.
  let mainFolder: Map<string, string> | undefined;
  const repoOf = (folder: string) => {
    const own = bySlug.get(folder.toLowerCase());
    if (own) return own;
    const id = UUID.exec(folder)?.[0];
    if (!id) return undefined;
    if (!mainFolder) {
      mainFolder = new Map();
      for (const [file, e] of Object.entries(data.files)) if (!e.main) mainFolder.set(path.basename(file, '.jsonl'), folderOf(file).toLowerCase());
    }
    const parent = mainFolder.get(id);
    return parent ? bySlug.get(parent) : undefined;
  };
  const several = accounts.length > 1;
  const rows: UsageSession[] = [];
  for (const [main, s] of used) {
    const e = data.files[main];
    const cwd = e?.cwd;
    if (target.inside && !within(cwd, target.inside)) continue;
    if (target.outside.some(d => within(cwd, d))) continue;
    const folder = folderOf(main);
    const repo = repoOf(folder);
    const account = several && e?.root ? accounts.find(a => norm(a.root) === norm(e.root!))?.label : undefined;
    rows.push({
      id: path.basename(main, '.jsonl'),
      title: e?.title ?? 'No prompt',
      repo: repo?.label ?? (cwd ? path.basename(cwd) : folder),
      ...(repo ? { scope: repo.id } : {}),
      ...(account ? { account } : {}),
      last: s.last,
      count: s.keys.size,
    });
  }
  return rows.sort((a, b) => b.last - a.last || a.id.localeCompare(b.id));
}
