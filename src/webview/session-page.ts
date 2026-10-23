// @ts-nocheck
// The session page: cost, delegation views, output style.
import { drawConcurrency, drawFlow, drawScatter } from './charts';
import { app, openAt, persist, showRepo, state, total, viewOf, vscode } from './core';
import { drawDecisions } from './decisions';
import { clip, el, fmtDate, fmtDur, fmtTime, icon, iconBtn, pageHead, shortModel, shortType } from './dom';
import { hideHover, placeCard, tabTip } from './hover';
import { renderMain } from './main';
import { drawMap } from './map';
import { colorsOf, modeSwitch, peakParallel } from './session-common';
import { sessionDesc, showSession } from './sessions';
import { drawTimeline, renderAgent } from './timeline';

export const SESSION_VIEWS = [
  ['timeline', 'Timeline', 'graph-line', 'When each agent ran, next to your prompts.'],
  ['map', 'Delegation map', 'list-tree', 'Who started which agent, and which agents worked as a team.'],
  ['decisions', 'Decisions', 'type-hierarchy', 'What happened after each prompt: handed to agents, done directly, or just answered.'],
  ['concurrency', 'Concurrency', 'pulse', 'How many agents were busy at the same time.'],
  ['flow', 'Token flow', 'git-merge', 'Where the tokens went: the main thread or the agents, and whether their work came back.'],
  ['scatter', 'Scatter', 'graph-scatter', 'Every agent by time and tokens, so the slow or costly ones stand out.'],
];

export const currentView = () => (SESSION_VIEWS.some(v => v[0] === state.sessionView) ? state.sessionView : 'timeline');

export const drawView = (host, d) => ({ timeline: drawTimeline, map: drawMap, decisions: drawDecisions, concurrency: drawConcurrency, flow: drawFlow, scatter: drawScatter })[currentView()](host, d);

// Legend under each diagram: the marks it uses, in a few words each.
export function viewLegend(d) {
  const colors = colorsOf(d);
  const types = colors.types.map(type => el('span', { className: 'legend-item' }, el('span', { className: `swatch ${colors.typeTone(type)}` }), shortType(type)));
  const fact = text => el('span', { className: 'legend-item muted' }, text);
  const main = el('span', { className: 'legend-item' }, el('span', { className: 'swatch tone-main' }), 'main thread');
  const parts = {
    timeline: [...types, el('span', { className: 'legend-break' }), fact('● prompt'), fact('○ result'), fact('▼ message'), el('span', { className: 'legend-item' }, el('span', { className: 'stop-glyph', 'aria-hidden': 'true' }, '×'), 'stopped')],
    map: [main, ...types],
    decisions: [fact('one prompt = the time until the next prompt'), fact('line width: prompts'), fact('gold: delegated'), fact('▸ click to drill down, ▾ to collapse')],
    concurrency: [...types, fact('height: agents running'), fact('one bar per agent run'), fact('ticks: prompts')],
    flow: [main, ...types, fact('width: tokens in, cache and out')],
    scatter: [...types, fact('size: cost'), fact('dashed: medians'), fact('log scales')],
  };
  return parts[currentView()];
}

export function viewTabs(d, host, legend) {
  const tabs = el('div', { className: 'view-tabs', role: 'tablist', 'aria-label': 'Session views' });
  const buttons = SESSION_VIEWS.map(([id, label, glyph, about]) => {
    const tip = target => {
      const r = target.getBoundingClientRect();
      placeCard(`tab:${id}`, () => tabTip(label, glyph, about), { x: r.left - 14, y: r.bottom - 6 });
    };
    return el(
      'button',
      {
        className: 'view-tab',
        role: 'tab',
        'data-view': id,
        'aria-description': about,
        onclick: () => setView(id),
        onmouseenter: e => tip(e.currentTarget),
        onmouseleave: hideHover,
        onfocus: e => tip(e.currentTarget),
        onblur: hideHover,
      },
      icon(glyph),
      el('span', {}, label)
    );
  });
  const sync = () =>
    buttons.forEach(b => {
      const on = b.dataset.view === currentView();
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
  const setView = id => {
    state.sessionView = id;
    persist();
    sync();
    hideHover();
    drawView(host, d);
    legend.replaceChildren(...viewLegend(d));
  };
  tabs.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = SESSION_VIEWS.findIndex(v => v[0] === currentView());
    const next = SESSION_VIEWS[(i + (e.key === 'ArrowRight' ? 1 : SESSION_VIEWS.length - 1)) % SESSION_VIEWS.length][0];
    setView(next);
    buttons.find(b => b.dataset.view === next).focus();
  });
  tabs.append(...buttons);
  sync();
  return tabs;
}

export const selectAgent = (id, refocus) => {
  if (!state.session || !state.session.data) return;
  state.session.selected = state.session.selected === id ? undefined : id;
  const host = app.querySelector('.timeline');
  if (host) drawView(host, state.session.data);
  if (host && refocus) {
    const lane = [...host.querySelectorAll('.tl-lane')].find(g => g.dataset.agent === id);
    if (lane) lane.focus();
  }
  const detail = app.querySelector('.agent-detail');
  if (detail) detail.replaceWith(renderAgent(state.session.data));
};

export const fmtUsd = v => (v <= 0 ? '$0' : v < 0.01 ? '<$0.01' : v < 1000 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString()}`);

export const fmtShare = (v, grant) => {
  const p = (v / grant) * 100;
  return p <= 0 ? '0%' : p < 0.01 ? '<0.01%' : `${p < 10 ? p.toFixed(2) : p < 100 ? p.toFixed(1) : Math.round(p)}%`;
};

export const COST_KINDS = [
  ['cacheRead', 'Cache reads'],
  ['cacheWrite', 'Cache writes'],
  ['output', 'Output'],
  ['input', 'Input'],
];

// Weekly limits valued at API list prices. Anthropic publishes none: Max 5x from botfarm.run (March 2026),
// Max 20x from wokey.ai (accounts measured 2026-10-12 to 2026-10-19). API billing has no grant.
// Team Premium (1010) was measured against the Claude app's usage card on one Team Premium seat, 2026-10-22
// (56 % used at 566 $ of list prices): one sample, still an estimate. Two figures are derived: Pro is one fifth of
// Max 5x (about 105) and Team Standard one fifth of Team Premium (about 202), because claude.com/pricing sells Max 5x at 5 times Pro and Premium at 5 times Standard.
// The ids and figures match PLANS in src/sessions.ts, which a unit test compares. Keep `api` last.
export const BILLING = [
  ['pro', 'Pro', 'account', 105],
  ['max5', 'Max 5x', 'dashboard', 523],
  ['max20', 'Max 20x', 'rocket', 1643],
  ['team-standard', 'Team Standard', 'organization', 202],
  ['team', 'Team Premium', 'organization', 1010],
  ['api', 'API billing', 'credit-card', 0],
];

export const TEAM_PLANS = new Set(['team', 'team-standard']);

export const billingAbout = (label, grant) => (grant ? `This session as a share of one ${label} weekly limit, which measures at about $${grant.toLocaleString()} of API list prices.` : 'This session at Anthropic API list prices.');

export function costBar(parts, total, label, fmt) {
  const bar = el('div', { className: 'cost-bar', role: 'img', 'aria-label': `${label}: ${parts.map(p => `${p.label} ${fmt(p.cost)}`).join(', ')}` });
  for (const p of parts) {
    if (p.cost <= 0) continue;
    const seg = el('span', { className: `swatch cost-seg ${p.tone}`, title: `${p.label}: ${fmt(p.cost)} (${Math.round((p.cost / total) * 100)}%)` });
    seg.style.width = `${(p.cost / total) * 100}%`;
    bar.append(seg);
  }
  return bar;
}

export const costLegend = (parts, total, fmt) =>
  el(
    'div',
    { className: 'cost-legend' },
    parts
      .filter(p => p.cost > 0)
      .map(p =>
        el('span', { className: 'cost-item' }, el('span', { className: `swatch ${p.tone}` }), el('span', { className: 'cost-name' }, p.label), el('b', {}, fmt(p.cost)), el('span', { className: 'cost-pct' }, `${Math.round((p.cost / total) * 100)}%`))
      )
  );

// Cost row: the session total, split by who spent it and by what it was spent on.
// A subscription plan shows every amount as a share of that plan's weekly limit, API billing in dollars.
export function renderCost(d, colors) {
  const byType = new Map();
  for (const a of d.agents) byType.set(a.type, (byType.get(a.type) || 0) + (a.usage.cost || 0));
  const spenders = [{ label: 'Main thread', tone: 'tone-main', cost: d.usage.cost || 0 }, ...[...byType.entries()].sort((x, y) => y[1] - x[1]).map(([type, cost]) => ({ label: shortType(type), tone: colors.typeTone(type), cost }))];
  const total = spenders.reduce((n, p) => n + p.cost, 0);
  const kindTotals = COST_KINDS.map(([key, label]) => ({
    label,
    tone: `kind-${key}`,
    cost: [d.usage, ...d.agents.map(a => a.usage)].reduce((n, u) => n + ((u.costParts || {})[key] || 0), 0),
  }));
  // The plan set for the session's account in the settings is the default; a click on the switch overrides it.
  const billingId = state.billingPick || (BILLING.some(b => b[0] === d.plan) ? d.plan : state.billing);
  const [, , , grant] = BILLING.find(b => b[0] === billingId) || BILLING[BILLING.length - 1];
  const fmt = grant ? v => fmtShare(v, grant) : fmtUsd;
  const plans = modeSwitch(
    app,
    BILLING.map(([id, label, glyph, g]) => [id, label, glyph, billingAbout(label, g)]),
    billingId,
    'Billing',
    id => {
      state.billing = id;
      state.billingPick = id;
      card.replaceWith(renderCost(d, colors));
    }
  );
  const card = el(
    'div',
    { className: 'cost-card' },
    el(
      'div',
      { className: 'cost-head' },
      el('div', {}, el('div', { className: 'cost-k' }, grant ? 'Weekly limit used' : 'Estimated cost'), el('div', { className: 'cost-v' }, fmt(total), grant ? '*' : '')),
      plans
    ),
    total > 0
      ? [
          el('div', { className: 'cost-row' }, el('div', { className: 'cost-label' }, 'Who spent it'), costBar(spenders, total, 'Cost by thread', fmt), costLegend(spenders, total, fmt)),
          el('div', { className: 'cost-row' }, el('div', { className: 'cost-label' }, 'Spent on'), costBar(kindTotals, total, 'Cost by token kind', fmt), costLegend(kindTotals, total, fmt)),
        ]
      : el('div', { className: 'empty flush' }, 'No priced model usage in this session.')
  );
  return card;
}

export const STYLE_MODELS = [
  ['sonnet', 'Sonnet'],
  ['opus', 'Opus'],
  ['haiku', 'Haiku'],
];

export const STYLE_KINDS = { length: 'Length', format: 'Format', language: 'Language', repetition: 'Repetition', asking: 'Asking' };

// Output style: what the transcript says about how replies should read, and Claude drafting a style from it.
export function renderStyle(d) {
  const s = state.session;
  const scan = d.style;
  if (!scan) return null;
  const r = scan.replies;
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const draft = s.styleDraft || { state: 'idle' };
  const running = draft.state === 'running';
  const facts = [
    `Active: ${scan.active.length ? scan.active.join(', ') : 'default'}`,
    count(scan.prompts, 'prompt', 'prompts'),
    count(scan.corrections.length, 'correction', 'corrections'),
    count(scan.interrupts, 'interrupt', 'interrupts'),
    `${count(r.count, 'reply', 'replies')}: median ${r.medianWords} words, longest ${r.longest}`,
    `${r.headings} with headings, ${r.tables} with tables, ${r.lists} with lists`,
  ];
  return el(
    'div',
    { className: 'recent' },
    el('div', { className: 'group-label' }, 'Output style'),
    el('div', { className: 'legend' }, facts.map(t => el('span', { className: 'legend-item muted' }, t))),
    scan.corrections.length
      ? scan.corrections.map(c => el('div', { className: 'row style-row' }, el('span', { className: 'style-kind' }, STYLE_KINDS[c.kind] || c.kind), el('span', { className: 'name wrap' }, c.text)))
      : el('div', { className: 'empty flush' }, 'No corrections about length, format, language or repetition in this session.'),
    el(
      'div',
      { className: 'style-draft' },
      el(
        'select',
        {
          'aria-label': 'Model',
          disabled: running,
          onchange: e => {
            state.styleModel = e.target.value;
            persist();
          },
        },
        STYLE_MODELS.map(([id, label]) => el('option', { value: id, selected: state.styleModel === id }, label))
      ),
      el(
        'button',
        { className: 'primary', disabled: running, 'data-confirm': 'draftStyle', onclick: () => vscode.postMessage({ type: 'draftStyle', scope: s.scope, id: s.id, model: state.styleModel }) },
        running ? el('span', { className: 'codicon codicon-loading codicon-modifier-spin' }) : icon('sparkle'),
        running ? 'Drafting...' : 'Draft output style'
      ),
      draft.state === 'done'
        ? el('button', { className: 'link', onclick: () => openAt(draft.file) }, `Drafted ${draft.file.split(/[\\/]/).pop()}`)
        : draft.state === 'error'
          ? el('span', { className: 'style-error' }, draft.error)
          : null
    )
  );
}

export function renderSession() {
  const s = state.session;
  const d = s.data;
  const view = viewOf(s.scope);
  const back = iconBtn('arrow-left', `Back to ${view ? view.label : 'the repo'}`, () => showRepo(s.scope));
  const reload = iconBtn('refresh', 'Read the transcript again', () => {
    s.data = undefined;
    vscode.postMessage({ type: 'session', scope: s.scope, id: s.id });
    renderMain();
  });
  if (state.timelineObserver) state.timelineObserver.disconnect();
  hideHover();
  if (!d || d.error)
    return el('section', { className: 'main' }, pageHead('type-hierarchy-sub', 'Session', view ? view.label : '', back, reload), el('div', { className: 'main-body' }, el('div', { className: 'empty flush' }, d ? d.error : 'Reading the transcript...')));
  const sub = [d.repo, d.account, d.start ? `${fmtDate(d.start)} to ${fmtTime(d.end)}` : '', d.start ? fmtDur(d.end - d.start) : '', d.branch, shortModel(d.model), d.live].filter(Boolean).join(' · ');
  const colors = colorsOf(d);
  const usages = [d.usage, ...d.agents.map(a => a.usage)];
  const sum = key => usages.reduce((n, u) => n + (u[key] || 0), 0);
  const totalCost = sum('cost');
  const agentCost = totalCost - (d.usage.cost || 0);
  const inputAll = sum('input') + sum('cacheCreate') + sum('cacheRead');
  const failed = d.agents.filter(a => a.status === 'failed').length;
  const silent = d.agents.filter(a => a.status === 'unknown' || a.status === 'stopped').length;
  const pct = v => `${Math.round(v * 100)}%`;
  const kpis = [
    [String(d.agents.length), 'Agents', 'type-hierarchy-sub', failed ? `${failed} failed` : silent ? `${silent} without a report` : d.agents.length ? 'all reported back' : 'none started', failed || silent ? 'warn' : ''],
    [String(peakParallel(d.agents)), 'Peak parallel', 'layers', 'agents running at the same time'],
    [totalCost ? pct(agentCost / totalCost) : '0%', 'Delegated', 'arrow-swap', 'of the cost ran in agents'],
    [inputAll ? pct(sum('cacheRead') / inputAll) : '0%', 'Cache hits', 'database', 'of input tokens read from cache'],
  ];
  const timeline = el('div', { className: 'timeline', onmouseleave: hideHover });
  const legend = el('div', { className: 'legend below' }, viewLegend(d));
  const observer = new ResizeObserver(() => {
    if (timeline.isConnected) drawView(timeline, d);
  });
  observer.observe(timeline);
  state.timelineObserver = observer;
  const exportBtn = iconBtn('export', 'Export the transcript as JSONL', () => vscode.postMessage({ type: 'exportSession', scope: s.scope, id: s.id }));
  const head = pageHead('type-hierarchy-sub', clip(d.title, 140), sub, back, exportBtn, reload);
  head.classList.add('session-head');
  head.querySelector('h1').setAttribute('title', d.title);
  return el(
    'section',
    { className: 'main' },
    head,
    el(
      'div',
      { className: 'main-body', onscroll: hideHover },
      renderCost(d, colors),
      el(
        'div',
        { className: 'kpis' },
        kpis.map(([n, l, i, note, tone]) =>
          el('div', { className: 'tile static' }, el('span', { className: 'n' }, n), el('span', { className: 'l' }, icon(i), l), el('span', { className: `kpi-note${tone ? ` ${tone}` : ''}` }, note))
        )
      ),
      el(
        'div',
        { className: 'recent' },
        el('div', { className: 'group-label' }, 'Delegation'),
        viewTabs(d, timeline, legend),
        timeline,
        legend
      ),
      renderAgent(d),
      d.findings.length
        ? el(
            'div',
            { className: 'recent' },
            el('div', { className: 'group-label' }, `Findings (${d.findings.length})`),
            d.findings.map(f =>
              el(
                'div',
                { className: 'row', onclick: f.agent ? () => selectAgent(f.agent) : undefined },
                el('span', { className: `check-badge ${f.level === 'warn' ? 'warn' : 'muted'}` }, icon(f.level === 'warn' ? 'warning' : 'info')),
                el('span', { className: 'name wrap' }, f.text)
              )
            )
          )
        : null,
      renderStyle(d),
      d.children.length
        ? el(
            'div',
            { className: 'recent' },
            el('div', { className: 'group-label' }, `Headless runs (${d.children.length})`),
            d.children.map(c =>
              el('div', { className: 'row', title: c.file, onclick: () => showSession(s.scope, c.id) }, icon('terminal'), el('span', { className: 'name' }, c.title), el('span', { className: 'desc' }, sessionDesc(c)))
            )
          )
        : null
    )
  );
}
