// @ts-nocheck
// The last 7 days seen per repo and per agent type, from the `weekly` message (one entry per account).
import { state, vscode } from './core';
import { fmtDate } from './dom';

/** Asks the host for the weekly totals once; `state.weekly` is null while it reads. */
export function askWeekly() {
  if (state.weekly === undefined) {
    state.weekly = null;
    vscode.postMessage({ type: 'weekly' });
  }
  return state.weekly;
}

/** The folder name Claude Code gives a repo under `projects/`, the host's `projectSlug`. */
export const slugOf = view => String(view.path || '').replace(/[^A-Za-z0-9]/g, '-').toLowerCase();

/** What one repo used in the window, per account that has a share of it. Entries from a host without `repos` are skipped. */
export function repoWeek(totals, view) {
  const slug = slugOf(view);
  return (totals || []).map(t => ({ t, r: (t.repos || []).find(r => r.folder.toLowerCase() === slug) })).filter(x => x.r);
}

/** The window the totals count, as the host chose it per account: "Last 7 days", or "Since <reset>" when a plan's weekly reset starts it. */
export function weekSpan(totals) {
  const spans = [...new Set((totals || []).map(t => (t.fromReset ? `Since ${fmtDate(t.since)}` : 'Last 7 days')))];
  return spans.length ? spans.join(' / ') : 'Last 7 days';
}

/** What the agents of one type launched in the window, summed over the accounts; undefined without a launch. */
export function agentWeek(totals, name) {
  const rows = (totals || []).flatMap(t => (t.agents || []).filter(a => a.type === name));
  if (!rows.length) return undefined;
  return { launches: rows.reduce((n, a) => n + a.launches, 0), cost: rows.reduce((n, a) => n + a.cost, 0), tokens: rows.reduce((n, a) => n + a.tokens, 0) };
}
