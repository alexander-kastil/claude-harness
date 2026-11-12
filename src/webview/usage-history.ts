// @ts-nocheck
// The History tab of a repo and the Usage history page of all repos: cost per day and per month at API list prices, by project,
// over a chosen period, and the plan advisor that sets each month's API price against the Pro, Max and Ultra prices.
import { periodRows, byDay, byMonth, byFolder, advise, PERIODS, PLAN_PRICES, PLAN_PRICES_READ_ON, PLAN_PRICES_SOURCE, monthCapacity } from '../usage-history';
import { state, vscode } from './core';
import { el, icon, tag } from './dom';
import { renderMain } from './main';
import { fmtUsd } from './session-page';
import { modeSwitch } from './session-common';
import { gridTable } from './tables';
import { slugOf } from './week';

const period = () => (PERIODS.some(p => p.id === state.usageHistoryPeriod) ? state.usageHistoryPeriod : '30d');

// 436K, 8.8M: the unit glued to the number.
const fmtTokens = n => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const fmtRatio = r => (r <= 0 ? '0x' : r < 10 ? `${r.toFixed(1)}x` : `${Math.round(r)}x`);

const monthName = key => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString([], { month: 'short', year: 'numeric' });
const dayName = key => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
const dayShort = key => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** The repo label of a project folder: the label of the repo whose path makes that folder, else the folder itself. */
const labelOfFolder = folder => {
  const view = state.views.find(v => v.path && slugOf(v) === folder.toLowerCase());
  return view ? view.label : folder;
};

const PLAN_TIP = Object.fromEntries(
  PLAN_PRICES.map(p => [p.id, `${p.label}${p.formerly ? ` (formerly ${p.formerly})` : ''}\n$${p.price} a month. Its weekly limit of about ${fmtUsd(p.weeklyLimit)} at API prices allows about ${fmtUsd(monthCapacity(p))} a month.`])
);

/** One bar per day (30 and 90 days) or per month (12 months); each bar has the hover card of its bucket. */
function costChart(buckets, monthly) {
  const max = Math.max(0.01, ...buckets.map(b => b.cost));
  const bars = el('div', { className: 'usage-history-bars', role: 'img', 'aria-label': `Cost per ${monthly ? 'month' : 'day'}: ${buckets.map(b => `${b.key} ${fmtUsd(b.cost)}`).join(', ')}` });
  for (const b of buckets) {
    const bar = el('span', { className: `usage-history-bar${b.cost ? '' : ' empty'}` });
    bar.style.height = b.cost ? `${Math.max(3, (b.cost / max) * 100)}%` : '2px';
    bars.append(el('span', { className: 'usage-history-col', title: `${monthly ? monthName(b.key) : dayName(b.key)}\n${b.cost ? `${fmtUsd(b.cost)} at API prices\n${fmtTokens(b.tokens)} tokens` : 'No usage'}` }, bar));
  }
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  return el(
    'div',
    { className: 'usage-history-chart' },
    el('div', { className: 'usage-history-max' }, fmtUsd(max)),
    bars,
    el('div', { className: 'usage-history-axis' }, el('span', {}, first ? (monthly ? monthName(first.key) : dayShort(first.key)) : ''), el('span', {}, last ? (monthly ? monthName(last.key) : dayShort(last.key)) : ''))
  );
}

/** The months of the period with the plan advisor: the API price against each plan's price, and the plan that fits. */
function monthTable(months) {
  const cols = [
    { head: 'Month', track: '96px', cls: 'at-name', cell: m => m.name, title: m => `${m.name}\nThe month so far counts only the days that have passed.` },
    { head: 'Tokens', track: '72px', num: true, wide: true, cell: m => fmtTokens(m.tokens) },
    { head: 'API price', track: '84px', num: true, cell: m => fmtUsd(m.cost), tip: 'What the month cost at API list prices, per million tokens.' },
    ...PLAN_PRICES.map(p => ({
      head: `${p.label} $${p.price}`,
      track: '84px',
      num: true,
      wide: p.id !== 'max',
      cell: m => fmtRatio(m.cost / p.price),
      tip: `${PLAN_TIP[p.id]}\nThe figure is the API price divided by the plan price: above 1x the plan costs less.`,
    })),
    {
      head: 'Best fit',
      track: '96px',
      align: 'center',
      cell: m => {
        const a = advise(m.cost);
        const plan = PLAN_PRICES.find(p => p.id === a.best);
        return tag(plan ? plan.label : 'API', a.best === 'api' ? 'API billing\nPaying by the token costs less than the cheapest plan this month.' : `${plan.label}\n${a.over ? 'More work than its limit allows in a month.\n' : ''}Saves ${fmtUsd(a.saves)} against the API price.`);
      },
    },
  ];
  return gridTable(cols, months.map(m => ({ ...m, name: monthName(m.key) })), 'Cost per month');
}

/** The project table of the all-repos view: cost, tokens and days with work, with the share of the total as a bar. */
function projectTable(rows) {
  const total = rows.reduce((n, r) => n + r.cost, 0);
  return gridTable(
    [
      { head: 'Project', track: 'minmax(120px, 3fr)', cls: 'at-name', cell: r => [icon('repo'), el('span', { className: 'at-label' }, labelOfFolder(r.folder))], title: r => r.folder },
      { head: 'Tokens', track: '72px', num: true, wide: true, cell: r => fmtTokens(r.tokens) },
      { head: 'API price', track: '84px', num: true, cell: r => fmtUsd(r.cost) },
      { head: 'Days', track: '60px', num: true, cell: r => String(r.days), tip: 'Days with work in this period.' },
      {
        head: 'Share',
        track: '120px',
        wide: true,
        cell: r => {
          const p = total ? (r.cost / total) * 100 : 0;
          const fill = el('span', { className: 'seg in' });
          fill.style.width = `${p}%`;
          return el('span', { className: 'wk-share' }, el('span', { className: 'wk-bar', role: 'img', 'aria-label': `${Math.round(p)}% of the cost` }, fill), el('span', { className: 'wk-pct' }, p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`));
        },
        tip: 'Cost as a share of this account in the period.',
      },
    ],
    rows,
    'Cost per project'
  );
}

/** The period chips, then one block per account. `view` narrows the history to one repo. */
export function renderUsageHistory(view) {
  const data = state.usageHistoryData;
  if (data === undefined) {
    state.usageHistoryData = null;
    vscode.postMessage({ type: 'usageHistory' });
  }
  if (!data) return el('div', { className: 'empty flush' }, 'Reading the transcripts...');
  const now = data.until || Date.now();
  const p = period();
  const folder = view ? slugOf(view) : undefined;
  const chips = modeSwitch(
    document.body,
    PERIODS.map(x => [x.id, x.label, x.id === '12m' ? 'calendar' : 'history', x.id === '12m' ? 'The last 12 calendar months, per month.' : `The last ${x.days} days, per day.`]),
    p,
    'Period',
    id => {
      state.usageHistoryPeriod = id;
      renderMain();
    }
  );
  chips.classList.add('usage-history-chips');
  const blocks = data.accounts.map(a => {
    const rows = periodRows(a.rows, p, now, folder);
    const total = rows.reduce((n, r) => n + r.cost, 0);
    const tokens = rows.reduce((n, r) => n + r.tokens, 0);
    const head = [data.accounts.length > 1 ? a.account : '', `${fmtUsd(total)} at API prices`, `${fmtTokens(tokens)} tokens`].filter(Boolean).join(' · ');
    const block = (label, tip, ...body) => el('div', { className: 'recent' }, el('div', { className: 'group-label', title: tip }, label), ...body);
    if (!rows.length) return block(head, 'The cost of every response in the period at API list prices.', el('div', { className: 'empty flush' }, 'No usage in this period.'));
    const monthly = p === '12m';
    return [
      block(head, 'The cost of every response in the period at API list prices, subagents included, each message once.', costChart(monthly ? byMonth(rows, p, now) : byDay(rows, p, now), monthly)),
      block(
        'By month and plan',
        `The API price of each month against the plan prices.\nPlan prices as read on ${PLAN_PRICES_READ_ON} from ${PLAN_PRICES_SOURCE}.`,
        monthTable(byMonth(rows, p, now))
      ),
      view ? null : block('By project', 'Cost per project folder in the period, costliest first.', projectTable(byFolder(rows))),
    ];
  });
  return el('div', { className: 'usage-history' }, chips, data.accounts.length ? blocks.flat() : el('div', { className: 'empty flush' }, 'No accounts found.'));
}

/** The page of all repos together, opened from the top bar. */
export function renderUsageHistoryPage() {
  return el(
    'section',
    { className: 'main' },
    el('header', { className: 'main-head' }, el('span', { className: 'big' }, icon('graph')), el('div', { className: 'title' }, el('h1', {}, 'Usage history'), el('div', { className: 'path meta' }, 'All repos, at API list prices'))),
    el('div', { className: 'main-body' }, renderUsageHistory(undefined))
  );
}
