import * as fs from 'fs';
import type { Asset, ScopeView } from './harness';
import { DeclaredHook, FailedHook, failuresByHook } from './shared/harness-trace';
import type { IndexData } from './usage';
import type { HookStat } from './usage-scan';
import { UsageSession, sessionLocator, within } from './usage-rows';

// The Fired in tab of a hook and of a hook script: the sessions where the hook ran, from the per-file hook counts of the
// usage index. A run is matched to a declared hook by its command first, then by its event and matcher (harness-trace.ts).

/** The hooks declared in the settings of every scope, and which of them one page is about. */
export interface HookTarget {
  declared: DeclaredHook[];
  /** Indexes into `declared`. */
  mine: Set<number>;
  /** Count only sessions whose cwd is inside this folder: the hook is declared in a repo. */
  inside?: string;
}

const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a command runs the script `hooks/<name>`, a file of a `hooks` folder; `name` has forward slashes. */
export function runsScript(command: string, name: string): boolean {
  return new RegExp(`hooks/${escape(name.toLowerCase())}(?![\\w.-])`).test(norm(command));
}

/** The group a hook asset names in its settings file: `hooks[event][i]`. */
function groupOf(asset: Asset): { matcher?: string; hooks?: { command?: string; type?: string }[] } | undefined {
  try {
    let node: unknown = JSON.parse(fs.readFileSync(asset.file, 'utf8'));
    for (const key of asset.jsonPath ?? []) node = (node as Record<string | number, unknown> | undefined)?.[key];
    return node && typeof node === 'object' ? (node as { matcher?: string; hooks?: { command?: string; type?: string }[] }) : undefined;
  } catch {
    return undefined;
  }
}

/** The target of a hook or hook script page; `views` are all scopes, as the host lists them. */
export function hookTarget(asset: Asset, views: ScopeView[]): HookTarget | undefined {
  if (asset.kind !== 'hook' && asset.kind !== 'hookScript') return undefined;
  const declared: DeclaredHook[] = [];
  const mine = new Set<number>();
  for (const view of views)
    for (const hook of (view.categories.find(c => c.kind === 'hook')?.items ?? []).filter(i => i.kind === 'hook')) {
      const group = groupOf(hook);
      if (!group) continue;
      for (const h of group.hooks?.length ? group.hooks : [{}]) {
        const command = h.command ?? '';
        const [event] = String(hook.jsonPath?.[1] ?? hook.name).split(' · ');
        if (asset.kind === 'hook' ? hook.id === asset.id : runsScript(command, asset.name)) mine.add(declared.length);
        declared.push({ event, matcher: group.matcher ?? '', command });
      }
    }
  const view = views.find(v => v.id === asset.scope);
  return { declared, mine, inside: asset.scope !== 'global' ? view?.path : undefined };
}

interface Total {
  runs: number;
  failed: number;
  ms: number;
  timed: number;
  exit?: number;
  last: number;
}

/** One row per session where a hook of the target ran, newest first. */
export function hookRows(data: IndexData, target: HookTarget, repos: { id: string; label: string; path: string }[], accounts: { label: string; root: string }[]): UsageSession[] {
  if (!target.mine.size) return [];
  // Which declared hooks a run belongs to depends only on its name and command, so it is worked out once for each.
  const belongs = new Map<string, boolean>();
  const takes = (h: HookStat): boolean => {
    const key = `${h.hook}\0${h.command ?? ''}`;
    let hit = belongs.get(key);
    // A run that names a command no declared hook has belongs to a hook declared elsewhere (a plugin's): matching it by event
    // and matcher would hand its failures to a settings hook that never ran.
    if (hit === undefined && h.command && !target.declared.some(d => d.command.trim() === h.command!.trim())) hit = false;
    if (hit === undefined) {
      const item: FailedHook = { hook: h.hook, count: h.runs, ...(h.command ? { command: h.command } : {}) };
      hit = [...failuresByHook(target.declared, [item]).keys()].some(i => target.mine.has(i));
      belongs.set(key, hit);
    }
    return hit;
  };
  const folderOk = new Map<string, boolean>();
  const totals = new Map<string, Total>();
  for (const [file, e] of Object.entries(data.files)) {
    if (!e.hooks) continue;
    const main = e.main ?? file;
    let ok = folderOk.get(main);
    if (ok === undefined) ok = !target.inside || within(data.files[main]?.cwd, target.inside);
    folderOk.set(main, ok);
    if (!ok) continue;
    for (const h of e.hooks) {
      if (!takes(h)) continue;
      const t = totals.get(main) ?? { runs: 0, failed: 0, ms: 0, timed: 0, last: 0 };
      t.runs += h.runs;
      t.failed += h.failed;
      t.ms += h.ms;
      t.timed += h.timed;
      if (h.exit !== undefined) t.exit = h.exit;
      t.last = Math.max(t.last, h.last);
      totals.set(main, t);
    }
  }
  const locate = sessionLocator(data, repos, accounts);
  return [...totals]
    .map(([main, t]) => ({ ...locate(main), last: t.last, count: t.runs, fired: { runs: t.runs, failed: t.failed, avgMs: t.timed ? Math.round(t.ms / t.timed) : 0, ...(t.exit !== undefined ? { exit: t.exit } : {}) } }))
    .sort((a, b) => b.last - a.last || a.id.localeCompare(b.id));
}
