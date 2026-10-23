// @ts-nocheck
// The Decisions view.
import { promptParts } from '../shared/event-layers';
import { state, total } from './core';
import { clip, el, fmtDur, fmtTime, icon, svg } from './dom';
import { hideHover, placeCard } from './hover';
import { AGENT_STATUS, STATUS_TONE, colorsOf, endOfAgent, modeSwitch, widthOf } from './session-common';
import { bindAgent, laneName } from './timeline';

export const ACTIONS = ['delegated', 'worked on the main thread', 'followed up an agent', 'answered directly'];

export const DECISION_LABELS = { 'worked on the main thread': 'worked itself', 'followed up an agent': 'followed up agent', 'answered directly': 'answered' };

export const TEAM_SHAPES = { 'agents together': 'together', 'agents one after another': 'one after another' };

export const DECISION_MODES = [
  ['sum', 'Sum', 'merge', 'Your prompts summed up: what the main thread did, which agent or team, and how it ended.'],
  ['timeline', 'Full timeline', 'history', 'Every prompt in order: what the main thread did, the agent it launched or its team, and each team member.'],
];

export const STATUS_GLYPH = { done: 'pass', failed: 'error', stopped: 'debug-stop', unknown: 'question', running: 'clock' };

// A whole prompt: the user's own words as text, each pasted block muted under "Pasted text" and cut to a few lines.
const fullPrompt = text =>
  el(
    'div',
    { className: 'hc-tl-prompt full' },
    promptParts(text).map(p =>
      p.kind === 'text'
        ? el('div', { className: 'hc-tl-words' }, p.text)
        : el('div', { className: 'hc-paste' }, el('div', { className: 'hc-paste-head' }, icon('clippy'), el('span', {}, 'Pasted text')), el('div', { className: 'hc-paste-body tip-lines' }, p.text))
    )
  );

// The prompts on a time rail. Each prompt carries the agents it launched, one by name or several as a team,
// and every agent gets a run bar on a track that spans the prompt to the last report. `full` shows each prompt whole,
// its pasted blocks set apart, instead of two lines.
export function decisionCard(label, items, d, full) {
  const promptAt = new Map(d.prompts.map(p => [p.at, p.text]));
  const byId = new Map(d.agents.map(a => [a.id, a]));
  const colors = colorsOf(d);
  const sorted = [...items].sort((p, q) => p.at - q.at);
  const shown = sorted.slice(0, 6);
  const first = sorted[0].at;
  const last = sorted[sorted.length - 1].at;
  const launches = items.reduce((n, x) => n + x.launches, 0);
  const span = [last > first ? `${fmtTime(first)} to ${fmtTime(last)}` : fmtTime(first), last > first ? fmtDur(last - first) : '', launches ? `${launches} ${launches === 1 ? 'agent' : 'agents'}` : ''];
  const run = (a, from, to) => {
    const start = typeof a.start === 'number' ? a.start : typeof a.launchedAt === 'number' ? a.launchedAt : from;
    const end = endOfAgent(a) || a.reports[0] || start;
    const seg = el('span', { className: `hc-run-seg swatch ${colors.tone(a)}` });
    seg.style.left = `${((start - from) / (to - from)) * 100}%`;
    seg.style.width = `${Math.max(1.5, ((end - start) / (to - from)) * 100)}%`;
    return el(
      'div',
      { className: 'hc-run' },
      el('span', { className: `swatch hc-dot ${colors.tone(a)}` }),
      el('span', { className: 'hc-run-name' }, laneName(a)),
      el('span', { className: 'hc-run-desc' }, a.description || ''),
      el('span', { className: `hc-run-status ${STATUS_TONE[a.status] || 'muted'}` }, icon(STATUS_GLYPH[a.status] || 'circle-outline'), AGENT_STATUS[a.status]),
      el('span', { className: 'hc-run-track', 'aria-hidden': 'true' }, seg),
      el('span', { className: 'hc-run-dur' }, end > start ? fmtDur(end - start) : '')
    );
  };
  return el(
    'div',
    { className: 'hc hc-decision' },
    el('div', { className: 'hc-head' }, icon('type-hierarchy'), el('span', { className: 'hc-type' }, label), el('span', { className: 'hc-spacer' }), el('span', { className: 'hc-pill muted' }, `${items.length} ${items.length === 1 ? 'prompt' : 'prompts'}`)),
    el('div', { className: 'hc-sub' }, span.filter(Boolean).join(' · ')),
    el(
      'ol',
      { className: 'hc-tl' },
      shown.map((x, i) => {
        const runs = (x.agents || []).map(id => byId.get(id)).filter(Boolean);
        const to = Math.max(x.at + 1000, ...runs.map(a => endOfAgent(a) || a.reports[0] || a.start || a.launchedAt || x.at));
        const together = x.shape === 'agents together';
        return el(
          'li',
          { className: `hc-tl-item${runs.length ? ' delegated' : ''}` },
          el('div', { className: 'hc-tl-when' }, el('span', { className: 'hc-tl-time' }, fmtTime(x.at)), i ? el('span', { className: 'hc-tl-gap' }, `+${fmtDur(x.at - shown[i - 1].at)}`) : null),
          full ? fullPrompt(promptAt.get(x.at) || '') : el('div', { className: 'hc-tl-prompt' }, promptAt.get(x.at) || ''),
          runs.length
            ? el(
                'div',
                { className: `hc-tl-runs${runs.length > 1 ? ` team${together ? '' : ' serial'}` : ''}` },
                runs.length > 1 ? el('div', { className: 'hc-tl-team' }, icon(together ? 'organization' : 'list-ordered'), `Team of ${runs.length} · ${TEAM_SHAPES[x.shape] || ''}`) : null,
                runs.map(a => run(a, x.at, to))
              )
            : null
        );
      })
    ),
    sorted.length > shown.length ? el('div', { className: 'hc-text muted' }, `and ${sorted.length - shown.length} more`) : null
  );
}

export function drawDecisions(host, d) {
  const W = widthOf(host, 560);
  const list = d.decisions || [];
  const total = list.length;
  if (!total) {
    host.replaceChildren(el('div', { className: 'empty flush dg-empty' }, 'No prompts in this session.'));
    return;
  }
  const colors = colorsOf(d);
  const selected = state.session && state.session.selected;
  const byId = new Map(d.agents.map(a => [a.id, a]));
  // Tree: prompts -> action -> agent name or team -> outcome -> each agent launched.
  const node = (label, items, children = [], extra = {}) => ({ label, items, children, ...extra });
  const groupBy = (items, keyOf) => {
    const groups = new Map();
    for (const x of items) groups.set(keyOf(x), [...(groups.get(keyOf(x)) || []), x]);
    return [...groups.entries()];
  };
  const mode = state.decisionMode === 'timeline' ? 'timeline' : 'sum';
  const launchedBy = x => (x.agents || []).map(id => byId.get(id)).filter(Boolean);
  const runs = items => items.flatMap(x => launchedBy(x).map(a => node(laneName(a), [x], [], { agent: a })));
  const delegated = items => {
    const agents = groupBy(
      items.filter(x => x.launches === 1),
      x => x.types[0] || 'agent'
    )
      .sort((p, q) => q[1].length - p[1].length)
      .map(([name, v]) => node(name, v, groupBy(v, x => x.outcome).map(([outcome, w]) => node(outcome, w, runs(w), { title: `${name} · ${outcome}` }))));
    const team = items.filter(x => x.launches > 1);
    if (!team.length) return agents;
    const members = groupBy(team, x => `${x.types.join(' + ') || 'agent'}|${x.outcome}`).map(([k, w]) => node(k.split('|')[0], w, runs(w), { outcome: k.split('|')[1] }));
    return [...agents, node('team', team, members)];
  };
  const sum = () =>
    node(
      'Your prompts',
      list,
      ACTIONS.map(action => {
        const items = list.filter(x => x.action === action);
        return node(action, items, action === 'delegated' ? delegated(items) : []);
      }).filter(a => a.items.length)
    );
  // Full timeline: every prompt in order with what the main thread did, the agent it launched by name or its team, and each team member.
  const timeline = () =>
    node(
      'Your prompts',
      list,
      list.map(x => {
        const launched = launchedBy(x);
        const agents = launched.map(a => node(laneName(a), [x], [], { agent: a }));
        return node(fmtTime(x.at), [x], launched.length > 1 ? [node('team', [x], agents, { outcome: TEAM_SHAPES[x.shape] })] : agents, { prompt: x });
      })
    );
  const tree = mode === 'timeline' ? timeline() : sum();
  const keyed = (n, key, depth) => {
    n.key = key;
    n.depth = depth;
    n.children.forEach(c => keyed(c, `${key}/${c.agent ? c.agent.id : c.prompt ? c.prompt.at : c.title || (c.outcome ? `${c.label}|${c.outcome}` : c.label)}`, depth + 1));
  };
  keyed(tree, mode, 0);
  // Drilldown: the sum opens three levels by default, the timeline opens everything; every node with children folds on click.
  const open = state.session ? (state.session.decisionOpen = state.session.decisionOpen || {}) : {};
  // The timeline hides the root: its prompts sit in the first column on a time rail.
  const base = mode === 'timeline' ? 1 : 0;
  const isOpen = n => n.children.length > 0 && ((base && n === tree) || (n.key in open ? open[n.key] : mode === 'timeline' || n.depth < 3));
  const RAIL = mode === 'timeline' ? 18 : 0;
  const promptText = new Map(d.prompts.map(p => [p.at, p.text]));
  const PAD = 12;
  const SLOT = 46;
  const NODE_H = 34;
  const GAP = 48;
  let leaf = 0;
  let deepest = 0;
  const place = n => {
    deepest = Math.max(deepest, n.depth);
    if (!isOpen(n)) {
      n.y = PAD + 20 + leaf * SLOT;
      leaf++;
    } else {
      n.children.forEach(place);
      n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2;
    }
  };
  place(tree);
  const cols = Math.max(mode === 'timeline' ? 3 : 4, deepest + 1 - base);
  const nodeW = Math.max(130, Math.floor((W - PAD * 2 - RAIL - (cols - 1) * GAP) / cols));
  const colX = c => PAD + RAIL + (c - base) * (nodeW + GAP);
  const width = Math.max(W, colX(cols - 1 + base) + nodeW + PAD);
  const H = PAD + 20 + leaf * SLOT;
  const root = svg('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, class: 'tl dg', role: 'img', 'aria-label': mode === 'timeline' ? 'Orchestrator decisions, prompt by prompt' : 'Orchestrator decision tree' });
  const headers = mode === 'timeline' ? ['prompt and what the main thread did', 'agent or team', 'each agent in the team'] : ['', 'what the main thread did', 'agent or team', 'outcome', 'each agent'];
  root.append(...headers.slice(0, cols).map((t, i) => (t ? svg('text', { x: colX(i + base), y: PAD + 6, class: 'dg-meta' }, t) : null)).filter(Boolean));
  const onDelegated = n => n === tree || n.label === 'delegated' || n.items.every(x => x.action === 'delegated');
  if (mode === 'timeline') {
    const ys = tree.children.map(c => c.y + NODE_H / 2);
    const rx = PAD + 5;
    root.append(svg('line', { x1: rx, x2: rx, y1: ys[0], y2: ys[ys.length - 1], class: 'dg-rail' }));
    tree.children.forEach((c, i) =>
      root.append(svg('line', { x1: rx, x2: colX(1), y1: ys[i], y2: ys[i], class: 'dg-rail' }), svg('circle', { cx: rx, cy: ys[i], r: 4.5, class: `dg-rail-dot${c.prompt.action === 'delegated' ? ' gold' : ''}` }))
    );
  }
  const toggle = (n, refocus) => {
    open[n.key] = !isOpen(n);
    hideHover();
    drawDecisions(host, d);
    if (!refocus) return;
    const g = [...host.querySelectorAll('.dg-decision')].find(x => x.dataset.key === n.key);
    if (g) g.focus();
  };
  const drawNode = n => {
    if (n === tree && base) {
      n.children.forEach(drawNode);
      return;
    }
    if (isOpen(n))
      for (const c of n.children) {
        const w = Math.max(1.5, (c.items.length / total) * 22);
        const x1 = colX(n.depth) + nodeW;
        const x2 = colX(c.depth);
        const y1 = n.y + NODE_H / 2;
        const y2 = c.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        root.append(svg('path', { d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, class: `dg-flow${onDelegated(c) ? ' gold' : ''}`, 'stroke-width': w }));
        drawNode(c);
      }
    const x0 = colX(n.depth);
    if (n.agent) {
      const a = n.agent;
      const g = svg(
        'g',
        { class: 'dg-agent' },
        svg('rect', { x: x0, y: n.y, width: nodeW, height: NODE_H, rx: 5, class: `dg-node${a.status === 'failed' ? ' failed' : a.status === 'unknown' ? ' silent' : ''}${selected === a.id ? ' sel' : ''}` }),
        svg('rect', { x: x0, y: n.y, width: 4, height: NODE_H, class: `dg-tone ${colors.tone(a)}` }),
        svg('text', { x: x0 + 10, y: n.y + 14, class: 'dg-label strong' }, clip(n.label, Math.floor((nodeW - 16) / 6.6))),
        svg('text', { x: x0 + 10, y: n.y + 28, class: 'dg-meta' }, clip(a.description || AGENT_STATUS[a.status], Math.floor((nodeW - 16) / 5.6)))
      );
      bindAgent(g, a, d, colors);
      root.append(g);
      return;
    }
    const fold = n.children.length > 0;
    const p = n.prompt;
    const title = p ? fmtTime(p.at) : n.title || (n.outcome ? `${n.label} · ${n.outcome}` : n.label);
    const launches = n.items.reduce((s, x) => s + x.launches, 0);
    const label = p ? `${fmtTime(p.at)} · ${DECISION_LABELS[p.action] || p.action}` : DECISION_LABELS[n.label] || n.label;
    const meta = p
      ? String(promptText.get(p.at) || '').replace(/\s+/g, ' ')
      : [n.outcome, base ? '' : `${n.items.length} ${n.items.length === 1 ? 'prompt' : 'prompts'}`, n.depth >= 2 ? `${launches} ${launches === 1 ? 'agent' : 'agents'}` : ''].filter(Boolean).join(' · ');
    const g = svg(
      'g',
      { class: 'dg-decision' },
      svg('rect', { x: x0, y: n.y, width: nodeW, height: NODE_H, rx: 5, class: `dg-node${n === tree ? ' main' : ''}${n.label === 'delegated' || (p && p.action === 'delegated') ? ' gold' : ''}` }),
      svg('text', { x: x0 + 8, y: n.y + 14, class: 'dg-label strong' }, clip(label, Math.floor((nodeW - (fold ? 28 : 14)) / 6.6))),
      svg('text', { x: x0 + 8, y: n.y + 28, class: 'dg-meta' }, clip(meta, Math.floor((nodeW - 14) / 5.6))),
      fold ? svg('text', { x: x0 + nodeW - 8, y: n.y + 16, class: 'dg-fold', 'text-anchor': 'end' }, isOpen(n) ? '▾' : '▸') : null
    );
    g.dataset.key = n.key;
    g.addEventListener('mouseenter', e => placeCard(`decision:${n.key}`, () => decisionCard(title, n.items, d), { x: e.clientX, y: e.clientY }));
    g.addEventListener('mousemove', e => placeCard(`decision:${n.key}`, () => decisionCard(title, n.items, d), { x: e.clientX, y: e.clientY }));
    g.addEventListener('mouseleave', hideHover);
    if (fold) {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-expanded', isOpen(n) ? 'true' : 'false');
      g.setAttribute('aria-label', `${title}, ${n.items.length} ${n.items.length === 1 ? 'prompt' : 'prompts'}`);
      g.addEventListener('click', () => toggle(n));
      g.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggle(n, true);
      });
    }
    root.append(g);
  };
  drawNode(tree);
  const modes = modeSwitch(host, DECISION_MODES, mode, 'Decision views', id => {
    state.decisionMode = id;
    drawDecisions(host, d);
  });
  host.replaceChildren(modes, root);
}
