// @ts-nocheck
// The overview page.
import { repoContext } from './context';
import { bylineNodes } from './byline';
import { kindLabel, labelOf, matches, persist, select, showRepo, state, total, vscode } from './core';
import { el, fmtAgo, fmtDate, fmtDur, highlight, icon, logo, plural, pressable } from './dom';
import { hideHover } from './hover';
import { huntButton } from './hunt';
import { showKindPage } from './kind-page';
import { tabBar } from './repo-page';
import { fmtUsd } from './session-page';
import { filterSessions, sessionIcon, showSession } from './sessions';
import { gridTable } from './tables';
import { askWeekly, repoWeek } from './week';

const DAY = 86400000;
// The lists show as many rows as the panel's height holds, never fewer than this, never more than the cap.
const LAST_SESSIONS = 10;
const RECENT_CHANGED = 12;
const LIST_CAP = 100;

// Hides the rows of a list that would end below the bottom of the page body; the lists already hold every row.
function fitRows(body, box, rowSelector, min) {
  if (!body || box.hidden) return;
  const rows = [...box.querySelectorAll(rowSelector)];
  rows.forEach(r => (r.style.display = ''));
  const top = body.getBoundingClientRect().top - body.scrollTop;
  const limit = body.clientHeight - 12;
  let kept = rows.filter(r => r.getBoundingClientRect().bottom - top <= limit).length;
  kept = Math.max(min, kept);
  rows.forEach((r, i) => (r.style.display = i < kept ? '' : 'none'));
}
const SESSION_HITS = 25;

// Every repo's session list is asked for once; the lists arrive one by one and the page redraws in place.
function askSessions(repos) {
  for (const v of repos) {
    if (state.sessions[v.id] === undefined) {
      state.sessions[v.id] = null;
      vscode.postMessage({ type: 'sessions', scope: v.id });
    }
  }
}

const sessionState = s => s.live || (s.headless ? 'headless' : s.children && s.children.length ? `${s.children.length} headless` : '');

// The newest sessions of all repos: the list's own facts, one row each across the full width.
function lastSessionsBlock(repos) {
  const loaded = repos.filter(v => state.sessions[v.id]);
  const all = loaded.flatMap(v => state.sessions[v.id].map(s => Object.assign({ scope: v.id, repo: v.label, open: () => showSession(v.id, s.id) }, s)));
  all.sort((a, b) => b.end - a.end);
  const shown = all.slice(0, LIST_CAP);
  return el(
    'div',
    { className: 'recent' },
    el('div', { className: 'group-label', title: 'The newest sessions over all repositories' }, 'Last sessions'),
    shown.length
      ? gridTable(
          [
            { head: 'Session', track: 'minmax(180px, 3fr)', cls: 'at-name', cell: s => [sessionIcon(s), el('span', { className: 'at-label' }, s.title)], title: s => s.title },
            { head: 'Repository', track: 'minmax(84px, 1fr)', muted: true, cell: s => s.repo, title: s => s.repo },
            { head: 'Branch', track: 'minmax(72px, 1fr)', muted: true, wide: true, cell: s => s.branch || '', title: s => s.branch || '' },
            { head: 'Started', track: '120px', num: true, cell: s => (s.start ? fmtDate(s.start) : '') },
            { head: 'Duration', track: '76px', num: true, wide: true, cell: s => (s.start ? fmtDur(s.end - s.start) : '') },
            { head: 'Agents', track: '60px', num: true, wide: true, cell: s => String(s.agents || 0) },
            // The State column exists only while some session shows a state.
            ...(shown.some(s => sessionState(s)) ? [{ head: 'State', track: '84px', muted: true, wide: true, cell: sessionState }] : []),
          ],
          shown,
          'Last sessions'
        )
      : el('div', { className: 'empty flush' }, loaded.length < repos.length ? 'Reading the sessions...' : 'No Claude Code session ran in these repositories yet.')
  );
}

const COUNTS = [
  ['Memory', 'memory', 'memory'],
  ['Rules', 'rule', 'rules'],
  ['Agents', 'agent', 'agents'],
  ['Skills', 'skill', 'skills'],
  ['MCP', 'mcp', 'MCP servers'],
];

const countOf = (v, kind) => {
  const c = v.categories.find(x => x.kind === kind);
  return c ? c.items.length : 0;
};

// One row per repo, the same columns in every row: the assets it holds, then its last 7 days.
function reposBlock(repos) {
  const week = askWeekly();
  const since = Date.now() - 7 * DAY;
  const info = new Map(
    repos.map(v => {
      const list = state.sessions[v.id];
      const cost = week ? repoWeek(week, v).reduce((n, x) => n + x.r.cost, 0) : undefined;
      return [v.id, { last: list && list.length ? list[0].end : 0, recent: list ? list.filter(s => (s.start || s.end) >= since).length : undefined, cost, loaded: !!list }];
    })
  );
  const rows = repos.map(v => Object.assign({ v, i: info.get(v.id), context: repoContext(v), open: () => (state.openRepos.add(v.id), persist(), showRepo(v.id)) }));
  return el(
    'div',
    { className: 'recent' },
    el('div', { className: 'group-label' }, 'Repositories'),
    gridTable(
      [
        { head: 'Repository', track: 'minmax(76px, 1fr)', cls: 'at-name', cell: r => [icon('repo'), el('span', { className: 'at-label' }, r.v.label)], title: r => r.v.path },
        ...COUNTS.map(([head, kind, noun]) => ({ head, track: '52px', num: true, wide: true, cell: r => String(countOf(r.v, kind)), title: r => `${countOf(r.v, kind)} ${noun}` })),
        { head: 'Sessions 7d', track: '84px', num: true, low: true, cell: r => (r.i.recent === undefined ? '' : String(r.i.recent)), title: () => 'Sessions started in the last 7 days' },
        { head: 'Cost 7d', track: '70px', num: true, low: true, cell: r => (r.i.cost === undefined ? '' : fmtUsd(r.i.cost)), title: () => 'Cost at API list prices over the last 7 days, all accounts' },
        { head: 'Last session', track: 'minmax(84px, 90px)', num: true, cell: r => (r.i.last ? fmtAgo(r.i.last) : r.i.loaded ? 'none' : '') },
      ],
      rows,
      'Repositories'
    )
  );
}

export function renderOverview() {
  const [global, ...others] = state.views;
  const repos = others.filter(v => v.id !== 'cowork');
  const categories = global ? global.categories : [];
  const all = state.views.flatMap(v => v.categories.flatMap(c => c.items.map(a => Object.assign({ icon: c.icon, scopeLabel: v.label }, a))));
  const recent = all
    .filter(a => ['memory', 'rule', 'agent', 'skill', 'command', 'outputStyle', 'workflow'].includes(a.kind))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, LIST_CAP);
  askSessions(repos);
  const results = el('div', { className: 'recent' });
  const sessionResults = el('div', { className: 'recent' });
  const lastBox = el('div', { className: 'overview-list' });
  const reposBox = el('div', { className: 'overview-list' });
  const showResults = () => {
    const q = state.overviewFilter.toLowerCase();
    const hits = q ? all.filter(a => matches(a, q)) : [];
    // The sessions page's own matcher: prompt, agent, branch and date.
    const sessionHits = q ? repos.flatMap(v => filterSessions(state.sessions[v.id] || [], q, []).map(s => ({ v, s }))).sort((a, b) => b.s.end - a.s.end) : [];
    const pending = repos.some(v => !state.sessions[v.id]);
    // Nothing matched anywhere: one message for the whole search, not an empty group per source.
    if (q && !hits.length && !sessionHits.length) {
      const sessionCount = repos.reduce((n, v) => n + (state.sessions[v.id] || []).length, 0);
      results.replaceChildren(
        el(
          'div',
          { className: 'search-empty', role: 'status' },
          icon(pending ? 'loading' : 'search'),
          el('div', { className: 'se-title' }, pending ? `Reading the sessions for "${state.overviewFilter}"...` : `No match for "${state.overviewFilter}"`),
          el(
            'div',
            { className: 'se-hint' },
            `Searched ${all.length} harness items (names and descriptions) and ${sessionCount} sessions in ${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'} (prompts, agents, branches and dates). Try a shorter or different word.`
          )
        )
      );
      results.hidden = false;
      sessionResults.replaceChildren();
      sessionResults.hidden = true;
      return;
    }
    sessionResults.replaceChildren(
      ...(q
        ? [
            el('div', { className: 'group-label' }, `Sessions (${sessionHits.length})`),
            sessionHits.length
              ? sessionHits.slice(0, SESSION_HITS).map(({ v, s }) =>
                  el(
                    'div',
                    { className: 'row', title: s.title, onclick: () => showSession(v.id, s.id) },
                    sessionIcon(s),
                    el('span', { className: 'name' }, highlight(s.title, q)),
                    el('span', { className: 'desc' }, [v.label, s.start ? fmtDate(s.start) : '', s.branch || '', (s.types || []).join(', ')].filter(Boolean).join(' · '))
                  )
                )
              : el('div', { className: 'empty flush' }, pending ? 'Reading the sessions...' : 'No matches'),
            sessionHits.length > SESSION_HITS ? el('div', { className: 'empty flush' }, `Showing the newest ${SESSION_HITS}. Narrow the search to see the rest.`) : null,
          ]
        : []
      )
        .flat()
        .filter(Boolean)
    );
    sessionResults.hidden = !q;
    results.replaceChildren(
      ...(q
        ? [
            el('div', { className: 'group-label' }, `Harness (${hits.length})`),
            hits.length
              ? hits.map(a =>
                  el(
                    'div',
                    { className: 'row', title: a.description, onclick: () => select(a.id) },
                    icon(a.icon),
                    el('span', { className: 'name' }, labelOf(a)),
                    el('span', { className: 'desc' }, ...bylineNodes(a, a.scopeLabel))
                  )
                )
              : el('div', { className: 'empty flush' }, 'No matches'),
          ]
        : []
      ).flat()
    );
    results.hidden = !q;
  };
  // The blocks that wait for the session lists and the weekly totals; redrawn in place so the search keeps its focus.
  const drawLive = () => {
    lastBox.replaceChildren(lastSessionsBlock(repos));
    reposBox.replaceChildren(...(repos.length ? [reposBlock(repos)] : []));
    fit();
  };
  let body;
  const fit = () => {
    fitRows(body, lastBox, '.at-row:not(.at-head)', LAST_SESSIONS);
    fitRows(body, changedBox, '.at-row:not(.at-head)', RECENT_CHANGED);
  };
  const changedBox = el(
    'div',
    { className: 'recent overview-list' },
    el('div', { className: 'group-label' }, 'Recently changed'),
    gridTable(
      [
        { head: 'Name', track: 'minmax(100px, 2fr)', cls: 'at-name', cell: a => [icon(a.icon), el('span', { className: 'at-label' }, a.name)], title: a => a.name },
        { head: 'Type', track: 'minmax(0, 1fr)', muted: true, wide: true, cell: a => kindLabel(a.kind) },
        { head: 'Scope', track: 'minmax(72px, 1fr)', muted: true, cell: a => a.scopeLabel },
        { head: 'Changed', track: '120px', num: true, cell: a => fmtDate(a.mtime) },
      ],
      recent.map(a => Object.assign({ open: () => select(a.id) }, a)),
      'Recently changed'
    )
  );
  // The three lists sit behind tabs under the search; the tab picked last is kept in the panel state.
  const tabs = [
    ['sessions', 'Last sessions', 'history', 'The newest sessions over all repositories.'],
    ...(repos.length ? [['repos', 'Repositories', 'repo', 'Every repository: its assets, its last 7 days and its last session.', repos.length]] : []),
    ['changed', 'Recently changed', 'edit', 'The harness assets edited last, over every scope.'],
  ];
  const tabsBox = el('div', { className: 'overview-tabs' });
  const boxes = { sessions: lastBox, repos: reposBox, changed: changedBox };
  let current = 'sessions';
  // While a search is active its results take the place of the active tab's list.
  const syncLists = () => {
    for (const [id, box] of Object.entries(boxes)) box.hidden = !!state.overviewFilter || id !== current;
  };
  const showTab = focus => {
    const tab = tabs.some(t => t[0] === state.overviewTab) ? state.overviewTab : 'sessions';
    const pick = (id, again) => {
      state.overviewTab = id;
      persist();
      hideHover();
      showTab(again);
    };
    tabsBox.replaceChildren(tabBar(tabs, tab, pick, 'Overview lists'), huntButton());
    current = tab;
    syncLists();
    fit();
    const active = focus && tabsBox.querySelector('.view-tab.active');
    if (active) active.focus();
  };
  const draw = () => {
    showResults();
    drawLive();
  };
  state.overviewRefresh = draw;
  draw();
  showTab(false);
  const search = el(
    'div',
    { className: 'overview-search' },
    el('input', {
      type: 'search',
      placeholder: 'Search the harness and sessions',
      'aria-label': 'Search the harness and sessions',
      value: state.overviewFilter,
      oninput: e => {
        state.overviewFilter = e.target.value;
        showResults();
        syncLists();
        fit();
      },
    })
  );
  const page = el(
    'section',
    { className: 'main' },
    el(
      'header',
      { className: 'main-head' },
      el('span', { className: 'big' }, logo('logo-lg')),
      el('div', { className: 'title' }, el('h1', {}, 'Claude Harness'), el('div', { className: 'path meta' }, `${global ? total(global) : 0} global assets · ${plural(repos.length, 'repository')}`))
    ),
    (body = el(
      'div',
      { className: 'main-body' },
      el(
        'div',
        { className: 'overview compact' },
        categories.map(c =>
          el(
            'div',
            Object.assign({ className: `tile${c.items.length ? '' : ' zero'}` }, pressable(() => showKindPage(c.kind, global.id))),
            el('span', { className: 'n' }, c.items.length),
            el('span', { className: 'l' }, icon(c.icon), c.label)
          )
        )
      ),
      tabsBox,
      search,
      results,
      sessionResults,
      lastBox,
      reposBox,
      changedBox
    ))
  );
  // The lists follow the panel's height: a resize shows more or fewer rows.
  state.overviewObserver?.disconnect();
  state.overviewObserver = new ResizeObserver(() => {
    if (body.isConnected) fit();
  });
  state.overviewObserver.observe(body);
  return page;
}
