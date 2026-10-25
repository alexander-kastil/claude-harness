// What the pages read from the usage index beside the session list: the 7-day strip, a plugin's per-element counts, an MCP
// server's calls, and the Used column of a type page. The host answers `usageMore` and `usageTotals`; nothing here builds the index
// except the Used in tab of a plugin when it is opened (`build`).
import type { Asset } from '../harness';
import type { Progress, UsageDay, UsageMore, UsageTotal } from '../shared/messages';
import { vscode } from './core';
import { el, fmtAgo, plural, svg } from './dom';

export interface MoreState {
  more?: UsageMore;
  indexing?: Progress;
  built?: false;
}

const mores = new Map<string, MoreState>();
const totals = new Map<string, Record<string, UsageTotal> | false>();

export const moreOf = (id: string): MoreState | undefined => mores.get(id);

/** Asks the host for the strip and counts of an element; `build` builds the transcript index when there is none yet. */
export const askMore = (a: Asset, build: boolean) => vscode.postMessage({ type: 'usageMore', id: a.id, build });

/** Stores the host's answer; true when the page showing the element has something new to draw. */
export function storeMore(m: { id: string; more?: UsageMore; indexing?: Progress; built?: false }): boolean {
  const before = mores.get(m.id);
  const next: MoreState = m.indexing ? { more: before?.more, indexing: m.indexing } : m.more ? { more: m.more } : { built: false };
  mores.set(m.id, next);
  return JSON.stringify(before) !== JSON.stringify(next);
}

/** Asks for the uses of every element of a kind; the index is only read when it exists. */
export const askTotals = (kind: string, build = false) => vscode.postMessage({ type: 'usageTotals', kind, ...(build ? { build } : {}) });

/** Stores the totals of a kind; true when they changed. */
export function storeTotals(m: { kind: string; totals?: Record<string, UsageTotal>; built?: false }): boolean {
  const next = m.totals ?? false;
  const same = JSON.stringify(totals.get(m.kind)) === JSON.stringify(next);
  totals.set(m.kind, next);
  return !same;
}

export const totalOf = (a: Asset): UsageTotal | undefined => {
  const t = totals.get(a.kind);
  return t ? t[a.id] : undefined;
};

/** Whether the totals of a kind are known: undefined while asked and unanswered, false without an index. */
export const totalsKnown = (kind: string): boolean | undefined => (totals.has(kind) ? !!totals.get(kind) : undefined);

const DAY = 864e5;
const NOT_USED_MS = 30 * DAY;

/** Not used for 30 days, or never: the "Not used in 30 days" preset. */
export const isStale = (a: Asset): boolean => {
  const t = totalOf(a);
  return !!t && (t.count === 0 || (t.last > 0 && Date.now() - t.last > NOT_USED_MS));
};

export const isNeverUsed = (a: Asset): boolean => totalOf(a)?.count === 0;

/** What the Used and Cost cells say before the usage index exists. */
export const NOT_COUNTED = 'not counted yet';

/** The hover card of a cell that is not counted yet. */
export const NOT_COUNTED_TIP = 'Not counted yet\nUsage is counted the first time a Used in tab opens, or when you press Count usage on this page. It reads your Claude Code transcripts once.';

/** The Used cell of a type page: the count and the last use. */
export function usedText(a: Asset): string {
  const known = totalsKnown(a.kind);
  if (known === undefined) return '...';
  if (!known) return NOT_COUNTED;
  const t = totalOf(a);
  if (!t) return '-';
  if (!t.count) return 'never';
  return t.last ? `${t.count} · ${fmtAgo(t.last)}` : String(t.count);
}

export function usedTip(a: Asset): string {
  const known = totalsKnown(a.kind);
  if (known === false) return NOT_COUNTED_TIP;
  const t = totalOf(a);
  if (!t) return '';
  return t.count ? `Used ${plural(t.count, 'time')}\nLast ${t.last ? new Date(t.last).toLocaleString() : 'at an unknown time'}` : 'Never used in a recorded session';
}

const weekday = (at: number) => new Date(at).toLocaleDateString([], { weekday: 'short' });

/** Uses per day for the last 7 days: one rounded bar per day, today last, each with the hover card of its day. */
export function dayStrip(days: UsageDay[]): HTMLElement {
  const max = Math.max(1, ...days.map(d => d.n));
  const H = 40;
  return el(
    'div',
    { className: 'us-strip', role: 'img', 'aria-label': `Uses in the last 7 days: ${days.map(d => `${weekday(d.at)} ${d.n}`).join(', ')}` },
    days.map(d => {
      const h = d.n ? Math.max(4, Math.round((d.n / max) * H)) : 2;
      return el(
        'div',
        { className: `us-day${d.n ? '' : ' empty'}`, title: `${new Date(d.at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}\n${d.n ? plural(d.n, 'use') : 'No use'}` },
        el('span', { className: 'us-n' }, d.n ? String(d.n) : ''),
        svg('svg', { class: 'us-bars', viewBox: `0 0 24 ${H}`, 'aria-hidden': 'true' }, svg('rect', { class: 'us-bar', x: 3, y: H - h, width: 18, height: h, rx: 3 })),
        el('span', { className: 'us-label' }, weekday(d.at))
      );
    })
  );
}

/** The use count of a plugin's element by name (`name` as transcripts write it after the plugin prefix), from the plugin's Used in data. */
export function elementCount(plugin: Asset, kind: 'agent' | 'use', name: string): number | undefined {
  const more = mores.get(plugin.id)?.more;
  if (!more) return undefined;
  return more.elements?.find(e => e.kind === kind && e.name === name)?.count ?? 0;
}
