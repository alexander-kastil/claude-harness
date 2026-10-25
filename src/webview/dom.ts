// @ts-nocheck
// DOM builders and formatters with no state of their own.

export const el = (tag, attrs, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'className') node.className = v;
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) node.append(c.nodeType ? c : String(c));
  return node;
};

export const icon = name => el('span', { className: `codicon codicon-${name}` });

export const logo = size => (document.body.dataset.logo ? el('img', { className: `logo ${size}`, src: document.body.dataset.logo, alt: '' }) : icon('hubot'));

// The Claude mark as Anthropic ships it in the Claude Code extension. Every action that starts a Claude wears it.
const CLAUDE_PATH =
  'M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z';

export const claudeMark = (size = 14) => svg('svg', { class: 'claude-mark', width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: CLAUDE_PATH }));

// `glyph` is a codicon name, or a node (the Claude mark) drawn as it is.
export const glyphOf = glyph => (typeof glyph === 'string' ? icon(glyph) : glyph);

export const iconBtn = (name, title, onclick, disabled) => el('button', { className: 'icon-btn', title, 'aria-label': title, onclick, disabled }, glyphOf(name));

// A div that acts as a button: clickable, focusable, and opened with Enter or Space.
export const pressable = fn => ({
  role: 'button',
  tabindex: '0',
  onclick: fn,
  onkeydown: e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    fn();
  },
});

export const fmtAgo = t => {
  if (!t) return '-';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  if (m < 30 * 1440) return `${Math.round(m / 1440)} d ago`;
  return new Date(t).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

export function pageHead(glyph, title, sub, ...tools) {
  return el('header', { className: 'main-head' }, el('span', { className: 'big' }, icon(glyph)), el('div', { className: 'title' }, el('h1', {}, title), el('div', { className: 'path' }, sub)), el('div', { className: 'toolbar' }, ...tools));
}

export const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const fmtDate = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtDur = ms => {
  const minutes = Math.round(ms / 60000);
  if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))} s`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
};

export const fmtNum = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));

export const shortType = t => String(t || '').split(':').pop();

export const shortModel = m => (m ? String(m).replace(/^claude-/, '') : '');

export const highlight = (text, q) => {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  return i < 0 ? text : [text.slice(0, i), el('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
};

export const SVG_NS = 'http://www.w3.org/2000/svg';

export const svg = (tag, attrs, ...children) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
};

export const clip = (text, chars) => (text.length > chars ? `${text.slice(0, Math.max(1, chars - 3))}...` : text);

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : /(s|x|z|ch|sh)$/.test(word) ? 'es' : 's'}`;
