// The drawing of what a skill does, above its info card. The host stores it (src/drawing.ts) and answers `drawing` with the one
// made from the current SKILL.md; this keeps the answers, draws the figure, and cleans the svg of everything executable first.
import type { Asset } from '../harness';
import { state, vscode } from './core';
import { el } from './dom';

interface Drawing {
  svg?: string;
  running?: boolean;
  error?: string;
}

const drawings = new Map<string, Drawing>();
const asked = new WeakSet<object>();

/** What the host last said about a skill's drawing; undefined before it answered. */
export const drawingOf = (id: string): Drawing | undefined => drawings.get(id);

/** Asks for the stored drawing once per loaded detail; the page repaints when the answer differs. */
export function askDrawing(a: Asset): void {
  const d = state.detail;
  if (a.kind !== 'skill' || !d || asked.has(d)) return;
  asked.add(d);
  vscode.postMessage({ type: 'drawing', id: a.id });
}

/** Stores the host's answer; true when the page showing the skill has something new to draw. */
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

/** The figure above the info card: the drawing, or nothing at all. */
export function drawingFigure(a: Asset): HTMLElement | null {
  const svg = drawingOf(a.id)?.svg;
  if (a.kind !== 'skill' || !svg) return null;
  const clean = cleanSvg(svg);
  if (!clean) return null;
  clean.setAttribute('aria-label', `What ${a.name} does`);
  return el('figure', { className: 'dv-draw' }, clean);
}
