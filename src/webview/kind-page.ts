// @ts-nocheck
// Type pages: every element of one kind, with search, presets and facets.
import { LIST_VIEWS, SOURCES, categoryOf, command, groupItems, labelOf, linkName, metaOf, pluginLabel, pluginOf, select, showRepo, singular, skillPluginOf, sourceName, state, twinText, twinsOf, viewOf } from './core';
import { el, highlight, icon, iconBtn, pageHead, plural } from './dom';
import { hideHover } from './hover';
import { render } from './main';
import { assetTable, glyphOf, groupHead } from './tables';

export const COPYABLE_KINDS = ['rule', 'agent', 'skill', 'command', 'outputStyle', 'workflow', 'hookScript'];

export const RESTRICTED = ['restricted', 'Restricted tools', a => !!metaOf(a).tools];

export const KIND_PRESETS = {
  agent: [RESTRICTED, ['alltools', 'All tools', a => !metaOf(a).tools], ['plugin', 'From plugins', a => a.source === 'plugin']],
  skill: [
    RESTRICTED,
    ['manual', 'Manual only', a => !!metaOf(a).manual],
    ['files', 'With extra files', a => (a.files || []).length > 1],
    ['plugin', 'From plugins', a => a.source === 'plugin'],
    ['linked', 'Linked', a => !!a.link],
  ],
  command: [RESTRICTED, ['manual', 'Manual only', a => !!metaOf(a).manual]],
  rule: [
    ['always', 'Always loaded', a => !metaOf(a).paths],
    ['scoped', 'Path-scoped', a => !!metaOf(a).paths],
  ],
  mcp: [
    ['connected', 'Connected', a => a.enabled !== false && /^connected/i.test(a.status || '')],
    ['auth', 'Needs sign-in', a => a.enabled !== false && /auth/i.test(a.status || '') && !/fail/i.test(a.status || '')],
    ['failed', 'Failed', a => a.enabled !== false && /fail/i.test(a.status || '')],
    ['off', 'Switched off', a => a.enabled === false || !!a.offIn],
    ['twins', 'Duplicates', a => twinsOf(a).length > 0],
  ],
  plugin: [
    ['on', 'Enabled', a => !!a.enabled],
    ['disabled', 'Disabled', a => !a.enabled],
  ],
};

export const presetsFor = kind => [
  ...(KIND_PRESETS[kind] || []),
  ['week', 'Changed this week', a => Date.now() - (a.mtime || 0) < 7 * 864e5],
  ...(COPYABLE_KINDS.includes(kind) ? [['copies', 'Has copies', a => (a.copies || []).length > 0]] : []),
];

export const pluginNameOf = a =>
  a.kind === 'mcp' ? pluginOf(a) : a.source === 'plugin' && String(a.scope).startsWith('plugin:') ? a.scope.slice('plugin:'.length).split('@')[0] : '';

// [key, label, glyph, values of an entry, display name of a value]
export const FACET_GROUPS = [
  ['tool', 'Tool', 'tools', e => metaOf(e.a).tools || []],
  ['model', 'Model', 'chip', e => [metaOf(e.a).model].filter(Boolean)],
  ['color', 'Color', 'symbol-color', e => [metaOf(e.a).color].filter(Boolean)],
  ['path', 'Path', 'filter', e => metaOf(e.a).paths || []],
  ['source', 'Source', 'plug', e => (e.a.kind === 'mcp' && e.a.source ? [e.a.source] : []), v => (SOURCES[v] ? SOURCES[v].label : v)],
  ['plugin', 'Plugin', 'extensions', e => [pluginNameOf(e.a)].filter(Boolean)],
  ['market', 'Marketplace', 'package', e => (e.a.kind === 'plugin' && e.a.name.includes('@') ? [e.a.name.split('@').pop()] : [])],
  ['event', 'Event', 'zap', e => (e.a.kind === 'hook' ? [e.a.name.split(' · ')[0]] : [])],
  ['scope', 'Scope', 'repo', e => [e.v.id], v => (viewOf(v) ? viewOf(v).label : v)],
];

export const groupOf = key => FACET_GROUPS.find(g => g[0] === key);

export const valueName = (g, v) => (g[4] ? g[4](v) : v);

export const kindEntries = kind => state.views.flatMap(v => (v.categories.find(c => c.kind === kind) || { items: [] }).items.map(a => ({ a, v })));

export const entryText = e =>
  [labelOf(e.a), e.a.description, e.a.about, e.a.target, e.a.status, e.v.label, metaOf(e.a).model, ...(metaOf(e.a).tools || []), ...(metaOf(e.a).paths || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export const facetTestOf = (kind, f) => {
  if (f.kind === 'preset') {
    const p = presetsFor(kind).find(x => x[0] === f.value);
    return e => !p || p[2](e.a);
  }
  const g = groupOf(f.kind);
  return e => !g || g[3](e).includes(f.value);
};

// Facets of one group widen the list (Tool: Bash or Tool: Read), facets of different groups and presets narrow it.
export const filterEntries = (kind, list, q, facets) => {
  const groups = new Map();
  for (const f of facets) {
    const key = f.kind === 'preset' ? `preset:${f.value}` : f.kind;
    groups.set(key, [...(groups.get(key) || []), facetTestOf(kind, f)]);
  }
  const tests = [...groups.values()];
  return list.filter(e => tests.every(any => any.some(t => t(e))) && (!q || entryText(e).includes(q)));
};

export const groupsIn = list => FACET_GROUPS.filter(g => (g[0] === 'scope' ? new Set(list.map(e => e.v.id)).size > 1 : list.some(e => g[3](e).length)));

export const facetValues = (g, pool) => {
  const counts = new Map();
  for (const e of pool) for (const v of new Set(g[3](e))) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts]
    .map(([value, n]) => ({ kind: g[0], value, label: `${g[1]}: ${valueName(g, value)}`, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
};

// "tool: ba" lists the Tool values that contain "ba" instead of searching the text.
export const groupQuery = (q, groups) => {
  const m = /^([a-z ]+):\s*(.*)$/.exec(q);
  const g = m && groups.find(x => x[1].toLowerCase() === m[1].trim());
  return g ? { g, rest: m[2].trim() } : undefined;
};

export function kindSuggestions(kind, entries, q, facets) {
  const has = f => facets.some(x => x.kind === f.kind && x.value === f.value);
  const groups = groupsIn(entries);
  const pool = filterEntries(kind, entries, '', facets);
  const gq = groupQuery(q, groups);
  if (gq) return facetValues(gq.g, pool).filter(f => !has(f) && String(valueName(gq.g, f.value)).toLowerCase().includes(gq.rest));
  const presets = presetsFor(kind)
    .map(([value, label, test]) => ({ kind: 'preset', value, label, n: pool.filter(e => test(e.a)).length }))
    .filter(f => f.n > 0 && !has(f) && (!q || f.label.toLowerCase().includes(q)));
  const openers = groups.map(g => ({ kind: 'group', g, label: `${g[1]}:`, n: facetValues(g, pool).length })).filter(f => f.n > 0 && (!q || f.g[1].toLowerCase().startsWith(q)));
  if (!q) return [...presets, ...openers];
  const values = groups.flatMap(g => facetValues(g, pool)).filter(f => !has(f) && f.label.toLowerCase().includes(q));
  const items = pool
    .filter(e => labelOf(e.a).toLowerCase().includes(q))
    .slice(0, 5)
    .map(e => ({ kind: 'item', e, label: labelOf(e.a) }));
  return [...openers, ...presets.slice(0, 3), ...values.slice(0, 6), ...items];
}

export const toolsText = a => (metaOf(a).tools ? plural(metaOf(a).tools.length, 'tool') : 'all tools');
// The MCP Source cell names the place inside the origin group: the config file, or the plugin.
export const mcpSourceCell = a =>
  a.source === 'plugin' ? pluginOf(a) : a.source === 'claude.ai' ? 'claude.ai' : a.source === 'project' ? '.mcp.json' : a.source === 'local' ? 'local' : '~/.claude.json';
// One word per status; the full text from `claude mcp list` is in the cell's hover card.
export const mcpStatusWord = a => {
  const s = a.status || '';
  if (a.enabled === false) return 'Off';
  if (/^connected/i.test(s)) return 'Connected';
  if (/fail/i.test(s)) return 'Failed';
  if (/auth/i.test(s)) return 'Sign-in';
  if (/not configured/i.test(s)) return 'Unconfigured';
  return s ? s.split(/\s/)[0] : '-';
};

// Facts per kind as table columns: [header, width in px, value, optional hover text].
export const KIND_FACTS = {
  agent: [
    ['Model', 76, a => metaOf(a).model || 'inherit'],
    ['Tools', 80, toolsText],
  ],
  skill: [
    ['Tools', 80, toolsText],
    ['Files', 48, a => String(Math.max(1, (a.files || []).length))],
    ['Origin', 150, a => (a.source === 'plugin' ? pluginLabel(skillPluginOf(a)) : a.link ? `linked from ${linkName(a.link)}` : '-')],
  ],
  command: [['Tools', 80, toolsText]],
  rule: [['Loads', 170, a => (metaOf(a).paths ? metaOf(a).paths.join(', ') : 'always')]],
  mcp: [
    ['Source', 130, mcpSourceCell, a => sourceName(a)],
    ['Status', 104, mcpStatusWord, a => (a.enabled === false ? 'Switched off' : a.status || '')],
  ],
  plugin: [
    ['Version', 84, a => a.description.split(' · ')[1] || '-'],
    ['State', 72, a => (a.enabled ? 'enabled' : 'disabled')],
  ],
  settings: [['Keys', 52, a => a.description.replace(/ keys$/, '')]],
};

// Opened from a repo, the page lists what loads there: Global, the plugins it enables, and the repo's own files.
export const showKindPage = (kind, scope) => {
  const view = viewOf(scope);
  const global = state.views[0];
  const loaded = !view ? [] : global && view.id !== global.id ? [global, view] : [view];
  state.page = 'kind';
  state.repo = undefined;
  state.kindPage = { kind, origin: scope, query: '', facets: loaded.map(v => ({ kind: 'scope', value: v.id, label: `Scope: ${v.label}` })), open: false, active: 0, focus: true };
  hideHover();
  if (state.detail) select(undefined);
  else render();
};

export function renderKindPage() {
  const p = state.kindPage;
  const cat = categoryOf(p.kind) || { kind: p.kind, label: p.kind, icon: 'file' };
  const origin = viewOf(p.origin);
  const lower = cat.label.toLowerCase();
  const facts = KIND_FACTS[p.kind] || [];
  let entries = kindEntries(p.kind);
  const results = el('div', { className: 'kind-results' });
  const filters = el('div', { className: 'filter-bar' });
  const suggest = el('div', { className: 'suggest', role: 'listbox', id: 'kind-suggest', hidden: true });
  const hintGroup = groupsIn(entries).find(g => g[0] !== 'scope');
  const input = el('input', {
    type: 'search',
    id: 'kind-search',
    placeholder: `Search ${lower} by name or description${hintGroup ? `, or type ${hintGroup[1].toLowerCase()}: to filter` : ''}`,
    value: p.query,
    autocomplete: 'off',
    spellcheck: 'false',
    role: 'combobox',
    'aria-label': `Search ${lower}`,
    'aria-expanded': 'false',
    'aria-controls': 'kind-suggest',
    'aria-autocomplete': 'list',
  });
  let items = [];
  const q = () => p.query.trim().toLowerCase();
  const textQ = () => (groupQuery(q(), groupsIn(entries)) ? '' : q());
  const same = (a, b) => a.kind === b.kind && a.value === b.value;
  const has = f => p.facets.some(x => same(x, f));
  const toggle = f => {
    p.facets = has(f) ? p.facets.filter(x => !same(x, f)) : [...p.facets, { kind: f.kind, value: f.value, label: f.label }];
    update();
  };
  const openGroup = g => {
    input.value = `${g[1].toLowerCase()}: `;
    p.query = input.value;
    p.open = true;
    p.active = 0;
    input.focus();
    update();
  };
  const drawResults = () => {
    const hits = filterEntries(p.kind, entries, textQ(), p.facets);
    const cols = p.kind === 'mcp' && hits.some(e => twinsOf(e.a).length) ? [...facts, ['Duplicate of', 170, a => twinText(a) || '-']] : facts;
    // Grouped lists get one table per group, in the sidebar's order: by default where each item lives.
    const groups = LIST_VIEWS[p.kind] ? groupItems(p.kind, hits, e => e.a) : [];
    const scoped = new Set(hits.map(e => e.v.id)).size > 1;
    const body =
      groups.length > 1
        ? groups.map(([[id, label, glyph], list]) => {
            const foldKey = `page|${p.kind}|${id}`;
            const folded = state.foldedGroups.has(foldKey);
            return el('div', { className: 'origin-section' }, groupHead('origin-label', foldKey, folded, glyph, label, list.length, drawResults), folded ? null : assetTable(list, cols, textQ(), label, scoped));
          })
        : [assetTable(hits, cols, textQ(), cat.label, scoped)];
    results.replaceChildren(
      ...[
        el('div', { className: 'group-label' }, hits.length === entries.length ? `${entries.length} ${lower}` : `${hits.length} of ${entries.length} ${lower}`),
        hits.length ? body : el('div', { className: 'empty flush' }, entries.length ? 'Nothing matches. Press Esc to clear the search, then the filters.' : `No ${lower} yet.`),
      ].flat()
    );
  };
  const drawFilters = () => {
    const chips = p.facets
      .filter(f => f.kind !== 'preset')
      .map(f =>
        el(
          'button',
          {
            className: 'chip',
            title: `Remove the filter ${f.label}`,
            onclick: () => {
              toggle(f);
              input.focus();
            },
          },
          icon((groupOf(f.kind) || [])[2] || 'filter'),
          el('span', {}, f.label),
          icon('close')
        )
      );
    const presets = presetsFor(p.kind).map(([value, label, test]) => {
      const f = { kind: 'preset', value, label };
      const on = has(f);
      const n = filterEntries(p.kind, entries, textQ(), p.facets.filter(x => !same(x, f))).filter(e => test(e.a)).length;
      return on || n
        ? el('button', { className: `preset${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => toggle(f) }, el('span', {}, label), el('span', { className: 'preset-n' }, n))
        : null;
    });
    const openers = groupsIn(entries).map(g => el('button', { className: 'filter-add', 'aria-label': `Filter by ${g[1].toLowerCase()}`, onclick: () => openGroup(g) }, icon('add'), g[1]));
    filters.replaceChildren(...[chips, presets, openers.length ? el('span', { className: 'filter-sep', 'aria-hidden': 'true' }) : null, openers].flat().filter(Boolean));
  };
  const drawSuggest = () => {
    items = kindSuggestions(p.kind, entries, q(), p.facets);
    if (p.active >= items.length) p.active = 0;
    suggest.replaceChildren(
      ...items.map((it, i) =>
        el(
          'div',
          {
            className: `suggest-item${i === p.active ? ' active' : ''}`,
            role: 'option',
            id: `kind-suggest-${i}`,
            'aria-selected': i === p.active ? 'true' : 'false',
            onmousedown: e => {
              e.preventDefault();
              pick(it);
            },
          },
          icon(it.kind === 'item' ? glyphOf(it.e.a) : it.kind === 'group' ? it.g[2] : (groupOf(it.kind) || [])[2] || 'filter'),
          el('span', { className: 'name' }, it.kind === 'item' ? highlight(it.label, q()) : it.label),
          el('span', { className: 'desc' }, it.kind === 'item' ? 'Open' : it.kind === 'group' ? `${it.n} ${it.n === 1 ? 'value' : 'values'}` : `${it.n} ${it.n === 1 ? singular(cat).toLowerCase() : lower}`)
        )
      )
    );
    const show = p.open && items.length > 0;
    suggest.hidden = !show;
    input.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) input.setAttribute('aria-activedescendant', `kind-suggest-${p.active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const update = () => {
    drawFilters();
    drawResults();
    drawSuggest();
  };
  const pick = it => {
    if (it.kind === 'item') {
      select(it.e.a.id);
      return;
    }
    if (it.kind === 'group') {
      openGroup(it.g);
      return;
    }
    p.facets = [...p.facets, { kind: it.kind, value: it.value, label: it.label }];
    p.query = '';
    input.value = '';
    p.active = 0;
    update();
  };
  input.addEventListener('input', () => {
    p.query = input.value;
    p.open = true;
    p.active = 0;
    update();
  });
  input.addEventListener('focus', () => {
    if (p.quiet) {
      p.quiet = false;
      return;
    }
    p.open = true;
    drawSuggest();
  });
  input.addEventListener('blur', () => {
    p.open = false;
    drawSuggest();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (p.query) {
        p.query = '';
        input.value = '';
      } else p.facets = [];
      p.active = 0;
      update();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      p.open = true;
      if (items.length) p.active = (p.active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      drawSuggest();
      const active = suggest.querySelector('.suggest-item.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (p.open && items[p.active]) {
        e.preventDefault();
        pick(items[p.active]);
      }
    } else if (e.key === 'Backspace' && !input.value && p.facets.length) {
      p.facets = p.facets.slice(0, -1);
      update();
    }
  });
  p.refresh = () => {
    entries = kindEntries(p.kind);
    update();
  };
  update();
  if (p.focus) {
    p.focus = false;
    p.quiet = true;
    requestAnimationFrame(() => input.focus());
  }
  const inOrigin = entries.filter(e => e.v.id === p.origin).length;
  const scopes = new Set(entries.map(e => e.v.id)).size;
  const back = origin && origin.id !== 'global' ? iconBtn('arrow-left', `Back to ${origin.label}`, () => showRepo(origin.id)) : iconBtn('arrow-left', 'Back to the overview', () => showRepo(undefined));
  const create = cat.creatable
    ? iconBtn('add', `New ${singular(cat)}${origin ? ` in ${origin.label}` : ''}`, () => command('create', { kind: p.kind, scope: p.origin }))
    : p.kind === 'mcp'
      ? iconBtn('add', 'Add MCP Server...', () => command('addMcp', { scope: p.origin }))
      : p.kind === 'plugin'
        ? iconBtn('add', 'Install Plugin...', () => command('installPlugin', { scope: p.origin }))
        : null;
  return el(
    'section',
    { className: 'main' },
    pageHead(cat.icon, cat.label, [origin ? `${inOrigin} in ${origin.label}` : '', `${entries.length} across ${plural(scopes, 'scope')}`].filter(Boolean).join(' · '), back, create),
    el('div', { className: 'main-body', onscroll: hideHover }, el('div', { className: 'kind-search' }, el('div', { className: 'combo' }, icon('search'), input, suggest), filters), results)
  );
}
