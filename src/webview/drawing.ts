// The drawing of what a skill, agent, command, workflow, plugin, hook or MCP server does and how its parts connect, above its
// info card. The host stores it (src/drawing.ts) and answers `drawing` with the one made from the element's current source (a
// skill's SKILL.md, a plugin's folder); this keeps the answers, draws the figure, and cleans the svg of everything executable first.
import type { Asset } from '../harness';
import { state, vscode } from './core';
import { el, icon } from './dom';
import { hideHover, placeCard } from './hover';

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
  plugin: 'what this plugin brings and how its skills, agents, servers and hooks connect, from its manifest and contents',
  hook: 'when this hook runs and what it does, from its entry in the settings file',
  mcp: 'what this server is and what it connects to, from its entry',
};

export const canDraw = (a: Asset): boolean => a.kind in DRAWS;

export const drawsWhat = (kind: string): string => DRAWS[kind];

/** Asks for the stored drawing once per loaded detail; the page repaints when the answer differs. */
export function askDrawing(a: Asset): void {
  const d = state.detail;
  if (!canDraw(a) || !d || asked.has(d)) return;
  asked.add(d);
  vscode.postMessage({ type: 'drawing', id: a.id });
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
  const svg = drawingOf(a.id)?.svg;
  if (!canDraw(a) || !svg) return null;
  const clean = cleanSvg(svg);
  if (!clean) return null;
  const title = `What ${a.name} does`;
  clean.setAttribute('aria-label', title);
  const fig = el('figure', { className: 'dv-draw', tabindex: '0' }, clean);
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
