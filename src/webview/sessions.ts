// @ts-nocheck
// The sessions search page and session lists.
import { analyzeRowButton } from './confirm';
import { select, showRepo, state, viewOf, vscode } from './core';
import { clip, countHead, el, fmtDate, fmtDur, highlight, icon, iconBtn, plural } from './dom';
import { render, renderMain } from './main';
import { gridTable } from './tables';

export const sessionDesc = s =>
  [
    s.account || '',
    s.start ? fmtDate(s.start) : '',
    s.start ? fmtDur(s.end - s.start) : '',
    s.agents ? `${s.agents} ${s.agents === 1 ? 'agent' : 'agents'}` : '',
    s.children && s.children.length ? `${s.children.length} headless` : '',
    s.headless ? 'headless' : '',
    s.live || '',
  ]
    .filter(Boolean)
    .join(' · ');

// The hover card of a session row: its first prompt, where and when it ran, never the transcript's path.
export const sessionTip = (s, scope) => {
  const view = scope && viewOf(scope);
  const facts = [view ? view.label : '', s.branch || '', s.start ? fmtDate(s.start) : '', s.agents ? `${s.agents} ${s.agents === 1 ? 'agent' : 'agents'}` : ''].filter(Boolean).join(' · ');
  return [s.live ? `Running now: ${s.live}` : s.headless ? 'Headless session' : 'Session', s.title ? clip(s.title.replace(/\s+/g, ' '), 160) : '', facts].filter(Boolean).join('\n');
};

export const sessionIcon =s =>
  s.live ? el('span', { className: 'codicon codicon-circle-filled live' }) : icon(s.headless ? 'terminal' : s.agents ? 'type-hierarchy-sub' : 'comment-discussion');

// The head of the sessions search: the repo's name, its path in the hover.
const sessionsHead = (view, ...tools) => {
  const head = countHead('history', 'Sessions', view ? view.label : '', ...tools);
  if (view) head.querySelector('.path').setAttribute('title', view.path);
  return head;
};

// Sessions as one-line rows, the same columns on the repo's Sessions tab and in the search; the search adds a button to analyze one.
export const sessionTable = (list, scope, label, { q = '', analyze = false } = {}) =>
  gridTable(
    [
      { head: 'Session', track: 'minmax(180px, 3fr)', cls: 'at-name', cell: s => [sessionIcon(s), el('span', { className: 'at-label' }, q ? highlight(s.title, q) : s.title)], title: s => sessionTip(s, scope) },
      { head: 'Branch', track: 'minmax(0, 1fr)', muted: true, wide: true, cell: s => s.branch || '' },
      { head: 'Started', track: '120px', num: true, cell: s => (s.start ? fmtDate(s.start) : '') },
      { head: 'Duration', track: '76px', num: true, cell: s => (s.start ? fmtDur(s.end - s.start) : '') },
      { head: 'Agents', track: '60px', num: true, cell: s => String(s.agents || 0), title: s => (s.types || []).join(', ') },
      { head: 'State', track: '84px', muted: true, cell: s => s.live || (s.headless ? 'headless' : s.children && s.children.length ? `${s.children.length} headless` : '') },
      ...(analyze ? [{ head: '', track: '58px', cell: s => analyzeRowButton(scope, s.id) }] : []),
    ],
    list.map(s => Object.assign({ open: () => showSession(scope, s.id) }, s)),
    label
  );

export const showSessionsPage = scope => {
  state.page = 'sessions';
  state.repo = undefined;
  state.sessionsPage = { scope, query: '', facets: [], open: false, active: 0, focus: true };
  if (state.sessions[scope] === undefined) {
    state.sessions[scope] = null;
    vscode.postMessage({ type: 'sessions', scope });
  }
  if (state.detail) select(undefined);
  else render();
};

export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export const FACET_ICONS = { type: 'hubot', branch: 'git-branch', state: 'filter' };

export const STATE_FACETS = [
  ['running', 'Running now', s => !!s.live],
  ['today', 'Started today', s => !!s.start && sameDay(s.start, Date.now())],
  ['agents', 'With agents', s => s.agents > 0],
  ['headless', 'With headless runs', s => !!s.headless || (s.children || []).length > 0],
  ['hookFailed', 'A hook failed', s => !!s.hookFailed],
  ['modDenied', 'A mod denied a tool', s => !!s.modDenied],
];

export const facetTest = f =>
  f.kind === 'type' ? s => (s.types || []).includes(f.value) : f.kind === 'branch' ? s => s.branch === f.value : (STATE_FACETS.find(x => x[0] === f.value) || [0, 0, () => true])[2];

export const searchText = s => [s.title, s.branch, ...(s.types || []), s.start ? fmtDate(s.start) : ''].join(' ').toLowerCase();

export const filterSessions = (list, q, facets) => list.filter(s => facets.every(f => facetTest(f)(s)) && (!q || searchText(s).includes(q)));

export function suggestionsFor(list, q, facets) {
  const has = f => facets.some(x => x.kind === f.kind && x.value === f.value);
  const pool = filterSessions(list, '', facets);
  const types = [...new Set(pool.flatMap(s => s.types || []))].sort();
  const branches = [...new Set(pool.map(s => s.branch).filter(Boolean))].sort();
  const facetItems = [
    ...STATE_FACETS.map(([value, label]) => ({ kind: 'state', value, label })),
    ...types.map(value => ({ kind: 'type', value, label: `Agent: ${value}` })),
    ...branches.map(value => ({ kind: 'branch', value, label: `Branch: ${value}` })),
  ]
    .map(f => Object.assign(f, { n: pool.filter(facetTest(f)).length }))
    .filter(f => f.n > 0 && !has(f) && (!q || f.label.toLowerCase().includes(q)));
  const sessions = q ? pool.filter(s => s.title.toLowerCase().includes(q)).slice(0, 5).map(s => ({ kind: 'session', s, label: s.title })) : [];
  return [...facetItems.slice(0, q ? 4 : 8), ...sessions].slice(0, 11);
}

export function renderSessionsPage() {
  const p = state.sessionsPage;
  const view = viewOf(p.scope);
  let list = state.sessions[p.scope];
  if (list === undefined) {
    state.sessions[p.scope] = null;
    vscode.postMessage({ type: 'sessions', scope: p.scope });
  }
  const back = iconBtn('arrow-left', `Back to ${view ? view.label : 'the repo'}`, () => showRepo(p.scope));
  const reload = iconBtn('refresh', 'Read the sessions again', () => {
    state.sessions[p.scope] = null;
    vscode.postMessage({ type: 'sessions', scope: p.scope });
    p.refresh();
  });
  const results = el('div', { className: 'recent' });
  const suggest = el('div', { className: 'suggest', role: 'listbox', id: 'session-suggest', hidden: true });
  const chips = el('div', { className: 'chips', hidden: true });
  const input = el('input', {
    type: 'search',
    id: 'session-search',
    placeholder: 'Search sessions by prompt, agent, branch or date',
    value: p.query,
    autocomplete: 'off',
    spellcheck: 'false',
    role: 'combobox',
    'aria-label': 'Search sessions',
    'aria-expanded': 'false',
    'aria-controls': 'session-suggest',
    'aria-autocomplete': 'list',
  });
  let items = [];
  const q = () => p.query.trim().toLowerCase();
  const drawResults = () => {
    if (!list) {
      results.replaceChildren(el('div', { className: 'empty flush' }, 'Reading the sessions...'));
      return;
    }
    const hits = filterSessions(list, q(), p.facets);
    results.replaceChildren(
      ...[
        el('div', { className: 'group-label' }, q() || p.facets.length ? `${hits.length} of ${list.length} sessions` : plural(list.length, "session")),
        hits.length
          ? sessionTable(hits, p.scope, 'Sessions', { q: q(), analyze: true })
          : el('div', { className: 'empty flush' }, 'No session matches. Esc clears the search.'),
      ].flat()
    );
  };
  const drawChips = () => {
    chips.replaceChildren(
      ...p.facets.map(f =>
        el(
          'button',
          {
            className: 'chip',
            title: `Remove the filter ${f.label}`,
            onclick: () => {
              p.facets = p.facets.filter(x => x !== f);
              update();
              input.focus();
            },
          },
          icon(FACET_ICONS[f.kind] || 'filter'),
          el('span', {}, f.label),
          icon('close')
        )
      )
    );
    chips.hidden = !p.facets.length;
  };
  const drawSuggest = () => {
    items = list ? suggestionsFor(list, q(), p.facets) : [];
    if (p.active >= items.length) p.active = 0;
    suggest.replaceChildren(
      ...items.map((it, i) =>
        el(
          'div',
          {
            className: `suggest-item${i === p.active ? ' active' : ''}`,
            role: 'option',
            id: `session-suggest-${i}`,
            'aria-selected': i === p.active ? 'true' : 'false',
            onmousedown: e => {
              e.preventDefault();
              pick(it);
            },
          },
          it.kind === 'session' ? sessionIcon(it.s) : icon(FACET_ICONS[it.kind] || 'filter'),
          el('span', { className: 'name' }, it.kind === 'session' ? highlight(it.label, q()) : it.label),
          el('span', { className: 'desc' }, it.kind === 'session' ? 'Open' : `${it.n} ${it.n === 1 ? 'session' : 'sessions'}`)
        )
      )
    );
    const show = p.open && items.length > 0;
    suggest.hidden = !show;
    input.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) input.setAttribute('aria-activedescendant', `session-suggest-${p.active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const update = () => {
    drawChips();
    drawResults();
    drawSuggest();
  };
  const pick = it => {
    if (it.kind === 'session') {
      showSession(p.scope, it.s.id);
      return;
    }
    p.facets = [...p.facets, { kind: it.kind, value: it.value, label: it.label }];
    p.query = '';
    input.value = '';
    p.active = 0;
    update();
  };
  const cancel = () => {
    p.query = '';
    p.facets = [];
    p.open = false;
    p.active = 0;
    input.value = '';
    update();
  };
  input.addEventListener('input', () => {
    p.query = input.value;
    p.open = true;
    p.active = 0;
    update();
  });
  // The suggestions open on typing or the arrow keys, never on focus alone, so the latest sessions stay in sight.
  input.addEventListener('blur', () => {
    p.open = false;
    drawSuggest();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      p.open = true;
      if (items.length) p.active = (p.active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      drawSuggest();
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
    list = state.sessions[p.scope];
    update();
  };
  update();
  if (p.focus) {
    p.focus = false;
    requestAnimationFrame(() => input.focus());
  }
  return el(
    'section',
    { className: 'main' },
    sessionsHead(view, back, reload),
    el('div', { className: 'main-body' }, el('div', { className: 'session-search' }, el('div', { className: 'combo' }, icon('search'), input, suggest), chips), results)
  );
}

export const showSession = (scope, id) => {
  state.page = 'session';
  state.repo = undefined;
  state.session = { scope, id, data: undefined, selected: undefined };
  vscode.postMessage({ type: 'session', scope, id });
  if (state.detail) select(undefined);
  else render();
};

export function renderSessionList(view) {
  const list = state.sessions[view.id];
  if (list === undefined) {
    state.sessions[view.id] = null;
    vscode.postMessage({ type: 'sessions', scope: view.id });
  }
  const all = list || [];
  const shown = state.allSessions.has(view.id) ? all : all.slice(0, state.lists.sessions);
  return el(
    'div',
    { className: 'recent' },
    el('div', { className: 'group-label' }, `Sessions${list ? ` (${list.length})` : ''}`),
    !list
      ? el('div', { className: 'empty flush' }, 'Reading the sessions...')
      : !list.length
        ? el('div', { className: 'empty flush' }, 'No Claude Code session ran in this repo yet.')
        : sessionTable(shown, view.id, 'Sessions'),
    list && list.length > shown.length
      ? el(
          'div',
          {
            className: 'row',
            onclick: () => {
              state.allSessions.add(view.id);
              renderMain();
            },
          },
          icon('ellipsis'),
          el('span', { className: 'name' }, `Show all ${list.length} sessions`)
        )
      : null
  );
}
