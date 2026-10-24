// @ts-nocheck
// The agent detail page's "Last 7 days" chip: launches and cost of the agent's type, in the hero's chip row.
import { el, icon, plural } from './dom';
import { fmtUsd } from './session-page';
import { agentWeek, askWeekly } from './week';

export function weekAgentChip(a) {
  const totals = askWeekly();
  const w = totals ? agentWeek(totals, a.name) : undefined;
  const text = !totals ? 'reading...' : w ? `${plural(w.launches, 'launch')} · ${fmtUsd(w.cost)} at API list prices` : 'no launches in the window';
  return el('span', { className: 'dv-chip', title: 'Launches of this agent type and their cost at Anthropic API list prices, over the last 7 days, all repos and accounts.' }, icon('history'), el('span', { className: 'k' }, 'Last 7 days'), text);
}
