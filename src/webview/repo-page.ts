// @ts-nocheck
// The repo page and its tabs.
import { standardCard } from './standard-card';
import { agentColorClass, app, checkBadge, checkText, command, kindLabel, metaOf, openAt, persist, showPage, state, std, total, vscode } from './core';
import { slugOf } from './week';
import { aiGroup, el, fmtAgo, fmtDate, fmtNum, icon, iconBtn, plural, pressable, shortModel, tailPath } from './dom';
import { hideHover, placeCard, tabTip } from './hover';
import { showKindPage } from './kind-page';
import { renderMain } from './main';
import { BILLING, fmtShare, fmtUsd } from './session-page';
import { renderSessionList, showSessionsPage } from './sessions';
import { assetTable, gridTable } from './tables';
import { failureText, failuresByHook, notLoaded } from '../shared/harness-trace';
import { repoTraceOf } from './trace';

// A hook's settings file as the shared Origin token: global, repo or marketplace (the plugin's own hooks).
const hookOrigin = source => (String(source).startsWith('~') ? 'global' : /^\.claude[\\/]/.test(source) ? 'repo' : 'marketplace');

// Repo page: three tabs, the way the session page splits its delegation views.
export const REPO_TABS = [
  ['overview', 'Overview', 'dashboard', 'What the repo adds to the harness, how much of it every session loads, and what changed last.'],
  ['effective', 'Effective harness', 'layers', 'What a session here loads: memory with its imports, rules, plugins and hooks.'],
  ['sessions', 'Sessions', 'history', 'Every Claude Code session that ran in this repo.'],
  ['models', 'Models', 'chip', 'Tokens and cost by model over the last 7 days, all repos of each account.'],
];

export function tabBar(tabs, current, pick, label) {
  const bar = el('div', { className: 'view-tabs', role: 'tablist', 'aria-label': label });
  bar.append(
    ...tabs.map(([id, text, glyph, about, count]) => {
      const on = id === current;
      const tip = target => {
        const r = target.getBoundingClientRect();
        placeCard(`tab:${id}`, () => tabTip(text, glyph, about), { x: r.left - 14, y: r.bottom - 6 });
      };
      return el(
        'button',
        {
          className: `view-tab${on ? ' active' : ''}`,
          role: 'tab',
          'aria-selected': on ? 'true' : 'false',
          tabindex: on ? '0' : '-1',
          'aria-description': about,
          onclick: () => pick(id),
          onmouseenter: e => tip(e.currentTarget),
          onmouseleave: hideHover,
          onfocus: e => tip(e.currentTarget),
          onblur: hideHover,
        },
        icon(glyph),
        el('span', {}, text),
        count === undefined ? null : el('span', { className: 'tab-count' }, count)
      );
    })
  );
  bar.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.findIndex(t => t[0] === current);
    pick(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0], true);
  });
  return bar;
}

export const memoryCount = node => (node.exists ? 1 : 0) + node.imports.reduce((n, c) => n + memoryCount(c), 0);

export function repoOverview(view, pick) {
  const sessions = state.sessions[view.id];
  const eff = state.effective[view.id];
  if (eff === undefined) {
    state.effective[view.id] = null;
    vscode.postMessage({ type: 'effective', scope: view.id });
  }
  const entries = view.categories.flatMap(c => c.items.map(a => ({ a, v: view })));
  const copies = entries.filter(e => (e.a.copies || []).length);
  const identical = copies.filter(e => e.a.copies.some(c => c.same)).length;
  const latest = sessions && sessions.length ? Math.max(...sessions.map(s => s.start || 0)) : 0;
  const launched = sessions ? sessions.reduce((n, s) => n + (s.agents || 0), 0) : 0;
  const delegating = sessions ? sessions.filter(s => s.agents > 0).length : 0;
  const e = eff && eff.effective;
  const memory = e ? e.memory.reduce((n, m) => n + memoryCount(m), 0) : 0;
  const always = e ? e.rules.filter(r => r.always).length : 0;
  const kpi = (n, label, glyph, note, open) =>
    el(
      'div',
      Object.assign({ className: `tile${open ? '' : ' static'}` }, open ? pressable(open) : {}),
      el('span', { className: 'n' }, n),
      el('span', { className: 'l' }, icon(glyph), label),
      el('span', { className: 'kpi-note' }, note)
    );
  const recent = [...entries].sort((x, y) => y.a.mtime - x.a.mtime).slice(0, 10);
  return [
    el(
      'div',
      { className: 'kpis' },
      kpi(sessions ? String(sessions.length) : '...', 'Sessions', 'history', sessions ? (latest ? `last ${fmtAgo(latest)}` : 'none yet') : 'reading...', () => pick('sessions')),
      kpi(sessions ? String(launched) : '...', 'Agents launched', 'type-hierarchy-sub', sessions ? `in ${delegating} of ${plural(sessions.length, 'session')}` : 'reading...'),
      kpi(e ? String(memory + always) : '...', 'Always loaded', 'layers', e ? `${plural(memory, 'memory file')}, ${plural(always, 'rule')}` : 'reading...', () => pick('effective')),
      kpi(String(copies.length), 'Copies', 'files', copies.length ? `${identical} identical to another scope` : 'none shared')
    ),
    el(
      'div',
      { className: 'recent' },
      el('div', { className: 'group-label' }, 'Harness'),
      el(
        'div',
        { className: 'overview compact' },
        view.categories.map(c =>
          el(
            'div',
            Object.assign({ className: `tile${c.items.length ? '' : ' zero'}`, title: `Search and filter the ${c.label.toLowerCase()} of ${view.label}` }, pressable(() => showKindPage(c.kind, view.id))),
            el('span', { className: 'n' }, c.items.length),
            el('span', { className: 'l' }, icon(c.icon), c.label)
          )
        )
      )
    ),
    recent.length
      ? el('div', { className: 'recent' }, el('div', { className: 'group-label' }, 'Recently changed'), assetTable(recent, [['Type', 96, a => kindLabel(a.kind)]], '', 'Recently changed'))
      : null,
    std() ? renderStandard(view) : null,
  ];
}

export function repoSessions(view) {
  return [
    el('div', { className: 'toolbar' }, el('button', { className: 'secondary', onclick: () => showSessionsPage(view.id) }, icon('search'), 'Search and filter')),
    renderSessionList(view),
  ];
}

// The last 7 days of each account by model, over all repos. A plan shows the cost as a share of its estimated weekly limit.
export function repoModels(view) {
  const totals = state.weekly;
  if (totals === undefined) {
    state.weekly = null;
    vscode.postMessage({ type: 'weekly' });
  }
  if (!totals) return el('div', { className: 'empty flush' }, 'Reading the last 7 days...');
  const agentDefs = state.views.flatMap(v => v.categories.filter(c => c.kind === 'agent').flatMap(c => c.items));
  return totals.flatMap(t => {
    const plan = BILLING.find(b => b[0] === t.plan);
    const head = [t.account, plan ? plan[1] : '', `${fmtNum(t.tokens)} tokens`, fmtUsd(t.cost), t.limit ? `${fmtShare(t.cost, t.limit)} of the weekly limit` : ''].filter(Boolean).join(' · ');
    const span = t.fromReset ? `Since ${fmtDate(t.since)}` : 'Last 7 days';
    const mine = view && (t.repos || []).find(r => r.folder.toLowerCase() === slugOf(view));
    // One table per grouping, the same columns in each: tokens, cost, the share of the weekly limit when the plan has one, and the count.
    const usage = (name, rows, count, label) =>
      gridTable(
        [
          { head: name, track: 'minmax(96px, 3fr)', cls: 'at-name', cell: r => r.name, title: r => r.title },
          { head: 'Tokens', track: '72px', num: true, wide: true, cell: r => fmtNum(r.tokens) },
          { head: 'Cost', track: '72px', num: true, cell: r => fmtUsd(r.cost) },
          t.limit ? { head: 'Of limit', track: '72px', num: true, cell: r => fmtShare(r.cost, t.limit) } : null,
          { head: count, track: '76px', num: true, cell: r => String(r.count) },
        ].filter(Boolean),
        rows,
        label
      );
    const repoRows = mine ? [{ name: [icon('repo'), el('span', { className: 'at-label' }, view.label)], title: `What sessions in ${view.label} and their agents used in this window.`, tokens: mine.tokens, cost: mine.cost, count: mine.messages }] : [];
    const modelRows = t.models.map(m => ({ name: [icon('chip'), el('span', { className: 'at-label' }, shortModel(m.model))], tokens: m.input + m.cacheCreate + m.cacheRead + m.output, cost: m.cost, count: m.messages }));
    const agentRows = (t.agents || []).map(a => {
      const def = agentDefs.find(d => d.name === a.type);
      const color = def ? agentColorClass(metaOf(def).color) : '';
      return { name: [icon('hubot'), color ? el('span', { className: `swatch ${color}` }) : null, el('span', { className: 'at-label' }, a.type)], tokens: a.tokens, cost: a.cost, count: a.launches };
    });
    const block = (label, tip, ...body) => el('div', { className: 'recent' }, el('div', { className: 'group-label', title: tip }, label), ...body);
    return [
      block(`${span} · ${head}`, `${span}, all repos and agents, at API list prices.${t.limit ? ' The limit is an estimate.' : ''}`, mine ? usage('Repo', repoRows, 'Replies', 'This repo') : null),
      block(
        'By model',
        'Every repo on this account, not only this one.',
        t.models.length ? usage('Model', modelRows, 'Replies', 'By model') : el('div', { className: 'empty flush' }, 'No usage in this window.'),
        (t.families || []).length
          ? gridTable(
              [
                { head: 'Model limit', track: 'minmax(160px, 3fr)', cls: 'at-name', cell: x => [icon('dashboard'), el('span', { className: 'at-label' }, `${x.family[0].toUpperCase()}${x.family.slice(1)}`)] },
                { head: 'Of its own limit', track: '120px', num: true, cell: x => fmtShare(x.cost, x.limit) },
              ],
              t.families,
              'Model limits'
            )
          : null
      ),
      agentRows.length ? block('By agent type', 'Agent transcripts by agent type, over every repo on this account. The main thread is not counted here.', usage('Agent type', agentRows, 'Launches', 'By agent type')) : null,
    ];
  });
}

export function renderRepo(view) {
  const tab = REPO_TABS.some(t => t[0] === state.repoTab) ? state.repoTab : 'overview';
  const sessions = state.sessions[view.id];
  if (sessions === undefined) {
    state.sessions[view.id] = null;
    vscode.postMessage({ type: 'sessions', scope: view.id });
  }
  const pick = (id, focus) => {
    state.repoTab = id;
    if (id === 'models') state.weekly = undefined;
    persist();
    hideHover();
    renderMain();
    const active = focus && app.querySelector('.main .view-tab.active');
    if (active) active.focus();
  };
  const tabs = REPO_TABS.map(t => (t[0] === 'sessions' && sessions ? [...t, sessions.length] : t));
  return el(
    'section',
    { className: 'main' },
    el(
      'header',
      { className: 'main-head' },
      el('span', { className: 'big' }, icon('repo')),
      el('div', { className: 'title' }, el('h1', {}, view.label), el('div', { className: 'path meta', title: view.path }, `${plural(total(view), 'asset')} · ${tailPath(view.path)}`)),
      el(
        'div',
        { className: 'toolbar' },
        std() ? iconBtn('checklist', 'Check against the harness standard', () => command('checkRepos', { scope: view.id })) : null,
        aiGroup('', std('align') ? iconBtn('markdown', 'Align CLAUDE.md with Claude...', () => command('alignClaudeMd', { scope: view.id })) : null),
        std('fix') ? iconBtn('wrench', 'Fix settings and hooks...', () => command('fixSettings', { scope: view.id })) : null,
        std('scaffold') ? iconBtn('new-folder', 'Scaffold repo harness...', () => showPage('init', view.path)) : null,
        iconBtn('add', `New in ${view.label}`, () => command('create', { scope: view.id })),
        iconBtn('trash', `Remove ${view.label} from the harness`, () => {
          state.repo = undefined;
          command('removeRepo', { id: view.id });
        })
      )
    ),
    el(
      'div',
      { className: 'main-body', onscroll: hideHover },
      tabBar(tabs, tab, pick, `${view.label} views`),
      tab === 'effective' ? renderEffective(view) : tab === 'sessions' ? repoSessions(view) : tab === 'models' ? repoModels(view) : repoOverview(view, pick)
    )
  );
}

export const LEVEL_ICONS = { FAIL: 'error', REVIEW: 'warning', INFO: 'info' };

export const renderStandard = view => standardCard(view);

export const memoryList = (node, depth) => [{ node, depth }, ...node.imports.flatMap(n => memoryList(n, depth + 1))];

export const indent = depth => {
  const node = el('span', { className: 'at-indent', 'aria-hidden': 'true' });
  node.style.setProperty('--depth', depth);
  return node;
};

// A file of the effective harness as one token: relative to the repo, or `~/.claude/...` for the user's own; the full path is the hover.
export const relFile = (view, file) => {
  const f = String(file).replace(/\\/g, '/');
  const base = String(view.path).replace(/\\/g, '/').replace(/\/$/, '');
  if (f.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return f.slice(base.length + 1);
  const i = f.indexOf('/.claude/');
  return i >= 0 ? `~${f.slice(i)}` : f;
};

export const section = (label, body) => el('div', { className: 'recent' }, el('div', { className: 'group-label' }, label), body);

export function renderEffective(view) {
  const eff = state.effective[view.id];
  if (eff === undefined) {
    state.effective[view.id] = null;
    vscode.postMessage({ type: 'effective', scope: view.id });
  }
  if (!eff) return el('div', { className: 'empty flush' }, 'Reading what a session here loads...');
  const e = eff.effective;
  // What the newest session here really did: the files it loaded and the hooks that failed in recent sessions.
  const trace = repoTraceOf(view.id);
  const loaded = trace && trace.loaded;
  const memoryFiles = e.memory.flatMap(n => memoryList(n, 0)).filter(r => r.node.exists).map(r => r.node.file);
  const missing = loaded ? notLoaded([...memoryFiles, ...e.rules.filter(r => r.always).map(r => r.file)], loaded) : new Set();
  const loadedCol = (file, applies) => ({ head: 'Last session', track: '96px', muted: true, cell: r => (!applies(r) ? '' : missing.has(file(r)) ? el('span', { className: 'warn' }, icon('warning'), 'not loaded') : 'loaded'), title: r => (applies(r) && missing.has(file(r)) ? 'Declared here, but the last session in this repo did not load it.' : '') });
  const name = (glyph, text, depth, title) => ({ head: 'Name', track: 'minmax(160px, 1.2fr)', cls: 'at-name', cell: r => [indent(depth ? depth(r) : 0), icon(glyph(r)), el('span', { className: 'at-label' }, text(r))], title });
  const switchCol = (head, key) => ({ head, track: '64px', muted: true, cell: p => (p[key] === undefined ? '' : p[key] ? 'on' : 'off') });
  const memory = e.memory.flatMap(n => memoryList(n, 0));
  const memoryTable = gridTable(
    [
      name(r => (r.depth ? 'arrow-small-right' : 'markdown'), r => r.node.label, r => r.depth, r => r.node.file),
      { head: 'Loaded as', track: '96px', muted: true, cell: r => (!r.node.exists ? 'not found' : r.depth ? 'import' : 'memory') },
      loaded ? loadedCol(r => r.node.file, r => r.node.exists) : null,
    ].filter(Boolean),
    memory.map(r => Object.assign({ open: r.node.exists ? () => openAt(r.node.file) : undefined, className: r.node.exists ? '' : 'disabled' }, r)),
    'Memory'
  );
  const rulesTable = gridTable(
    [
      name(r => (r.always ? 'law' : r.total ? 'filter' : 'warning'), r => r.name),
      { head: 'Loads', track: 'minmax(0, 2fr)', muted: true, wide: true, cell: r => (r.always ? 'always' : r.globs.map(g => g.glob).join(', ')), title: r => r.globs.map(g => g.glob).join('\n') },
      { head: 'Files', track: '72px', num: true, cell: r => (r.always ? '' : `${r.total}${e.capped ? '+' : ''}`) },
      { head: 'Origin', track: '92px', muted: true, cell: r => (r.scope === 'Global' ? 'global' : 'repo'), title: r => `Origin · ${r.scope === 'Global' ? 'Global' : 'Repo'}
${r.scope === 'Global' ? 'Authored in ~/.claude' : `Authored in ${r.scope}`}` },
      loaded ? loadedCol(r => r.file, r => r.always) : null,
    ].filter(Boolean),
    e.rules.map(r => Object.assign({ open: () => openAt(r.file) }, r)),
    'Rules'
  );
  const pluginsTable = gridTable(
    [
      name(p => (p.enabled ? 'pass-filled' : 'circle-large-outline'), p => p.key.split('@')[0]),
      { head: 'Marketplace', track: 'minmax(0, 1fr)', muted: true, wide: true, cell: p => p.key.split('@')[1] || '' },
      switchCol('User', 'user'),
      switchCol('Project', 'project'),
      switchCol('Local', 'local'),
      e.plugins.some(p => p.duplicate) ? { head: 'Note', track: '160px', muted: true, cls: 'warn', cell: p => (p.duplicate ? 'already on for the user' : '') } : null,
    ].filter(Boolean),
    e.plugins.map(p => Object.assign({ className: p.enabled ? '' : 'disabled' }, p)),
    'Plugins'
  );
  const failed = trace && trace.failures.length ? failuresByHook(e.hooks, trace.failures) : new Map();
  const hooksTable = gridTable(
    [
      name(h => (h.event === 'mod' ? 'extensions' : 'zap'), h => (h.matcher ? `${h.event} · ${h.matcher}` : h.event)),
      { head: 'Command', track: 'minmax(0, 2fr)', muted: true, wide: true, cell: h => h.command, title: h => h.command },
      { head: 'Origin', track: '92px', muted: true, cell: h => hookOrigin(h.source), title: h => `Origin · ${hookOrigin(h.source)}
${h.source}` },
      failed.size ? { head: 'Failures', track: '96px', num: true, cell: h => (failed.has(h.index) ? el('span', { className: 'bad' }, icon('error'), `${failed.get(h.index).reduce((n, f) => n + f.count, 0)}x`) : ''), title: h => (failed.has(h.index) ? `${failureText(failed.get(h.index))}\nin the last ${plural(trace.scanned, 'session')} with a failure` : '') } : null,
    ].filter(Boolean),
    e.hooks.map((h, index) => Object.assign({ index }, h)),
    'Hooks'
  );
  const on = e.plugins.filter(p => p.enabled).length;
  return [
    section(`Memory (${memory.filter(r => r.node.exists).length})`, memory.length ? memoryTable : el('div', { className: 'empty flush' }, 'No CLAUDE.md')),
    section(`Rules (${e.rules.length})`, e.rules.length ? rulesTable : el('div', { className: 'empty flush' }, 'No rules')),
    section(`Plugins (${on} on)`, e.plugins.length ? pluginsTable : el('div', { className: 'empty flush' }, 'No plugins')),
    section(`Hooks (${e.hooks.length})`, e.hooks.length ? hooksTable : el('div', { className: 'empty flush' }, 'No hooks')),
    trace && trace.session
      ? section(
          `Loaded by the last session${loaded ? ` (${loaded.length})` : ''}`,
          loaded
            ? loaded.length
              ? loaded.map(p => el('div', { className: 'row', title: p, onclick: () => openAt(p) }, icon('markdown'), el('span', { className: 'name' }, relFile(view, p))))
              : el('div', { className: 'empty flush' }, 'The last session loaded no memory or rule files.')
            : el('div', { className: 'empty flush' }, 'The last session recorded no loaded files.')
        )
      : null,
  ];
}
