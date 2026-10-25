// @ts-nocheck
// Shared pieces of the session diagrams: colors, axes, hover cards, mode switches.
import { agentColorClass, persist, total } from './core';
import { el, fmtDur, fmtNum, fmtTime, icon, shortModel, shortType, svg } from './dom';
import { hideHover, placeCard, tabTip } from './hover';

export const topTools = tools =>
  Object.entries(tools || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');

export const agentLabel = a => `${shortType(a.type)}${a.name ? ` ${a.name}` : ''}${a.description ? `: ${a.description}` : ''}`;

export const AGENT_STATUS = { running: 'running', done: 'reported back', stopped: 'stopped', failed: 'failed', unknown: 'never reported back' };

export const peakParallel = agents => {
  const edges = agents
    .filter(a => typeof a.start === 'number' && typeof a.end === 'number')
    .flatMap(a => [
      [a.start, 1],
      [Math.max(a.end, a.start + 1), -1],
    ])
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  let n = 0;
  let peak = 0;
  for (const [, k] of edges) {
    n += k;
    peak = Math.max(peak, n);
  }
  return peak;
};

export const tokensText = u => `${fmtNum(u.input + u.cacheCreate)} in · ${fmtNum(u.output)} out · ${fmtNum(u.cacheRead)} cache reads`;

export const STATUS_TONE = { done: 'ok', failed: 'bad', stopped: 'warn', unknown: 'muted', running: 'run' };

// A report reads as plain lines: no code blocks, table rules, heading or emphasis markers.
export const summaryText = text =>
  String(text || '')
    .slice(0, 4000)
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .map(l =>
      l
        .replace(/^\s*#{1,6}\s*/, '')
        .replace(/^\s*[-*]\s+/, '• ')
        .replace(/\*\*|__|`/g, '')
        .trim()
    )
    .filter(l => l && !/^[\s|:-]+$/.test(l))
    .join('\n');

export const forkNote = (a, parent) =>
  a.type !== 'fork'
    ? undefined
    : parent
      ? `Nested fork: another agent ${a.status === 'failed' ? 'tried to start' : 'started'} it, not the main thread, so its lane is indented under that agent (${shortType(parent.type)}${parent.name ? ` ${parent.name}` : ''}${parent.description ? ` "${parent.description}"` : ''}).`
      : 'Fork of the main session: it starts with the whole conversation so far, runs on the same model in the background and reports back when it finishes.';

export function hoverCard(a, color, parent) {
  const note = forkNote(a, parent);
  const u = a.usage;
  const tokenIn = u.input + u.cacheCreate;
  const total = Math.max(1, tokenIn + u.output + u.cacheRead);
  const toolUses = Object.values(a.tools || {}).reduce((n, v) => n + v, 0);
  const stat = (label, value, key) => el('div', { className: 'hc-stat' }, el('span', { className: `hc-k${key ? ` k-${key}` : ''}` }, label), el('span', { className: 'hc-v' }, value));
  const bar = el('div', { className: 'hc-bar', 'aria-hidden': 'true' }, ['in', 'out', 'read'].map(k => el('span', { className: `seg ${k}` })));
  [tokenIn, u.output, u.cacheRead].forEach((n, i) => (bar.children[i].style.width = `${(n / total) * 100}%`));
  const summary = summaryText(a.result);
  return el(
    'div',
    { className: 'hc' },
    el(
      'div',
      { className: 'hc-head' },
      el('span', { className: `swatch hc-dot ${color}` }),
      el('span', { className: 'hc-type' }, shortType(a.type)),
      a.name ? el('span', { className: 'hc-name' }, a.name) : null,
      el('span', { className: 'hc-spacer' }),
      el('span', { className: `hc-pill ${STATUS_TONE[a.status] || 'muted'}` }, AGENT_STATUS[a.status])
    ),
    a.description ? el('div', { className: 'hc-title' }, a.description) : null,
    note ? el('div', { className: 'hc-note' }, icon('repo-forked'), el('span', {}, note)) : null,
    el(
      'div',
      { className: 'hc-grid' },
      stat('Model', shortModel(a.model) || 'inherit'),
      stat('Ran', typeof a.start === 'number' && a.end ? fmtDur(a.end - a.start) : 'n/a'),
      stat('Tool uses', String(toolUses)),
      stat('Tokens in', fmtNum(tokenIn), 'in'),
      stat('Tokens out', fmtNum(u.output), 'out'),
      stat('Cache reads', fmtNum(u.cacheRead), 'read')
    ),
    bar,
    a.error ? el('div', { className: 'hc-error' }, a.error) : null,
    a.prompt ? el('div', { className: 'hc-sec' }, el('div', { className: 'hc-label' }, 'Prompt'), el('div', { className: 'hc-text clamp-3' }, a.prompt.slice(0, 800).replace(/\s+/g, ' ').trim())) : null,
    el(
      'div',
      { className: 'hc-sec' },
      el('div', { className: 'hc-label' }, 'What it did'),
      summary ? el('div', { className: 'hc-text hc-summary clamp-6' }, summary) : el('div', { className: 'hc-text muted' }, a.status === 'running' ? 'Still running.' : 'No report.')
    ),
    el('div', { className: 'hc-foot' }, el('span', {}, typeof a.launchedAt === 'number' ? `Launched ${fmtTime(a.launchedAt)}` : ''), el('span', {}, 'Click for the full brief and report'))
  );
}

export const showHover = (a, color, at, parent) => placeCard(`agent:${a.id}`, () => hoverCard(a, color, parent), at);

export const TICKS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440].map(m => m * 60000);

export const LANE = 22;

export const BAR = 12;

export const AXIS = 22;

// The palette classes c0 to c5 by the hue they paint, so a palette type and a named type of one hue count as a clash.
export const PALETTE_HUES = ['blue', 'green', 'orange', 'purple', 'yellow', 'red'];

export function colorsOf(d) {
  const map = new Map();
  const namedOf = type => ((d.agentColors || {})[type] && agentColorClass(d.agentColors[type]) ? d.agentColors[type].trim().toLowerCase() : undefined);
  for (const a of d.agents) if (!map.has(a.type)) map.set(a.type, -1);
  // A type without its own color takes a palette hue no named type uses, while one is left.
  const taken = new Set([...map.keys()].map(namedOf).filter(Boolean));
  let next = 0;
  for (const type of map.keys()) {
    if (namedOf(type)) continue;
    const free = PALETTE_HUES.findIndex(h => !taken.has(h));
    const i = free >= 0 ? free : next++ % PALETTE_HUES.length;
    taken.add(PALETTE_HUES[i]);
    map.set(type, i);
  }
  const baseOf = type => (namedOf(type) ? agentColorClass(namedOf(type)) : `c${map.get(type)}`);
  const hueOf = base => (base.startsWith('ac-') ? base.slice(3) : PALETTE_HUES[Number(base.slice(1))]);
  // Types that share a hue keep it; the second and third get a lighter and a deeper shade.
  const shade = new Map();
  const seen = new Map();
  for (const type of map.keys()) {
    const hue = hueOf(baseOf(type));
    const k = seen.get(hue) || 0;
    seen.set(hue, k + 1);
    shade.set(type, k ? ` tint-${((k - 1) % 2) + 1}` : '');
  }
  const typeTone = type => `${baseOf(type)}${shade.get(type) || ''}`;
  const tone = a => (agentColorClass(a.color) && agentColorClass(a.color) !== baseOf(a.type) ? agentColorClass(a.color) : typeTone(a.type));
  return { tone, typeTone, types: [...map.keys()] };
}

export const endOfAgent = a => (a.status === 'running' ? Math.max(a.end || 0, Date.now()) : a.end);

// Diagram width: the host's inner width, a pixel short so rounding never adds a scrollbar.
export const widthOf = (host, min) => Math.max(min, Math.floor(host.clientWidth || 0) - 1);

// Time axis shared by the timeline and the concurrency view: idle stretches longer than GAP shrink to a thin band.
export function timeAxis(d, left, W, right) {
  const endOf = endOfAgent;
  const times = [d.start, d.end, ...d.prompts.map(p => p.at), ...d.agents.flatMap(a => [a.launchedAt, a.start, endOf(a), ...a.reports]), ...d.children.flatMap(c => [c.start, c.end])].filter(
    t => typeof t === 'number' && isFinite(t)
  );
  const t0 = Math.min(...times);
  const t1 = Math.max(...times, t0 + 60000);
  // Idle stretches (no agent, prompt or message) longer than GAP shrink to a thin band so the active parts get the width.
  const GAP = Math.max(15 * 60000, (t1 - t0) * 0.06);
  const GAP_PX = 22;
  const spans = [
    ...d.agents.map(a => [typeof a.launchedAt === 'number' ? a.launchedAt : a.start, Math.max(endOf(a) || 0, ...a.reports)]),
    ...d.children.map(c => [c.start, c.end]),
    ...d.prompts.map(p => [p.at - 60000, p.at + 60000]),
    ...d.events.map(e => [e.at - 30000, e.at + 30000]),
  ]
    .filter(([a, b]) => isFinite(a) && isFinite(b))
    .map(([a, b]) => [Math.max(t0, a), Math.min(t1, Math.max(a, b))])
    .sort((p, q) => p[0] - q[0]);
  const segs = [];
  const push = (a, b, gap) => {
    if (b <= a) return;
    const last = segs[segs.length - 1];
    if (last && !gap && !last.gap) last.b = b;
    else segs.push({ a, b, gap });
  };
  let cursor = t0;
  for (const [a, b] of spans) {
    if (b <= cursor) continue;
    if (a > cursor) push(cursor, a, a - cursor > GAP);
    push(Math.max(cursor, a), b, false);
    cursor = b;
  }
  if (t1 > cursor) push(cursor, t1, t1 - cursor > GAP);
  if (!segs.length) segs.push({ a: t0, b: t1, gap: false });
  const gaps = segs.filter(s => s.gap).length;
  const activeTotal = Math.max(1, segs.filter(s => !s.gap).reduce((n, s) => n + (s.b - s.a), 0));
  const avail = Math.max(60, W - left - right - gaps * GAP_PX);
  let off = left;
  for (const s of segs) {
    s.x = off;
    s.w = s.gap ? GAP_PX : ((s.b - s.a) / activeTotal) * avail;
    off += s.w;
  }
  const x = t => {
    const s = segs.find(g => t <= g.b) || segs[segs.length - 1];
    if (t <= s.a) return s.x;
    return s.x + Math.min(1, (t - s.a) / (s.b - s.a)) * s.w;
  };
  const perPx = activeTotal / avail;
  // Gap bands, grid lines and time labels; labels sit 10px above `top`.
  const grid = (root, top, bottom) => {
    const step = TICKS.find(s => s / perPx >= 80) || TICKS[TICKS.length - 1];
    let lastLabel = -Infinity;
    for (const s of segs) {
      if (s.gap) {
        root.append(
          svg('rect', { x: s.x, y: top - 4, width: s.w, height: bottom - top + 4, class: 'tl-gap' }, svg('title', {}, `${fmtDur(s.b - s.a)} idle, ${fmtTime(s.a)} to ${fmtTime(s.b)}`)),
          svg('path', { d: `M ${s.x + 6} ${top - 2} L ${s.x + 10} ${top - 12} M ${s.x + 12} ${top - 2} L ${s.x + 16} ${top - 12}`, class: 'tl-break' })
        );
        continue;
      }
      for (let t = Math.ceil(s.a / step) * step; t <= s.b; t += step) {
        const tx = x(t);
        root.append(svg('line', { x1: tx, x2: tx, y1: top - 4, y2: bottom, class: 'tl-grid' }));
        // A centered label needs half its widest text (12:59 AM, about 44px) inside the diagram on both sides.
        if (tx - lastLabel < 64 || tx < 24 || tx > W - 24) continue;
        root.append(svg('text', { x: tx, y: top - 10, class: 'tl-axis', 'text-anchor': 'middle' }, fmtTime(t)));
        lastLabel = tx;
      }
    }
  };
  return { x, segs, grid };
}

// The Sum / Full timeline switch above a diagram; `pick` stores the mode and redraws, the focus stays on the button.
export function modeSwitch(host, modes, current, label, pick) {
  return el(
    'div',
    { className: 'dg-modes', role: 'group', 'aria-label': label },
    modes.map(([id, text, glyph, about, head]) => {
      const tip = target => {
        const r = target.getBoundingClientRect();
        placeCard(`mode:${id}`, () => tabTip(head || text, glyph, about), { x: r.left - 14, y: r.bottom - 6 });
      };
      return el(
        'button',
        {
          className: `view-tab dg-mode${current === id ? ' active' : ''}`,
          'aria-pressed': current === id ? 'true' : 'false',
          'aria-description': about,
          onclick: () => {
            hideHover();
            pick(id);
            persist();
            const b = host.querySelector(`.dg-mode[data-mode="${id}"]`);
            if (b) b.focus();
          },
          onmouseenter: e => tip(e.currentTarget),
          onmouseleave: hideHover,
          onfocus: e => tip(e.currentTarget),
          onblur: hideHover,
          'data-mode': id,
        },
        icon(glyph),
        el('span', {}, text)
      );
    })
  );
}
