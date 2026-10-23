// @ts-nocheck
// The grid table every main page uses, and its asset flavour.
import { SOURCES, agentColorClass, app, categoryOf, labelOf, metaOf, persist, select, state } from './core';
import { el, fmtAgo, highlight, icon, pressable } from './dom';

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
  a.kind === 'mcp' ? a.target || a.description : a.kind === 'plugin' ? (a.name.includes('@') ? `from ${a.name.split('@').pop()}` : '') : a.description;

export const CHANGED = ['Changed', 92, a => fmtAgo(a.mtime)];

// One grid for every table on the main pages. A column: { head, track, cell(row), title(row), num, muted, wide, cls };
// `wide` columns drop out when the panel is narrow. A row with `open` is a button.
export function gridTable(cols, rows, label) {
  const cellClass = c => [c.cls, c.num ? 'at-fact' : 'at-cell', c.muted ? 'at-muted' : '', c.wide ? 'at-wide' : ''].filter(Boolean).join(' ');
  const table = el(
    'div',
    { className: 'asset-table', role: 'table', 'aria-label': label },
    el('div', { className: 'at-row at-head', role: 'row' }, cols.map(c => el('span', { className: cellClass(c), role: 'columnheader' }, c.head))),
    rows.map(r =>
      el(
        'div',
        Object.assign({ className: ['at-row', r.open ? '' : 'static', r.className].filter(Boolean).join(' ') }, r.open ? pressable(r.open) : {}, { role: 'row' }),
        cols.map(c => el('span', { className: cellClass(c), role: 'cell', title: (c.title && c.title(r)) || undefined }, c.cell(r)))
      )
    )
  );
  table.style.setProperty('--at-cols', cols.map(c => c.track).join(' '));
  table.style.setProperty('--at-cols-narrow', cols.filter(c => !c.wide).map(c => c.track).join(' '));
  return table;
}

// A fact column: [header, width in px, value, optional hover text].
export const factCol = ([head, width, value, tip]) => {
  const text = e => String(value(e.a, e.v));
  return { head, track: `minmax(0, ${width}px)`, num: true, cell: text, title: e => (tip ? tip(e.a) : text(e).length * 7 > width ? text(e) : '') };
};

export function assetTable(entries, facts, q, label, showScope = new Set(entries.map(e => e.v.id)).size > 1) {
  const cols = [
    {
      head: 'Name',
      track: 'minmax(140px, 1fr)',
      cls: 'at-name',
      cell: e => {
        const color = agentColorClass(metaOf(e.a).color);
        return [icon(glyphOf(e.a)), color ? el('span', { className: `swatch ${color}` }) : null, el('span', { className: 'at-label' }, highlight(rowName(e.a), q))];
      },
    },
    { head: 'Description', track: 'minmax(0, 2fr)', muted: true, wide: true, cell: e => highlight(descOf(e.a) || '', q), title: e => descOf(e.a) },
    ...[...facts, CHANGED].map(factCol),
  ];
  if (showScope) cols.push(factCol(['Scope', 130, (a, v) => v.label]));
  return gridTable(cols, entries.map(e => Object.assign({ open: () => select(e.a.id), className: e.a.enabled === false ? 'disabled' : '' }, e)), label);
}
