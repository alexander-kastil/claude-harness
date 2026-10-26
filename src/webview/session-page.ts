// @ts-nocheck
// The session page: cost, delegation views, output style.
import { drawConcurrency, drawFlow, drawScatter } from './charts';
import { app, openAt, persist, showRepo, state, total, viewOf, vscode } from './core';
import { drawDecisions } from './decisions';
import { renderFindings } from './findings';
import { aiGroup, clip, countHead, el, fmtDate, fmtDur, fmtTime, icon, iconBtn, plural, shortModel, shortType } from './dom';
import { hideHover, placeCard, tabTip } from './hover';
import { renderMain } from './main';
import { drawMap } from './map';
import { renderMarkdown } from './markdown';
import { colorsOf, modeSwitch, peakParallel } from './session-common';
import { sessionTable } from './sessions';
import { drawTimeline, renderAgent, renderCheckpoint } from './timeline';

export const SESSION_VIEWS = [
  ['timeline', 'Timeline', 'graph-line', 'When each agent ran, next to your prompts.'],
  ['map', 'Delegation map', 'list-tree', 'Who started which agent, and which agents worked as a team.'],
  ['decisions', 'Decisions', 'type-hierarchy', 'What happened after each prompt: handed to agents, done directly, or just answered. A prompt counts until the next one starts. Click a row with a triangle to drill down or collapse it.'],
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
    timeline: [...types, el('span', { className: 'legend-break' }), fact('● prompt'), fact('○ result'), fact('▼ message'), ...(d.checkpoints && d.checkpoints.length ? [fact('◯ checkpoint')] : []), el('span', { className: 'legend-item' }, el('span', { className: 'stop-glyph', 'aria-hidden': 'true' }, '×'), 'stopped')],
    map: [main, ...types],
    decisions: [fact('line width: prompts'), fact('gold: delegated')],
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

// Picks a checkpoint on the Timeline, or drops the pick when it is pressed again; the host answers with the files it changed.
export const selectCheckpoint = (id, refocus) => {
  const s = state.session;
  if (!s || !s.data) return;
  s.checkpoint = s.checkpoint === id ? undefined : id;
  s.cpFiles = undefined;
  s.cpRestored = undefined;
  if (s.checkpoint) vscode.postMessage({ type: 'checkpointFiles', scope: s.scope, id: s.id, checkpoint: id });
  const host = app.querySelector('.timeline');
  if (host) drawView(host, s.data);
  if (host && refocus) {
    const mark = [...host.querySelectorAll('.tl-cp')].find(g => g.dataset.checkpoint === id);
    if (mark) mark.focus();
  }
  redrawCheckpoint();
};

export const redrawCheckpoint = () => {
  const s = state.session;
  const detail = app.querySelector('.cp-detail');
  if (!s || !s.data || !detail) return;
  const next = renderCheckpoint(s.data);
  detail.replaceWith(next);
  if (s.checkpoint && s.cpFiles === undefined) next.scrollIntoView({ block: 'nearest' });
};

export const fmtUsd =v => (v <= 0 ? '$0' : v < 0.01 ? '<$0.01' : v < 1000 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString()}`);

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

// Weekly limits at API list prices; Anthropic publishes none. Max 5x: botfarm.run (03/2026), Max 20x: wokey.ai (10/2026),
// Team Premium: measured on one seat (10/2026). Pro and Team Standard are a fifth of Max 5x and Team Premium.
// Same ids and figures as PLANS in src/sessions.ts (unit test). Keep `api` last. A fifth entry is a shorter switch label; the hover keeps the full name.
export const BILLING = [
  ['pro', 'Pro', 'account', 105],
  ['max5', 'Max 5x', 'dashboard', 523],
  ['max20', 'Max 20x', 'rocket', 1643],
  ['team-standard', 'Team Standard', 'organization', 202, 'Team'],
  ['team', 'Team Premium', 'organization', 1010],
  ['api', 'API billing', 'credit-card', 0, 'API'],
];

export const billingAbout = (label, grant) => (grant ? `Share of one ${label} weekly limit (about $${grant.toLocaleString()}, estimated).` : 'This session at Anthropic API list prices, paid per token, with no weekly limit.');

// A share of the total; a thin slice reads "<1%", never "0%" beside a nonzero amount.
const share = (cost, total) => {
  const p = (cost / total) * 100;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
};

export function costBar(parts, total, label, fmt) {
  const bar = el('div', { className: 'cost-bar', role: 'img', 'aria-label': `${label}: ${parts.map(p => `${p.label} ${fmt(p.cost)}`).join(', ')}` });
  for (const p of parts) {
    if (p.cost <= 0) continue;
    const seg = el('span', { className: `swatch cost-seg ${p.tone}`, title: `${p.label}: ${fmt(p.cost)} (${share(p.cost, total)})` });
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
        el('span', { className: 'cost-item' }, el('span', { className: `swatch ${p.tone}` }), el('span', { className: 'cost-name' }, p.label), el('b', {}, fmt(p.cost)), el('span', { className: 'cost-pct' }, share(p.cost, total)))
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
    BILLING.map(([id, label, glyph, g, short]) => [id, short || label, glyph, billingAbout(label, g), label]),
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
      el('div', {}, el('div', { className: 'cost-k' }, grant ? 'Weekly limit used' : 'Estimated cost'), el('div', { className: 'cost-v' }, fmt(total))),
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
  const draft = s.styleDraft || { state: 'idle' };
  const running = draft.state === 'running';
  const facts = [
    ['Active style', scan.active.length ? scan.active.join(', ') : 'default'],
    ['Prompts', scan.prompts],
    ['Corrections', scan.corrections.length],
    ['Interrupts', scan.interrupts],
    ['Replies', r.count],
    ['Median reply', plural(r.medianWords, 'word')],
    ['Longest reply', plural(r.longest, 'word')],
    ['With headings', r.headings],
    ['With tables', r.tables],
    ['With lists', r.lists],
  ];
  return el(
    'div',
    { className: 'style-body' },
    el('div', { className: 'dv-chips' }, facts.map(([k, v]) => el('span', { className: 'dv-chip' }, el('span', { className: 'k' }, k), String(v)))),
    scan.corrections.length
      ? scan.corrections.map(c => el('div', { className: 'row style-row' }, el('span', { className: 'style-kind' }, STYLE_KINDS[c.kind] || c.kind), el('span', { className: 'name wrap' }, c.text)))
      : el('div', { className: 'empty flush' }, 'No corrections to length, format, language or repetition.'),
    el(
      'div',
      { className: 'style-draft' },
      el(
        'label',
        { className: 'style-model' },
        el('span', {}, 'Model'),
        el(
          'select',
          {
            disabled: running,
            onchange: e => {
              state.styleModel = e.target.value;
              persist();
            },
          },
          STYLE_MODELS.map(([id, label]) => el('option', { value: id, selected: state.styleModel === id }, label))
        )
      ),
      aiGroup(
        '',
        el(
          'button',
          { className: 'primary', disabled: running, 'data-confirm': 'draftStyle', onclick: () => vscode.postMessage({ type: 'draftStyle', scope: s.scope, id: s.id, model: state.styleModel }) },
          running ? el('span', { className: 'codicon codicon-loading codicon-modifier-spin' }) : icon('symbol-color'),
          running ? 'Drafting...' : 'Draft output style'
        )
      ),
      // A host that sends no text keeps the link to the file.
      draft.state === 'done' && draft.text === undefined ? el('button', { className: 'link', onclick: () => openAt(draft.file) }, `Drafted ${draft.file.split(/[\\/]/).pop()}`) : null
    ),
    styleRegion(draft, scan)
  );
}

// The frontmatter of a drafted style, as key/value pairs, and the instructions after it.
export function splitStyle(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.trim());
  if (!m) return { meta: [], body: text.trim() };
  const meta = m[1]
    .split(/\r?\n/)
    .map(line => /^([\w-]+):\s*(.*)$/.exec(line))
    .filter(Boolean)
    .map(x => [x[1], x[2].replace(/^["']|["']$/g, '')]);
  return { meta, body: m[2].trim() };
}

// The drafted output style as one region: its name and description, the settings from its frontmatter and every
// instruction in it, uncut, with the file and what the draft cost. While Claude writes it the region holds its place.
export function styleRegion(draft, scan) {
  if (draft.state === 'running') {
    const model = (STYLE_MODELS.find(m => m[0] === draft.model) || [0, draft.model || 'Claude'])[1];
    return el(
      'section',
      { className: 'style-region running', role: 'status', 'aria-live': 'polite', 'aria-busy': 'true' },
      el('div', { className: 'style-region-head' }, el('span', { className: 'cf-badge' }, el('span', { className: 'codicon codicon-loading codicon-modifier-spin' })), el('div', { className: 'style-region-titles' }, el('div', { className: 'style-region-name' }, 'Drafting the output style'), el('div', { className: 'style-region-desc' }, `${model} is writing the style from this session's ${scan.corrections.length === 1 ? '1 correction' : `${scan.corrections.length} corrections`}.`))),
      el('div', { className: 'style-skeleton', 'aria-hidden': 'true' }, el('span'), el('span'), el('span'), el('span'))
    );
  }
  if (draft.state === 'error')
    return el('section', { className: 'style-region failed', role: 'alert' }, el('div', { className: 'style-region-head' }, el('span', { className: 'cf-badge bad' }, icon('error')), el('div', { className: 'style-region-titles' }, el('div', { className: 'style-region-name' }, 'Draft failed'), el('div', { className: 'style-region-desc style-error' }, draft.error))));
  if (draft.state !== 'done' || draft.text === undefined) return null;
  const { meta, body } = splitStyle(draft.text);
  const get = key => (meta.find(m => m[0] === key) || [])[1];
  const rest = meta.filter(m => m[0] !== 'name' && m[0] !== 'description');
  const file = draft.file.split(/[\\/]/).pop();
  return el(
    'section',
    { className: 'style-region done', 'aria-label': `Drafted output style ${get('name') || file}` },
    el(
      'div',
      { className: 'style-region-head' },
      el('span', { className: 'cf-badge' }, icon('sparkle')),
      el('div', { className: 'style-region-titles' }, el('div', { className: 'style-region-name' }, get('name') || file), get('description') ? el('div', { className: 'style-region-desc' }, get('description')) : null),
      el('button', { className: 'secondary', title: `Open the file\n${draft.file}`, onclick: () => openAt(draft.file) }, icon('go-to-file'), 'Open file')
    ),
    rest.length ? el('dl', { className: 'style-meta' }, rest.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) : null,
    body ? renderMarkdown(body).node : el('div', { className: 'empty flush' }, 'The draft has no instructions.'),
    el('div', { className: 'style-region-foot' }, icon('file'), file, draft.cost !== undefined ? el('span', {}, ` · drafted for ${fmtUsd(draft.cost)}`) : null)
  );
}

// Review: the two sections that look back at the session, as tab siblings in one boxed group.
export const REVIEW_TABS = [
  ['findings', 'Findings', 'search', 'What stood out in the session, what it cost, why it matters and what to do.'],
  ['style', 'Output style', 'symbol-color', 'How the replies read, the corrections you made about it, and a style Claude drafts from them.'],
];

export function renderReview(d) {
  const bodies = { findings: d.findings.length ? () => renderFindings(d) : null, style: d.style ? () => renderStyle(d) : null };
  const tabs = REVIEW_TABS.filter(t => bodies[t[0]]);
  if (!tabs.length) return null;
  const current = () => (tabs.some(t => t[0] === state.reviewTab) ? state.reviewTab : tabs[0][0]);
  const panel = el('div', { className: 'review-panel', role: 'tabpanel' });
  const bar = el('div', { className: 'view-tabs', role: 'tablist', 'aria-label': 'Review' });
  const buttons = tabs.map(([id, label, glyph, about]) => {
    const tip = target => {
      const r = target.getBoundingClientRect();
      placeCard(`tab:${id}`, () => tabTip(label, glyph, about), { x: r.left - 14, y: r.bottom - 6 });
    };
    return el(
      'button',
      {
        className: 'view-tab',
        role: 'tab',
        id: `review-tab-${id}`,
        'data-tab': id,
        'aria-description': about,
        onclick: () => pick(id),
        onmouseenter: e => tip(e.currentTarget),
        onmouseleave: hideHover,
        onfocus: e => tip(e.currentTarget),
        onblur: hideHover,
      },
      icon(glyph),
      el('span', {}, label),
      id === 'findings' ? el('span', { className: 'tab-count' }, d.findings.length) : null
    );
  });
  const draw = () => {
    const id = current();
    buttons.forEach(b => {
      const on = b.dataset.tab === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
    panel.setAttribute('aria-labelledby', `review-tab-${id}`);
    panel.dataset.tab = id;
    panel.replaceChildren(bodies[id]());
  };
  const pick = id => {
    state.reviewTab = id;
    persist();
    hideHover();
    draw();
  };
  bar.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.findIndex(t => t[0] === current());
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0];
    pick(next);
    buttons.find(b => b.dataset.tab === next).focus();
  });
  bar.append(...buttons);
  draw();
  return el('div', { className: 'recent' }, el('div', { className: 'group-label' }, 'Review'), bar, el('div', { className: 'view-box review-box' }, panel));
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
    return el('section', { className: 'main' }, countHead('type-hierarchy-sub', 'Session', view ? view.label : '', back, reload), el('div', { className: 'main-body' }, el('div', { className: 'empty flush' }, d ? d.error : 'Reading the transcript...')));
  const sub = [d.repo, d.account, d.start ? `${fmtDate(d.start)} to ${fmtTime(d.end)}` : '', d.start ? fmtDur(d.end - d.start) : '', d.branch, shortModel(d.model), d.live].filter(Boolean).join(' · ');
  const colors = colorsOf(d);
  const usages = [d.usage, ...d.agents.map(a => a.usage)];
  const sum = key => usages.reduce((n, u) => n + (u[key] || 0), 0);
  const totalCost = sum('cost');
  const agentCost = totalCost - (d.usage.cost || 0);
  const inputAll = sum('input') + sum('cacheCreate') + sum('cacheRead');
  // An agent is a run with a transcript, the same count as the sessions list; a launch that never started (an unknown
  // agent type, say) is named beside it, not counted.
  const started = d.agents.filter(a => a.transcript);
  const never = d.agents.length - started.length;
  const failed = started.filter(a => a.status === 'failed').length;
  const silent = started.filter(a => a.status === 'unknown' || a.status === 'stopped').length;
  const pct = v => `${Math.round(v * 100)}%`;
  const agentNote = [failed ? `${failed} failed` : '', never ? `${never} never started` : '', silent ? `${silent} without a report` : ''].filter(Boolean).join(', ') || (started.length ? 'all reported back' : 'none started');
  const kpis = [
    [String(started.length), 'Agents', 'type-hierarchy-sub', agentNote, failed || never ? 'bad' : silent ? 'warn' : ''],
    [String(peakParallel(d.agents)), 'Peak parallel', 'layers', 'agents at once', '', 'Peak parallel\nThe most agents running at the same time.'],
    [totalCost ? pct(agentCost / totalCost) : '0%', 'Delegated', 'arrow-swap', 'of cost in agents', '', 'Delegated\nThe share of the session cost that ran in agents instead of the main thread.'],
    [inputAll ? pct(sum('cacheRead') / inputAll) : '0%', 'Cache hits', 'database', 'of input tokens', '', 'Cache hits\nThe share of input tokens read from the cache.'],
  ];
  const timeline = el('div', { className: 'timeline', onmouseleave: hideHover });
  const legend = el('div', { className: 'legend below' }, viewLegend(d));
  const observer = new ResizeObserver(() => {
    if (timeline.isConnected) drawView(timeline, d);
  });
  observer.observe(timeline);
  state.timelineObserver = observer;
  const exportBtn = iconBtn('export', 'Export the transcript as JSONL', () => vscode.postMessage({ type: 'exportSession', scope: s.scope, id: s.id }));
  const head = countHead('type-hierarchy-sub', clip(d.title, 140), sub, back, exportBtn, reload);
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
        kpis.map(([n, l, i, note, tone, about]) =>
          el('div', { className: 'tile static', title: about || undefined }, el('span', { className: 'n' }, n), el('span', { className: 'l' }, icon(i), l), el('span', { className: `kpi-note${tone ? ` ${tone}` : ''}` }, note))
        )
      ),
      el(
        'div',
        { className: 'recent' },
        el('div', { className: 'group-label' }, 'How the work ran'),
        viewTabs(d, timeline, legend),
        el('div', { className: 'view-box' }, timeline, legend)
      ),
      renderAgent(d),
      renderCheckpoint(d),
      renderReview(d),
      d.children.length
        ? el(
            'div',
            { className: 'recent' },
            el('div', { className: 'group-label' }, `Headless runs (${d.children.length})`),
            sessionTable(d.children.map(c => ({ ...c, headless: true })), s.scope, 'Headless runs')
          )
        : null
    )
  );
}
