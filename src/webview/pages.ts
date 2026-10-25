// @ts-nocheck
// Fleet overview, marketplace health and the scaffold form.
import { checkBadge, checkText, command, persist, showRepo, state, std, vscode } from './core';
import { confirmAt } from './confirm';
import { el, icon, iconBtn, pageHead, plural } from './dom';
import { renderMain } from './main';

export const liveCheck = r => state.checks[r.id] || { state: r.checkState };

export function renderFleet() {
  const rows = state.fleet;
  const body = el('div', { className: 'main-body' });
  if (!rows) body.append(el('div', { className: 'empty flush' }, 'Reading the repos...'));
  else {
    const s = std();
    const cols = [
      ['Repo', '', r => el('span', { className: 'cell' }, icon('repo'), r.label)],
      s && ['Layout', '', r => r.layout || '-', r => (r.layout && r.layout !== 'router' ? 'warn' : '')],
      s && ['Standard', '', r => el('span', { className: 'cell' }, checkBadge(liveCheck(r)), checkText(liveCheck(r)))],
      ['Lines', 'num', r => String(r.lines || 0), r => (s && r.lines > 120 ? 'warn' : '')],
      s && ['Em dashes', 'num', r => (r.emDashes === undefined ? '-' : String(r.emDashes)), r => (r.emDashes ? 'warn' : '')],
      s && ['Review', 'num', r => (r.check ? String(r.check.review) : '-'), r => (r.check && r.check.review ? 'warn' : '')],
      ['Plugins', 'num', r => String(r.plugins.length)],
      ['Hook copies', 'num', r => String(r.hookCopies || 0)],
      ['Copies', 'num', r => String(r.copies || 0)],
    ].filter(Boolean);
    const heads = cols.map(c => c[0]);
    body.append(
      el(
        'div',
        { className: 'table-wrap' },
        el(
          'table',
          { className: 'grid' },
          el('thead', {}, el('tr', {}, cols.map(c => el('th', { className: c[1] }, c[0])))),
          el(
            'tbody',
            {},
            rows.map(r =>
              el(
                'tr',
                {
                  className: 'clickable',
                  title: r.path,
                  onclick: () => {
                    state.openRepos.add(r.id);
                    persist();
                    showRepo(r.id);
                  },
                },
                cols.map(c => el('td', { className: [c[1], c[3] ? c[3](r) : ''].filter(Boolean).join(' '), title: c[0] === 'Plugins' ? r.plugins.join('\n') : undefined }, c[2](r)))
              )
            )
          )
        )
      ),
      el(
        'div',
        { className: 'empty flush' },
        `Lines count the root CLAUDE.md.${s ? ` Layout, Standard, Em dashes and Review come from ${s.name}.` : ''} Copies count skills and agents that also exist in another scope or a plugin.`
      )
    );
  }
  return el(
    'section',
    { className: 'main' },
    pageHead(
      'dashboard',
      'Fleet overview',
      rows ? (rows.length === 1 ? '1 repository' : `${rows.length} repositories`) : 'Reading...',
      std() ? iconBtn('checklist', 'Check every repo against the harness standard', () => command('checkRepos')) : null,
      std('fix') ? iconBtn('wrench', 'Fix settings and hooks...', () => command('fixSettings')) : null,
      confirmAt(iconBtn('archive', 'Retire clean copies...', () => command('retireCopies')), 'panel', 'retireCopies'),
      iconBtn('refresh', 'Reload the table', () => vscode.postMessage({ type: 'fleet' }))
    ),
    body
  );
}

export const SOURCE_ICONS = { github: 'github', git: 'source-control', directory: 'folder', file: 'file', url: 'globe' };

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
          el('div', { className: 'market-head' }, icon('package'), el('span', { className: 'label' }, m.name), ahead ? el('span', { className: 'tag warn' }, `${ahead} ahead`) : null, el('span', { className: 'spacer' }),
            m.kind === 'directory' ? el('button', { className: 'secondary', onclick: () => command('renameMarketplace', { market: m.name }) }, icon('edit'), 'Rename...') : null),
          el('div', { className: 'facts' }, [
            [el('span', { className: 'key' }, 'Source', el('span', { className: `codicon codicon-${SOURCE_ICONS[m.kind] ?? 'question'}`, title: m.kind, 'aria-label': m.kind })), el('span', { className: 'value' }, m.source)],
            [el('span', { className: 'key' }, 'Location'), el('span', { className: 'value' }, m.location)],
          ].flat()),
          m.plugins.length
            ? el(
                'div',
                { className: 'table-wrap' },
                el(
                  'table',
                  { className: 'grid' },
                  el('thead', {}, el('tr', {}, ['Plugin', 'Installed', 'Source', 'State'].map(h => el('th', {}, h)))),
                  el(
                    'tbody',
                    {},
                    m.plugins.map(p =>
                      el(
                        'tr',
                        {},
                        el('td', {}, p.name),
                        el('td', {}, p.installed || 'not installed'),
                        el('td', {}, p.source || ''),
                        el('td', { className: p.ahead ? 'warn' : '' }, [p.ahead ? 'source ahead of the installed copy' : p.installed ? 'current' : '', p.enabled ? 'enabled' : ''].filter(Boolean).join(' · '))
                      )
                    )
                  )
                )
              )
            : el('div', { className: 'empty flush' }, 'No plugins installed from it')
        )
      );
      }
    }
  }
  return el('section', { className: 'main' }, pageHead('package', 'Marketplace health', list ? plural(list.length, 'marketplace') : 'Reading...', iconBtn('refresh', 'Reload', () => vscode.postMessage({ type: 'marketplaces' }))), body);
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
