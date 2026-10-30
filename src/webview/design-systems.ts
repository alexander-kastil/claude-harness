// @ts-nocheck
// Cowork design systems: a node in the Cowork region, a list page and a read-only page per design system. They come from claude.ai
// (`designSystems` message: the artifacts of the Design System type, and the standalone Claude Design projects); everything that
// changes one stays on claude.ai, which every page links to.
import { COWORK_NODES } from './cowork';
import { coworkFilter } from './cowork-chats';
import { command, persist, showPage, state, vscode } from './core';
import { cmd, cmdBox } from './detail';
import { confirmAt } from './confirm';
import { card } from './detail-view';
import { aiGroup, countHead, el, fmtDate, icon, iconBtn, plural } from './dom';
import { gridTable } from './tables';

const FOLD = 'cowork-design-systems';
const systems = () => (state.designSystems && state.designSystems.systems) || [];
const open = (target, id) => command('openDesignSystem', { target, id });
const ask = () => vscode.postMessage({ type: 'designSystems' });
const kindOf = d => (d.standalone ? 'Standalone' : 'Design System');
const when = t => (t ? fmtDate(t) : '-');
const iconText = (glyph, text) => el('span', { className: 'sched-cell' }, icon(glyph), text);

/** The host's `designRead` message: Claude is reading, the read, or why not. */
export function onDesignRead(m) {
  state.designReads = { ...state.designReads, [m.id]: { state: m.state, error: m.error } };
  if (m.state === 'done' && m.read && state.designSystems) state.designSystems = { ...state.designSystems, reads: { ...state.designSystems.reads, [m.id]: m.read } };
}

export function openDesignSystem(id) {
  state.designPage = { id };
  showPage('design-system');
}

function renderNode(list, q, { treeItem, render }) {
  if (state.designSystems === undefined) {
    state.designSystems = null;
    ask();
  }
  const all = systems().filter(d => !q || d.name.toLowerCase().includes(q));
  if (q && !all.length) return;
  const folded = state.foldedGroups.has(FOLD) && !q;
  const toggle = () => {
    folded ? state.foldedGroups.delete(FOLD) : state.foldedGroups.add(FOLD);
    persist();
  };
  const current = !state.detail && state.page === 'design-systems';
  const stop = fn => e => (e.stopPropagation(), fn());
  list.append(
    treeItem(
      el(
        'div',
        { className: `section-head${current ? ' selected' : ''}`, title: 'Design systems\nThe design systems of your claude.ai account, read from claude.ai. Read-only here.', onclick: () => showPage('design-systems') },
        el('span', { className: 'twistie', onclick: stop(() => (toggle(), render())) }, icon(folded ? 'chevron-right' : 'chevron-down')),
        el('span', { className: 'label' }, 'Design systems'),
        iconBtn('link-external', 'Open on claude.ai', stop(() => open('list'))),
        el('span', { className: 'count' }, state.designSystems ? all.length : '...')
      ),
      's|cowork-design-systems',
      1,
      !folded,
      () => (toggle(), render())
    )
  );
  if (folded) return;
  if (!state.designSystems) return void list.append(el('div', { className: 'empty' }, 'Reading the design systems...'));
  if (state.designSystems.state !== 'ok') return void list.append(el('div', { className: 'empty' }, state.designSystems.note));
  if (!all.length) return void list.append(el('div', { className: 'empty' }, 'None'));
  list.append(
    ...all.map(d => {
      const selected = !state.detail && state.page === 'design-system' && state.designPage && state.designPage.id === d.id;
      return treeItem(
        el('div', { className: `row${selected ? ' selected' : ''}`, title: `${d.name}\n${kindOf(d)} · ${d.usableBy}`, onclick: () => openDesignSystem(d.id) }, icon('symbol-color'), el('span', { className: 'name' }, d.name), el('span', { className: 'desc' }, d.standalone ? `${d.usableBy} · Standalone` : d.usableBy)),
        `k|cowork-design-systems|${d.id}`,
        2
      );
    })
  );
}
COWORK_NODES.push(renderNode);

const noticeFor = s =>
  el('div', { className: 'notice' }, el('span', {}, s.note), el('button', { className: 'secondary', onclick: () => open('list') }, icon('link-external'), 'Open on claude.ai'));

export function renderDesignSystems() {
  const s = state.designSystems;
  const body = el('div', { className: 'main-body' });
  if (!s) body.append(el('div', { className: 'empty flush' }, 'Reading the design systems...'));
  else if (s.state !== 'ok') body.append(noticeFor(s));
  else {
    // The standalone projects need a sign-in scope the artifact side does not: say so here, the rest of the list stays.
    if (s.standalone.state !== 'ok') body.append(el('div', { className: 'notice design-standalone-note' }, icon('info'), el('span', {}, s.standalone.note), el('button', { className: 'secondary', onclick: () => open('standalone') }, icon('link-external'), 'Open Claude Design')));
    if (!s.systems.length) body.append(el('div', { className: 'empty flush' }, 'No design system yet. Create one on claude.ai.'));
    else {
      const table = () =>
        gridTable(
          [
            { head: 'Name', track: 'minmax(120px, 2fr)', cls: 'at-name', cell: d => [icon('symbol-color'), el('span', { className: 'at-label' }, d.name)] },
            { head: 'Usable by', track: 'minmax(110px, 1.5fr)', cell: d => iconText(d.audience === 'owner' ? 'lock' : 'organization', d.usableBy), title: d => `${d.usableBy}${d.mine ? '' : '\nShared with you'}` },
            { head: 'Published', track: 'minmax(100px, 130px)', muted: true, cell: d => when(d.publishedAt) },
            { head: 'Type', track: 'minmax(96px, 120px)', muted: true, low: true, cell: d => kindOf(d), title: d => (d.standalone ? 'Standalone\nA Claude Design project. Standalone design projects close on December 14, 2026.' : 'Design System\nAn artifact of the Design System type.') },
          ],
          s.systems.filter(d => !state.coworkFilter || [d.name, d.usableBy, kindOf(d)].join(' ').toLowerCase().includes(state.coworkFilter.trim().toLowerCase())).map(d => Object.assign({ open: () => openDesignSystem(d.id) }, d)),
          'Design systems'
        );
      let shown = table();
      body.append(
        coworkFilter('Search the design systems', () => {
          const next = table();
          shown.replaceWith(next);
          shown = next;
        }),
        shown
      );
    }
  }
  return el('section', { className: 'main' }, countHead('symbol-color', 'Design systems', s && s.state === 'ok' ? plural(s.systems.length, 'design system') : 'Cowork', iconBtn('refresh', 'Reload', ask), iconBtn('link-external', 'Open on claude.ai', () => open('list'))), body);
}

/** What Claude read of this design system: from the host's cache, or from the read that just finished. */
const readOf = d => (state.designSystems && state.designSystems.reads && state.designSystems.reads[d.id]) || undefined;
const stale = (d, read) => !!d.version && read.version !== d.version;

/** The read as cards: a stale line when the design system moved on, then the README, tokens, components and files. */
function readCards(d, read) {
  const groups = [...new Set(read.tokens.map(t => t.group))];
  return [
    el(
      'div',
      { className: `notice design-read-note${stale(d, read) ? ' design-read-stale' : ''}` },
      icon(stale(d, read) ? 'warning' : 'sparkle'),
      el('span', {}, stale(d, read) ? `Read ${fmtDate(read.readAt)}. The design system has a newer version since: read it again to refresh.` : `Read ${fmtDate(read.readAt)} by Claude. It stays here until the design system has a newer version.`)
    ),
    card('README', null, read.readme ? el('div', { className: 'sched-instructions' }, read.readme) : el('div', { className: 'dv-empty' }, 'No README.')),
    card(
      'Tokens',
      String(read.tokens.length),
      read.tokens.length
        ? groups.map(g => el('div', { className: 'dv-group' }, el('div', { className: 'dv-group-cap' }, g), read.tokens.filter(t => t.group === g).map(t => fact(t.name, t.value, 'symbol-color'))))
        : el('div', { className: 'dv-empty' }, 'No tokens.')
    ),
    card('Components', String(read.components.length), read.components.length ? read.components.map(c => fact(c.name, c.description || '-', 'symbol-class')) : el('div', { className: 'dv-empty' }, 'No components.')),
    card('Files', String(read.files.length), read.files.length ? el('div', { className: 'dv-tool-chips' }, read.files.map(f => el('span', { className: 'dv-tool' }, f))) : el('div', { className: 'dv-empty' }, 'No files.')),
  ];
}

const fact = (label, value, glyph, tip) => el('div', { className: 'dv-fact', title: tip }, el('span', { className: 'k' }, icon(glyph), label), el('span', { className: 'v' }, value));

export function renderDesignSystem() {
  const s = state.designSystems;
  const d = systems().find(x => x.id === (state.designPage && state.designPage.id));
  const back = cmd('arrow-left', 'Back', 'Back to Design systems', () => showPage('design-systems'));
  if (!d)
    return el('section', { className: 'main' }, countHead('symbol-color', 'Design system', s ? 'Not found' : 'Reading...', iconBtn('arrow-left', 'Back to Design systems', () => showPage('design-systems'))), el('div', { className: 'main-body' }, el('div', { className: 'empty flush' }, s ? 'This design system is not in the list claude.ai returned.' : 'Reading the design systems...')));
  const read = readOf(d);
  const live = (state.designReads && state.designReads[d.id]) || {};
  const head = el(
    'header',
    { className: `main-head detail-head${live.state === 'running' ? ' busy' : ''}` },
    el(
      'div',
      { className: 'title' },
      el(
        'div',
        { className: 'dh-line' },
        el('span', { className: 'dh-kind', title: 'Design system\nA brand\'s README, tokens, components and assets that Claude reads and builds on. This page is read-only.' }, icon('symbol-color'), el('span', {}, 'Design system')),
        el('h1', { title: d.name }, el('span', { className: 'dh-name' }, d.name)),
        el('span', { className: 'dh-source', title: `${kindOf(d)}${d.standalone ? '\nStandalone design projects close on December 14, 2026.' : ''}` }, icon(d.standalone ? 'package' : 'cloud'), el('span', {}, kindOf(d))),
        el('span', { className: 'dh-source', title: `${d.usableBy}${d.mine ? '' : '\nShared with you'}` }, icon(d.audience === 'owner' ? 'lock' : 'organization'), el('span', {}, d.usableBy))
      )
    ),
    el(
      'div',
      { className: 'cmd-bar' },
      cmdBox('Page', '', back),
      cmdBox('Claude.ai', '', cmd('link-external', 'Open on claude.ai', 'Open on claude.ai\nThe design system on claude.ai, where you change it.', () => open(d.standalone ? 'standalone' : 'system', d.id))),
      d.standalone
        ? null
        : aiGroup(
            '',
            confirmAt(
              cmd(
                'sparkle',
                live.state === 'running' ? 'Reading...' : read ? 'Read again' : 'Read with Claude',
                'Read with Claude\nClaude lists the files and reads the README, the tokens and the components with the Artifact tool. Only reads. Counts against your Claude plan; asks first.',
                () => vscode.postMessage({ type: 'designRead', id: d.id }),
                { disabled: live.state === 'running' }
              ),
              'designRead',
              'read'
            )
          )
    )
  );
  const details = el(
    'div',
    { className: 'dv-group' },
    el('div', { className: 'dv-group-cap' }, 'Details'),
    fact('Usable by', d.usableBy, d.audience === 'owner' ? 'lock' : 'organization', `Usable by\n${d.mine ? 'Yours.' : 'Shared with you.'}`),
    fact('Published', when(d.publishedAt), 'calendar'),
    fact('Created', when(d.createdAt), 'history'),
    fact('Type', kindOf(d), d.standalone ? 'package' : 'cloud'),
    d.standalone ? null : fact('Default', d.isDefault ? 'Yes' : 'No', 'star', 'Default\nThe design system your account uses when none is named.'),
    d.version ? fact('Version', d.version, 'tag') : null
  );
  // What it holds: a standalone project lists its files; an artifact is described by its type, its files are read on claude.ai.
  const holds = d.standalone
    ? d.files.length
      ? card('Files', String(d.files.length), el('div', { className: 'dv-tool-chips' }, d.files.map(f => el('span', { className: 'dv-tool' }, f))))
      : card('Files', null, el('div', { className: 'dv-empty' }, 'No files listed.'))
    : card('What it holds', null, s.holds ? el('div', { className: 'sched-instructions' }, s.holds) : el('div', { className: 'dv-empty' }, 'Its files are on claude.ai.'), el('button', { className: 'secondary', onclick: () => open('system', d.id) }, icon('link-external'), 'Open files on claude.ai'));
  const body = el(
    'div',
    { className: 'main-body' },
    el(
      'div',
      { className: 'dv' },
      el('section', { className: 'dv-hero' }, el('div', { className: 'dv-cols' }, details)),
      el('div', { className: 'group-label' }, 'Contents'),
      live.state === 'running' ? el('div', { className: 'notice design-read-running' }, icon('loading'), el('span', {}, 'Claude is reading the design system...')) : null,
      live.state === 'error' ? el('div', { className: 'notice design-read-error' }, icon('error'), el('span', {}, live.error)) : null,
      ...(read ? readCards(d, read) : [holds])
    )
  );
  return el('section', { className: 'main' }, head, body);
}
