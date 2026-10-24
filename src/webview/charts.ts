// @ts-nocheck
// The Concurrency, Token flow and Scatter views.
import { state, total } from './core';
import { clip, el, fmtDur, fmtNum, fmtTime, shortType, svg } from './dom';
import { AXIS, BAR, colorsOf, endOfAgent, timeAxis, widthOf } from './session-common';
import { fmtUsd } from './session-page';
import { bindAgent, laneName, tokensOf } from './timeline';

export function drawConcurrency(host, d) {
  const W = widthOf(host, 480);
  const colors = colorsOf(d);
  const LEFT = 36;
  const TOP = AXIS + 8;
  const PLOT = 170;
  // The peak label gets its own row between the time axis labels and the plot.
  const bottom = TOP + 22 + PLOT;
  const H = bottom + 34;
  const { x, grid } = timeAxis(d, LEFT, W, 14);
  const runs = d.agents.filter(a => typeof a.start === 'number' && endOfAgent(a) > a.start);
  const cuts = [...new Set(runs.flatMap(a => [a.start, endOfAgent(a)]))].sort((p, q) => p - q);
  const steps = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t = cuts[i];
    const by = new Map();
    for (const a of runs) if (a.start <= t && endOfAgent(a) > t) by.set(a.type, (by.get(a.type) || 0) + 1);
    const n = [...by.values()].reduce((s, v) => s + v, 0);
    if (n) steps.push({ a: t, b: cuts[i + 1], by, n });
  }
  const max = Math.max(1, ...steps.map(s => s.n));
  const yOf = n => bottom - (n / max) * PLOT;
  const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tl dg', role: 'img', 'aria-label': 'Agents running over time' });
  grid(root, TOP, bottom);
  const tick = max <= 6 ? 1 : max <= 12 ? 2 : 5;
  for (let n = 0; n <= max; n += tick) {
    root.append(svg('line', { x1: LEFT, x2: W - 14, y1: yOf(n), y2: yOf(n), class: 'dg-hgrid' }), svg('text', { x: LEFT - 6, y: yOf(n) + 4, class: 'tl-axis', 'text-anchor': 'end' }, String(n)));
  }
  // One rounded bar per run in its agent's color. A run takes the lowest lane free at its start and keeps it
  // until it ends, so the bars never move and the height is the number of agents running.
  const ordered = [...runs].sort((p, q) => p.start - q.start || endOfAgent(q) - endOfAgent(p));
  const laneEnds = [];
  const pill = (x0, x1, y0, y1) => {
    const r = Math.min(10, (x1 - x0) / 2, (y1 - y0) / 2);
    return `M ${x0 + r} ${y0} H ${x1 - r} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} V ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} H ${x0 + r} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} V ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`;
  };
  for (const a of ordered) {
    let lane = laneEnds.findIndex(e => e <= a.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = endOfAgent(a);
    const d0 = pill(x(a.start), Math.max(x(endOfAgent(a)), x(a.start) + 2), yOf(lane + 1) + 2, yOf(lane) - 2);
    const tone = colors.typeTone(a.type);
    const g = svg('g', { class: 'dg-agent' }, svg('path', { d: d0, class: `dg-area ${tone}` }), svg('path', { d: d0, class: `dg-ridge ${tone}` }));
    bindAgent(g, a, d, colors);
    root.append(g);
  }
  const peak = steps.find(s => s.n === max);
  if (peak) {
    const px = x(peak.a);
    root.append(svg('line', { x1: px, x2: px, y1: yOf(max) - 4, y2: yOf(max) - 12, class: 'dg-edge' }), svg('text', { x: Math.min(px + 4, W - 120), y: yOf(max) - 6, class: 'dg-label dg-halo strong' }, `Peak ${max} at ${fmtTime(peak.a)}`));
  }
  for (const p of d.prompts) root.append(svg('line', { x1: x(p.at), x2: x(p.at), y1: bottom + 6, y2: bottom + 14, class: 'dg-tick' }, svg('title', {}, `${fmtTime(p.at)} ${clip(p.text, 200)}`)));
  // Under the ticks and from the left edge, so the label neither clips nor sits on a tick.
  root.append(svg('text', { x: 4, y: bottom + 28, class: 'tl-axis' }, 'prompts'));
  host.replaceChildren(root);
}

export const OUTCOMES = [
  ['done', 'reported back'],
  ['unknown', 'no report'],
  ['stopped', 'stopped'],
  ['failed', 'failed'],
  ['running', 'running'],
];

export function drawFlow(host, d) {
  const W = widthOf(host, 560);
  const colors = colorsOf(d);
  const PAD = 12;
  const BAR = 12;
  const GAP = 12;
  const MIN_SLOT = 30;
  const mids = [{ key: 'main', label: 'Main thread', tone: 'tone-main', tokens: tokensOf(d.usage), cost: d.usage.cost || 0, out: new Map() }];
  for (const type of colors.types) {
    const agents = d.agents.filter(a => a.type === type);
    const out = new Map();
    for (const a of agents) out.set(a.status, (out.get(a.status) || 0) + tokensOf(a.usage));
    mids.push({ key: type, label: shortType(type), tone: colors.typeTone(type), tokens: agents.reduce((s, a) => s + tokensOf(a.usage), 0), cost: agents.reduce((s, a) => s + (a.usage.cost || 0), 0), out, count: agents.length });
  }
  const total = mids.reduce((s, m) => s + m.tokens, 0);
  if (!total) {
    host.replaceChildren(el('div', { className: 'empty flush dg-empty' }, 'No token usage recorded.'));
    return;
  }
  const rights = OUTCOMES.map(([status, label]) => ({ status, label, tokens: mids.reduce((s, m) => s + (m.out.get(status) || 0), 0), count: d.agents.filter(a => a.status === status).length })).filter(r => r.count);
  const k = 260 / total;
  const hOf = t => Math.max(2, t * k);
  const stack = list => {
    let y = PAD + 18;
    for (const n of list) {
      n.h = hOf(n.tokens);
      n.y = y;
      y += Math.max(n.h, MIN_SLOT) + GAP;
    }
    return y;
  };
  const H = Math.max(stack(mids), stack(rights), PAD + 18 + 260) + PAD;
  const xL = PAD + 96;
  const xM = Math.round(W * 0.36);
  const xMend = xM + BAR + 150;
  const xR = W - PAD - 150;
  const left = { y: PAD + 18, h: Math.max(hOf(total), 4) };
  const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tl dg', role: 'img', 'aria-label': 'Token flow' });
  const band = (x1, a1, b1, x2, a2, b2, cls, tip) => {
    const mx = (x1 + x2) / 2;
    root.append(svg('path', { d: `M ${x1} ${a1} C ${mx} ${a1}, ${mx} ${a2}, ${x2} ${a2} L ${x2} ${b2} C ${mx} ${b2}, ${mx} ${b1}, ${x1} ${b1} Z`, class: `dg-band ${cls}` }, svg('title', {}, tip)));
  };
  let lo = left.y;
  for (const m of mids) {
    const h = m.tokens * k;
    band(xL + BAR, lo, lo + h, xM, m.y, m.y + h, m.tone, `${m.label}: ${fmtNum(m.tokens)} tokens`);
    lo += h;
  }
  const rOff = new Map(rights.map(r => [r.status, r.y]));
  for (const m of mids) {
    let mo = m.y;
    for (const r of rights) {
      const t = m.out.get(r.status) || 0;
      if (!t) continue;
      const h = t * k;
      root.append(svg('rect', { x: xM + BAR, y: mo, width: xMend - xM - BAR, height: Math.max(h, 1), class: `dg-band faint ${m.tone}` }));
      band(xMend, mo, mo + h, xR, rOff.get(r.status), rOff.get(r.status) + h, m.tone, `${m.label} → ${r.label}: ${fmtNum(t)} tokens`);
      rOff.set(r.status, rOff.get(r.status) + h);
      mo += h;
    }
  }
  root.append(
    svg('rect', { x: xL, y: left.y, width: BAR, height: left.h, class: 'dg-bar tone-ink' }),
    svg('text', { x: xL - 6, y: left.y + 14, class: 'dg-label strong', 'text-anchor': 'end' }, 'Session'),
    svg('text', { x: xL - 6, y: left.y + 28, class: 'dg-meta', 'text-anchor': 'end' }, `${fmtNum(total)} tokens`)
  );
  for (const m of mids)
    root.append(
      svg('rect', { x: xM, y: m.y, width: BAR, height: m.h, class: `dg-bar ${m.tone}` }),
      svg('text', { x: xM + BAR + 6, y: m.y + 12, class: 'dg-label strong' }, m.label + (m.count ? ` · ${m.count}` : '')),
      svg('text', { x: xM + BAR + 6, y: m.y + 25, class: 'dg-meta' }, `${fmtNum(m.tokens)} · ${fmtUsd(m.cost)}${m.key === 'main' ? ' · not delegated' : ''}`)
    );
  for (const r of rights)
    root.append(
      svg('rect', { x: xR, y: r.y, width: BAR, height: r.h, class: `dg-bar ${r.status === 'failed' ? 'tone-bad' : r.status === 'done' ? 'tone-ok' : 'tone-muted'}` }),
      svg('text', { x: xR + BAR + 6, y: r.y + 12, class: 'dg-label strong' }, `${r.label} · ${r.count}`),
      svg('text', { x: xR + BAR + 6, y: r.y + 25, class: 'dg-meta' }, `${fmtNum(r.tokens)} tokens`)
    );
  host.replaceChildren(root);
}

export function drawScatter(host, d) {
  const W = widthOf(host, 480);
  const colors = colorsOf(d);
  const selected = state.session && state.session.selected;
  const pts = d.agents
    .map(a => ({ a, rt: typeof a.start === 'number' && a.end ? a.end - a.start : 0, tok: a.usage.input + a.usage.cacheCreate + a.usage.cacheRead, tools: Object.values(a.tools).reduce((n, v) => n + v, 0) }))
    .filter(p => p.rt > 0 && p.tok > 0);
  if (!pts.length) {
    host.replaceChildren(el('div', { className: 'empty flush dg-empty' }, 'No agent with run time and tokens to plot.'));
    return;
  }
  const L = 58;
  const R = 16;
  const T = 16;
  const B = 34;
  const H = 320;
  const lg = Math.log10;
  const span = (vals, pad) => [lg(Math.min(...vals) / pad), lg(Math.max(...vals) * pad)];
  const [x0, x1] = span(pts.map(p => p.rt), 1.6);
  const [y0, y1] = span(pts.map(p => p.tok), 1.6);
  const sx = v => L + ((lg(v) - x0) / Math.max(0.001, x1 - x0)) * (W - L - R);
  const sy = v => H - B - ((lg(v) - y0) / Math.max(0.001, y1 - y0)) * (H - T - B);
  const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tl dg', role: 'img', 'aria-label': 'Agents by run time and tokens' });
  const XT = [1, 5, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400].map(s => s * 1000);
  let last = -Infinity;
  for (const t of XT) {
    if (lg(t) < x0 || lg(t) > x1) continue;
    const xx = sx(t);
    root.append(svg('line', { x1: xx, x2: xx, y1: T, y2: H - B, class: 'dg-hgrid' }));
    if (xx - last > 46) {
      root.append(svg('text', { x: xx, y: H - B + 16, class: 'tl-axis', 'text-anchor': 'middle' }, fmtDur(t)));
      last = xx;
    }
  }
  for (let e = Math.ceil(y0); e <= Math.floor(y1); e++) {
    const v = 10 ** e;
    root.append(svg('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), class: 'dg-hgrid' }), svg('text', { x: L - 6, y: sy(v) + 4, class: 'tl-axis', 'text-anchor': 'end' }, fmtNum(v)));
  }
  root.append(svg('text', { x: L, y: H - 4, class: 'dg-meta' }, 'run time (log)'), svg('text', { x: 4, y: T - 4, class: 'dg-meta' }, 'tokens in, incl. cache (log)'));
  const median = vals => {
    const s = [...vals].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  };
  const mx = median(pts.map(p => p.rt));
  const my = median(pts.map(p => p.tok));
  root.append(svg('line', { x1: sx(mx), x2: sx(mx), y1: T, y2: H - B, class: 'dg-median' }), svg('line', { x1: L, x2: W - R, y1: sy(my), y2: sy(my), class: 'dg-median' }));
  // Circle area follows the agent's cost; the costliest is drawn first so smaller ones stay on top.
  const costOf = p => p.a.usage.cost || 0;
  const maxCost = Math.max(0, ...pts.map(costOf));
  // Labels stay off the median lines and off each other: each takes the first of right, left, above, below that is free.
  const placed = [];
  const sorted = [...pts].sort((p, q) => costOf(q) - costOf(p));
  const radius = p => 4 + (maxCost ? Math.sqrt(costOf(p) / maxCost) : 0) * 18;
  const discs = sorted.map(p => ({ x0: sx(p.rt) - radius(p), x1: sx(p.rt) + radius(p), y0: sy(p.tok) - radius(p), y1: sy(p.tok) + radius(p) }));
  const hits = (r, q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0;
  // What a label box costs at a spot: leaving the plot, crossing a median line, another label, a circle; the cheapest spot wins.
  const cost = r =>
    (r.x0 < L || r.x1 > W - R || r.y0 < T || r.y1 > H - B ? 1000 : 0) +
    (r.x0 <= sx(mx) + 2 && r.x1 >= sx(mx) - 2 ? 100 : 0) +
    (r.y0 <= sy(my) + 2 && r.y1 >= sy(my) - 2 ? 100 : 0) +
    placed.filter(q => hits(r, q)).length * 30 +
    discs.filter(q => hits(r, q)).length * 5;
  const dots = sorted.map(p => {
    const r = radius(p);
    const g = svg('g', { class: 'dg-agent' }, svg('circle', { cx: sx(p.rt), cy: sy(p.tok), r, class: `dg-dot ${colors.tone(p.a)}${selected === p.a.id ? ' sel' : ''}` }));
    bindAgent(g, p.a, d, colors);
    root.append(g);
    return { p, r, g };
  });
  // Labels go in a layer of their own above every circle.
  const layer = svg('g', { class: 'dg-labels' });
  root.append(layer);
  for (const { p, r } of dots) {
    const name = laneName(p.a);
    const w = name.length * 7;
    const cx = sx(p.rt);
    const cy = sy(p.tok);
    const options = [
      { x: cx + r + 4, y: cy + 4, anchor: 'start' },
      { x: cx - r - 4, y: cy + 4, anchor: 'end' },
      { x: cx, y: cy - r - 5, anchor: 'middle' },
      { x: cx, y: cy + r + 14, anchor: 'middle' },
      { x: cx, y: cy - r - 19, anchor: 'middle' },
      { x: cx, y: cy + r + 28, anchor: 'middle' },
      ...[-r - 5, r + 14, -r - 19, r + 28].flatMap(dy => [{ x: cx + 2, y: cy + dy, anchor: 'start' }, { x: cx - 2, y: cy + dy, anchor: 'end' }]),
      // Hugging the vertical median from either side, for a wide name beside a circle that sits near it.
      ...[-r - 5, r + 14, -r - 19, r + 28].flatMap(dy => [{ x: sx(mx) + 5, y: cy + dy, anchor: 'start' }, { x: sx(mx) - 5, y: cy + dy, anchor: 'end' }]),
      { x: cx + r * 0.7 + 4, y: cy - r * 0.7 - 5, anchor: 'start' },
      { x: cx - r * 0.7 - 4, y: cy - r * 0.7 - 5, anchor: 'end' },
      { x: cx + r * 0.7 + 4, y: cy + r * 0.7 + 14, anchor: 'start' },
      { x: cx - r * 0.7 - 4, y: cy + r * 0.7 + 14, anchor: 'end' },
    ];
    const box = o => ({ x0: o.anchor === 'start' ? o.x : o.anchor === 'end' ? o.x - w : o.x - w / 2, x1: o.anchor === 'start' ? o.x + w : o.anchor === 'end' ? o.x : o.x + w / 2, y0: o.y - 13, y1: o.y + 4 });
    const at = options.reduce((best, o) => (cost(box(o)) < cost(box(best)) ? o : best), options[0]);
    placed.push(box(at));
    layer.append(svg('text', { x: at.x, y: at.y, class: 'dg-label dg-halo', 'text-anchor': at.anchor }, name));
  }
  host.replaceChildren(root);
}
