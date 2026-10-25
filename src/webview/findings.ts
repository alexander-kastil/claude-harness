// @ts-nocheck
// The session page's Findings: what stood out, what it cost, why it matters, what to do, and a jump to the agent on the map.
import { app, state } from './core';
import { el, fmtDur, fmtNum, icon, plural, shortType } from './dom';
import { hideHover } from './hover';
import { mapFacts } from './map';
import { currentView, drawView } from './session-page';
import { renderAgent, tokensOf } from './timeline';

// The label beside each finding's icon: severity is never carried by color alone.
export const FINDING_KINDS = {
  failed: ['Failed', 'error'],
  stopped: ['Stopped', 'circle-slash'],
  silent: ['No report', 'comment-unresolved'],
  general: ['Generic agent', 'person'],
  resumed: ['Follow-ups', 'reply'],
  repeated: ['Launched again', 'refresh'],
  hook: ['Hook failed', 'plug'],
  edits: ['Main-thread edits', 'edit'],
};

// What the finding's runs cost, from the same figures the map rows show: run time and tokens, with the share of the whole session.
export function findingCost(f, d) {
  const { runOf } = mapFacts(d);
  const runs = (f.runs || []).map(id => d.agents.find(a => a.id === id)).filter(Boolean);
  const sessionTokens = tokensOf(d.usage) + d.agents.reduce((n, a) => n + tokensOf(a.usage), 0);
  const ms = runs.reduce((n, a) => n + runOf(a), 0);
  const tokens = runs.length ? runs.reduce((n, a) => n + tokensOf(a.usage), 0) : f.kind === 'edits' ? tokensOf(d.usage) : 0;
  const chips = [];
  if (runs.length > 1) chips.push(['layers', plural(runs.length, 'run'), 'Runs\nWhat the figures beside it add up over.']);
  if (ms > 0) chips.push(['clock', fmtDur(ms), `Time\n${runs.length > 1 ? 'The runs added up, from the first record to the last.' : 'From the first record of the run to the last.'}`]);
  if (tokens > 0) chips.push(['symbol-numeric', `${fmtNum(tokens)} tokens${f.kind === 'edits' ? ' on the main thread' : ''}`, 'Tokens\nInput, cache and output, counted as on the map.']);
  if (tokens > 0 && sessionTokens > 0) chips.push(['pie-chart', `${tokens / sessionTokens < 0.01 ? '<1' : Math.round((tokens / sessionTokens) * 100)}% of the session`, 'Share\nOf all tokens in the session, main thread and agents.']);
  if (runs.length && !chips.some(c => c[0] === 'clock' || c[0] === 'symbol-numeric')) chips.push(['circle-slash', 'nothing recorded', 'Nothing recorded\nThe run left no tokens or run time in the transcript.']);
  return chips;
}

// Jumps from a finding to its agent on the Delegation map: opens the map, selects the agent, opens the groups that hide it,
// scrolls it into view and marks it for a moment.
export function jumpToMap(id) {
  const s = state.session;
  if (!s || !s.data) return;
  const d = s.data;
  const agent = d.agents.find(a => a.id === id);
  if (!agent) return;
  hideHover();
  s.selected = id;
  // The Sum view folds runs under their type; open every group on the way down to this run.
  const open = (s.mapOpen = s.mapOpen || {});
  const byId = new Map(d.agents.map(a => [a.id, a]));
  const chain = [];
  for (let a = agent; a && chain.length < 9; a = a.parent && byId.get(a.parent)) chain.unshift(a);
  let key = 'map';
  for (const a of chain) {
    open[`${key}/${a.type}`] = true;
    key = `${key}/${a.type}/${a.id}`;
  }
  const host = app.querySelector('.timeline');
  const tab = app.querySelector('.view-tab[data-view="map"]');
  if (currentView() !== 'map' && tab) tab.click();
  else if (host) drawView(host, d);
  const detail = app.querySelector('.agent-detail');
  if (detail) detail.replaceWith(renderAgent(d));
  if (!host) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => {
    const node = host.querySelector('.dg-node.sel');
    // Only the page scrolls: scrollIntoView would also push a wide diagram sideways to reach the row's far edge.
    const page = host.closest('.main-body');
    const at = (node || host).getBoundingClientRect();
    if (page) {
      const box = page.getBoundingClientRect();
      page.scrollTo({ top: page.scrollTop + at.top - box.top - (box.height - at.height) / 2, behavior: still ? 'auto' : 'smooth' });
    }
    if (!node) return;
    node.classList.add('jump');
    setTimeout(() => node.classList.remove('jump'), 1800);
  });
}

function finding(f, d) {
  const [kind, glyph] = FINDING_KINDS[f.kind] || [f.level === 'warn' ? 'Warning' : 'Note', f.level === 'warn' ? 'warning' : 'info'];
  const chips = findingCost(f, d);
  const run = f.agent && d.agents.find(a => a.id === f.agent);
  const advice = [
    ['Why it matters', f.why],
    ['What to do', f.fix],
  ].filter(x => x[1]);
  return el(
    'div',
    { className: `finding ${f.kind === 'failed' || f.kind === 'hook' ? 'sev-bad' : f.level === 'warn' ? 'sev-warn' : 'sev-info'}`, role: 'listitem', 'data-kind': f.kind || '' },
    el(
      'div',
      { className: 'finding-main' },
      el('div', { className: 'finding-kind' }, icon(glyph), kind),
      el('div', { className: 'finding-title' }, f.text),
      f.note ? el('div', { className: 'finding-note' }, f.note) : null,
      chips.length ? el('div', { className: 'finding-cost' }, chips.map(([g, text, tip]) => el('span', { className: 'finding-chip', title: tip }, icon(g), text))) : null,
      advice.length ? el('dl', { className: 'finding-advice' }, advice.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) : null
    ),
    run
      ? el('button', { className: 'secondary finding-jump', title: `Show on the delegation map\nSelects ${shortType(run.type)} there and scrolls to it.`, 'aria-label': `Show ${shortType(run.type)}${run.description ? ` "${run.description}"` : ''} on the delegation map`, onclick: () => jumpToMap(f.agent) }, icon('list-tree'), 'Show on map')
      : null
  );
}

export function renderFindings(d) {
  if (!d.findings.length) return null;
  return el('div', { className: 'findings', role: 'list' }, d.findings.map(f => finding(f, d)));
}
