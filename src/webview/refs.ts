// References between harness elements: the names a body mentions resolved to skills, agents, commands and
// output styles; the elements that mention one; the reference chip with its hover card; and go-to with a
// way back.
import type { Asset, ScopeView } from '../harness';
import { linkedRepos } from './dist';
import { command, kindLabel, labelOf, linkName, metaOf, pending, skillPluginOf, state, viewOf, vscode } from './core';
import { el, icon } from './dom';
import { hideHover, placeCard } from './hover';
import { glyphOf } from './tables';

export interface Entry {
  a: Asset;
  v: ScopeView;
}

const TARGETS = ['skill', 'agent', 'command', 'outputStyle'];
const SOURCES_OF_REFS = ['skill', 'agent', 'command', 'outputStyle', 'rule', 'memory'];

let index: { views: ScopeView[]; byName: Map<string, Entry[]> } | undefined;

// Every target under its name, and plugin ones also under `plugin:name`, rebuilt when the host sends new views.
function roster(): Map<string, Entry[]> {
  if (index && index.views === state.views) return index.byName;
  const byName = new Map<string, Entry[]>();
  const add = (key: string, e: Entry) => byName.set(key, [...(byName.get(key) || []), e]);
  for (const v of state.views)
    for (const c of v.categories)
      if (TARGETS.includes(c.kind))
        for (const a of c.items) {
          const e = { a, v };
          add(a.name.toLowerCase(), e);
          const plugin = skillPluginOf(a);
          if (plugin) add(`${plugin}:${a.name}`.toLowerCase(), e);
        }
  index = { views: state.views, byName };
  return byName;
}

/** The element a name means when `from` mentions it: one in the same scope first, then a global one. */
export function resolve(token: string, from?: Asset, kind?: string): Entry | undefined {
  const key = token.replace(/^\//, '').toLowerCase();
  const list = roster().get(key) || (key.includes(':') ? roster().get(key.split(':').pop() as string) : undefined);
  if (!list) return undefined;
  const others = list.filter(e => (!from || e.a.id !== from.id) && (!kind || e.a.kind === kind));
  return others.find(e => from && e.a.scope === from.scope) || others.find(e => e.v.id === 'global') || others[0];
}

const SPAN_PATH = /(?:^|[\\/])(skills|agents|commands)[\\/]([a-z0-9][a-z0-9_-]*)(?:\.md)?(?:[\\/]|$)/i;
const PATH_KIND: Record<string, string> = { skills: 'skill', agents: 'agent', commands: 'command' };

/**
 * The element an inline code span names, by the host's rules in `refsOf`: a path into a skills, agents or commands
 * folder, a hyphenated or plugin-qualified name, a slash command, or a single word the host found in context.
 */
export function resolveSpan(span: string, from: Asset): Entry | undefined {
  const path = SPAN_PATH.exec(span);
  if (path) return resolve(path[2], from, PATH_KIND[path[1].toLowerCase()]);
  const key = span.replace(/^\//, '').toLowerCase();
  if (!/[-:]/.test(key) && !span.startsWith('/') && !(from.refs || []).includes(key)) return undefined;
  return resolve(span, from);
}

const byKindName = (x: Entry, y: Entry) => TARGETS.indexOf(x.a.kind) - TARGETS.indexOf(y.a.kind) || x.a.name.localeCompare(y.a.name);

export function mentionsOf(a: Asset): Entry[] {
  const seen = new Map<string, Entry>();
  for (const token of a.refs || []) {
    const e = resolve(token, a);
    if (e) seen.set(e.a.id, e);
  }
  return [...seen.values()].sort(byKindName);
}

export function mentionedBy(a: Asset): Entry[] {
  const out: Entry[] = [];
  for (const v of state.views)
    for (const c of v.categories)
      if (SOURCES_OF_REFS.includes(c.kind))
        for (const other of c.items)
          if (other.id !== a.id && (other.refs || []).some(t => resolve(t, other)?.a.id === a.id)) out.push({ a: other, v });
  return out.sort((x, y) => SOURCES_OF_REFS.indexOf(x.a.kind) - SOURCES_OF_REFS.indexOf(y.a.kind) || x.a.name.localeCompare(y.a.name));
}

// Descriptions often end in trigger phrases or example tasks; the pages show those as chips.
const MARKERS: [string, RegExp][] = [
  ['Triggers', /\bTrigger(?:s| phrases)?(?: on)?\s*:?\s*/i],
  ['Example tasks', /\bExample tasks\s*:?\s*/i],
];

export function splitDescription(desc: string): { text: string; groups: [string, string[]][] } {
  const hits = MARKERS.map(([label, re]) => ({ label, m: re.exec(desc) }))
    .filter(h => h.m)
    .sort((x, y) => (x.m as RegExpExecArray).index - (y.m as RegExpExecArray).index);
  const groups: [string, string[]][] = [];
  hits.forEach((h, i) => {
    const m = h.m as RegExpExecArray;
    const end = i + 1 < hits.length ? (hits[i + 1].m as RegExpExecArray).index : desc.length;
    const tail = desc.slice(m.index + m[0].length, end);
    let phrases = [...tail.matchAll(/["“]([^"”]{2,120})["”]/g)].map(x => x[1].trim());
    // Unquoted lists ("Trigger phrases: init class repo, refresh a module, ...") split on commas.
    if (phrases.length < 2)
      phrases = tail
        .split(/[,;]\s*/)
        .map(p => p.trim().replace(/(\.\.\.|…|\.)$/, '').trim())
        .filter(p => p.length >= 2 && p.length <= 60);
    if (phrases.length >= 2) groups.push([h.label, phrases]);
  });
  if (!groups.length) return { text: desc, groups };
  const cut = (hits[0].m as RegExpExecArray).index;
  return { text: desc.slice(0, cut).trim().replace(/[,;:]\s*$/, '.'), groups };
}

export const tokens = (text: string) => Math.round((text || '').length / 4);
export const fmtTokens = (n: number) => (n < 1000 ? `~${n}` : `~${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`);

/** Where an element comes from, in a few words. */
export function originText(a: Asset, v?: ScopeView): string {
  const plugin = skillPluginOf(a);
  return [v && v.id !== 'global' ? v.label : 'Global', plugin ? `${plugin.replace(/-plugin$/, '')} plugin` : a.origin ? `from ${a.origin.source}` : a.link ? `linked from ${linkName(a.link)}` : '', a.version ? `v${a.version}` : '', linkedRepos(a).length ? `linked into ${linkedRepos(a).join(', ')}` : '']
    .filter(Boolean)
    .join(' · ');
}

// The hover card of a referenced element: what it is, where it comes from, what it says, and its key facts.
export function assetCard(a: Asset, v?: ScopeView): HTMLElement {
  const { text, groups } = splitDescription(a.description || '');
  const meta = metaOf(a);
  const stat = (label: string, value: string) => el('div', { className: 'hc-stat' }, el('span', { className: 'hc-k' }, label), el('span', { className: 'hc-v' }, value));
  const stats =
    a.kind === 'agent'
      ? [stat('Model', meta.model || 'inherit'), stat('Tools', meta.tools ? String(meta.tools.length) : 'all'), stat('In context', `${fmtTokens(tokens(a.description))} tokens`)]
      : a.kind === 'skill'
        ? [stat('Files', String(Math.max(1, (a.files || []).length))), stat('Tools', meta.tools ? String(meta.tools.length) : 'all'), stat('In context', `${fmtTokens(tokens(a.description))} tokens`)]
        : [stat('Tools', meta.tools ? String(meta.tools.length) : 'all'), stat('Changed', a.mtime ? new Date(a.mtime).toLocaleDateString() : '-')];
  const triggers = groups.find(g => g[0] === 'Triggers' || g[0] === 'Example tasks');
  return el(
    'div',
    { className: 'hc hc-asset' },
    el('div', { className: 'hc-head' }, icon(glyphOf(a)), el('span', { className: 'hc-type' }, labelOf(a)), el('span', { className: 'hc-spacer' }), el('span', { className: 'hc-pill muted' }, kindLabel(a.kind))),
    el('div', { className: 'hc-name' }, originText(a, v)),
    el('div', { className: `hc-text clamp-4${text ? '' : ' muted'}` }, text || 'No description.'),
    triggers ? el('div', { className: 'hc-chips' }, triggers[1].slice(0, 4).map(t => el('span', { className: 'hc-chip' }, t)), triggers[1].length > 4 ? el('span', { className: 'hc-chip more' }, `+${triggers[1].length - 4}`) : null) : null,
    el('div', { className: 'hc-grid' }, stats),
    el('div', { className: 'hc-foot' }, el('span', {}, 'Click to open'), el('span', {}, 'Alt+click: the file in the editor'))
  );
}

/** Opens an element from a reference and remembers where it came from. */
export function goTo(id: string) {
  hideHover();
  if (state.detail && state.detail.asset.id === id) return;
  if (state.detail) state.history = [...state.history, state.detail.asset.id];
  vscode.postMessage({ type: 'select', id, pending: pending() });
}

export function goBack() {
  hideHover();
  const id = state.history[state.history.length - 1];
  state.history = state.history.slice(0, -1);
  vscode.postMessage({ type: 'select', id, pending: pending() });
}

export const historyLabel = () => {
  const id = state.history[state.history.length - 1];
  const a = id ? state.views.flatMap(v => v.categories.flatMap(c => c.items)).find(x => x.id === id) : undefined;
  return a ? labelOf(a) : 'the previous element';
};

// Hover and focus show the card, a click opens the element, Alt+click opens its file.
function wire(node: HTMLElement, e: Entry): HTMLElement {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const show = (at: { x: number; y: number }) => placeCard(`ref:${e.a.id}`, () => assetCard(e.a, e.v), at);
  node.addEventListener('mouseenter', ev => {
    clearTimeout(timer);
    const at = { x: ev.clientX, y: ev.clientY };
    timer = setTimeout(() => show(at), 250);
  });
  node.addEventListener('mouseleave', () => {
    clearTimeout(timer);
    hideHover();
  });
  node.addEventListener('focus', () => {
    const r = node.getBoundingClientRect();
    show({ x: r.left - 14, y: r.bottom - 6 });
  });
  node.addEventListener('blur', hideHover);
  node.addEventListener('click', ev => {
    ev.preventDefault();
    if (ev.altKey) command('openFile', { id: e.a.id });
    else goTo(e.a.id);
  });
  return node;
}

/** An inline reference: the name as written, styled as a link to the element. */
export const refChip = (e: Entry, label?: string): HTMLElement =>
  wire(el('button', { type: 'button', className: `ref ref-${e.a.kind}`, 'aria-label': `${kindLabel(e.a.kind)} ${label ?? labelOf(e.a)}` }, icon(glyphOf(e.a)), el('span', {}, label ?? labelOf(e.a))), e);

/** A reference in a list: icon, name, kind and where it comes from. */
export const refRow = (e: Entry): HTMLElement =>
  wire(
    el(
      'button',
      { type: 'button', className: 'ref-row' },
      icon(glyphOf(e.a)),
      el('span', { className: 'ref-name' }, labelOf(e.a)),
      el('span', { className: 'ref-kind' }, kindLabel(e.a.kind)),
      el('span', { className: 'ref-from' }, e.v.id === 'global' ? (skillPluginOf(e.a) ? `${skillPluginOf(e.a).replace(/-plugin$/, '')} plugin` : 'Global') : e.v.label)
    ),
    e
  );

export const viewEntry = (a: Asset): Entry => ({ a, v: viewOf(a.scope) || state.views[0] });
