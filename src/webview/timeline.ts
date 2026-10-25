// @ts-nocheck
// The Timeline view and the agent detail.
import { bindEvents, chipText, modsOf, toneOfAll } from '../shared/event-layers';
import { persist, state, total } from './core';
import { clip, el, fmtDur, fmtNum, fmtTime, icon, shortModel, shortType, svg } from './dom';
import { hideHover, placeCard, tabTip } from './hover';
import { eventsCard } from './map';
import { AGENT_STATUS, AXIS, BAR, LANE, agentLabel, colorsOf, endOfAgent, showHover, timeAxis, tokensText, topTools, widthOf } from './session-common';
import { fmtUsd, selectAgent } from './session-page';
import { showSession } from './sessions';

// The Mods switch of the Timeline: the same state as the Full timeline's, so one choice holds in both views.
function modsSwitch(host, d) {
  const about = 'What each mod did, as ticks beside the prompt dots and on the agents it concerns.';
  const on = !!state.mapMods;
  const tip = target => {
    const r = target.getBoundingClientRect();
    placeCard('toggle:mods', () => tabTip('Mods', 'plug', about), { x: r.left - 14, y: r.bottom - 6 });
  };
  return el(
    'div',
    { className: 'dg-bar' },
    el(
      'div',
      { className: `dg-modes dg-toggle` },
      el(
        'button',
        {
          className: `view-tab dg-mode${on ? ' active' : ''}`,
          'aria-pressed': on ? 'true' : 'false',
          'aria-description': about,
          'data-toggle': 'mods',
          onclick: () => {
            hideHover();
            state.mapMods = !state.mapMods;
            persist();
            drawTimeline(host, d);
            const b = host.querySelector('[data-toggle="mods"]');
            if (b) b.focus();
          },
          onmouseenter: e => tip(e.currentTarget),
          onmouseleave: hideHover,
          onfocus: e => tip(e.currentTarget),
          onblur: hideHover,
        },
        icon('plug'),
        el('span', {}, 'Mods')
      )
    )
  );
}

// One tick per cluster of events of a mod that sit within a few pixels of each other, so a busy hook stays a handful of marks.
function modTicks(events, x, y1, y2, name, label, key) {
  const clusters = [];
  for (const e of events) {
    const px = x(Date.parse(e.at));
    const last = clusters[clusters.length - 1];
    if (last && px - last.x < 4) last.events.push(e);
    else clusters.push({ x: px, events: [e] });
  }
  return clusters.map(c => {
    const tone = toneOfAll(c.events);
    const g = svg(
      'g',
      { class: `tl-modtick ev-${tone}`, tabindex: '0', role: 'img', 'aria-label': `${label}: ${chipText(c.events)}` },
      svg('rect', { x: c.x - 3, y: y1 - 1, width: 6, height: y2 - y1 + 2, class: 'tl-modtick-hit' }),
      svg('line', { x1: c.x, x2: c.x, y1, y2, class: 'tl-modtick-line' })
    );
    const open = () => {
      const r = g.getBoundingClientRect();
      placeCard(`ticks:${key}:${label}:${c.x}`, () => eventsCard(name, [{ label, events: c.events }]), { x: r.left - 14, y: r.bottom - 2 });
    };
    g.addEventListener('mouseenter', open);
    g.addEventListener('focus', open);
    g.addEventListener('mousemove', e => e.stopPropagation());
    g.addEventListener('mouseleave', hideHover);
    g.addEventListener('blur', hideHover);
    return g;
  });
}

export function drawTimeline(host, d) {
  const W = widthOf(host, 480);
  const LABEL = Math.max(150, Math.min(300, Math.round(W * 0.32)));
  const RIGHT = 14;
  const colors = colorsOf(d);
  const endOf = endOfAgent;
  const { x, grid } = timeAxis(d, LABEL, W, RIGHT);
  const lanes = 1 + d.agents.length + d.children.length;
  const H = AXIS + lanes * LANE + 6;
  const cy = i => AXIS + i * LANE + LANE / 2;
  const laneOf = new Map(d.agents.map((a, i) => [a.id, i + 1]));
  const selected = state.session && state.session.selected;
  const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tl', role: 'img', 'aria-label': 'Delegation timeline' });
  grid(root, AXIS, H);

  const row = (i, label, depth, onclick, isSelected, extraClass) =>
    svg(
      'g',
      { class: `tl-lane${extraClass ? ` ${extraClass}` : ''}`, onclick },
      svg('rect', { x: 0, y: AXIS + i * LANE, width: W, height: LANE, class: `tl-row${isSelected ? ' sel' : ''}` }),
      svg('text', { x: 8 + depth * 12, y: cy(i) + 4, class: `tl-label${i === 0 ? ' main' : ''}` }, clip(label, Math.floor((LABEL - 16 - depth * 12) / 6.2)))
    );

  const main = row(0, 'Main thread', 0, undefined, false, 'main-lane');
  bindMainHover(main, d);
  main.append(svg('line', { x1: x(d.start), x2: x(d.end), y1: cy(0), y2: cy(0), class: 'tl-main' }));
  for (const a of d.agents) {
    if (a.background || a.teammate || a.parent || typeof a.launchedAt !== 'number') continue;
    const until = a.reports[0] || a.end || a.launchedAt;
    main.append(svg('rect', { x: x(a.launchedAt), y: cy(0) - 3, width: Math.max(2, x(until) - x(a.launchedAt)), height: 6, class: 'tl-wait' }, svg('title', {}, `Main thread waits for ${agentLabel(a)}`)));
  }
  const roots = d.agents.filter(a => !a.parent && typeof a.launchedAt === 'number').sort((p, q) => p.launchedAt - q.launchedAt);
  for (let i = 0; i < roots.length; ) {
    let j = i + 1;
    while (j < roots.length && roots[j].launchedAt - roots[j - 1].launchedAt <= 60000) j++;
    if (j - i > 1) main.append(svg('text', { x: x(roots[i].launchedAt), y: cy(0) - 5, class: 'tl-fan' }, `×${j - i}`, svg('title', {}, `${j - i} agents launched together at ${fmtTime(roots[i].launchedAt)}`)));
    i = j;
  }
  for (const p of d.prompts) main.append(svg('circle', { cx: x(p.at), cy: cy(0), r: 3.5, class: 'tl-prompt' }, svg('title', {}, `${fmtTime(p.at)} you: ${clip(p.text, 300)}`)));
  // With Mods on, the events of every mod: a tick under the main thread's line for an event of a prompt's window, a tick
  // under the bar of the agent an event names.
  const mods = modsOf(d.layers);
  const agentTicks = new Map();
  for (const mod of state.mapMods ? mods : []) {
    const bound = bindEvents(mod.events, d.prompts.map(p => p.at).sort((p, q) => p - q), laneOf.keys());
    main.append(...modTicks(bound.steps.flat(), x, cy(0) + 5, cy(0) + 10, 'Main thread', mod.label, 'main'));
    for (const [id, events] of Object.entries(bound.agents)) agentTicks.set(id, [...(agentTicks.get(id) || []), { mod, events }]);
  }
  for (const a of d.agents)
    if (!a.parent) for (const t of a.reports) main.append(svg('circle', { cx: x(t), cy: cy(0), r: 3, class: `tl-dot ${colors.tone(a)}` }, svg('title', {}, `${fmtTime(t)} result from ${agentLabel(a)}`)));
  root.append(main);

  d.agents.forEach((a, k) => {
    const i = k + 1;
    const color = colors.tone(a);
    const parent = a.parent ? d.agents.find(p => p.id === a.parent) : undefined;
    const g = row(i, a.type === 'claude' && a.name ? a.name : shortType(a.type), a.depth, () => selectAgent(a.id), selected === a.id);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${agentLabel(a)}, ${AGENT_STATUS[a.status]}`);
    g.dataset.agent = a.id;
    g.addEventListener('mouseenter', e => showHover(a, color, { x: e.clientX, y: e.clientY }, parent));
    g.addEventListener('mousemove', e => showHover(a, color, { x: e.clientX, y: e.clientY }, parent));
    g.addEventListener('mouseleave', hideHover);
    g.addEventListener('focus', () => {
      const r = g.getBoundingClientRect();
      showHover(a, color, { x: r.left + LABEL, y: r.bottom }, parent);
    });
    g.addEventListener('blur', hideHover);
    g.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      selectAgent(a.id, true);
    });
    const from = a.parent && laneOf.has(a.parent) ? laneOf.get(a.parent) : 0;
    const start = typeof a.start === 'number' ? a.start : a.launchedAt;
    const end = endOf(a) || start;
    if (typeof a.launchedAt === 'number') {
      g.append(svg('line', { x1: x(a.launchedAt), x2: x(a.launchedAt), y1: cy(from) + (from ? BAR / 2 : 3), y2: cy(i) - BAR / 2, class: 'tl-link' }));
      if (start - a.launchedAt > 5000) g.append(svg('line', { x1: x(a.launchedAt), x2: x(start), y1: cy(i), y2: cy(i), class: 'tl-queue' }, svg('title', {}, `Waited ${fmtDur(start - a.launchedAt)} before it started`)));
    }
    if (typeof start === 'number') {
      g.append(
        svg('rect', { x: x(start), y: cy(i) - BAR / 2, width: Math.max(3, x(end) - x(start)), height: BAR, rx: a.teammate ? 6 : 2, class: `tl-bar ${color} ${a.status}` })
      );
    }
    for (const t of a.reports) g.append(svg('circle', { cx: x(t), cy: cy(i), r: 2.5, class: `tl-dot ${color}` }, svg('title', {}, `${fmtTime(t)} reported`)));
    for (const e of d.events) {
      if (e.agent !== a.id) continue;
      const ex = x(e.at);
      const top = cy(i) - BAR / 2;
      g.append(
        e.kind === 'stop'
          ? svg(
              'g',
              { class: 'tl-stop' },
              svg('circle', { cx: ex, cy: cy(i), r: 6, class: 'tl-stop-bg' }),
              svg('path', { d: `M ${ex - 2.5} ${cy(i) - 2.5} L ${ex + 2.5} ${cy(i) + 2.5} M ${ex + 2.5} ${cy(i) - 2.5} L ${ex - 2.5} ${cy(i) + 2.5}`, class: 'tl-stop-x' }),
              svg('title', {}, `${fmtTime(e.at)} stopped`)
            )
          : svg('path', { d: `M ${ex - 4} ${top - 7} L ${ex + 4} ${top - 7} L ${ex} ${top - 1} Z`, class: 'tl-msg' }, svg('title', {}, `${fmtTime(e.at)} message: ${clip(e.text, 300)}`))
      );
    }
    for (const t of agentTicks.get(a.id) || []) g.append(...modTicks(t.events, x, cy(i) + BAR / 2 + 1, cy(i) + BAR / 2 + 5, agentLabel(a), t.mod.label, `agent:${a.id}`));
    root.append(g);
  });

  d.children.forEach((c, k) => {
    const i = 1 + d.agents.length + k;
    const g = row(i, `claude -p: ${c.title}`, 0, () => showSession(state.session.scope, c.id), false, 'child-lane');
    if (typeof c.start === 'number')
      g.append(svg('rect', { x: x(c.start), y: cy(i) - BAR / 2, width: Math.max(3, x(c.end) - x(c.start)), height: BAR, rx: 2, class: 'tl-child' }, svg('title', {}, `Headless session: ${clip(c.title, 300)}\n${fmtDur(c.end - c.start)} · click to open`)));
    root.append(g);
  });
  host.replaceChildren(...(mods.length ? [modsSwitch(host, d)] : []), root);
}

export function renderAgent(d) {
  const a = d.agents.find(x => x.id === (state.session && state.session.selected));
  if (!a) return el('div', { className: 'agent-detail empty flush', hidden: d.agents.length > 0 }, d.agents.length ? '' : 'No subagent ran in this session.');
  const parent = a.parent && d.agents.find(x => x.id === a.parent);
  const facts = [
    ['Type', a.type],
    a.name && ['Name', a.name],
    ['Model', shortModel(a.model) || 'inherit'],
    ['Mode', `${a.teammate ? 'teammate' : a.background ? 'background' : 'foreground'} · started by ${parent ? agentLabel(parent) : 'the main thread'}`],
    ['Status', AGENT_STATUS[a.status]],
    typeof a.launchedAt === 'number' && ['Launched', fmtTime(a.launchedAt)],
    typeof a.start === 'number' && a.end && ['Ran', `${fmtTime(a.start)} to ${fmtTime(a.end)} · ${fmtDur(a.end - a.start)}`],
    a.reports.length && ['Reported', a.reports.map(fmtTime).join(', ')],
    ['Turns', a.turns],
    Object.keys(a.tools).length && ['Tools', topTools(a.tools)],
    ['Tokens', tokensText(a.usage)],
    a.error && ['Error', a.error],
  ].filter(Boolean);
  return el(
    'div',
    { className: 'agent-detail' },
    el('div', { className: 'group-label' }, agentLabel(a)),
    el(
      'div',
      { className: 'facts' },
      facts.flatMap(([k, v]) => [el('span', { className: 'key' }, k), el('span', { className: 'value' }, String(v))])
    ),
    a.prompt ? el('details', {}, el('summary', {}, 'Brief'), el('pre', { className: 'json wrap' }, a.prompt)) : null,
    a.result ? el('details', { open: true }, el('summary', {}, 'Report'), el('pre', { className: 'json wrap' }, a.result)) : null
  );
}

export const hcStat = (label, value, key) => el('div', { className: 'hc-stat' }, el('span', { className: `hc-k${key ? ` k-${key}` : ''}` }, label), el('span', { className: 'hc-v' }, value));

export function tokenBar(u) {
  const tokenIn = u.input + u.cacheCreate;
  const total = Math.max(1, tokenIn + u.output + u.cacheRead);
  const bar = el('div', { className: 'hc-bar', 'aria-hidden': 'true' }, ['in', 'out', 'read'].map(k => el('span', { className: `seg ${k}` })));
  [tokenIn, u.output, u.cacheRead].forEach((n, i) => (bar.children[i].style.width = `${(n / total) * 100}%`));
  return bar;
}

// Card for the main thread: the orchestrator's own facts.
export function mainCard(d) {
  const u = d.usage;
  const toolUses = Object.values(d.tools || {}).reduce((n, v) => n + v, 0);
  return el(
    'div',
    { className: 'hc' },
    el(
      'div',
      { className: 'hc-head' },
      el('span', { className: 'swatch hc-dot tone-main' }),
      el('span', { className: 'hc-type' }, 'Main thread'),
      el('span', { className: 'hc-name' }, 'orchestrator'),
      el('span', { className: 'hc-spacer' }),
      d.live ? el('span', { className: 'hc-pill run' }, d.live) : null
    ),
    el('div', { className: 'hc-note' }, icon('info'), el('span', {}, 'The session itself: reads your prompts, runs its own tools, starts the agents.')),
    el(
      'div',
      { className: 'hc-grid' },
      hcStat('Model', shortModel(d.model) || 'n/a'),
      hcStat('Ran', d.start && d.end ? fmtDur(d.end - d.start) : 'n/a'),
      hcStat('Prompts', String(d.prompts.length)),
      hcStat('Tool uses', String(toolUses)),
      hcStat('File edits', String(d.edits || 0)),
      hcStat('Agents started', String(d.agents.filter(a => !a.parent).length)),
      hcStat('Tokens in', fmtNum(u.input + u.cacheCreate), 'in'),
      hcStat('Tokens out', fmtNum(u.output), 'out'),
      hcStat('Cache reads', fmtNum(u.cacheRead), 'read')
    ),
    tokenBar(u),
    el('div', { className: 'hc-sec' }, el('div', { className: 'hc-label' }, 'Top tools'), el('div', { className: 'hc-text' }, topTools(d.tools) || 'none')),
    el('div', { className: 'hc-foot' }, el('span', {}, `Est. cost ${fmtUsd(u.cost || 0)}`), el('span', {}, `${d.turns} ${d.turns === 1 ? 'turn' : 'turns'}`))
  );
}

export function bindMainHover(g, d) {
  g.addEventListener('mouseenter', e => placeCard('main', () => mainCard(d), { x: e.clientX, y: e.clientY }));
  g.addEventListener('mousemove', e => placeCard('main', () => mainCard(d), { x: e.clientX, y: e.clientY }));
  g.addEventListener('mouseleave', hideHover);
}

// Hover, focus, click and keyboard wiring for one agent mark in any diagram.
export function bindAgent(g, a, d, colors) {
  const color = colors.tone(a);
  const parent = a.parent ? d.agents.find(p => p.id === a.parent) : undefined;
  g.setAttribute('tabindex', '0');
  g.setAttribute('role', 'button');
  g.setAttribute('aria-label', `${agentLabel(a)}, ${AGENT_STATUS[a.status]}`);
  g.dataset.agent = a.id;
  g.addEventListener('click', () => selectAgent(a.id));
  g.addEventListener('mouseenter', e => showHover(a, color, { x: e.clientX, y: e.clientY }, parent));
  g.addEventListener('mousemove', e => showHover(a, color, { x: e.clientX, y: e.clientY }, parent));
  g.addEventListener('mouseleave', hideHover);
  g.addEventListener('focus', () => {
    const r = g.getBoundingClientRect();
    showHover(a, color, { x: r.right, y: r.bottom }, parent);
  });
  g.addEventListener('blur', hideHover);
  g.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    selectAgent(a.id, true);
  });
}

export const tokensOf = u => u.input + u.cacheCreate + u.cacheRead + u.output;

export const laneName = a => (a.type === 'claude' && a.name ? a.name : shortType(a.type));
