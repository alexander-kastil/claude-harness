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
// from what (the Draw button's hover card), and what each perspective shows (the toggle's hover cards).
// The other kinds have no Draw with Claude and no drawing.
const DRAWS: Record<string, { what: string; harness: string; process: string }> = {
  skill: {
    what: 'what this skill does and how its parts connect (Harness), and the steps it makes Claude take in run order (Process), two drawings from its SKILL.md',
    harness: 'What the skill does: when it applies, its decisions and what each branch produces.',
    process: 'The steps it makes Claude take, in the order they run.',
  },
  agent: {
    what: 'what this agent does and what it works with (Harness), and its run from the hand-off to the report (Process), two drawings from its file',
    harness: 'What the agent does and the tools, skills and servers it works with.',
    process: 'Its run from the moment Claude hands work to it until it reports back.',
  },
  command: {
    what: 'what this command does (Harness), and what happens from typing it to its result (Process), two drawings from its file',
    harness: 'What the command does and what it uses.',
    process: 'What happens from typing it to its result, step by step.',
  },
  workflow: {
    what: 'the parts of this workflow (Harness), and its phases in run order with what runs in parallel (Process), two drawings from its script',
    harness: 'Its phases, the agents it starts and what it returns.',
    process: 'Its phases in run order, and what runs in parallel.',
  },
  plugin: {
    what: 'what this plugin brings and how its skills, agents, servers and hooks connect (Harness), and what runs in which order with what its mods do (Process), two drawings from its manifest, contents and hook modules',
    harness: 'How the plugin connects to a Claude session.',
    process: 'What runs in which order, and what its mods do.',
  },
  hook: {
    what: 'when this hook runs and what it does (Harness), and what happens from its event to what Claude Code does next (Process), two drawings from its entry in the settings file',
    harness: 'When the hook runs and what it does.',
    process: 'What happens from its event to what Claude Code does next.',
  },
  mcp: {
    what: 'what this server is and what it connects to (Harness), and how a session starts it and calls it (Process), two drawings from its entry',
    harness: 'What the server is and what it connects to.',
    process: 'How a session starts or reaches it, calls a tool and gets the answer.',
  },
  market: {
    what: "what this marketplace's plugins bring (Harness), and how they call, feed, gate and extend each other (Process), two drawings from its plugins' contents and the lines where one plugin names another",
    harness: 'What its plugins bring to a Claude session, grouped by what they are for.',
    process: 'How its plugins work with each other: which one calls, feeds, gates or extends which.',
  },
};

// What can be drawn: an element, or a marketplace's page (`market:<name>`, kind `market`), which is no element of a scope.
type Drawn = Pick<Asset, 'id' | 'name'> & { kind: string };

export const canDraw = (a: Drawn): boolean => a.kind in DRAWS;

export const drawsWhat = (kind: string): string => DRAWS[kind].what;

// Every drawing has two perspectives: the harness one (its parts and how they connect) and the process one (what runs in which
// order). The process one is stored under the id plus this suffix; the toggle in the figure picks the one shown.
const PROCESS = '#process';
let processFor: string | undefined;

/** Whether the page of this element or marketplace shows the process perspective. */
export const processOf = (a: Drawn): boolean => canDraw(a) && processFor === a.id;

/** The id the element's drawing is stored and asked under: the process perspective has its own. */
export const drawingId = (a: Drawn): string => (processOf(a) ? a.id + PROCESS : a.id);

/** What Draw with Claude shows: two drawings, so it counts as running while either runs, and as drawn once either exists. */
export function drawState(a: Drawn): { running: boolean; drawn: boolean; error?: string } {
  const all = [drawingOf(a.id), drawingOf(a.id + PROCESS)];
  return { running: all.some(d => d?.running), drawn: all.some(d => d?.svg), error: all.find(d => d?.error)?.error };
}

/** Asks for both stored drawings once per loaded detail, or per opening of `page` (a marketplace's page); the page repaints when the answer differs. */
export function askDrawing(a: Drawn, page?: object): void {
  const d = page ?? state.detail;
  if (!canDraw(a) || !d || asked.has(d)) return;
  asked.add(d);
  vscode.postMessage({ type: 'drawing', id: a.id });
  vscode.postMessage({ type: 'drawing', id: a.id + PROCESS });
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

// Claude now and then writes an attribute twice on one element (two d= on a path), which no XML parser takes: the first one stays.
const firstAttributes = (text: string) =>
  text.replace(/<([A-Za-z][\w:.-]*)(\s[^<>]*?)?(\/?)>/g, (_tag: string, name: string, attrs = '', end: string) => {
    const seen = new Set<string>();
    const kept = attrs.replace(/\s+([^\s=/>]+)(\s*=\s*(?:"[^"]*"|'[^']*'))?/g, (all: string, key: string) => (seen.has(key) ? '' : (seen.add(key), all)));
    return `<${name}${kept}${end}>`;
  });

/** The svg as an element with nothing executable or external in it, or undefined when the text is not a plain svg. */
export function cleanSvg(text: string): SVGSVGElement | undefined {
  const parse = (t: string) => new DOMParser().parseFromString(t, 'image/svg+xml');
  let doc = parse(text);
  if (doc.querySelector('parsererror')) doc = parse(firstAttributes(text));
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
export function drawingFigure(a: Drawn): HTMLElement | null {
  const market = a.kind === 'market';
  const process = processOf(a);
  const svg = drawingOf(drawingId(a))?.svg;
  // The figure stays while either perspective has a drawing, so the toggle stays reachable; the shown one may be empty.
  if (!canDraw(a) || (!svg && !drawingOf(a.id)?.svg && !drawingOf(a.id + PROCESS)?.svg)) return null;
  const clean = svg ? cleanSvg(svg) : undefined;
  const title = market ? (process ? `When the plugins of ${a.name} act` : `What ${a.name} offers`) : process ? `How ${a.name} runs` : `What ${a.name} does`;
  clean?.setAttribute('aria-label', title);
  // Spread over the figure's width, but never drawn larger than Claude drew it, so its text stays the size it was written at.
  const width = clean?.viewBox.baseVal?.width;
  if (clean && width) clean.style.setProperty('max-width', `${width}px`);
  const pick = (to: boolean, label: string, tip: string) =>
    el('button', { type: 'button', className: `view-tab dg-mode${process === to ? ' active' : ''}`, title: tip, 'aria-pressed': String(process === to), onclick: () => ((processFor = to ? a.id : undefined), hideHover(), renderMain()) }, el('span', {}, label));
  const toggle = el(
    'div',
    { className: 'dg-modes dv-persp', role: 'group', 'aria-label': 'Perspective' },
    pick(false, 'Harness', `Harness\n${DRAWS[a.kind].harness}`),
    pick(true, 'Process', `Process\n${DRAWS[a.kind].process}`)
  );
  const fig = el(
    'figure',
    { className: 'dv-draw', tabindex: clean ? '0' : undefined },
    toggle,
    clean ?? el('div', { className: 'dv-empty' }, svg ? "Claude's drawing could not be read. Redraw with Claude in the bar above." : 'Not drawn yet. Draw with Claude in the bar above.')
  );
  if (!svg || !clean) return fig;
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
