// @ts-nocheck
// The grid table every main page uses, and its asset flavour.
import { SOURCES, agentColorClass, app, categoryOf, command, labelOf, metaOf, persist, select, state } from './core';
import { skillContext } from './context';
import { el, highlight, icon, pressable } from './dom';

// A group header: the whole bar folds and unfolds its group, by click or by Enter and Space. `redraw` repaints
// the list, after which the header gets its focus back.
export function groupHead(className, key, folded, glyph, label, count, redraw) {
  const toggle = () => {
    state.foldedGroups.has(key) ? state.foldedGroups.delete(key) : state.foldedGroups.add(key);
    persist();
    redraw();
    const again = [...app.querySelectorAll('[data-group]')].find(n => n.dataset.group === key);
    if (again) again.focus();
  };
  return el(
    'div',
    {
      className,
      role: 'button',
      tabindex: '0',
      'aria-expanded': folded ? 'false' : 'true',
      'data-group': key,
      onclick: toggle,
      onkeydown: e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggle();
      },
    },
    icon(folded ? 'chevron-right' : 'chevron-down'),
    icon(glyph),
    el('span', { className: 'label' }, label),
    el('span', { className: 'origin-n' }, count)
  );
}

export const glyphOf = a => {
  const cat = categoryOf(a.kind);
  return a.kind === 'plugin' ? (a.enabled ? 'pass-filled' : 'circle-large-outline') : a.kind === 'mcp' && SOURCES[a.source] ? SOURCES[a.source].icon : cat ? cat.icon : 'file';
};

export const rowName = a => (a.kind === 'plugin' ? a.name.split('@')[0] : labelOf(a));

export const descOf = a =>
  a.kind === 'mcp' ? a.target || a.description : a.kind === 'plugin' || a.kind === 'settings' ? '' : a.description;

// Days since the change as a plain number, 0 for today; the hover card has the full date.
export const daysSince = at => (at ? String(Math.max(0, Math.floor((Date.now() - at) / 864e5))) : '');

export const CHANGED = ['Changed', [60, 72], a => daysSince(a.mtime), a => (a.mtime ? `Changed\n${new Date(a.mtime).toLocaleString()}` : '')];

// One grid for every table on the main pages. A column: { head, track, cell(row), title(row), num, muted, wide, cls };
// `wide` columns drop out when the panel is narrow. A row with `open` is a button.
export function gridTable(cols, rows, label) {
  const cellClass = (c, r) => [c.cls, c.num ? 'at-fact' : 'at-cell', c.muted ? 'at-muted' : '', c.wide ? 'at-wide' : '', c.low ? 'at-low' : '', r && c.tone ? c.tone(r) : ''].filter(Boolean).join(' ');
  const table = el(
    'div',
    { className: 'asset-table', role: 'table', 'aria-label': label },
    el('div', { className: 'at-row at-head', role: 'row', 'data-vscode-context': JSON.stringify({ webviewSection: 'asset', preventDefaultContextMenuItems: true }) }, cols.map(c => el('span', { className: cellClass(c), role: 'columnheader', title: c.tip }, c.head))),
    rows.map(r =>
      el(
        'div',
        Object.assign({ className: ['at-row', r.open ? '' : 'static', r.className].filter(Boolean).join(' ') }, r.open ? pressable(r.open) : {}, r.context || {}, { role: 'row' }),
        cols.map(c => el('span', { className: cellClass(c, r), role: 'cell', title: (c.title && c.title(r)) || undefined }, c.cell(r)))
      )
    )
  );
  table.style.setProperty('--at-cols', cols.map(c => c.track).join(' '));
  table.style.setProperty('--at-cols-narrow', cols.filter(c => !c.wide).map(c => c.track).join(' '));
  // A table whose fixed columns need more than the stylesheet's 620 px breakpoint drops its `wide` columns as soon as it would
  // run past its box, instead of being clipped between 620 px and its own width; a `low` column goes next, when even the rest
  // does not fit.
  const need = list => list.reduce((n, c) => n + Number((/^(?:minmax\()?(\d+)px/.exec(c.track) || [])[1] || 0), 0) + 16 * (list.length - 1) + 24;
  const kept = cols.filter(c => !c.wide);
  const lowest = kept.filter(c => !c.low);
  table.style.setProperty('--at-cols-narrow2', lowest.map(c => c.track).join(' '));
  const low = cols.some(c => c.low);
  if ((need(cols) > 620 && cols.some(c => c.wide)) || low) {
    const fit = () => {
      const w = table.clientWidth;
      if (!w) return;
      table.classList.toggle('at-compact', w < need(cols));
      table.classList.toggle('at-compact2', low && w < need(kept));
    };
    new ResizeObserver(fit).observe(table);
  }
  return table;
}

// The State cell of a plugin row: a switch that enables or disables the plugin in its own scope. It never opens the row.
export const pluginSwitch = a =>
  el(
    'label',
    { className: 'dv-switch', onclick: e => e.stopPropagation(), onkeydown: e => e.stopPropagation() },
    el('input', { type: 'checkbox', checked: !!a.enabled, title: a.enabled ? 'Enabled' : 'Disabled', 'aria-label': `${a.enabled ? 'Disable' : 'Enable'} ${a.name}`, onchange: () => command('togglePlugin', { id: a.id }) })
  );

// Only numbers are right-aligned; every other fact is a short left-aligned token with its details in the hover card.
const NUMERIC = new Set(['Files', 'Desc', 'Cost', 'Used', 'Changed', 'Keys']);

// A fact column: [header, width in px, value, optional hover text, optional tone, optional control that replaces the text].
export const factCol = ([head, width, value, tip, tone, control, low]) => {
  const text = e => String(value(e.a, e.v));
  // A width given as [least, most] keeps the column from shrinking below `least`; a plain width never shrinks, so the Description drops out first.
  const [least, most] = Array.isArray(width) ? width : [width, width];
  return { head, track: `minmax(${least}px, ${most}px)`, low, num: NUMERIC.has(head), muted: !NUMERIC.has(head), tone: tone ? e => tone(e.a) : undefined, cell: control ? e => control(e.a) : text, title: e => (tip ? tip(e.a) : text(e).length * 7 > most ? text(e) : '') };
};

export function assetTable(entries, facts, q, label, showScope = new Set(entries.map(e => e.v.id)).size > 1, withDesc = true) {
  const cols = [
    {
      head: 'Name',
      track: 'minmax(140px, 2fr)',
      cls: 'at-name',
      cell: e => {
        const color = agentColorClass(metaOf(e.a).color);
        return [icon(glyphOf(e.a)), color ? el('span', { className: `swatch ${color}` }) : null, el('span', { className: 'at-label' }, highlight(rowName(e.a), q))];
      },
    },
    ...(withDesc ? [{ head: 'Description', track: 'minmax(100px, 3fr)', muted: true, wide: true, cell: e => highlight(descOf(e.a) || '', q), title: e => descOf(e.a) }] : []),
    ...[...facts, CHANGED].map(factCol),
  ];
  if (showScope) cols.push(factCol(['Scope', 130, (a, v) => (a.source === 'plugin' ? 'Plugins' : v.label), undefined, undefined, undefined, true]));
  return gridTable(cols, entries.map(e => Object.assign({ open: () => select(e.a.id), className: [e.a.enabled === false ? 'disabled' : '', state.distScroll === e.a.id ? 'flash' : ''].filter(Boolean).join(' '), context: skillContext(e.a) }, e)), label);
}
