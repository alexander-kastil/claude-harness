// The drawing of what a skill, agent, command, workflow, plugin, hook or MCP server does and how its parts connect, above its
// info card. The host stores it (src/drawing.ts) and answers `drawing` with the one made from the element's current source (a
// skill's SKILL.md, a plugin's folder); this keeps the answers, draws the figure, and cleans the svg of everything executable first.
import type { Asset } from '../harness';
import { state, vscode } from './core';
import { el, icon } from './dom';
import { hideHover, placeCard } from './hover';
import { renderMain } from './main';

interface Drawing {
  svg?: string;
  running?: boolean;
  error?: string;
}

const drawings = new Map<string, Drawing>();
const asked = new WeakSet<object>();

/** What the host last said about an element's drawing; undefined before it answered. */
export const drawingOf = (id: string): Drawing | undefined => drawings.get(id);

// The kinds a drawing helps with (a mod is a plugin, a hook is an entry in a settings file), each with what Claude draws and
// from what: the Draw button's hover card.
// The other kinds have no Draw with Claude and no drawing.
const DRAWS: Record<string, string> = {
  skill: 'what this skill does, from its SKILL.md',
  agent: 'what this agent does and what it works with, from its file',
  command: 'what this command does, from its file',
  workflow: 'the steps of this workflow, from its script',
  plugin: 'what this plugin brings and how its skills, agents, servers and hooks connect (Harness), and what runs in which order with what its mods do (Process), two drawings from its manifest, contents and hook modules',
  hook: 'when this hook runs and what it does, from its entry in the settings file',
  mcp: 'what this server is and what it connects to, from its entry',
};

export const canDraw = (a: Asset): boolean => a.kind in DRAWS;

export const drawsWhat = (kind: string): string => DRAWS[kind];

// A plugin has two drawings: the harness perspective (how its parts connect to a session) and the process perspective (what runs
// in which order). The process one is stored under the plugin's id plus this suffix; the toggle in the figure picks the one shown.
const PROCESS = '#process';
let processFor: string | undefined;

/** Whether the page of this plugin shows the process perspective. */
export const processOf = (a: Asset): boolean => a.kind === 'plugin' && processFor === a.id;

/** The id the element's drawing is stored and asked under: the plugin's process perspective has its own. */
export const drawingId = (a: Asset): string => (processOf(a) ? a.id + PROCESS : a.id);

/** What Draw with Claude shows for an element: a plugin has two drawings, so it counts as running while either runs, and as drawn once either exists. */
export function drawState(a: Asset): { running: boolean; drawn: boolean; error?: string } {
  const all = [drawingOf(a.id), a.kind === 'plugin' ? drawingOf(a.id + PROCESS) : undefined];
  return { running: all.some(d => d?.running), drawn: all.some(d => d?.svg), error: all.find(d => d?.error)?.error };
}

/** Asks for the stored drawing once per loaded detail; the page repaints when the answer differs. */
export function askDrawing(a: Asset): void {
  const d = state.detail;
  if (!canDraw(a) || !d || asked.has(d)) return;
  asked.add(d);
  vscode.postMessage({ type: 'drawing', id: a.id });
  if (a.kind === 'plugin') vscode.postMessage({ type: 'drawing', id: a.id + PROCESS });
}

/** Stores the host's answer; true when the page showing the element has something new to draw. */
export function storeDrawing(m: { id: string; svg?: string; running?: boolean; error?: string }): boolean {
  const before = JSON.stringify(drawings.get(m.id));
  const old = drawings.get(m.id);
  // A failed run leaves the drawing that was there; a stored answer replaces everything.
  drawings.set(m.id, m.error ? { svg: old?.svg, error: m.error } : m.running ? { svg: old?.svg, running: true } : { svg: m.svg });
  return before !== JSON.stringify(drawings.get(m.id));
}

const DROP = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'style', 'link', 'a', 'use', 'audio', 'video', 'canvas', 'animate', 'animatemotion', 'animatetransform', 'set', 'handler', 'listener']);
// A value may point at the svg itself (`url(#arrow)`) and nothing else.
const external = (v: string) => /javascript:|data:|expression\(|@import|&#|url\(\s*(?!['"]?#)/i.test(v);

/** The svg as an element with nothing executable or external in it, or undefined when the text is not a plain svg. */
export function cleanSvg(text: string): SVGSVGElement | undefined {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) return undefined;
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (DROP.has(child.localName.toLowerCase())) child.remove();
      else walk(child);
    }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || external(attr.value) || ((name === 'href' || name === 'xlink:href') && !attr.value.startsWith('#')) || name === 'src') {
        node.removeAttribute(attr.name);
      }
    }
  };
  walk(root);
  const out = document.importNode(root, true) as unknown as SVGSVGElement;
  // The page's CSP blocks style attributes, so their declarations move into the element's CSSOM.
  const all = [out, ...Array.from(out.querySelectorAll('*'))] as SVGElement[];
  for (const node of all) {
    const css = node.getAttribute('style');
    if (css === null) continue;
    node.removeAttribute('style');
    for (const decl of css.split(';')) {
      const at = decl.indexOf(':');
      const prop = decl.slice(0, at).trim();
      const value = decl.slice(at + 1).trim();
      if (at > 0 && prop && !external(value)) node.style.setProperty(prop, value);
    }
  }
  out.removeAttribute('width');
  out.removeAttribute('height');
  out.setAttribute('role', 'img');
  return out;
}

// The drawing enlarged in the house hover card, as wide as the panel allows.
const bigCard = (title: string, svg: SVGSVGElement) => el('div', { className: 'hc hc-draw' }, el('div', { className: 'hc-head' }, icon('brush'), el('span', { className: 'hc-type' }, title)), svg);

/** The figure above the info card: the drawing, or nothing at all. Hovered or focused, it opens the drawing large. */
export function drawingFigure(a: Asset): HTMLElement | null {
  const plugin = a.kind === 'plugin';
  const process = processOf(a);
  const svg = drawingOf(drawingId(a))?.svg;
  // A plugin keeps its figure while either perspective has a drawing, so the toggle stays reachable; the shown one may be empty.
  if (!canDraw(a) || (!svg && !(plugin && (drawingOf(a.id)?.svg || drawingOf(a.id + PROCESS)?.svg)))) return null;
  const clean = svg ? cleanSvg(svg) : undefined;
  if (svg && !clean) return null;
  const title = process ? `How ${a.name} runs` : `What ${a.name} does`;
  clean?.setAttribute('aria-label', title);
  const pick = (to: boolean, label: string, tip: string) =>
    el('button', { type: 'button', className: `view-tab dg-mode${process === to ? ' active' : ''}`, title: tip, 'aria-pressed': String(process === to), onclick: () => ((processFor = to ? a.id : undefined), hideHover(), renderMain()) }, el('span', {}, label));
  const toggle = plugin
    ? el('div', { className: 'dg-modes dv-persp', role: 'group', 'aria-label': 'Perspective' }, pick(false, 'Harness', 'Harness\nHow the plugin connects to a Claude session.'), pick(true, 'Process', 'Process\nWhat runs in which order, and what its mods do.'))
    : null;
  const fig = el('figure', { className: `dv-draw${process ? ' dv-process' : ''}`, tabindex: svg ? '0' : undefined }, toggle, clean ?? el('div', { className: 'dv-empty' }, 'Not drawn yet. Draw with Claude in the bar above.'));
  if (!svg) return fig;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!fig.isConnected) return;
      const r = fig.getBoundingClientRect();
      placeCard(`draw:${a.id}:${svg.length}`, () => bigCard(title, cleanSvg(svg) as SVGSVGElement), { x: r.left - 14, y: r.bottom - 6, above: r.top - 6, anchor: fig });
    }, delay);
  };
  const close = () => {
    clearTimeout(timer);
    hideHover();
  };
  fig.addEventListener('mouseenter', () => open(250));
  fig.addEventListener('focus', () => open(0));
  fig.addEventListener('mouseleave', close);
  fig.addEventListener('blur', close);
  return fig;
}
