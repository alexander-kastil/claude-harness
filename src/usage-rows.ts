import * as path from 'path';
import { projectSlug } from './fleet';
import { mcpToolPrefix } from './harness';
import type { Asset, ScopeView } from './harness';
import type { Hit, HitKind } from './usage-scan';
import type { IndexData } from './usage';

// What the detail page's Used in tab shows: the target of one element, and the sessions of the index that match it.

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
  /** A memory file: how its last load in the session came about, as `Hit.info`. */
  info?: string;
  /** An agent: what hooks and mods did in this session's transcripts of that agent: tool calls denied and hook failures. */
  hooks?: { denied: number; failed: number };
  /** A hook or hook script: its runs in the session. `avgMs` is 0 when no run reported a duration. */
  fired?: { runs: number; failed: number; avgMs: number; exit?: number };
}

/** What counts as a use of one element. */
export interface UsageTarget {
  /** `plugin`: any agent, skill or command of the plugin `name`. `mcp`: any tool of the server whose tool prefix is `name`. `memory`: the file at path `name`. `style`: the output style `name`. */
  kind: 'agent' | 'skill' | 'command' | 'plugin' | 'mcp' | 'memory' | 'style';
  /** The name transcripts use: `plugin:name` for a plugin's element, the bare name for an own one. */
  name: string;
  /** Count only sessions whose cwd is inside this folder: a repo's copy of a global element. */
  inside?: string;
  /** Leave out sessions whose cwd is inside one of these folders: repos with their own copy of a global element. */
  outside: string[];
}

/** One day of the activity strip: its local midnight, ms, and the uses on it. */
export interface UsageDay {
  at: number;
  n: number;
}

/** One agent, skill or command of a plugin that was used. `use` is a skill or a command: transcripts do not tell them apart. */
export interface UsageElement {
  kind: 'agent' | 'use';
  /** Without the `plugin:` prefix. */
  name: string;
  count: number;
  sessions: number;
  last: number;
}

/** One tool of an MCP server that was called. */
export interface UsageTool {
  /** Without the `mcp__<server>__` prefix. */
  name: string;
  count: number;
  last: number;
}

/** What the pages show beside the session list: the last 7 days, and per-element or per-tool counts. */
export interface UsageMore {
  days: UsageDay[];
  total: number;
  last: number;
  elements?: UsageElement[];
  tools?: UsageTool[];
}

/** The total uses and the last one of an element, for the Used column of a type page. */
export interface UsageTotal {
  count: number;
  last: number;
  /** Indexed sessions the element was listed in, used or not: a skill's description is paid in each. Absent from older hosts. */
  sessions?: number;
}

const ownIn = (view: ScopeView | undefined, kind: string, name: string) =>
  !!view && (view.categories.find(c => c.kind === kind)?.items ?? []).some(a => a.name === name && a.scope === view.id && a.source !== 'plugin');

/**
 * The target of an element; `views` starts with the global one, as the host lists them. `styleName` is an output
 * style's frontmatter `name`, which is what transcripts record (the file name is not).
 */
export function usageTarget(asset: Asset, views: ScopeView[], styleName?: string): UsageTarget | undefined {
  if (asset.kind === 'plugin') return { kind: 'plugin', name: asset.name.split('@')[0], outside: [] };
  if (asset.kind === 'rule' || asset.kind === 'memory') return { kind: 'memory', name: asset.file, outside: [] };
  if (asset.kind === 'mcp') {
    const global = views.find(v => v.id === 'global');
    const name = mcpToolPrefix(asset.name);
    if (asset.source === 'plugin' || asset.source === 'claude.ai') return { kind: 'mcp', name, outside: [] };
    if (asset.scope === 'global') return { kind: 'mcp', name, outside: views.filter(v => v !== global && ownIn(v, 'mcp', asset.name)).map(v => v.path) };
    const repo = views.find(v => v.id === asset.scope);
    return { kind: 'mcp', name, inside: repo && ownIn(global, 'mcp', asset.name) ? repo.path : undefined, outside: [] };
  }
  const kind = asset.kind === 'outputStyle' ? 'style' : asset.kind;
  if (kind !== 'agent' && kind !== 'skill' && kind !== 'command' && kind !== 'style') return undefined;
  const bare = kind === 'style' ? styleName || asset.name : asset.name;
  const own = asset.kind;
  if (asset.source === 'plugin' && asset.scope.startsWith('plugin:')) return { kind, name: `${asset.scope.slice('plugin:'.length).split('@')[0]}:${bare}`, outside: [] };
  const global = views.find(v => v.id === 'global');
  if (asset.scope === 'global') return { kind, name: bare, outside: views.filter(v => v !== global && ownIn(v, own, asset.name)).map(v => v.path) };
  const repo = views.find(v => v.id === asset.scope);
  return { kind, name: bare, inside: repo && ownIn(global, own, asset.name) ? repo.path : undefined, outside: [] };
}

const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

export const within = (cwd: string | undefined, dir: string) => {
  if (!cwd) return false;
  const c = norm(cwd);
  const d = norm(dir);
  return c === d || c.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** One counted use: a hit with the main transcript of its session. */
interface Use {
  main: string;
  key: string;
  at: number;
  name: string;
  kind: HitKind;
  info?: string;
}

interface Located {
  h: Hit;
  main: string;
}

/** The agent, skill and command hits of the index by name, for matching many elements without a pass over every hit each. */
export type HitIndex = Map<string, Located[]>;

export function hitIndex(data: IndexData): HitIndex {
  const out: HitIndex = new Map();
  for (const [file, e] of Object.entries(data.files)) {
    const main = e.main ?? file;
    for (const h of e.hits) {
      if (h.kind !== 'agent' && h.kind !== 'skill' && h.kind !== 'command') continue;
      const list = out.get(h.name);
      if (list) list.push({ h, main });
      else out.set(h.name, [{ h, main }]);
    }
  }
  return out;
}

const NAMED: Record<string, HitKind[]> = { agent: ['agent'], skill: ['skill', 'command'], command: ['skill', 'command'], style: ['style'] };

/** Whether a hit counts for the target. */
function matcher(target: UsageTarget): (h: Hit) => boolean {
  switch (target.kind) {
    case 'plugin': {
      const prefix = `${target.name}:`;
      return h => (h.kind === 'agent' || h.kind === 'skill' || h.kind === 'command') && h.name.startsWith(prefix);
    }
    case 'mcp':
      return h => h.kind === 'mcp' && h.name.startsWith(target.name);
    case 'memory': {
      const want = norm(target.name);
      return h => h.kind === 'memory' && norm(h.name) === want;
    }
    default: {
      const kinds = NAMED[target.kind];
      return h => h.name === target.name && kinds.includes(h.kind);
    }
  }
}

/** Every use of the target, once per session and key (forks replay their parent's history), in sessions inside the target's folders. */
function usesOf(data: IndexData, target: UsageTarget, idx?: HitIndex): Use[] {
  const match = matcher(target);
  const seen = new Map<string, Use>();
  const folderOk = new Map<string, boolean>();
  const out: Use[] = [];
  const take = (h: Hit, main: string) => {
    let ok = folderOk.get(main);
    if (ok === undefined) {
      const cwd = data.files[main]?.cwd;
      ok = !(target.inside && !within(cwd, target.inside)) && !target.outside.some(d => within(cwd, d));
      folderOk.set(main, ok);
    }
    if (!ok) return;
    const key = h.key || h.name;
    const id = `${main}\0${key}`;
    // A replay of the use (a fork, or a progress record) may carry no time: the copy with one sets it.
    const again = seen.get(id);
    if (again) {
      again.at = Math.max(again.at, h.at);
      return;
    }
    const use: Use = { main, key, at: h.at, name: h.name, kind: h.kind, info: h.info };
    seen.set(id, use);
    out.push(use);
  };
  if (idx && (target.kind === 'agent' || target.kind === 'skill' || target.kind === 'command')) {
    for (const l of idx.get(target.name) ?? []) if (match(l.h)) take(l.h, l.main);
    return out;
  }
  for (const [file, e] of Object.entries(data.files)) for (const h of e.hits) if (match(h)) take(h, e.main ?? file);
  return out;
}

/**
 * One row per session that used the target, newest use first. A session opens under the repo whose project folder
 * holds it, or, for a headless run started from a session's scratchpad, under that session's repo.
 */
export function usageRows(data: IndexData, target: UsageTarget, repos: { id: string; label: string; path: string }[], accounts: { label: string; root: string }[]): UsageSession[] {
  const used = new Map<string, { count: number; last: number; info?: string; infoAt: number }>();
  for (const u of usesOf(data, target)) {
    let s = used.get(u.main);
    if (!s) used.set(u.main, (s = { count: 0, last: 0, infoAt: -1 }));
    s.count++;
    s.last = Math.max(s.last, u.at);
    if (u.at >= s.infoAt) {
      s.infoAt = u.at;
      s.info = u.info;
    }
  }
  if (!used.size) return [];
  const locate = sessionLocator(data, repos, accounts);
  // An agent's page also counts, per session, what hooks and mods did inside the agent's own transcripts.
  const inside = new Map<string, { denied: number; failed: number }>();
  if (target.kind === 'agent')
    for (const e of Object.values(data.files)) {
      if (!e.main || e.agent !== target.name || !used.has(e.main)) continue;
      const s = inside.get(e.main) ?? { denied: 0, failed: 0 };
      s.denied += e.denied ?? 0;
      s.failed += (e.hooks ?? []).reduce((n, h) => n + h.failed, 0);
      inside.set(e.main, s);
    }
  const rows: UsageSession[] = [];
  for (const [main, s] of used) {
    const hooks = inside.get(main);
    rows.push({
      ...locate(main),
      last: s.last,
      count: s.count,
      ...(s.info !== undefined ? { info: s.info } : {}),
      ...(hooks && (hooks.denied || hooks.failed) ? { hooks } : {}),
    });
  }
  return rows.sort((a, b) => b.last - a.last || a.id.localeCompare(b.id));
}

/** Names the session of a main transcript for a row: its id, title and repo, and the account when there are several. */
export function sessionLocator(data: IndexData, repos: { id: string; label: string; path: string }[], accounts: { label: string; root: string }[]) {
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
  return (main: string): Pick<UsageSession, 'id' | 'title' | 'repo' | 'scope' | 'account'> => {
    const e = data.files[main];
    const cwd = e?.cwd;
    const folder = folderOf(main);
    const repo = repoOf(folder);
    const account = several && e?.root ? accounts.find(a => norm(a.root) === norm(e.root!))?.label : undefined;
    return {
      id: path.basename(main, '.jsonl'),
      title: e?.title ?? 'No prompt',
      repo: repo?.label ?? (cwd ? path.basename(cwd) : folder),
      ...(repo ? { scope: repo.id } : {}),
      ...(account ? { account } : {}),
    };
  };
}

/** The last 7 local days up to and including today, oldest first, with the uses on each. */
export function usageDays(uses: { at: number }[], now = Date.now()): UsageDay[] {
  const today = new Date(now);
  const days: UsageDay[] = [];
  for (let i = 6; i >= 0; i--) days.push({ at: new Date(today.getFullYear(), today.getMonth(), today.getDate() - i).getTime(), n: 0 });
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  for (const u of uses) {
    if (u.at < days[0].at || u.at >= end) continue;
    let i = days.length - 1;
    while (days[i].at > u.at) i--;
    days[i].n++;
  }
  return days;
}

/** The 7-day strip, and for a plugin its elements or for an MCP server its tools, each with a count. */
export function usageMore(data: IndexData, target: UsageTarget, now = Date.now()): UsageMore {
  const uses = usesOf(data, target);
  const more: UsageMore = { days: usageDays(uses, now), total: uses.length, last: uses.reduce((t, u) => Math.max(t, u.at), 0) };
  if (target.kind === 'plugin') {
    const prefix = target.name.length + 1;
    const groups = new Map<string, { kind: 'agent' | 'use'; name: string; count: number; mains: Set<string>; last: number }>();
    for (const u of uses) {
      const kind = u.kind === 'agent' ? 'agent' : 'use';
      const name = u.name.slice(prefix);
      const g = groups.get(`${kind}\0${name}`) ?? { kind, name, count: 0, mains: new Set<string>(), last: 0 };
      g.count++;
      g.mains.add(u.main);
      g.last = Math.max(g.last, u.at);
      groups.set(`${kind}\0${name}`, g);
    }
    more.elements = [...groups.values()].map(g => ({ kind: g.kind, name: g.name, count: g.count, sessions: g.mains.size, last: g.last })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  if (target.kind === 'mcp') {
    const groups = new Map<string, UsageTool>();
    for (const u of uses) {
      const name = u.name.slice(target.name.length);
      const g = groups.get(name) ?? { name, count: 0, last: 0 };
      g.count++;
      g.last = Math.max(g.last, u.at);
      groups.set(name, g);
    }
    more.tools = [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return more;
}

/**
 * How many indexed sessions an element was listed in: the sessions inside its folder (`dir`, the repo of an own skill; or the
 * target's `inside`), minus those inside a repo with its own copy. A global or plugin element is listed in every session.
 */
export function sessionsListed(cwds: (string | undefined)[], target: UsageTarget, dir?: string): number {
  const folder = (d: string) => {
    const n = norm(d);
    return n.endsWith(path.sep) ? n : n + path.sep;
  };
  const inside = [target.inside, dir].filter((d): d is string => !!d).map(folder);
  const outside = target.outside.map(folder);
  const has = (c: string, f: string) => c + path.sep === f || c.startsWith(f);
  let n = 0;
  for (const c of cwds) {
    if (inside.length && (!c || !inside.every(f => has(c, f)))) continue;
    if (c && outside.some(f => has(c, f))) continue;
    n++;
  }
  return n;
}

/** The total uses and the last one of each target, by id. `dir` is the folder of an element that lives in one repo. */
export function usageTotals(data: IndexData, targets: { id: string; target: UsageTarget; dir?: string }[], withSessions = false): Record<string, UsageTotal> {
  const idx = hitIndex(data);
  const out: Record<string, UsageTotal> = {};
  const cwds = withSessions ? Object.values(data.files).filter(e => !e.main).map(e => (e.cwd ? norm(e.cwd) : undefined)) : [];
  for (const { id, target, dir } of targets) {
    const uses = usesOf(data, target, idx);
    out[id] = { count: uses.length, last: uses.reduce((t, u) => Math.max(t, u.at), 0), ...(withSessions ? { sessions: sessionsListed(cwds, target, dir) } : {}) };
  }
  return out;
}
