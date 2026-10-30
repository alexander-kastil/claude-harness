// @ts-nocheck
// GitHub Repo overview, marketplace health, a marketplace's page and the scaffold form.
import { checkBadge, checkText, command, persist, select, showPage, showRepo, state, std, vscode } from './core';
import { confirmAt } from './confirm';
import { aiGroup, countHead, el, icon, iconBtn, pageHead, plural } from './dom';
import { askDrawing, drawState, drawingFigure, drawingId, drawsWhat } from './drawing';
import { hideHover } from './hover';
import { renderMain } from './main';
import { syncMarket, syncPlugin } from './sync';
import { gridTable } from './tables';

export const liveCheck = r => state.checks[r.id] || { state: r.checkState };

export function renderRepoOverview() {
  const rows = state.repoOverview;
  const body = el('div', { className: 'main-body' });
  if (!rows) body.append(el('div', { className: 'empty flush' }, 'Reading the repos...'));
  else {
    const s = std();
    // What the old footnote explained now sits in each header's hover card.
    const from = s ? `Checked by ${s.name}` : '';
    const cols = [
      { head: 'Repo', track: 'minmax(140px, 2fr)', cls: 'at-name', cell: r => [icon('repo'), el('span', { className: 'at-label' }, r.label)], title: r => r.path },
      s && { head: 'Layout', track: 'minmax(70px, 1fr)', muted: true, wide: true, tip: `Layout\n${from}`, cell: r => r.layout || '', tone: r => (r.layout && r.layout !== 'router' ? 'warn' : '') },
      s && { head: 'Standard', track: 'minmax(110px, 1.5fr)', tip: `Standard\n${from}`, cell: r => [checkBadge(liveCheck(r)), el('span', { className: 'at-label' }, checkText(liveCheck(r)))], cls: 'at-name' },
      { head: 'Lines', track: '56px', num: true, tip: 'Lines\nLines in the root CLAUDE.md', cell: r => String(r.lines || 0), tone: r => (s && r.lines > 120 ? 'warn' : '') },
      s && { head: 'Em dashes', track: '80px', num: true, wide: true, tip: `Em dashes\n${from}`, cell: r => (r.emDashes === undefined ? '' : String(r.emDashes)), tone: r => (r.emDashes ? 'warn' : '') },
      s && { head: 'Review', track: '64px', num: true, wide: true, tip: `Review\n${from}`, cell: r => (r.check ? String(r.check.review) : ''), tone: r => (r.check && r.check.review ? 'warn' : '') },
      { head: 'Plugins', track: '64px', num: true, cell: r => String(r.plugins.length), title: r => r.plugins.join('\n') },
      { head: 'Hook copies', track: '90px', num: true, wide: true, tip: 'Hook copies\nHook scripts that also exist in another scope or a plugin', cell: r => String(r.hookCopies || 0) },
      { head: 'Copies', track: '64px', num: true, tip: 'Copies\nSkills and agents that also exist in another scope or a plugin', cell: r => String(r.copies || 0) },
    ].filter(Boolean);
    // The search on top filters the table by repo name or path as you type; only the table repaints, so the box keeps focus.
    const results = el('div', {});
    const paint = () => {
      const q = state.repoOverviewFilter.toLowerCase();
      const hits = rows.filter(r => !q || r.label.toLowerCase().includes(q) || (r.path || '').toLowerCase().includes(q));
      results.replaceChildren(
        hits.length
          ? gridTable(
              cols,
              hits.map(r =>
                Object.assign({}, r, {
                  open: () => {
                    state.openRepos.add(r.id);
                    persist();
                    showRepo(r.id);
                  },
                })
              ),
              'GitHub Repo overview'
            )
          : el('div', { className: 'empty flush' }, `No repo matches "${state.repoOverviewFilter}"`)
      );
    };
    const input = el('input', { type: 'search', placeholder: 'Search repos by name or path', value: state.repoOverviewFilter });
    input.addEventListener('input', () => {
      state.repoOverviewFilter = input.value;
      paint();
    });
    paint();
    body.append(el('div', { className: 'kind-search' }, el('div', { className: 'combo' }, icon('search'), input)), results);
  }
  return el(
    'section',
    { className: 'main' },
    countHead(
      'github',
      'GitHub Repo overview',
      rows ? plural(rows.length, 'repository') : 'Reading...',
      std() ? iconBtn('checklist', 'Check every repo against the harness standard', () => command('checkRepos')) : null,
      std('fix') ? iconBtn('wrench', 'Fix settings and hooks...', () => command('fixSettings')) : null,
      confirmAt(iconBtn('archive', 'Retire clean copies...', () => command('retireCopies')), 'panel', 'retireCopies'),
      iconBtn('refresh', 'Reload the table', () => vscode.postMessage({ type: 'repos' }))
    ),
    body
  );
}

export const SOURCE_ICONS = { github: 'github', git: 'source-control', directory: 'folder', file: 'file', url: 'globe' };

// One token per kind of source, the short name beside it; the full source and the folder on disk are in the hover card.
const SOURCE_TOKENS = { github: 'github', git: 'git', directory: 'local', file: 'file', url: 'url' };
const sourceToken = m => SOURCE_TOKENS[m.kind] ?? m.kind;
const sourceName = m => {
  if (m.kind === 'directory' || m.kind === 'file') return String(m.source).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || m.source;
  if (m.kind === 'url' || m.kind === 'git') return String(m.source).replace(/^[a-z+]+:\/\//, '').replace(/\.git$/, '');
  return m.source;
};
export const sourceTip = m => [`Source · ${sourceToken(m)}`, m.source, m.location && m.location !== m.source ? `Installed at ${m.location}` : ''].filter(Boolean).join('\n');

// The version and sync columns of a marketplace's plugins, on Marketplace health and on the marketplace's own page.
const syncCols = m => [
  { head: 'Installed', track: 'minmax(64px, 1fr)', muted: true, cell: p => p.installed || '' },
  ...(m.plugins.some(p => p.source) ? [{ head: 'Latest', track: 'minmax(64px, 1fr)', muted: true, tip: 'Latest\nThe version the marketplace offers', cell: p => p.source || '' }] : []),
  // One Sync column: a plugin that is ahead has its Sync plugin button, the others say where they stand; while one is ahead, the
  // header is Sync all, for every plugin that is.
  (() => {
    const ahead = m.plugins.filter(p => p.ahead).length;
    return {
      head: ahead
        ? el('button', { className: 'secondary at-head-btn', title: `Sync all\nRefresh ${m.name} once, then update the ${plural(ahead, 'plugin')} whose source is ahead of the installed copy.`, onclick: () => (hideHover(), syncMarket(m.name)) }, icon('sync'), 'Sync all')
        : 'Sync',
      track: ahead ? 'minmax(120px, 1fr)' : 'minmax(84px, 1fr)',
      muted: true,
      cell: p => (p.ahead ? el('button', { className: 'secondary', title: `Sync plugin\nRefresh ${m.name} and update ${p.name} from ${p.installed} to ${p.source}.`, onclick: e => (e.stopPropagation(), syncPlugin(p.key)) }, icon('sync'), 'Sync plugin') : p.installed ? 'current' : 'uninstalled'),
      title: p => (p.ahead ? undefined : `Sync · ${p.installed ? 'Up to date' : 'Not installed'}\n${p.installed ? 'The installed copy matches the source.' : 'The plugin is not installed.'}${p.enabled ? '\nEnabled' : ''}`),
    };
  })(),
];

// Where each plugin is available. A Code only plugin carries Add to Cowork, which opens the claude.ai plugin settings (a link out, nothing is written there).
const HARNESS_TEXT = { code: 'Code', cowork: 'Cowork', both: 'Both', none: 'None' };
const harnessCol = {
  head: 'Harness',
  track: 'minmax(190px, 1fr)',
  tip: 'Harness\nWhere the plugin is available: Code, Cowork, Both or None. Cowork is read from the plugins Claude.ai synced to this PC.',
  cell: p => {
    const h = p.harness || 'code';
    return h === 'code'
      ? [el('span', { className: 'at-label' }, HARNESS_TEXT[h]), el('button', { className: 'secondary', title: `Add to Cowork\nOpens the claude.ai plugin settings, where ${p.name} is added to Cowork. Nothing is written to your account from here.`, onclick: e => (e.stopPropagation(), hideHover(), command('openCowork', { target: 'plugins' })) }, icon('cloud'), 'Add to Cowork')]
      : HARNESS_TEXT[h];
  },
  title: p => `Harness · ${HARNESS_TEXT[p.harness || 'code']}`,
};
const notInCowork = plugins => plugins.filter(p => (p.harness || 'code') === 'code').length;
const notInCoworkText = n => (n ? `${plural(n, 'plugin')} not in Cowork` : '');

export function renderMarkets() {
  const list = state.markets;
  const body = el('div', { className: 'main-body' });
  if (!list) body.append(el('div', { className: 'empty flush' }, 'Reading the marketplaces...'));
  else if (!list.length) body.append(el('div', { className: 'empty flush' }, 'No marketplace registered. Add one with claude plugin marketplace add.'));
  else {
    // The owner's own marketplaces, the directory sources on disk, come first as a group of their own.
    const local = list.filter(m => m.kind === 'directory');
    const hosted = list.filter(m => m.kind !== 'directory');
    const groups = [local.length ? ['Local, on disk', 'folder', local] : null, hosted.length ? [local.length ? 'Hosted' : '', 'cloud', hosted] : null].filter(Boolean);
    for (const [title, glyph, items] of groups) {
      if (title) body.append(el('div', { className: 'group-label market-group' }, icon(glyph), title, el('span', { className: 'count' }, String(items.length))));
      for (const m of items) {
      const ahead = m.plugins.filter(p => p.ahead).length;
      body.append(
        el(
          'div',
          { className: 'recent' },
          el('div', { className: 'market-head' }, icon('package'), el('span', { className: 'label' }, m.name), el('span', { className: 'market-source', title: sourceTip(m) }, icon(SOURCE_ICONS[m.kind] ?? 'question'), `${sourceToken(m)} · ${sourceName(m)}`), ahead ? el('span', { className: 'tag warn' }, `${ahead} ahead`) : null, el('span', { className: 'spacer' }),
            m.kind === 'directory' ? el('button', { className: 'secondary', onclick: () => command('renameMarketplace', { market: m.name }) }, icon('edit'), 'Rename...') : null),
          m.plugins.length
            ? gridTable(
                [{ head: 'Plugin', track: 'minmax(120px, 2fr)', cls: 'at-name', cell: p => [icon('extensions'), el('span', { className: 'at-label' }, p.name)] }, harnessCol, ...syncCols(m)],
                m.plugins,
                `Plugins of ${m.name}`
              )
            : el('div', { className: 'empty flush' }, 'None installed')
        )
      );
      }
    }
  }
  return el('section', { className: 'main' }, countHead('package', 'Marketplace health', list ? [plural(list.length, 'marketplace'), notInCoworkText(notInCowork(list.flatMap(m => m.plugins)))].filter(Boolean).join(' · ') : 'Reading...', iconBtn('refresh', 'Reload', () => vscode.postMessage({ type: 'marketplaces' }))), body);
}

// The installed plugin of a key (`name@market`), Global's first: a row on the marketplace page opens its page.
const pluginAsset = key => state.views.flatMap(v => (v.categories.find(c => c.kind === 'plugin') || { items: [] }).items).find(a => a.name === key);

// One marketplace: a head like the Plugins page's, the drawing of what it offers with its Harness and Process toggle, and its plugins.
export function renderMarket() {
  const page = state.marketPage;
  const m = (state.markets || []).find(x => x.name === page.name);
  const drawn = { id: `market:${page.name}`, kind: 'market', name: page.name };
  if (m) askDrawing(drawn, page);
  const body = el('div', { className: 'main-body', onscroll: hideHover });
  if (!state.markets) body.append(el('div', { className: 'empty flush' }, 'Reading the marketplace...'));
  else if (!m) body.append(el('div', { className: 'empty flush' }, `${page.name} is not a registered marketplace any more.`));
  else
    body.append(
      el(
        'div',
        { className: 'market-page' },
        el('div', { className: 'market-head' }, el('span', { className: 'market-source', title: sourceTip(m) }, icon(SOURCE_ICONS[m.kind] ?? 'question'), `${sourceToken(m)} · ${sourceName(m)}`)),
        drawingFigure(drawn),
        el('div', { className: 'group-label' }, plural(m.plugins.length, 'plugin')),
        m.plugins.length
          ? gridTable(
              [
                { head: 'Plugin', track: 'minmax(140px, 2fr)', cls: 'at-name', cell: p => [icon(p.enabled ? 'pass-filled' : 'circle-large-outline'), el('span', { className: 'at-label' }, p.name)], title: p => `${p.name}\n${p.enabled ? 'Enabled' : p.installed ? 'Installed, disabled' : 'Not installed'}` },
                ...(m.plugins.some(p => p.description) ? [{ head: 'Description', track: 'minmax(100px, 3fr)', muted: true, wide: true, cell: p => p.description || '', title: p => p.description }] : []),
                harnessCol,
                ...syncCols(m),
              ],
              m.plugins.map(p => {
                const a = pluginAsset(p.key);
                return a ? Object.assign({}, p, { open: () => select(a.id), className: a.enabled ? '' : 'disabled' }) : p;
              }),
              `Plugins of ${m.name}`
            )
          : el('div', { className: 'empty flush' }, m.kind === 'directory' ? 'Its catalog lists no plugins.' : 'None installed from it.')
      )
    );
  const installed = m ? m.plugins.filter(p => p.installed).length : 0;
  const enabled = m ? m.plugins.filter(p => p.enabled).length : 0;
  const ahead = m ? m.plugins.filter(p => p.ahead).length : 0;
  const { running, drawn: done, error } = drawState(drawn);
  const back = page.back ? iconBtn('arrow-left', page.back.label, page.back.go) : iconBtn('arrow-left', 'Back to Marketplace health', () => showPage('marketplaces'));
  const head = countHead(
    'package',
    page.name,
    m ? [plural(m.plugins.length, 'plugin'), installed ? `${installed} installed` : '', enabled ? `${enabled} enabled` : '', ahead ? `${ahead} ahead` : '', notInCoworkText(notInCowork(m.plugins))].filter(Boolean).join(' · ') : state.markets ? 'Not registered' : 'Reading...',
    back,
    m && m.kind === 'directory' ? iconBtn('edit', 'Rename marketplace...', () => command('renameMarketplace', { market: m.name })) : null,
    iconBtn('refresh', 'Reload', () => vscode.postMessage({ type: 'marketplaces' })),
    // One press for every plugin that is ahead, after one card that lists them; shown only while one is.
    ahead
      ? el(
          'button',
          { className: 'secondary', title: `Sync ${plural(ahead, 'plugin')}\nRefresh ${page.name} once, then update every plugin whose source is ahead of the installed copy.`, onclick: () => (hideHover(), syncMarket(page.name)) },
          icon('sync'),
          `Sync ${plural(ahead, 'plugin')}`
        )
      : null,
    aiGroup(
      '',
      m && m.plugins.length
        ? confirmAt(
            el(
              'button',
              {
                className: 'secondary',
                disabled: running,
                title: `${done ? 'Redraw' : 'Draw'} with Claude\nClaude draws ${drawsWhat('market')}. The drawing shows above the plugins as soon as it is ready. It runs in the background and counts against your plan.${error ? `\nLast try failed: ${error}` : ''}`,
                onclick: () => (hideHover(), vscode.postMessage({ type: 'drawAsset', id: drawingId(drawn) })),
              },
              icon('brush'),
              running ? 'Drawing...' : done ? 'Redraw with Claude' : 'Draw with Claude'
            ),
            'draw'
          )
        : null
    )
  );
  // A flat, indeterminate line along the bottom edge while Claude draws, as on an element's page.
  if (running) head.classList.add('busy');
  return el('section', { className: 'main' }, head, body);
}

export const initForm = () => ({ summary: state.init.form.summary, areas: state.init.form.areas, rules: state.init.form.rules.split(/\r?\n/) });

export function renderInit() {
  const s = state.init;
  const data = s.data;
  const body = el('div', { className: 'main-body' });
  let createBtn;
  const syncCreate = () => {
    if (createBtn) createBtn.disabled = !(s.result && !s.result.error && !s.applied && s.previewKey === JSON.stringify(initForm()));
  };
  if (!data) body.append(el('div', { className: 'empty flush' }, 'Loading...'));
  else {
    if (data.error) body.append(el('div', { className: 'notice bad' }, data.error));
    if (data.hasClaudeMd) body.append(el('div', { className: 'notice' }, 'This folder has a CLAUDE.md. Init only creates missing files and never overwrites one.'));
    const owners = data.agents || [];
    body.append(
      el('div', { className: 'group-label' }, 'Summary'),
      el('textarea', { className: 'text', rows: 3, placeholder: 'One to three sentences: what the product is and its stack.', value: s.form.summary, oninput: e => ((s.form.summary = e.target.value), syncCreate()) }),
      el('div', { className: 'group-label' }, 'Areas'),
      el(
        'div',
        { className: 'areas' },
        s.form.areas.map((a, i) =>
          el(
            'div',
            { className: 'area' },
            el('input', { type: 'text', placeholder: 'name, e.g. api', value: a.name, oninput: e => ((a.name = e.target.value), syncCreate()) }),
            el('input', { type: 'text', placeholder: 'globs, e.g. src/api/**', value: a.globs, oninput: e => ((a.globs = e.target.value), syncCreate()) }),
            el(
              'select',
              { onchange: e => ((a.owner = e.target.value), syncCreate()) },
              el('option', { value: '', selected: !a.owner }, 'Owner agent'),
              owners.map(o => el('option', { value: o, selected: a.owner === o }, o))
            ),
            iconBtn('close', 'Remove area', () => {
              s.form.areas.splice(i, 1);
              renderMain();
            })
          )
        )
      ),
      el('div', { className: 'add-field' }, el('button', { className: 'secondary', onclick: () => (s.form.areas.push({ name: '', globs: '', owner: '' }), renderMain()) }, icon('add'), 'Add area')),
      el('div', { className: 'group-label' }, 'Repo rules'),
      el('textarea', { className: 'text', rows: 3, placeholder: 'One repo-only hard rule per line.', value: s.form.rules, oninput: e => ((s.form.rules = e.target.value), syncCreate()) })
    );
    createBtn = el(
      'button',
      {
        className: 'primary',
        onclick: () => vscode.postMessage({ type: 'initRun', dir: s.dir, form: initForm(), apply: true }),
      },
      icon('new-file'),
      'Create files'
    );
    body.append(
      el(
        'div',
        { className: 'toolbar' },
        el(
          'button',
          {
            className: 'secondary',
            onclick: () => {
              s.pendingKey = JSON.stringify(initForm());
              vscode.postMessage({ type: 'initRun', dir: s.dir, form: initForm(), apply: false });
            },
          },
          icon('eye'),
          'Preview'
        ),
        createBtn
      )
    );
    syncCreate();
    if (s.result) {
      if (s.result.error) body.append(el('div', { className: 'notice bad' }, s.result.error));
      else
        body.append(
          el(
            'div',
            {},
            el('div', { className: 'group-label' }, s.applied ? 'Created' : 'Preview: nothing is written yet'),
            (s.result.files || []).map(f => el('div', { className: 'row' }, icon(f.action === 'create' ? 'new-file' : 'circle-slash'), el('span', { className: 'name' }, f.rel), el('span', { className: 'desc' }, f.action === 'create' ? (s.applied ? 'created' : 'will be created') : 'exists, skipped'))),
            el('div', { className: 'empty flush' }, s.result.summary || '')
          )
        );
    }
  }
  const wrap = el('div', { className: 'init-form' });
  wrap.append(...[...body.childNodes]);
  body.append(wrap);
  return el('section', { className: 'main' }, pageHead('new-folder', 'Scaffold repo harness', s.dir), body);
}
