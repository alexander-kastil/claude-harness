// @ts-nocheck
// The sidebar: global and repo categories, grouped lists, sessions, the repo hover card.
import { LIST_VIEWS, SOURCES, agentColorClass, app, assetDesc, checkBadge, checkText, command, groupItems, isGrouped, labelOf, listMode, listModes, matches, mcpDesc, mcpFailed, metaOf, persist, select, showPage, showRepo, skillByline, sortList, state, std, total, twinText, vscode } from './core';
import { repoContext, skillContext } from './context';
import { claudeMark, el, fmtDate, icon, iconBtn, logo } from './dom';
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

// ---- The nav is a keyboard tree: one Tab stop, arrows move, Left and Right fold, Enter opens, Space folds. ----

// The key of the item that last had focus: the tree's one Tab stop, and the item a repaint gives the focus back to.
let navKey;

// The selection the list was last scrolled to; a different one is scrolled into view, its section and group unfolded.
let revealedSig;

let fresh = false;

const selectionSig = () =>
  JSON.stringify([state.detail ? state.detail.asset.id : [state.page, state.repo, state.kindPage && state.kindPage.kind, state.kindPage && state.kindPage.origin, state.session && state.session.id, state.sessionsPage && state.sessionsPage.scope]]);

// `fold` toggles a head without opening anything; an item without one is toggled or opened by its click.
const treeItem = (node, key, level, expanded, fold) => {
  node.setAttribute('role', 'treeitem');
  node.setAttribute('tabindex', '-1');
  node.setAttribute('aria-level', String(level));
  if (expanded !== undefined) node.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  if (node.classList.contains('selected')) node.setAttribute('aria-selected', 'true');
  node.dataset.nav = key;
  if (fold) node.fold = fold;
  return node;
};

const navItems = list => [...list.querySelectorAll('[role=treeitem]')];

function wireTree(list) {
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Harness');
  const items = navItems(list);
  const stop = items.find(n => n.dataset.nav === navKey) || items.find(n => n.classList.contains('selected')) || items[0];
  // The buttons of a head are reached from the head itself, so the tree is one Tab stop plus the buttons of its current row.
  const roving = current => {
    items.forEach(n => n.setAttribute('tabindex', n === current ? '0' : '-1'));
    list.querySelectorAll('[role=treeitem] button').forEach(b => b.setAttribute('tabindex', current && current.contains(b) ? '0' : '-1'));
  };
  roving(undefined);
  if (stop) stop.setAttribute('tabindex', '0');
  list.addEventListener('focusin', e => {
    const item = e.target.closest && e.target.closest('[role=treeitem]');
    if (!item) return;
    navKey = item.dataset.nav;
    roving(item);
  });
  list.addEventListener('focusout', e => {
    if (!e.relatedTarget || !list.contains(e.relatedTarget)) roving(items.find(n => n.dataset.nav === navKey) || stop);
  });
  list.addEventListener('keydown', e => {
    const item = e.target;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !item.matches || !item.matches('[role=treeitem]')) return;
    const all = navItems(list);
    const i = all.indexOf(item);
    const level = Number(item.getAttribute('aria-level'));
    const open = item.getAttribute('aria-expanded');
    const fold = () => (item.fold ? item.fold() : item.click());
    const go = n => {
      if (!n) return;
      e.preventDefault();
      n.focus();
    };
    if (e.key === 'ArrowDown') go(all[i + 1]);
    else if (e.key === 'ArrowUp') go(all[i - 1]);
    else if (e.key === 'Home') go(all[0]);
    else if (e.key === 'End') go(all[all.length - 1]);
    else if (e.key === 'ArrowRight') {
      if (open === 'false') (e.preventDefault(), fold());
      else if (open === 'true' && all[i + 1] && Number(all[i + 1].getAttribute('aria-level')) > level) go(all[i + 1]);
    } else if (e.key === 'ArrowLeft') {
      if (open === 'true') (e.preventDefault(), fold());
      else go(all.slice(0, i).reverse().find(n => Number(n.getAttribute('aria-level')) < level));
    } else if (e.key === 'Enter') (e.preventDefault(), item.click());
    else if (e.key === ' ') (e.preventDefault(), open !== undefined && item.fold ? item.fold() : item.click());
  });
}

// A view menu for a header with many modes: one button, the modes in a small menu under it.
function viewMenu(cat, label) {
  const on = listMode(cat.kind);
  const modes = listModes(cat.kind);
  const button = iconBtn((VIEW_MODES[on] || ['list-flat'])[0], `View: ${(VIEW_MODES[on] || [0, on])[1]}`, e => {
    e.stopPropagation();
    const existing = document.querySelector('.nav-menu');
    if (existing) return void existing.remove();
    const r = button.getBoundingClientRect();
    const close = () => {
      menu.remove();
      document.removeEventListener('mousedown', outside, true);
    };
    const outside = ev => {
      if (!menu.contains(ev.target) && ev.target !== button && !button.contains(ev.target)) close();
    };
    const menu = el(
      'div',
      { className: 'nav-menu', role: 'menu', 'aria-label': `${label} view`, onkeydown: ev => {
        const rows = [...menu.querySelectorAll('button')];
        const at = rows.indexOf(document.activeElement);
        if (ev.key === 'Escape') (ev.preventDefault(), ev.stopPropagation(), close(), button.focus());
        else if (ev.key === 'ArrowDown') (ev.preventDefault(), rows[(at + 1) % rows.length].focus());
        else if (ev.key === 'ArrowUp') (ev.preventDefault(), rows[(at - 1 + rows.length) % rows.length].focus());
      } },
      modes.map(k => {
        const [glyph, title] = VIEW_MODES[k] || ['list-flat', k];
        const b = el('button', { type: 'button', className: `nav-menu-item${k === on ? ' active' : ''}`, role: 'menuitemradio', 'aria-checked': k === on ? 'true' : 'false', onclick: () => {
          close();
          state.listViews[cat.kind] = k;
          persist();
          render();
        } }, icon(glyph), el('span', {}, title));
        return b;
      })
    );
    document.body.append(menu);
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.min(r.bottom + 2, Math.max(8, window.innerHeight - menu.offsetHeight - 8))}px`;
    document.addEventListener('mousedown', outside, true);
    (menu.querySelector('.active') || menu.querySelector('button')).focus();
  });
  button.setAttribute('aria-haspopup', 'menu');
  return button;
}

export function renderCategories(list, view, q, nested) {
  for (const cat of view.categories) {
    const lv = LIST_VIEWS[cat.kind];
    const groups = lv && isGrouped(cat.kind) ? groupItems(cat.kind, cat.items.filter(a => matches(a, q))) : [];
    const items = groups.length ? groups.flatMap(g => g[1]) : sortList(cat.kind, cat.items.filter(a => matches(a, q)));
    if (!items.length && (q || nested)) continue;
    const key = `${view.id}|${cat.kind}`;
    const collapsed = !state.expanded.has(key) && !q;
    const current = !state.detail && state.page === 'kind' && state.kindPage && state.kindPage.kind === cat.kind && state.kindPage.origin === view.id;
    const base = nested ? 2 : 1;
    const fold = () => {
      collapsed ? state.expanded.add(key) : state.expanded.delete(key);
      persist();
      render();
    };
    const head = el(
        'div',
        {
          className: `section-head${nested ? ' nested' : ''}${current ? ' selected' : ''}`,
          title: collapsed ? 'Expand' : 'Collapse',
          onclick: () => {
            collapsed ? state.expanded.add(key) : state.expanded.delete(key);
            persist();
            // A global header also opens the page its overview tile opens.
            if (!nested && view.id === state.views[0]?.id) showKindPage(cat.kind, view.id);
            else render();
          },
        },
        el('span', { className: 'twistie' }, icon(collapsed ? 'chevron-right' : 'chevron-down')),
        el('span', { className: 'label' }, cat.label),
        lv && !collapsed && items.length > 1 && (groups.length > 1 || !isGrouped(cat.kind) || Object.keys(lv.groupings).length > 1)
          ? listModes(cat.kind).length > 3
            ? viewMenu(cat, cat.label)
            : el(
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
    );
    list.append(treeItem(head, `s|${key}`, base, !collapsed, fold));
    if (collapsed) continue;
    if (!items.length) list.append(el('div', { className: 'empty' }, 'None'));
    const row = a => {
      const selected = state.detail && state.detail.asset.id === a.id;
      const glyph = a.kind === 'plugin' ? (a.enabled ? 'pass-filled' : 'circle-large-outline') : a.kind === 'mcp' && SOURCES[a.source] ? SOURCES[a.source].icon : cat.icon;
      const off = (a.kind === 'plugin' || a.kind === 'mcp') && a.enabled === false;
      const twin = twinText(a);
      const desc = a.kind === 'mcp' ? [twin && `duplicate of ${twin}`, mcpDesc(a)].filter(Boolean).join(' · ') : a.kind === 'skill' ? skillByline(a) : assetDesc(a);
      return treeItem(
        el(
          'div',
          {
            className: `row${nested ? ' nested' : ''}${groups.length > 1 ? ' in-group' : ''}${selected ? ' selected' : ''}${off ? ' disabled' : ''}`,
            title: ['skill', 'agent', 'command'].includes(a.kind) ? [labelOf(a), splitDescription(a.description || '').text].filter(Boolean).join('\n') : desc,
            onclick: () => select(a.id),
            ...skillContext(a),
          },
          icon(glyph),
          el('span', { className: 'name' }, a.kind === 'agent' && agentColorClass(metaOf(a).color) ? el('span', { className: `swatch ${agentColorClass(metaOf(a).color)}` }) : null, groups.length > 1 && a.kind === 'plugin' ? rowName(a) : labelOf(a)),
          desc ? el('span', { className: `desc${twin ? ' warn' : ''}${a.kind === 'mcp' && mcpFailed(a) ? ' bad' : ''}` }, desc) : null
        ),
        `r|${a.id}`,
        base + 1 + (groups.length > 1 ? 1 : 0)
      );
    };
    if (groups.length < 2) {
      list.append(...items.map(row));
      continue;
    }
    // One collapsible header per group; a search opens every group so no hit hides.
    for (const [[id, label, glyph], members] of groups) {
      const foldKey = `${key}|${id}`;
      // The group that holds a freshly opened element unfolds, so its row can be scrolled to.
      if (fresh && state.detail && state.foldedGroups.has(foldKey) && members.some(a => a.id === state.detail.asset.id)) state.foldedGroups.delete(foldKey);
      const folded = state.foldedGroups.has(foldKey) && !q;
      list.append(treeItem(groupHead(`origin-head${nested ? ' nested' : ''}`, foldKey, folded, glyph, label, members.length, render), `g|${foldKey}`, base + 1, !folded));
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
  // A freshly opened session unfolds its Sessions row, shows all sessions if it is an older one, and unfolds its day.
  const opened = fresh && !state.detail && state.page === 'session' && state.session && state.session.scope === view.id ? all.findIndex(s => s.id === state.session.id) : -1;
  if (opened >= 0) {
    state.expanded.add(key);
    if (opened >= 10) state.allSessions.add(view.id);
  }
  const collapsed = !state.expanded.has(key) && !q;
  const toggle = () => {
    collapsed ? state.expanded.add(key) : state.expanded.delete(key);
    persist();
    render();
  };
  const current = !state.detail && state.page === 'sessions' && state.sessionsPage && state.sessionsPage.scope === view.id;
  list.append(
    treeItem(
      el(
        'div',
        { className: `section-head nested${current ? ' selected' : ''}`, title: collapsed ? 'Expand' : 'Collapse', onclick: toggle },
        el('span', { className: 'twistie' }, icon(collapsed ? 'chevron-right' : 'chevron-down')),
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
      ),
      `s|${key}`,
      2,
      !collapsed
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
    return treeItem(
      el(
        'div',
        { className: `row nested${groups.length > 1 ? ' in-group' : ''}${selected ? ' selected' : ''}`, title: `${s.title}\n${sessionDesc(s)}`, onclick: () => showSession(view.id, s.id) },
        sessionIcon(s),
        el('span', { className: 'name' }, s.title),
        el('span', { className: 'desc' }, sessionDesc(s))
      ),
      `x|${view.id}|${s.id}`,
      groups.length > 1 ? 4 : 3
    );
  };
  // Sessions fold by day, newest first, the way a chat history does.
  if (groups.length < 2) list.append(...shown.map(row));
  else
    for (const [[id, label, glyph], members] of groups) {
      const foldKey = `${key}|${id}`;
      if (opened >= 0 && state.foldedGroups.has(foldKey) && members.some(s => s.id === state.session.id)) state.foldedGroups.delete(foldKey);
      const folded = state.foldedGroups.has(foldKey) && !q;
      list.append(treeItem(groupHead('origin-head nested', foldKey, folded, glyph, label, members.length, render), `g|${foldKey}`, 3, !folded));
      if (!folded) list.append(...members.map(row));
    }
  if (all.length > shown.length)
    list.append(
      treeItem(
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
        ),
        `m|${view.id}`,
        3
      )
    );
}

// Scrolls the list so `row` is in view, below the sticky section head; a row out of view is centred.
const scrollToRow = (list, row) => {
  const a = row.getBoundingClientRect();
  const b = list.getBoundingClientRect();
  const top = b.top + 34;
  const bottom = b.bottom - 6;
  if (a.top >= top && a.bottom <= bottom) return;
  list.scrollTop += a.top - top - Math.max(0, (bottom - top - a.height) / 2);
};

export function renderSidebar() {
  const sig = selectionSig();
  const isFresh = sig !== revealedSig;
  fresh = isFresh;
  // Focus inside the tree survives the repaint: the new copy of the focused item takes it back.
  const focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.sidebar .list [data-nav]') : null;
  const refocus = focused && focused.dataset.nav;
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
    // A freshly opened session or repo page unfolds its repo; an opened element did so already.
    if (fresh && !state.detail && ((state.page === 'session' && state.session && state.session.scope === view.id) || (state.page === 'sessions' && state.sessionsPage && state.sessionsPage.scope === view.id))) state.openRepos.add(view.id);
    const open = state.openRepos.has(view.id) || !!q;
    const count = q ? view.categories.reduce((n, c) => n + c.items.filter(a => matches(a, q)).length, 0) : total(view);
    const head = el(
        'div',
        {
          className: `repo-head${!state.detail && state.repo === view.id ? ' selected' : ''}`,
          'aria-label': `${view.label}, ${view.path}`,
          ...repoContext(view),
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
        iconBtn(claudeMark(), `Open Claude in ${view.label}`, e => {
          e.stopPropagation();
          command('openClaude', { scope: view.id });
        }),
        iconBtn('add', `New in ${view.label}`, e => {
          e.stopPropagation();
          command('create', { scope: view.id });
        }),
        el('span', { className: 'count' }, count)
    );
    list.append(
      treeItem(head, `p|${view.id}`, 1, open, () => {
        open ? state.openRepos.delete(view.id) : state.openRepos.add(view.id);
        persist();
        render();
      })
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
  wireTree(list);
  const aside = el(
    'aside',
    { className: 'sidebar' },
    el(
      'div',
      { className: 'sidebar-head' },
      logo('logo-sm'),
      el('span', {}, 'Claude Harness'),
      el('span', { className: 'spacer' }),
      // Home opens the overview with a clean search; Back to it keeps the search.
      iconBtn('home', 'Overview', () => {
        state.overviewFilter = '';
        showRepo(undefined);
      }),
      iconBtn('dashboard', 'Fleet overview', () => showPage('fleet')),
      iconBtn('package', 'Marketplace health', () => showPage('marketplaces')),
      iconBtn('add', 'New...', () => command('create')),
      iconBtn('refresh', 'Refresh', () => command('refresh'))
    ),
    el('div', { className: 'search' }, search),
    list
  );
  // Once the repaint is in the page: the selected row scrolls into view, and the focus comes back.
  queueMicrotask(() => {
    if (app.querySelector('.sidebar') !== aside) return;
    if (isFresh) {
      const row = list.querySelector('.selected');
      if (row) {
        revealedSig = sig;
        scrollToRow(list, row);
      }
    }
    if (refocus && (!document.activeElement || document.activeElement === document.body)) {
      const again = navItems(list).find(n => n.dataset.nav === refocus) || list.querySelector('[role=treeitem][tabindex="0"]');
      if (again) again.focus({ preventScroll: true });
    }
  });
  return aside;
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
              el('div', { className: 'hc-text' }, [`${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`, (agentCount === 1 ? '1 agent' : `${agentCount} agents`), running ? `${running} running now` : `last ${ago(latest.end)}`].join(' · ')),
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
