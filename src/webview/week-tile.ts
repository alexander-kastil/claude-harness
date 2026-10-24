// @ts-nocheck
// The agent detail page's "Last 7 days" tile: launches and cost of the agent's type.
import { el, icon, plural } from './dom';
import { fmtUsd } from './session-page';
import { agentWeek, askWeekly } from './week';

export function weekAgentTile(a) {
  const totals = askWeekly();
  const w = totals ? agentWeek(totals, a.name) : undefined;
  const text = !totals ? '...' : w ? plural(w.launches, 'launch') : 'none';
  const note = !totals ? 'reading' : w ? `${fmtUsd(w.cost)} at API list prices` : 'no launches in the window';
  return el('div', { className: 'tile static' }, el('span', { className: 'n' }, text), el('span', { className: 'l' }, icon('history'), 'Last 7 days'), el('span', { className: 'kpi-note' }, note));
}
