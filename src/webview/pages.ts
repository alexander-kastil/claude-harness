// @ts-nocheck
// Fleet overview, marketplace health and the scaffold form.
import { checkBadge, checkText, command, persist, showRepo, state, std, vscode } from './core';
import { confirmAt } from './confirm';
import { countHead, el, icon, iconBtn, pageHead, plural } from './dom';
import { renderMain } from './main';
import { syncPlugin } from './sync';
import { gridTable } from './tables';

export const liveCheck = r => state.checks[r.id] || { state: r.checkState };

export function renderFleet() {
  const rows = state.fleet;
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
    body.append(
      gridTable(
        cols,
        rows.map(r =>
          Object.assign({}, r, {
            open: () => {
              state.openRepos.add(r.id);
              persist();
              showRepo(r.id);
            },
          })
        ),
        'Fleet overview'
      )
    );
  }
  return el(
    'section',
    { className: 'main' },
    countHead(
      'dashboard',
      'Fleet overview',
      rows ? plural(rows.length, 'repository') : 'Reading...',
      std() ? iconBtn('checklist', 'Check every repo against the harness standard', () => command('checkRepos')) : null,
      std('fix') ? iconBtn('wrench', 'Fix settings and hooks...', () => command('fixSettings')) : null,
      confirmAt(iconBtn('archive', 'Retire clean copies...', () => command('retireCopies')), 'panel', 'retireCopies'),
      iconBtn('refresh', 'Reload the table', () => vscode.postMessage({ type: 'fleet' }))
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
const sourceTip = m => [`Source · ${sourceToken(m)}`, m.source, m.location && m.location !== m.source ? `Installed at ${m.location}` : ''].filter(Boolean).join('\n');

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
                [
                  { head: 'Plugin', track: 'minmax(120px, 2fr)', cls: 'at-name', cell: p => [icon('extensions'), el('span', { className: 'at-label' }, p.name)] },
                  { head: 'Installed', track: 'minmax(64px, 1fr)', muted: true, cell: p => p.installed || '' },
                  ...(m.plugins.some(p => p.source) ? [{ head: 'Latest', track: 'minmax(64px, 1fr)', muted: true, tip: 'Latest\nThe version the marketplace offers', cell: p => p.source || '' }] : []),
                  {
                    head: 'Sync',
                    track: 'minmax(84px, 1fr)',
                    muted: true,
                    tone: p => (p.ahead ? 'warn' : ''),
                    cell: p => (p.ahead ? 'update' : p.installed ? 'current' : 'uninstalled'),
                    title: p => `Sync · ${p.ahead ? 'Update available' : p.installed ? 'Up to date' : 'Not installed'}\n${p.ahead ? 'The source is ahead of the installed copy.' : p.installed ? 'The installed copy matches the source.' : 'The plugin is not installed.'}${p.enabled ? '\nEnabled' : ''}`,
                  },
                  ...(m.plugins.some(p => p.ahead)
                    ? [{ head: '', track: '120px', cell: p => (p.ahead ? el('button', { className: 'secondary', title: `Sync plugin\nRefresh ${m.name} and update ${p.name} from it.`, onclick: () => syncPlugin(p.key) }, icon('sync'), 'Sync plugin') : '') }]
                    : []),
                ],
                m.plugins,
                `Plugins of ${m.name}`
              )
            : el('div', { className: 'empty flush' }, 'None installed')
        )
      );
      }
    }
  }
  return el('section', { className: 'main' }, countHead('package', 'Marketplace health', list ? plural(list.length, 'marketplace') : 'Reading...', iconBtn('refresh', 'Reload', () => vscode.postMessage({ type: 'marketplaces' }))), body);
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
