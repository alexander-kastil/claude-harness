// @ts-nocheck
// The sidebar: global and repo categories, grouped lists, sessions, the repo hover card.
import { LIST_VIEWS, SOURCES, agentColorClass, app, checkBadge, checkText, command, groupItems, isGrouped, labelOf, listMode, listModes, matches, metaOf, persist, select, showMarket, showPage, showRepo, sortList, state, std, tidyError, total, vscode } from './core';
import { askCounted, bylineNodes } from './byline';
import { renderCoworkRegion } from './cowork';
import { repoContext, skillContext } from './context';
import { aiGroup, el, fmtDate, icon, iconBtn, logo, plural } from './dom';
import { hideHover, hover, placeCard } from './hover';
import { showKindPage } from './kind-page';
import { render } from './main';
import { SOURCE_ICONS, sourceTip } from './pages';
import { splitDescription } from './refs';
import { sessionDesc, sessionIcon, showSession, showSessionsPage } from './sessions';
import { groupHead, rowName } from './tables';
import { activeEntry, railCount, railEntries, revealEntry } from '../shared/nav-rail';

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
  JSON.stringify([state.detail ? state.detail.asset.id : [state.page, state.repo, state.kindPage && state.kindPage.kind, state.kindPage && state.kindPage.origin, state.session && state.session.id, state.sessionsPage && state.sessionsPage.scope, state.marketPage && state.marketPage.name, state.scheduledPage && state.scheduledPage.id, state.coworkChat && state.coworkChat.id]]);

// The global sections in reading order: what every session loads, what Claude calls, what runs on its own, and where packaged parts
// come from, which ends in the Marketplaces section. A kind not listed keeps its place after them.
const NAV_ORDER = ['memory', 'rule', 'settings', 'outputStyle', 'agent', 'skill', 'command', 'workflow', 'mcp', 'hook', 'mod', 'plugin'];
const navRank = kind => (NAV_ORDER.includes(kind) ? NAV_ORDER.indexOf(kind) : NAV_ORDER.length);
const inNavOrder = view => ({ ...view, categories: [...view.categories].sort((a, b) => navRank(a.kind) - navRank(b.kind)) });

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
        (cat.kind === 'mcp' || cat.kind === 'plugin') && view.id !== 'cowork'
          ? iconBtn('add', cat.kind === 'mcp' ? 'Add MCP server...' : 'Install plugin...', e => {
              e.stopPropagation();
              command(cat.kind === 'mcp' ? 'addMcp' : 'installPlugin', { scope: view.id });
            })
          : null,
        cat.creatable && view.id !== 'cowork'
          ? iconBtn('add', `New ${cat.label.replace(/s$/, '').toLowerCase()}`, e => {
              e.stopPropagation();
              command('create', { kind: cat.kind, scope: view.id });
            })
          : null,
        el('span', { className: 'count' }, items.length)
    );
    list.append(treeItem(head, `s|${key}`, base, !collapsed, fold));
    if (collapsed) continue;
    askCounted(cat.kind);
    if (!items.length) list.append(el('div', { className: 'empty' }, 'None'));
    const row = a => {
      const selected = state.detail && state.detail.asset.id === a.id;
      const glyph = a.kind === 'plugin' ? (view.id === 'cowork' ? 'extensions' : a.enabled ? 'pass-filled' : 'circle-large-outline') : a.kind === 'mcp' && SOURCES[a.source] ? SOURCES[a.source].icon : cat.icon;
      const off = (a.kind === 'plugin' || a.kind === 'mcp') && a.enabled === false;
      const desc = bylineNodes(a);
      return treeItem(
        el(
          'div',
          {
            className: `row${nested ? ' nested' : ''}${groups.length > 1 ? ' in-group' : ''}${selected ? ' selected' : ''}${off ? ' disabled' : ''}`,
            title: [labelOf(a), a.kind === 'mcp' ? tidyError(a.status) || a.target : splitDescription(a.description || '').text].filter(Boolean).join('\n'),
            onclick: () => select(a.id),
            ...skillContext(a),
          },
          icon(glyph),
          el('span', { className: 'name' }, a.kind === 'agent' && agentColorClass(metaOf(a).color) ? el('span', { className: `swatch ${agentColorClass(metaOf(a).color)}` }) : null, a.kind === 'plugin' ? rowName(a) : labelOf(a)),
          desc.length ? el('span', { className: 'desc' }, ...desc) : null
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

// The marketplaces Claude Code knows, under the global sections. The head folds and opens Marketplace health, the way a global head
// opens its type page; a row opens the marketplace's own page.
function renderMarketsNode(list, q) {
  if (state.markets === undefined) {
    state.markets = null;
    vscode.postMessage({ type: 'marketplaces' });
  }
  const all = (state.markets || []).filter(m => !q || m.name.toLowerCase().includes(q) || m.plugins.some(p => p.name.toLowerCase().includes(q)));
  if (q && !all.length) return;
  const key = 'markets';
  const collapsed = !state.expanded.has(key) && !q;
  const toggle = () => {
    collapsed ? state.expanded.add(key) : state.expanded.delete(key);
    persist();
  };
  const current = !state.detail && state.page === 'marketplaces';
  list.append(
    treeItem(
      el(
        'div',
        { className: `section-head${current ? ' selected' : ''}`, onclick: () => (toggle(), showPage('marketplaces')) },
        el('span', { className: 'twistie' }, icon(collapsed ? 'chevron-right' : 'chevron-down')),
        el('span', { className: 'label' }, 'Marketplaces'),
        el('span', { className: 'count' }, state.markets ? all.length : '...')
      ),
      's|markets',
      1,
      !collapsed,
      () => (toggle(), render())
    )
  );
  if (collapsed) return;
  if (!state.markets || !all.length) {
    list.append(el('div', { className: 'empty' }, state.markets ? 'None' : 'Reading the marketplaces...'));
    return;
  }
  list.append(
    ...all.map(m => {
      const selected = !state.detail && state.page === 'market' && state.marketPage && state.marketPage.name === m.name;
      const ahead = m.plugins.filter(p => p.ahead).length;
      return treeItem(
        el(
          'div',
          { className: `row${selected ? ' selected' : ''}`, title: `${m.name}\n${sourceTip(m)}`, onclick: () => showMarket(m.name) },
          icon(SOURCE_ICONS[m.kind] ?? 'package'),
          el('span', { className: 'name' }, m.name),
          el(
            'span',
            { className: 'desc' },
            el('span', { className: 'fact', title: `Plugins\n${m.kind === 'directory' ? 'Every plugin its catalog lists.' : 'The plugins installed or enabled from it.'}` }, plural(m.plugins.length, 'plugin')),
            ahead ? [' · ', el('span', { className: 'fact warn', title: `Updates\n${plural(ahead, 'plugin')} with a source ahead of the installed copy.` }, `${ahead} ahead`)] : null
          )
        ),
        `k|${m.name}`,
        2
      );
    })
  );
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
        { className: `section-head nested${current ? ' selected' : ''}`, onclick: toggle },
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
  const shown = state.allSessions.has(view.id) || q ? all : all.slice(0, state.lists.sessions);
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

// The head of one of the nav's three regions (Claude Code, Cowork, Repositories): chevron, glyph, title, its tools and count.
// A click on the head folds the whole region; a click on one of its buttons does not. Returns [folded, head].
function regionHead(key, glyph, label, title, tools, count) {
  const folded = state.foldedGroups.has(`region|${key}`) && !state.filter;
  const fold = () => {
    folded ? state.foldedGroups.delete(`region|${key}`) : state.foldedGroups.add(`region|${key}`);
    persist();
    render();
  };
  const head = el(
    'div',
    { className: 'scope-head', title, onclick: e => (e.target.closest('button') ? undefined : fold()) },
    icon(folded ? 'chevron-right' : 'chevron-down'),
    icon(glyph),
    el('span', { className: 'label' }, label),
    ...tools,
    el('span', { className: 'count' }, count)
  );
  head.dataset.region = key;
  return [folded, treeItem(head, `r|${key}`, 1, !folded, fold)];
}

// One button for the three regions: it folds them all while any is open, and opens them all otherwise. It writes the same
// fold state as a click on a region head.
function foldAllButton() {
  const keys = ['code', 'cowork', 'repos'].map(k => `region|${k}`);
  const present = keys.filter(k => k !== 'region|cowork' || (state.views.some(v => v.id === 'cowork') && state.coworkShow !== false));
  const anyOpen = present.some(k => !state.foldedGroups.has(k));
  return iconBtn(anyOpen ? 'collapse-all' : 'expand-all', anyOpen ? 'Collapse all' : 'Expand all', () => {
    for (const k of keys) anyOpen ? state.foldedGroups.add(k) : state.foldedGroups.delete(k);
    persist();
    render();
  });
}

// ---- The rail: the nav collapsed to 48px, one button per region and top-level group. ----

const NAV_ID = 'nav-pane';
const NAV_KEYS = 'Alt+Shift+B';

// The nav key an expand from the rail scrolls to once the full nav is repainted.
let railTarget;

const wide = window.matchMedia('(min-width: 641px)');

// The part that is not on show cannot take focus or be reached by Tab (`inert`). A stacked layout (a narrow panel) has no rail.
function syncRail(aside) {
  if (!aside) return;
  const on = state.navRail && wide.matches;
  aside.querySelector('.sidebar-full').toggleAttribute('inert', on);
  aside.querySelector('.rail').toggleAttribute('inert', !on);
}

// Collapses or expands the nav without a repaint, so the column width, the fade of the labels and the fade of the rail run as one
// CSS transition that a second press interrupts. Focus follows only when it was inside the part that goes away.
function setRail(next, byMouse) {
  const aside = app.querySelector('.sidebar');
  const hadFocus = aside && aside.contains(document.activeElement) && !byMouse;
  state.navRail = next;
  persist();
  hideHover();
  app.classList.add('rail-anim');
  app.classList.toggle('rail-on', next);
  syncRail(aside);
  document.querySelectorAll('.nav-toggle').forEach(b => b.setAttribute('aria-expanded', next ? 'false' : 'true'));
  if (aside && hadFocus && wide.matches) aside.querySelector(next ? '.rail .nav-toggle' : '.sidebar-full .nav-toggle').focus();
}

window.addEventListener('keydown', e => {
  if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyB') {
    e.preventDefault();
    setRail(!state.navRail);
  }
});
wide.addEventListener('change', () => syncRail(app.querySelector('.sidebar')));

// The collapse button of the top bar and the expand button of the rail: one control, `aria-expanded` says which way it goes.
const navToggle = collapsed => {
  const label = collapsed ? 'Expand navigation' : 'Collapse navigation';
  const b = iconBtn(collapsed ? 'layout-sidebar-left' : 'layout-sidebar-left-off', `${label}\n${NAV_KEYS}`, e => setRail(!collapsed, e.detail > 0));
  b.classList.add('nav-toggle');
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  b.setAttribute('aria-controls', NAV_ID);
  b.setAttribute('aria-keyshortcuts', 'Alt+Shift+B');
  return b;
};

// The top bar's buttons: the pages first, then the actions.
const topActions = () => [
  iconBtn('home', 'Overview', () => {
    state.overviewFilter = '';
    showRepo(undefined);
  }),
  iconBtn('package', 'Marketplace health', () => showPage('marketplaces')),
  foldAllButton(),
  iconBtn('add', 'New...', () => command('create')),
  iconBtn('refresh', 'Refresh', () => command('refresh')),
];

function railInput(global, cowork, visibleRepos) {
  const groups = (view, keep) => view.categories.filter(keep).map(c => ({ id: `${view.id}|${c.kind}`, label: c.label, glyph: c.icon, count: c.items.length }));
  const open = state.detail
    ? activeEntry({ kind: state.detail.asset.kind, scope: state.detail.asset.scope || 'global' })
    : state.page === 'kind' && state.kindPage
      ? activeEntry({ kind: state.kindPage.kind, scope: state.kindPage.origin })
      : state.page === 'marketplaces' || state.page === 'market'
        ? activeEntry({ market: true })
        : state.page === 'session' && state.session
          ? activeEntry({ scope: state.session.scope })
          : state.page === 'sessions' && state.sessionsPage
            ? activeEntry({ scope: state.sessionsPage.scope })
            : state.repo
              ? activeEntry({ repo: state.repo })
              : undefined;
  return {
    code: global ? { label: 'Claude Code', count: total(global), groups: [...groups(inNavOrder(global), () => true), { id: 'markets', label: 'Marketplaces', glyph: 'package', count: state.markets ? state.markets.length : 0 }] } : undefined,
    cowork: cowork ? { label: 'Cowork', count: total(cowork), groups: groups(cowork, c => c.items.length) } : undefined,
    repos: { label: 'Repositories', count: visibleRepos.length, repos: visibleRepos.map(v => ({ id: v.id, label: v.label, count: total(v) })) },
    active: open,
  };
}

function renderRail(input) {
  const entries = railEntries(input);
  const noun = e => (e.id === 'region:repos' ? plural(e.count, 'repository').replace(/^\d+ /, '') : plural(e.count, 'item').replace(/^\d+ /, ''));
  const button = e => {
    const b = el(
      'button',
      {
        type: 'button',
        className: `rail-btn${e.level === 0 ? ' region' : ''}${e.active ? ' active' : ''}`,
        title: `${e.label}\n${e.count} ${noun(e)}`,
        'aria-label': `${e.label}, ${e.count}`,
        'aria-current': e.active ? 'true' : undefined,
        onclick: () => {
          railTarget = revealEntry(e, state);
          setRail(false);
          render();
        },
      },
      icon(e.glyph),
      el('span', { className: 'rail-count', 'aria-hidden': 'true' }, railCount(e.count))
    );
    b.dataset.rail = e.id;
    return b;
  };
  const logoBtn = el('button', { type: 'button', className: 'icon-btn rail-logo', title: `Expand navigation\n${NAV_KEYS}`, 'aria-label': 'Expand navigation', 'aria-expanded': 'false', 'aria-controls': NAV_ID, onclick: e => setRail(false, e.detail > 0) }, logo('logo-sm'));
  const top = el('div', { className: 'rail-top' }, logoBtn, topActions(), navToggle(true));
  top.querySelectorAll('button').forEach((b, i) => (b.dataset.rail = `top${i}`));
  return el('nav', { className: 'rail', 'aria-label': 'Harness, collapsed' }, top, el('div', { className: 'rail-list' }, entries.map(button)));
}

export function renderSidebar() {
  const sig = selectionSig();
  const isFresh = sig !== revealedSig;
  fresh = isFresh;
  // Focus inside the tree survives the repaint: the new copy of the focused item takes it back.
  const focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.sidebar .list [data-nav]') : null;
  const refocus = focused && focused.dataset.nav;
  const q = state.filter.toLowerCase();
  const list = el('div', { className: 'list', onscroll: hideHover });
  const [global, ...others] = state.views;
  const repos = others.filter(v => v.id !== 'cowork');
  if (global) {
    const [folded, head] = regionHead('code', 'terminal', 'Claude Code', 'Claude Code\nWhat every Claude Code session loads and runs: memory, rules, agents, skills, plugins and the rest of the global harness.', [], total(global));
    list.append(head);
    if (!folded) {
      const block = el('div', { className: 'scope-block' });
      renderCategories(block, inNavOrder(global), q, false);
      renderMarketsNode(block, q);
      list.append(block);
    }
  }
  // Cowork is a region of its own between the Code tree and Repositories; the Cowork setting hides it from the nav alone.
  const cowork = others.find(v => v.id === 'cowork');
  const region = cowork && state.coworkShow !== false ? renderCoworkRegion(cowork, q, renderCategories, treeItem, render, regionHead) : null;
  if (region) list.append(region);
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
  const [reposFolded, reposHead] = regionHead(
    'repos',
    'github',
    'Repositories',
    '',
    [sortToggle('recent', 'history', 'Sort by last used'), sortToggle('name', 'case-sensitive', 'Sort A-Z'), iconBtn('repo-create', 'Add repo...', () => command('addRepo')), iconBtn('trash', 'Remove repo...', () => command('removeRepo'))],
    visibleRepos.length
  );
  reposHead.removeAttribute('title');
  list.append(reposHead);
  (reposFolded ? [] : visibleRepos).forEach((view, i) => {
    if (i > 0 && visibleRepos[i - 1].local && !view.local) list.append(el('div', { className: 'repo-separator' }));
    // A freshly opened session or repo page unfolds its repo; an opened element did so already.
    if (fresh && !state.detail && ((state.page === 'session' && state.session && state.session.scope === view.id) || (state.page === 'sessions' && state.sessionsPage && state.sessionsPage.scope === view.id))) state.openRepos.add(view.id);
    const open = state.openRepos.has(view.id) || !!q;
    const count = q ? view.categories.reduce((n, c) => n + c.items.filter(a => matches(a, q)).length, 0) : total(view);
    const head = el(
        'div',
        {
          className: `repo-head${!state.detail && state.repo === view.id ? ' selected' : ''}`,
          'aria-label': `${view.label} ${count}, ${view.path}`,
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
        aiGroup(
          'compact',
          iconBtn('terminal', `Open Claude in ${view.label}`, e => {
            e.stopPropagation();
            command('openClaude', { scope: view.id });
          })
        ),
        iconBtn('add', `New in ${view.label}`, e => {
          e.stopPropagation();
          command('create', { scope: view.id });
        }),
        ' ',
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
  const railFocus = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.rail [data-rail]') : null;
  const refocusRail = railFocus && railFocus.dataset.rail;
  const rail = renderRail(railInput(global, cowork && state.coworkShow !== false ? cowork : undefined, visibleRepos));
  const aside = el(
    'aside',
    { className: 'sidebar', id: NAV_ID },
    el(
      'div',
      { className: 'sidebar-full' },
      el(
        'div',
        { className: 'sidebar-head' },
        // The tab already says Claude Harness, so the row holds the mark and the buttons.
        logo('logo-sm'),
        el('span', { className: 'spacer' }),
        // The pages first, in the nav's order from top to bottom (the overview, the Marketplaces section, the Repositories), then the
        // actions. Home opens the overview with a clean search; Back to it keeps the search. The collapse button ends the row.
        ...topActions(),
        navToggle(false)
      ),
      el('div', { className: 'search' }, search),
      list
    ),
    rail
  );
  app.classList.toggle('rail-on', state.navRail);
  syncRail(aside);
  // Once the repaint is in the page: the selected row scrolls into view, and the focus comes back.
  queueMicrotask(() => {
    if (app.querySelector('.sidebar') !== aside) return;
    if (railTarget) {
      const target = navItems(list).find(n => n.dataset.nav === railTarget);
      railTarget = undefined;
      if (target) {
        scrollToRow(list, target);
        target.focus({ preventScroll: true });
      }
    } else if (refocusRail && (!document.activeElement || document.activeElement === document.body)) {
      const again = [...rail.querySelectorAll('[data-rail]')].find(b => b.dataset.rail === refocusRail);
      if (again && !rail.hasAttribute('inert')) again.focus({ preventScroll: true });
    }
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
    el('div', { className: 'hc-foot' }, el('span', {}, `${cats.reduce((n, cat) => n + cat.items.length, 0)} harness items`))
  );
}
