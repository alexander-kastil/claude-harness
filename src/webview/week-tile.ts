// @ts-nocheck
// The agent detail page's "Last 7 days" chip: launches and cost of the agent's type, in the hero's chip row.
import { el, icon, plural } from './dom';
import { fmtUsd } from './session-page';
import { agentWeek, askWeekly, weekSpan } from './week';

export function weekAgentChip(a) {
  const totals = askWeekly();
  const w = totals ? agentWeek(totals, a.name) : undefined;
  const span = weekSpan(totals);
  const text = !totals ? 'reading...' : w ? `${plural(w.launches, 'launch')} · ${fmtUsd(w.cost)} at API list prices` : 'no launches in this window';
  return el('div', { className: 'dv-fact', title: `${span}\nLaunches of this agent type that wrote a response in this window, and their cost at Anthropic API list prices, all repos and accounts. The Used in strip counts launches per day over the last 7 days instead, so a plan reset inside the week or a launch without a response makes them differ.` }, el('span', { className: 'k' }, icon('history'), span), el('span', { className: 'v' }, text));
}
