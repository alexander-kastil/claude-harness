// @ts-nocheck
// The Delegation map and its process diagram.
import { bindEvents, chipText, modsOf, promptLine, toneOf, toneOfAll } from '../shared/event-layers';
import { claudeMark } from './confirm';
import { persist, state, vscode } from './core';
import { DECISION_LABELS, decisionCard, promptCard } from './decisions';
import { clip, el, fmtDur, fmtTime, icon, plural, shortModel, shortType, svg } from './dom';
import { hideHover, placeCard, tabTip } from './hover';
import { colorsOf, endOfAgent, modeSwitch, widthOf } from './session-common';
import { bindAgent, bindMainHover, laneName } from './timeline';

export const MAP_MODES = [
  ['sum', 'Sum', 'merge', 'Agents summed up by type under whoever started them; click a type to drill down to its runs.'],
  ['timeline', 'Full timeline', 'history', 'Your prompts as a process from top to bottom: each delegation branches into the agents it started, and their reports join the main thread again.'],
];

// Every row in the map shows the same facts in the same right-aligned columns: model (runs for a type), run time, tools, messages.
export const MAP_ROW_H = 30;

export const MAP_FACT_ENDS = [244, 172, 100, 28];

// The narrowest a row gets before the map scrolls: the four fact columns plus a short agent name.
export const MAP_ROW_MIN = 400;

export const fmtRun = ms => (ms > 0 ? fmtDur(ms) : '-');

export const mapCells = (right, y, list) => list.map((t, i) => svg('text', { x: right - MAP_FACT_ENDS[i], y, class: 'dg-meta', 'text-anchor': 'end' }, t));

export const mapNameRoom = (x, right) => Math.floor((right - MAP_FACT_ENDS[0] - 70 - x) / 6.6);

export function mapFacts(d) {
  const msgs = new Map();
  for (const e of d.events) if (e.kind === 'message' && e.agent) msgs.set(e.agent, (msgs.get(e.agent) || 0) + 1);
  return { msgs, toolsOf: a => Object.values(a.tools).reduce((n, v) => n + v, 0), runOf: a => (typeof a.start === 'number' && a.end > a.start ? a.end - a.start : 0) };
}

export function mapAgentRow(a, x, y, right, d, colors, msgs, selected) {
  const { toolsOf, runOf } = mapFacts({ events: [] });
  const family = a.model ? String(a.model).replace(/^claude-/, '').replace(/-\d.*$/, '') : '-';
  const g = svg(
    'g',
    { class: 'dg-agent' },
    svg('rect', { x, y, width: right - x, height: MAP_ROW_H, rx: 5, class: `dg-node${a.status === 'failed' ? ' failed' : a.status === 'unknown' ? ' silent' : ''}${selected === a.id ? ' sel' : ''}` }),
    svg('rect', { x, y, width: 4, height: MAP_ROW_H, class: `dg-tone ${colors.tone(a)}` }),
    svg('text', { x: x + 12, y: y + 19, class: 'dg-label' }, clip(laneName(a), mapNameRoom(x, right))),
    mapCells(right, y + 19, [family, fmtRun(runOf(a)), plural(toolsOf(a), 'tool'), plural(msgs.get(a.id) || 0, 'msg')])
  );
  bindAgent(g, a, d, colors);
  return g;
}

export function drawMap(host, d) {
  const W = widthOf(host, 560);
  const colors = colorsOf(d);
  const selected = state.session && state.session.selected;
  const mode = state.mapMode === 'sum' ? 'sum' : 'timeline';
  const PAD = 12;
  const ROW = 36;
  const NODE_H = MAP_ROW_H;
  const MAIN_W = 150;
  // Sum: one node per agent type under whoever started it; a type drills down to its runs, a run shows the types it started.
  const ids = new Set(d.agents.map(a => a.id));
  const kids = new Map();
  for (const a of d.agents) if (a.parent && ids.has(a.parent)) kids.set(a.parent, [...(kids.get(a.parent) || []), a]);
  const groupsOf = (list, key) => {
    const byType = new Map();
    for (const a of list) byType.set(a.type, [...(byType.get(a.type) || []), a]);
    return [...byType.entries()].map(([type, agents]) => {
      const k = `${key}/${type}`;
      return { key: k, type, agents, children: agents.map(a => ({ key: `${k}/${a.id}`, agent: a, children: groupsOf(kids.get(a.id) || [], `${k}/${a.id}`) })) };
    });
  };
  const open = state.session ? (state.session.mapOpen = state.session.mapOpen || {}) : {};
  const isOpen = n => n.children.length > 0 && (n.agent ? true : !!open[n.key]);
  const shown = [];
  if (mode === 'sum') {
    const walk = (n, depth, parent) => {
      shown.push({ n, depth, parent });
      if (isOpen(n)) n.children.forEach(c => walk(c, depth + 1, n));
    };
    groupsOf(d.agents.filter(a => !a.parent || !ids.has(a.parent)), 'map').forEach(g => walk(g, 0));
  }
  const sw = modeSwitch(host, MAP_MODES, mode, 'Delegation map views', id => {
    state.mapMode = id;
    drawMap(host, d);
  });
  if (mode === 'timeline') {
    // A redraw, such as the one a toggle's new height sets off, keeps the focus on the toggle that had it.
    const focused = host.contains(document.activeElement) ? document.activeElement.dataset.toggle : undefined;
    host.replaceChildren(el('div', { className: 'dg-bar' }, sw, mapToggles(host, d)), drawProcess(W, d));
    const again = focused && [...host.querySelectorAll('[data-toggle]')].find(x => x.dataset.toggle === focused);
    if (again) again.focus();
    return;
  }
  // A tree table across the full width: rows indent by depth and end at the right edge, the facts sit in
  // right-aligned columns at the same place on every row.
  const INDENT = 22;
  const left0 = PAD + MAIN_W + 48;
  const width = Math.max(W, left0 + MAP_ROW_MIN + PAD);
  const rowRight = width - PAD;
  const { msgs, toolsOf, runOf } = mapFacts(d);
  const pos = new Map();
  let y = PAD + 18;
  for (const r of shown) {
    pos.set(r.n.key, { x: left0 + r.depth * INDENT, y });
    y += ROW;
  }
  const H = Math.max(y, PAD + 18 + 72) + PAD;
  const mainY = PAD + 18;
  const mainH = 72;
  const root = svg('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, class: 'tl dg', role: 'img', 'aria-label': 'Delegation map, summed by agent type' });
  const mainG = svg(
    'g',
    { class: 'dg-main' },
    svg('rect', { x: PAD, y: mainY, width: MAIN_W, height: mainH, rx: 6, class: 'dg-node main' }),
    svg('text', { x: PAD + 10, y: mainY + 20, class: 'dg-label strong' }, 'Main thread'),
    svg('text', { x: PAD + 10, y: mainY + 36, class: 'dg-meta' }, shortModel(d.model) || ''),
    svg('text', { x: PAD + 10, y: mainY + 50, class: 'dg-meta' }, `${d.prompts.length} prompts · ${Object.values(d.tools).reduce((n, v) => n + v, 0)} tools`)
  );
  bindMainHover(mainG, d);
  const mainRight = PAD + MAIN_W;
  const mainMid = mainY + mainH / 2;
  const edges = svg('g', {});
  for (const r of shown) {
    const c = pos.get(r.n.key);
    if (r.parent) {
      const p = pos.get(r.parent.key);
      edges.append(svg('path', { d: `M ${p.x + 10} ${p.y + NODE_H} V ${c.y + NODE_H / 2} H ${c.x}`, class: 'dg-edge' }));
    } else {
      const elbow = mainRight + (left0 - mainRight) / 2;
      edges.append(svg('path', { d: `M ${mainRight} ${mainMid} H ${elbow} V ${c.y + NODE_H / 2} H ${left0}`, class: 'dg-edge' }));
    }
  }
  root.append(edges, mainG);
  const agentNode = (a, p) => root.append(mapAgentRow(a, p.x, p.y, rowRight, d, colors, msgs, selected));
  // A type node: how many runs, their summed run time, tools and messages; a click drills down to the runs.
  const typeNode = (n, p) => {
    const runs = n.agents;
    const failed = runs.filter(a => a.status === 'failed').length;
    const name = shortType(n.type);
    const toggle = refocus => {
      open[n.key] = !isOpen(n);
      hideHover();
      drawMap(host, d);
      if (!refocus) return;
      const g = [...host.querySelectorAll('.dg-decision')].find(x => x.dataset.key === n.key);
      if (g) g.focus();
    };
    const g = svg(
      'g',
      { class: 'dg-decision', tabindex: '0', role: 'button', 'aria-expanded': isOpen(n) ? 'true' : 'false', 'aria-label': `${name}, ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}` },
      svg('rect', { x: p.x, y: p.y, width: rowRight - p.x, height: NODE_H, rx: 5, class: `dg-node${failed ? ' failed' : ''}` }),
      svg('rect', { x: p.x, y: p.y, width: 4, height: NODE_H, class: `dg-tone ${colors.tone(runs[0])}` }),
      svg('text', { x: p.x + 12, y: p.y + 19, class: 'dg-label strong' }, clip(name, mapNameRoom(p.x, rowRight))),
      svg('text', { x: rowRight - 10, y: p.y + 19, class: 'dg-fold', 'text-anchor': 'end' }, isOpen(n) ? '▾' : '▸'),
      mapCells(rowRight, p.y + 19, [
        plural(runs.length, 'run'),
        fmtRun(runs.reduce((s, a) => s + runOf(a), 0)),
        plural(runs.reduce((s, a) => s + toolsOf(a), 0), 'tool'),
        plural(runs.reduce((s, a) => s + (msgs.get(a.id) || 0), 0), 'msg'),
      ])
    );
    g.dataset.key = n.key;
    g.addEventListener('click', () => toggle());
    g.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggle(true);
    });
    root.append(g);
  };
  for (const r of shown) (r.n.agent ? agentNode(r.n.agent, pos.get(r.n.key)) : typeNode(r.n, pos.get(r.n.key)));
  host.replaceChildren(sw, root);
}

// Full timeline buttons right of the Sum / Full timeline switch: Prompts, which shows each prompt as its own box; Mods,
// which switches the events of every mod on or off together; and Analyze, which opens a new Claude on a copy of the session.
function mapToggles(host, d) {
  const button = (key, text, glyph, about, attrs, onclick, mark = icon(glyph)) => {
    const tip = target => {
      const r = target.getBoundingClientRect();
      placeCard(`toggle:${key}`, () => tabTip(text, glyph, about), { x: r.left - 14, y: r.bottom - 6 });
    };
    return el(
      'div',
      { className: 'dg-modes dg-toggle' },
      el(
        'button',
        {
          className: 'view-tab dg-mode',
          'aria-description': about,
          'data-toggle': key,
          onclick,
          onmouseenter: e => tip(e.currentTarget),
          onmouseleave: hideHover,
          onfocus: e => tip(e.currentTarget),
          onblur: hideHover,
          ...attrs,
        },
        mark,
        el('span', {}, text)
      )
    );
  };
  const toggle = (key, text, glyph, about, on, flip) =>
    button(key, text, glyph, about, { className: `view-tab dg-mode${on ? ' active' : ''}`, 'aria-pressed': on ? 'true' : 'false' }, () => {
      hideHover();
      flip();
      persist();
      drawMap(host, d);
      const b = [...host.querySelectorAll('[data-toggle]')].find(x => x.dataset.toggle === key);
      if (b) b.focus();
    });
  const s = state.session;
  return [
    toggle('prompts', 'Prompts', 'comment', 'Each prompt as its own box on the main thread, above the step it started.', state.mapPrompts, () => (state.mapPrompts = !state.mapPrompts)),
    hasModEvents(d) ? toggle('mods', 'Mods', 'plug', 'What each mod did, on the steps and agents it concerns.', state.mapMods, () => (state.mapMods = !state.mapMods)) : null,
    s
      ? button(
          'analyze',
          'Analyze',
          'comment-discussion',
          'A new Claude in a terminal with a copy of this session, to ask about it in a chat. The session itself stays untouched.',
          { 'data-confirm': 'analyze' },
          () => {
            hideHover();
            vscode.postMessage({ type: 'analyzeSession', scope: s.scope, id: s.id });
          },
          claudeMark()
        )
      : null,
  ].filter(Boolean);
}

// A session has mod events when at least one layer, from any source, holds one.
const hasModEvents = d => modsOf(d.layers).length > 0;

const fmtSec = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const TONE_ICON = { act: 'plug', warn: 'warning', quiet: 'circle-outline' };

// The events of one step or agent row, one section per mod headed by its label: who they concern, how many and when,
// then each event.
export function eventsCard(name, sets) {
  return el(
    'div',
    { className: 'hc hc-ev' },
    sets.map(({ label, events }) => {
      const first = Date.parse(events[0].at);
      const last = Date.parse(events[events.length - 1].at);
      return el(
        'div',
        { className: 'hc-ev-sec' },
        el('div', { className: 'hc-head' }, icon('plug'), el('span', { className: 'hc-type' }, label), el('span', { className: 'hc-name' }, name)),
        el('div', { className: 'hc-sub' }, `${plural(events.length, 'event')} · ${last > first ? `${fmtSec(first)} to ${fmtSec(last)}` : fmtSec(first)}`),
        el(
          'ol',
          { className: 'hc-tl' },
          events.map(e =>
            el(
              'li',
              { className: `hc-tl-item ev-${toneOf(e)}` },
              el('div', { className: 'hc-tl-when' }, el('span', { className: 'hc-tl-time' }, fmtSec(Date.parse(e.at))), el('span', { className: 'hc-ev-hook' }, e.hook)),
              el('div', { className: 'hc-ev-text' }, e.text),
              e.detail ? el('div', { className: 'hc-ev-detail tip-lines' }, e.detail) : null
            )
          )
        )
      );
    })
  );
}

// A chip with the layers' labels, for a step whose events all looked and did nothing a hollow dashed marker, and for
// a denial a stop sign alone, what was denied being in the card. All are buttons laid over the diagram; hover and
// focus open the event card.
function eventMark(sets, name, key, quiet) {
  const all = sets.flatMap(s => s.events);
  const tone = toneOfAll(all);
  const stop = !quiet && tone === 'warn';
  const aria = sets.map(s => `${s.label}: ${plural(s.events.length, 'event')}`).join(', ');
  const node = quiet
    ? el('button', { className: 'dg-mark', 'aria-label': aria }, svg('svg', { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': 'true' }, svg('circle', { cx: 5, cy: 5, r: 4.5 })))
    : stop
      ? el(
          'button',
          { className: 'dg-mark dg-stop', 'aria-label': aria },
          svg('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, svg('polygon', { points: '5,1 11,1 15,5 15,11 11,15 5,15 1,11 1,5' }), svg('rect', { x: 4, y: 7, width: 8, height: 2 }))
        )
      : el('button', { className: `dg-chip ev-${tone}`, 'aria-label': aria }, icon(TONE_ICON[tone]), el('span', {}, chipText(all)));
  const cardKey = `events:${key}:${sets.map(s => s.label).join('|')}`;
  const open = () => {
    const r = node.getBoundingClientRect();
    placeCard(cardKey, () => eventsCard(name, sets), { x: r.left - 14, y: r.bottom - 6 });
  };
  node.addEventListener('mouseenter', open);
  node.addEventListener('focus', open);
  node.addEventListener('mouseleave', hideHover);
  node.addEventListener('blur', hideHover);
  node.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideHover();
  });
  return { node, h: quiet || stop ? 24 : 20, text: quiet || stop ? '' : chipText(all) };
}

// Widths of the marks as the panel renders them, measured off screen before the diagram is laid out.
function measureMarks(marks) {
  if (!marks.length) return;
  const box = el('div', { className: 'dg-measure', 'aria-hidden': 'true' }, marks.map(m => m.node));
  document.body.append(box);
  for (const m of marks) m.w = m.node.offsetWidth || (m.text ? Math.ceil(m.text.length * 6.6) + 34 : 24);
  box.remove();
}

let measureCtx;

const textWidth = (text, font) => {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 6;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
};

// One line cut to `px` with an ellipsis.
const fitLine = (text, px, font) => {
  if (textWidth(text, font) <= px) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${text.slice(0, mid).trimEnd()}…`, font) <= px) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
};

// Full timeline as a process from top to bottom: your prompts are the steps of the main thread; a delegation branches
// to the agents it started, and each agent's report joins the main thread again (dashed) after the step it reached.
// With Prompts on, each prompt is its own box above the step it started, its first line inside and the whole prompt in
// its hover card; with Mods on, one chip beside each step and on the connector of each agent the events of any mod concern.
export function drawProcess(W, d) {
  const steps = [...(d.decisions || [])].sort((p, q) => p.at - q.at);
  if (!steps.length) return el('div', { className: 'empty flush dg-empty' }, 'No prompts in this session.');
  const colors = colorsOf(d);
  const selected = state.session && state.session.selected;
  const { msgs } = mapFacts(d);
  const byId = new Map(d.agents.map(a => [a.id, a]));
  const PAD = 12;
  const showPrompts = !!state.mapPrompts;
  const promptAt = new Map(d.prompts.map(p => [p.at, p.text]));
  const lines = steps.map(s => (showPrompts ? promptLine(promptAt.get(s.at) || '') : ''));
  const lineFont = `11px ${getComputedStyle(document.body).fontFamily}`;
  // With Mods on, the events of every mod, one set per mod label whatever source its layers came from, bound to the
  // steps and the agent rows.
  const stepSets = steps.map(() => []);
  const agentSets = new Map();
  for (const mod of state.mapMods ? modsOf(d.layers) : []) {
    const bound = bindEvents(mod.events, steps.map(s => s.at), byId.keys());
    bound.steps.forEach((events, i) => events.length && stepSets[i].push({ label: mod.label, events }));
    for (const [id, events] of Object.entries(bound.agents)) agentSets.set(id, [...(agentSets.get(id) || []), { label: mod.label, events }]);
  }
  const stepMarks = stepSets.map((sets, i) =>
    sets.length
      ? eventMark(
          sets,
          `${fmtTime(steps[i].at)} · ${DECISION_LABELS[steps[i].action] || steps[i].action}`,
          `step:${steps[i].at}`,
          sets.every(s => s.events.every(e => toneOf(e) === 'quiet'))
        )
      : undefined
  );
  const agentMarks = new Map(
    [...agentSets].map(([id, sets]) => {
      const a = byId.get(id);
      return [id, eventMark(sets, [shortType(a.type), a.description].filter(Boolean).join(' · '), `agent:${id}`, false)];
    })
  );
  measureMarks([...stepMarks.filter(Boolean), ...agentMarks.values()]);
  const stepMarkW = Math.max(0, ...stepMarks.filter(Boolean).map(m => m.w));
  const agentMarkW = Math.max(0, ...[...agentMarks.values()].map(m => m.w));
  const stepRoom = stepMarkW ? stepMarkW + 8 : 0;
  const agentRoom = agentMarkW ? agentMarkW + 12 : 0;
  const STEP_W = 124;
  const STEP_H = 34;
  const ASK_H = 26;
  const ASK_GAP = 14;
  const ROW = 36;
  const GAP = 22;
  const INDENT = 22;
  const stepX = PAD + 10;
  // A prompt box grows to fit its first line, while the agent rows keep their facts and room for a name beside it. The
  // steps stay narrow and sit centred under their prompts on the main thread.
  const ASK_W = showPrompts
    ? Math.max(STEP_W, Math.min(320, W - PAD - MAP_ROW_MIN - stepX - 48 - agentRoom, Math.ceil(Math.max(...lines.map(l => textWidth(l || 'Pasted text', lineFont)))) + 36))
    : 0;
  const colW = Math.max(STEP_W, ASK_W);
  const spineX = stepX + colW / 2;
  const stepL = spineX - STEP_W / 2;
  const stepR = spineX + STEP_W / 2;
  const returnX = Math.max(stepR + stepRoom, stepX + colW) + 14;
  const branchX = returnX + 16;
  const agentsX = branchX + 18 + agentRoom;
  const width = Math.max(W, agentsX + MAP_ROW_MIN + PAD);
  const right = width - PAD;
  const colOfTime = t => steps.reduce((c, s, i) => (typeof t === 'number' && s.at <= t ? i : c), 0);
  const startOf = a => (typeof a.launchedAt === 'number' ? a.launchedAt : typeof a.start === 'number' ? a.start : 0);
  const ordered = [...d.agents].sort((p, q) => startOf(p) - startOf(q));
  // Each run: the step that started it (its parent's step for a nested agent) and the step its report reached.
  const task = new Map();
  const place = a => {
    if (task.has(a.id)) return task.get(a.id);
    const parent = a.parent && byId.get(a.parent) ? place(byId.get(a.parent)) : undefined;
    const c = parent ? parent.c : colOfTime(startOf(a));
    const reported = a.reports && a.reports.length ? a.reports[0] : endOfAgent(a);
    const t = { a, c, rc: Math.max(c, colOfTime(reported)), depth: parent ? parent.depth + 1 : 0, parent };
    task.set(a.id, t);
    return t;
  };
  ordered.forEach(place);
  const runs = ordered.map(a => task.get(a.id));
  // Each step owns a block of rows: the runs it started in launch order, each nested run right under its parent.
  const kids = new Map();
  for (const t of runs) if (t.parent) kids.set(t.parent.a.id, [...(kids.get(t.parent.a.id) || []), t]);
  const blocks = steps.map(() => []);
  const add = (t, list) => {
    list.push(t);
    (kids.get(t.a.id) || []).forEach(k => add(k, list));
  };
  for (const t of runs) if (!t.parent) add(t, blocks[t.c]);
  const startY = PAD + 8;
  const askTop = [];
  const stepTop = [];
  const blockEnd = [];
  let y = startY + 22;
  steps.forEach((s, i) => {
    if (showPrompts) {
      askTop.push(y);
      y += ASK_H + ASK_GAP;
    }
    stepTop.push(y);
    blocks[i].forEach((t, k) => {
      t.x = agentsX + t.depth * INDENT;
      t.y = y + 2 + k * ROW;
    });
    const h = Math.max(STEP_H, blocks[i].length * ROW - (ROW - MAP_ROW_H) + 4);
    blockEnd.push(y + h);
    y += h + GAP;
  });
  const endY = y + 2;
  const H = endY + 8 + PAD;
  const joinY = i => blockEnd[i] + GAP / 2;
  const root = svg('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, class: 'tl dg', role: 'img', 'aria-label': 'Delegation process, prompt by prompt' });
  root.append(svg('defs', {}, svg('marker', { id: 'dg-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, svg('path', { d: 'M 0 0 L 8 4 L 0 8 z', class: 'dg-arrowhead' }))));
  const edges = svg('g', {});
  const arrow = (dPath, back) => edges.append(svg('path', { d: dPath, class: `dg-edge${back ? ' back' : ''}`, 'marker-end': 'url(#dg-arrow)' }));
  // A step's chip or marker sits level with its first line, the time; the step's branch to its agents then leaves
  // below the mark, so the mark never reads as part of the delegation.
  const FIRST_LINE = 10;
  const branchY = i => stepTop[i] + (stepMarks[i] ? Math.max(STEP_H / 2, FIRST_LINE + 17) : STEP_H / 2);
  // The main thread's flow: start, every prompt (with Prompts on, its box and then its step) in order, end.
  const topOf = i => (showPrompts ? askTop[i] : stepTop[i]);
  arrow(`M ${spineX} ${startY + 7} V ${topOf(0)}`);
  steps.forEach((s, i) => {
    if (showPrompts) arrow(`M ${spineX} ${askTop[i] + ASK_H} V ${stepTop[i]}`);
    arrow(`M ${spineX} ${stepTop[i] + STEP_H} V ${i + 1 < steps.length ? topOf(i + 1) : endY - 7}`);
  });
  for (const t of runs) {
    if (t.parent) {
      const p = t.parent;
      arrow(`M ${p.x + 10} ${p.y + MAP_ROW_H} V ${t.y + MAP_ROW_H / 2} H ${t.x}`);
    } else {
      arrow(`M ${stepR} ${branchY(t.c)} H ${branchX} V ${t.y + 11} H ${t.x}`);
      arrow(`M ${t.x} ${t.y + 21} H ${returnX} V ${joinY(t.rc)} H ${spineX + 1}`, true);
    }
  }
  root.append(edges);
  root.append(svg('circle', { cx: spineX, cy: startY, r: 7, class: 'dg-event' }), svg('circle', { cx: spineX, cy: endY, r: 7, class: 'dg-event end' }));
  // A team that ran together forks at a parallel gateway beside its prompt.
  steps.forEach((s, i) => {
    if (s.launches < 2 || s.shape !== 'agents together') return;
    const gx = branchX;
    const gy = branchY(i);
    root.append(svg('path', { d: `M ${gx} ${gy - 7} L ${gx + 7} ${gy} L ${gx} ${gy + 7} L ${gx - 7} ${gy} Z`, class: 'dg-gateway' }), svg('path', { d: `M ${gx - 3.5} ${gy} H ${gx + 3.5} M ${gx} ${gy - 3.5} V ${gy + 3.5}`, class: 'dg-edge' }));
  });
  const marks = [];
  const lay = (m, x, cy) => {
    m.node.style.left = `${x}px`;
    m.node.style.top = `${cy - m.h / 2}px`;
    marks.push(m.node);
  };
  // A step or prompt box opens its card on hover, follows the pointer, and opens it at its corner on focus.
  const hoverable = (g, key, build) => {
    const card = e => placeCard(key, build, { x: e.clientX, y: e.clientY });
    g.addEventListener('mouseenter', card);
    g.addEventListener('mousemove', card);
    g.addEventListener('mouseleave', hideHover);
    g.addEventListener('focus', () => {
      const r = g.getBoundingClientRect();
      placeCard(key, build, { x: r.right, y: r.bottom });
    });
    g.addEventListener('blur', hideHover);
    g.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideHover();
    });
    return g;
  };
  steps.forEach((s, i) => {
    const yy = stepTop[i];
    const action = DECISION_LABELS[s.action] || s.action;
    if (showPrompts) {
      // The prompt's own box: a speech bubble and the first line, the whole prompt in its card.
      const ay = askTop[i];
      const ax = spineX - ASK_W / 2;
      const line = lines[i] || 'Pasted text';
      const text = promptAt.get(s.at) || '';
      const ask = svg(
        'g',
        { class: 'dg-decision dg-ask', tabindex: '0', 'aria-label': `Prompt at ${fmtTime(s.at)}: ${line}` },
        svg('rect', { x: ax, y: ay, width: ASK_W, height: ASK_H, rx: ASK_H / 2, class: 'dg-node ask' }),
        svg('path', { d: `M ${ax + 11} ${ay + 8} h 10 v 7 h -5 l -3 3 v -3 h -2 z`, class: 'dg-ask-icon' }),
        svg('text', { x: ax + 28, y: ay + 17, class: `dg-prompt${lines[i] ? '' : ' muted'}` }, fitLine(line, ASK_W - 38, lineFont))
      );
      root.append(hoverable(ask, `ask:${s.at}`, () => promptCard(fmtTime(s.at), text)));
    }
    const g = svg(
      'g',
      { class: 'dg-decision', tabindex: '0', 'aria-label': `${fmtTime(s.at)}, ${action}` },
      svg('rect', { x: stepL, y: yy, width: STEP_W, height: STEP_H, rx: 5, class: `dg-node${s.action === 'delegated' ? ' gold' : ''}` }),
      svg('text', { x: stepL + 8, y: yy + 14, class: 'dg-label strong' }, fmtTime(s.at)),
      svg('text', { x: stepL + 8, y: yy + 28, class: 'dg-meta' }, clip(action, Math.floor((STEP_W - 14) / 5.6)))
    );
    root.append(hoverable(g, `step:${s.at}`, () => decisionCard(fmtTime(s.at), [s], d)));
    if (stepMarks[i]) lay(stepMarks[i], stepR + 6, yy + FIRST_LINE);
  });
  for (const t of runs) {
    root.append(mapAgentRow(t.a, t.x, t.y, right, d, colors, msgs, selected));
    if (agentMarks.has(t.a.id)) lay(agentMarks.get(t.a.id), branchX + 12, t.y + MAP_ROW_H / 2);
  }
  if (!marks.length) return root;
  return el('div', { className: 'dg-stage', style: `width: ${width}px; height: ${H}px` }, root, marks);
}
