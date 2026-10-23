// @ts-nocheck
// The sidebar: global and repo categories, grouped lists, sessions, the repo hover card.
import { LIST_VIEWS, SOURCES, app, assetDesc, checkBadge, checkText, command, groupItems, isGrouped, labelOf, listMode, listModes, matches, mcpDesc, persist, select, showPage, showRepo, skillByline, sortList, state, std, total, twinText, vscode } from './core';
import { el, fmtDate, icon, iconBtn, logo } from './dom';
import { hideHover, hover, placeCard } from './hover';
import { showKindPage } from './kind-page';
import { render } from './main';
import { splitDescription } from './refs';
import { sessionDesc, sessionIcon, showSession, showSessionsPage } from './sessions';
import { groupHead, rowName } from './tables';

// One toggle per list view in a category header: the grouping first, then each sort.
const VIEW_MODES = {
  where: ['list-tree', 'Group by where it lives'],
  origin: ['plug', 'Group by source'],
  loading: ['law', 'Group by when it loads'],
  event: ['zap', 'Group by event'],
  marketplace: ['list-tree', 'Group by marketplace'],
  name: ['case-sensitive', 'Sort by name'],
  recent: ['history', 'Sort by last change'],
  status: ['pulse', 'Sort by status'],
  state: ['pass', 'Sort by enabled state'],
};

export function renderCategories(list, view, q, nested) {
  for (const cat of view.categories) {
    const lv = LIST_VIEWS[cat.kind];
    const groups = lv && isGrouped(cat.kind) ? groupItems(cat.kind, cat.items.filter(a => matches(a, q))) : [];
    const items = groups.length ? groups.flatMap(g => g[1]) : sortList(cat.kind, cat.items.filter(a => matches(a, q)));
    if (!items.length && (q || nested)) continue;
    const key = `${view.id}|${cat.kind}`;
    const collapsed = !state.expanded.has(key) && !q;
    const current = !state.detail && state.page === 'kind' && state.kindPage && state.kindPage.kind === cat.kind && state.kindPage.origin === view.id;
    list.append(
      el(
        'div',
        {
          className: `section-head${nested ? ' nested' : ''}${current ? ' selected' : ''}`,
          title: `Search and filter the ${cat.label.toLowerCase()}`,
          onclick: () => showKindPage(cat.kind, view.id),
        },
        el(
          'span',
          {
            className: 'twistie',
            title: collapsed ? 'Expand' : 'Collapse',
            onclick: e => {
              e.stopPropagation();
              collapsed ? state.expanded.add(key) : state.expanded.delete(key);
              persist();
              render();
            },
          },
          icon(collapsed ? 'chevron-right' : 'chevron-down')
        ),
        el('span', { className: 'label' }, cat.label),
        lv && !collapsed && items.length > 1 && (groups.length > 1 || !isGrouped(cat.kind) || Object.keys(lv.groupings).length > 1)
          ? el(
              'span',
              { className: 'view-modes', role: 'group', 'aria-label': 'View' },
              listModes(cat.kind).map(k => {
                const on = listMode(cat.kind) === k;
                const [glyph, title] = VIEW_MODES[k] || ['list-flat', k];
                const b = iconBtn(glyph, title, e => {
                  e.stopPropagation();
                  state.listViews[cat.kind] = k;
                  persist();
                  render();
                });
                b.classList.add('toggle');
                if (on) b.classList.add('active');
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
                return b;
              })
            )
          : null,
        cat.kind === 'mcp' && view.id === 'global'
          ? iconBtn('link-external', 'Add a connector on claude.ai', e => {
              e.stopPropagation();
              command('openConnectors');
            })
          : null,
        cat.kind === 'mcp' || cat.kind === 'plugin'
          ? iconBtn('add', cat.kind === 'mcp' ? 'Add MCP Server...' : 'Install Plugin...', e => {
              e.stopPropagation();
              command(cat.kind === 'mcp' ? 'addMcp' : 'installPlugin', { scope: view.id });
            })
          : null,
        cat.creatable
          ? iconBtn('add', `New ${cat.label}`, e => {
              e.stopPropagation();
              command('create', { kind: cat.kind, scope: view.id });
            })
          : null,
        el('span', { className: 'count' }, items.length)
      )
    );
    if (collapsed) continue;
    if (!items.length) list.append(el('div', { className: 'empty' }, 'None'));
    const row = a => {
      const selected = state.detail && state.detail.asset.id === a.id;
      const glyph = a.kind === 'plugin' ? (a.enabled ? 'pass-filled' : 'circle-large-outline') : a.kind === 'mcp' && SOURCES[a.source] ? SOURCES[a.source].icon : cat.icon;
      const off = (a.kind === 'plugin' || a.kind === 'mcp') && a.enabled === false;
      const twin = twinText(a);
      const desc = a.kind === 'mcp' ? [twin && `duplicate of ${twin}`, mcpDesc(a)].filter(Boolean).join(' · ') : a.kind === 'skill' ? skillByline(a) : assetDesc(a);
      return el(
        'div',
        {
          className: `row${nested ? ' nested' : ''}${groups.length > 1 ? ' in-group' : ''}${selected ? ' selected' : ''}${off ? ' disabled' : ''}`,
          title: ['skill', 'agent', 'command'].includes(a.kind) ? [labelOf(a), splitDescription(a.description || '').text].filter(Boolean).join('\n') : desc,
          onclick: () => select(a.id),
        },
        icon(glyph),
        el('span', { className: 'name' }, groups.length > 1 && a.kind === 'plugin' ? rowName(a) : labelOf(a)),
        desc ? el('span', { className: `desc${twin ? ' warn' : ''}` }, desc) : null
      );
    };
    if (groups.length < 2) {
      list.append(...items.map(row));
      continue;
    }
    // One collapsible header per group; a search opens every group so no hit hides.
    for (const [[id, label, glyph], members] of groups) {
      const foldKey = `${key}|${id}`;
      const folded = state.foldedGroups.has(foldKey) && !q;
      list.append(groupHead(`origin-head${nested ? ' nested' : ''}`, foldKey, folded, glyph, label, members.length, render));
      if (!folded) list.append(...members.map(row));
    }
  }
}

export const DAY = 864e5;

export const startOfDay = () => new Date(new Date().toDateString()).getTime();

// [id, label, glyph, test on a start time]; a session lands in the first group that takes it.
export const SESSION_DAYS = [
  ['today', 'Today', 'calendar', t => t >= startOfDay()],
  ['yesterday', 'Yesterday', 'calendar', t => t >= startOfDay() - DAY],
  ['week', 'Previous 7 days', 'calendar', t => t >= startOfDay() - 7 * DAY],
  ['earlier', 'Earlier', 'history', () => true],
];

export function renderSessionsNode(list, view, q) {
  const sessions = state.sessions[view.id];
  if (sessions === undefined) {
    state.sessions[view.id] = null;
    vscode.postMessage({ type: 'sessions', scope: view.id });
  }
  const all = (sessions || []).filter(s => !q || s.title.toLowerCase().includes(q));
  if (q && !all.length) return;
  const key = `${view.id}|sessions`;
  const collapsed = !state.expanded.has(key) && !q;
  const toggle = e => {
    e.stopPropagation();
    collapsed ? state.expanded.add(key) : state.expanded.delete(key);
    persist();
    render();
  };
  const current = !state.detail && state.page === 'sessions' && state.sessionsPage && state.sessionsPage.scope === view.id;
  list.append(
    el(
      'div',
      { className: `section-head nested${current ? ' selected' : ''}`, title: 'Search and filter the sessions', onclick: () => showSessionsPage(view.id) },
      el('span', { className: 'twistie', onclick: toggle, title: collapsed ? 'Expand' : 'Collapse' }, icon(collapsed ? 'chevron-right' : 'chevron-down')),
      el('span', { className: 'label' }, 'Sessions'),
      iconBtn('desktop-download', 'Import a session transcript', e => {
        e.stopPropagation();
        vscode.postMessage({ type: 'importSession', scope: view.id });
      }),
      iconBtn('search', 'Search sessions', e => {
        e.stopPropagation();
        showSessionsPage(view.id);
      }),
      el('span', { className: 'count' }, sessions ? all.length : '...')
    )
  );
  if (collapsed) return;
  if (!sessions || !all.length) {
    list.append(el('div', { className: 'empty' }, sessions ? 'None' : 'Reading the sessions...'));
    return;
  }
  const shown = state.allSessions.has(view.id) || q ? all : all.slice(0, 10);
  const dayOf = s => SESSION_DAYS.find(d => d[3](s.start || 0))[0];
  const groups = SESSION_DAYS.map(([id, label, glyph]) => [[id, label, glyph], shown.filter(s => dayOf(s) === id)]).filter(g => g[1].length);
  const row = s => {
    const selected = !state.detail && state.page === 'session' && state.session && state.session.id === s.id;
    return el(
      'div',
      { className: `row nested${groups.length > 1 ? ' in-group' : ''}${selected ? ' selected' : ''}`, title: `${s.title}\n${sessionDesc(s)}`, onclick: () => showSession(view.id, s.id) },
      sessionIcon(s),
      el('span', { className: 'name' }, s.title),
      el('span', { className: 'desc' }, sessionDesc(s))
    );
  };
  // Sessions fold by day, newest first, the way a chat history does.
  if (groups.length < 2) list.append(...shown.map(row));
  else
    for (const [[id, label, glyph], members] of groups) {
      const foldKey = `${key}|${id}`;
      const folded = state.foldedGroups.has(foldKey) && !q;
      list.append(groupHead('origin-head nested', foldKey, folded, glyph, label, members.length, render));
      if (!folded) list.append(...members.map(row));
    }
  if (all.length > shown.length)
    list.append(
      el(
        'div',
        {
          className: 'row nested',
          onclick: () => {
            state.allSessions.add(view.id);
            render();
          },
        },
        icon('ellipsis'),
        el('span', { className: 'name' }, `Show all ${all.length} sessions`)
      )
    );
}

export function renderSidebar() {
  const q = state.filter.toLowerCase();
  const list = el('div', { className: 'list', onscroll: hideHover });
  const [global, ...repos] = state.views;
  if (global) {
    const block = el('div', { className: 'scope-block' });
    renderCategories(block, global, q, false);
    list.append(block);
  }
  const visibleRepos = repos
    .filter(v => !q || v.categories.some(c => c.items.some(a => matches(a, q))))
    .sort((a, b) => Number(!!b.local) - Number(!!a.local) || (state.repoSort === 'recent' ? (b.lastUsed || 0) - (a.lastUsed || 0) : 0) || a.label.localeCompare(b.label));
  const sortToggle = (id, glyph, title) =>
    el(
      'button',
      {
        className: `icon-btn toggle${state.repoSort === id ? ' active' : ''}`,
        title,
        'aria-label': title,
        'aria-pressed': state.repoSort === id ? 'true' : 'false',
        onclick: () => {
          if (state.repoSort === id) return;
          state.repoSort = id;
          persist();
          app.querySelector('.sidebar').replaceWith(renderSidebar());
        },
      },
      icon(glyph)
    );
  list.append(
    el(
      'div',
      { className: 'scope-head' },
      el('span', { className: 'label' }, 'Repositories'),
      sortToggle('recent', 'history', 'Sort by last used'),
      sortToggle('name', 'case-sensitive', 'Sort A-Z'),
      iconBtn('repo-create', 'Add Repo...', () => command('addRepo')),
      iconBtn('trash', 'Remove Repo...', () => command('removeRepo')),
      el('span', { className: 'count' }, visibleRepos.length)
    )
  );
  visibleRepos.forEach((view, i) => {
    if (i > 0 && visibleRepos[i - 1].local && !view.local) list.append(el('div', { className: 'repo-separator' }));
    const open = state.openRepos.has(view.id) || !!q;
    const count = q ? view.categories.reduce((n, c) => n + c.items.filter(a => matches(a, q)).length, 0) : total(view);
    list.append(
      el(
        'div',
        {
          className: `repo-head${!state.detail && state.repo === view.id ? ' selected' : ''}`,
          'aria-label': `${view.label}, ${view.path}`,
          onclick: () => {
            hideHover();
            open ? state.openRepos.delete(view.id) : state.openRepos.add(view.id);
            persist();
            showRepo(view.id);
          },
          onmouseenter: e => {
            clearTimeout(state.repoHoverTimer);
            const at = { x: e.clientX, y: e.clientY };
            state.repoHoverAt = at;
            state.repoHoverTimer = setTimeout(() => placeCard(`repo:${view.id}`, () => repoCard(view), state.repoHoverAt), 350);
          },
          onmousemove: e => {
            state.repoHoverAt = { x: e.clientX, y: e.clientY };
            if (hover && hover.dataset.key === `repo:${view.id}` && hover.classList.contains('show')) placeCard(`repo:${view.id}`, () => repoCard(view), state.repoHoverAt);
          },
          onmouseleave: () => {
            clearTimeout(state.repoHoverTimer);
            hideHover();
          },
        },
        icon(open ? 'chevron-down' : 'chevron-right'),
        icon('repo'),
        el('span', { className: 'label' }, view.label),
        checkBadge(state.checks[view.id]) || el('span', { className: 'check-badge', 'aria-hidden': 'true' }),
        iconBtn('terminal', `Open Claude in ${view.label}`, e => {
          e.stopPropagation();
          command('openClaude', { scope: view.id });
        }),
        iconBtn('add', `New in ${view.label}`, e => {
          e.stopPropagation();
          command('create', { scope: view.id });
        }),
        el('span', { className: 'count' }, count)
      )
    );
    if (open) {
      renderSessionsNode(list, view, q);
      renderCategories(list, view, q, true);
    }
  });
  const search = el('input', {
    type: 'search',
    placeholder: 'Search the harness',
    value: state.filter,
    oninput: e => {
      state.filter = e.target.value;
      persist();
      const sidebar = app.querySelector('.sidebar');
      sidebar.replaceWith(renderSidebar());
      const input = app.querySelector('.search input');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
  });
  return el(
    'aside',
    { className: 'sidebar' },
    el(
      'div',
      { className: 'sidebar-head' },
      logo('logo-sm'),
      el('span', {}, 'Claude Harness'),
      el('span', { className: 'spacer' }),
      iconBtn('home', 'Overview', () => showRepo(undefined)),
      iconBtn('dashboard', 'Fleet overview', () => showPage('fleet')),
      iconBtn('package', 'Marketplace health', () => showPage('marketplaces')),
      iconBtn('add', 'New...', () => command('create')),
      iconBtn('refresh', 'Refresh', () => command('refresh'))
    ),
    el('div', { className: 'search' }, search),
    list
  );
}

export const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(t);
};

export function repoCard(view) {
  const c = state.checks[view.id];
  const s = std();
  const sessions = state.sessions[view.id];
  if (sessions === undefined) {
    state.sessions[view.id] = null;
    vscode.postMessage({ type: 'sessions', scope: view.id });
  }
  const cats = view.categories.filter(cat => cat.items.length);
  const tone = !c ? 'muted' : c.state === 'pass' ? 'ok' : c.state === 'fail' || c.state === 'error' ? 'bad' : c.state === 'review' ? 'warn' : 'muted';
  const latest = sessions && sessions[0];
  const running = sessions ? sessions.filter(x => x.live).length : 0;
  const agentCount = sessions ? sessions.reduce((n, x) => n + x.agents, 0) : 0;
  return el(
    'div',
    { className: 'hc' },
    el(
      'div',
      { className: 'hc-head' },
      icon('repo'),
      el('span', { className: 'hc-type' }, view.label),
      view.local ? el('span', { className: 'hc-name' }, 'this workspace') : null,
      el('span', { className: 'hc-spacer' }),
      s && c && c.state !== 'unchecked' ? el('span', { className: `hc-pill ${tone}` }, checkText(c)) : null
    ),
    el('div', { className: 'hc-path' }, view.path),
    cats.length
      ? el(
          'div',
          { className: 'hc-grid' },
          cats.map(cat => el('div', { className: 'hc-stat' }, el('span', { className: 'hc-k' }, cat.label), el('span', { className: 'hc-v' }, String(cat.items.length))))
        )
      : el('div', { className: 'hc-text muted' }, 'No harness files yet.'),
    el(
      'div',
      { className: 'hc-sec' },
      el('div', { className: 'hc-label' }, 'Sessions'),
      !sessions
        ? el('div', { className: 'hc-text muted' }, 'Reading the sessions...')
        : !sessions.length
          ? el('div', { className: 'hc-text muted' }, 'No Claude Code session ran here yet.')
          : [
              el('div', { className: 'hc-text' }, [`${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`, `${agentCount} agents`, running ? `${running} running now` : `last ${ago(latest.end)}`].join(' · ')),
              el('div', { className: 'hc-text clamp-3' }, `Latest: ${latest.title}`),
            ]
    ),
    s && c && c.findings && c.findings.length
      ? el(
          'div',
          { className: 'hc-sec' },
          el('div', { className: 'hc-label' }, 'Harness standard'),
          el('div', { className: 'hc-text clamp-3' }, c.findings.slice(0, 3).map(f => f.text.replace(/^(FAIL|REVIEW|INFO) /, '')).join(' · '))
        )
      : null,
    el('div', { className: 'hc-foot' }, el('span', {}, `${cats.reduce((n, cat) => n + cat.items.length, 0)} harness items`), el('span', {}, 'Click to open the repo page'))
  );
}
