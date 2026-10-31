// What the Automation Hunter's procedure card reads out of its steps: the sites they name, the details of one step, and the simple diagram
// the panel draws itself (no Claude call). A step is one line of text; the deepest URL, the visible labels and the lessons are in it.
import { svg } from './dom';

const HOSTS = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,6})(?![a-z0-9-])((?:\/[^\s,;)"'`]*)?)/gi;
const FILE_EXT = new Set(['md', 'json', 'js', 'ts', 'txt', 'yml', 'yaml', 'png', 'jpg', 'html', 'css', 'exe', 'ps1', 'sh', 'csv', 'xml', 'zip', 'pdf']);

const linksIn = (text: string) =>
  [...text.matchAll(HOSTS)]
    .map(m => ({ host: m[1].toLowerCase().replace(/^www\./, ''), path: (m[2] || '').replace(/[.:]+$/, '') }))
    .filter(l => !FILE_EXT.has(l.host.split('.').pop() as string));

/** The sites and apps the steps name: the host of each URL and bare domain, in the order they appear. */
export const hostsOf = (steps: { text: string }[]): string[] => [...new Set(steps.flatMap(s => linksIn(s.text).map(l => l.host)))];

const WHY: [RegExp, string][] = [
  [/\bmfa\b|\b2fa\b|verification code|authenticator/i, 'Multi-factor check'],
  [/sign[- ]?in|log[- ]?in|password/i, 'Sign-in'],
  [/consent|approv|authori[sz]|grant|allow access|permission/i, 'Consent or approval'],
  [/invit/i, 'Invite acceptance'],
  [/shown only once|only once|secret|copy the key|save the key/i, 'A value shown only once'],
  [/\bpost\b|publish|\bjoin\b/i, 'A final click a permission check can stop'],
];

/** Why a step is manual, from the words it holds; the plain fact when none of them says. */
export const whyManual = (text: string): string => WHY.find(([re]) => re.test(text))?.[1] ?? 'A person does this step';

export interface StepFacts {
  link: string;
  controls: string[];
  lessons: string[];
  manual: string;
}

/** The details of one step, read out of its text: the deepest link, the labels it names, the lessons inside it, and why it is manual. Empty parts are left out. */
export function stepFacts(step: { text: string; manual: boolean }): StepFacts {
  const text = step.text.trim();
  const link = linksIn(text)[0];
  const controls = [...text.matchAll(/["“`]([^"”`]{1,48})["”`]/g)].map(m => m[1].trim()).filter(Boolean);
  const brackets = [...text.matchAll(/\(([^()]{3,120})\)/g)].map(m => m[1].trim()).filter(t => !/^manual$/i.test(t));
  const bare = text.replace(/\([^()]*\)/g, ' ');
  const [, ...later] = bare.split(/(?<=[.!?])\s+|;\s+|\s[-–]\s/).map(t => t.trim()).filter(Boolean);
  return {
    link: link ? `${link.host}${link.path}` : '',
    controls: [...new Set(controls)],
    lessons: [...new Set([...later, ...brackets])],
    manual: step.manual ? whyManual(text) : '',
  };
}

export const hasFacts = (f: StepFacts): boolean => !!(f.link || f.controls.length || f.lessons.length || f.manual);

// ---- The simple diagram ----

const W = 620;
const wrap = (text: string, LINE_CHARS: number): string[] => {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + w).length <= LINE_CHARS) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  if (lines.length > 2) {
    const two = lines.slice(0, 2);
    two[1] = `${two[1].slice(0, LINE_CHARS - 1).trimEnd()}...`;
    return two;
  }
  return lines;
};

/**
 * The steps in order as cards joined by arrows, grouped under the site or app they run on; a manual step has a small person icon at the left,
 * the last step is the final check. Drawn in the editor theme's colours only.
 */
export function simpleDiagram(name: string, steps: { text: string; manual: boolean }[]): SVGSVGElement {
  const live = steps.filter(s => s.text.trim());
  const parts: SVGElement[] = [];
  let y = 0;
  let host = '';
  live.forEach((s, i) => {
    const here = linksIn(s.text)[0]?.host;
    if (here && here !== host) {
      host = here;
      if (i) y += 6;
      parts.push(svg('text', { x: 0, y: y + 12, 'font-size': 12, 'font-weight': 600, fill: 'var(--vscode-descriptionForeground)', 'font-family': 'inherit' }, host));
      y += 20;
    }
    const lines = wrap(s.text.replace(/\(manual\)/i, ''), 66);
    const h = 14 + lines.length * 17;
    const last = i === live.length - 1 && live.length > 1;
    const mid = y + h / 2;
    parts.push(svg('rect', { x: 0.5, y: y + 0.5, width: W - 1, height: h - 1, rx: 6, fill: 'var(--vscode-editorWidget-background)', stroke: last ? 'var(--vscode-charts-green)' : 'var(--vscode-editorWidget-border)', 'stroke-width': last ? 1.5 : 1 }));
    // A step a person does: a small person at the left of its card, in the text colour.
    if (s.manual) parts.push(svg('g', { class: 'bh-who', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }, svg('circle', { cx: 14, cy: mid - 4.5, r: 3 }), svg('path', { d: `M8.5 ${mid + 7} q0 -7 5.5 -7 q5.5 0 5.5 7` })));
    parts.push(svg('text', { x: 38, y: mid + 4.5, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 600, fill: 'var(--vscode-descriptionForeground)', 'font-family': 'inherit' }, String(i + 1)));
    lines.forEach((l, k) => parts.push(svg('text', { x: 56, y: y + 21 + k * 17, 'font-size': 14, fill: 'currentColor', 'font-family': 'inherit' }, l)));
    if (last) parts.push(svg('path', { d: `M${W - 26} ${y + 14} l5 5 l9 -10`, fill: 'none', stroke: 'var(--vscode-charts-green)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    y += h;
    if (i < live.length - 1) {
      parts.push(svg('path', { d: `M38 ${y} v10 m-4 -5 l4 5 l4 -5`, fill: 'none', stroke: 'var(--vscode-descriptionForeground)', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      y += 12;
    }
  });
  const out = svg('svg', { viewBox: `0 0 ${W} ${Math.max(y, 1)}`, role: 'img', 'aria-label': `The steps of ${name || 'this procedure'} in order`, class: 'bh-simple-svg' }, parts);
  out.style.setProperty('max-width', `${W}px`);
  return out as SVGSVGElement;
}
