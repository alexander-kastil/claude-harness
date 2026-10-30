// @ts-nocheck
// Cowork projects as the desktop app keeps them on this PC: the Projects node of the Cowork region and a project's page. Read-only.
import { command, openAt, select, showPage, state, vscode } from './core';
import { cmd, cmdBox } from './detail';
import { card } from './detail-view';
import { el, fmtAgo, icon, iconBtn, plural } from './dom';
import { tabBar } from './repo-page';
import { gridTable } from './tables';

export const PAGE = 'cowork-project';

const projectOf = id => (state.coworkProjects?.list || []).find(p => p.id === id);

/** Opens a project's page and asks the host for its contents. */
export const showCoworkProject = id => {
  state.coworkProject = { id, data: undefined, tab: state.coworkProject?.tab || 'used' };
  vscode.postMessage({ type: 'coworkProject', id });
  showPage(PAGE);
};

/** The Projects node of the Cowork region: two links, then the local spaces linked to a project (none when the app's data folder is absent). */
export function coworkProjectsNode(list, q, { treeItem, render }) {
  if (state.coworkProjects === undefined) {
    state.coworkProjects = null;
    vscode.postMessage({ type: 'coworkProjects' });
  }
  const all = state.coworkProjects?.list || [];
  const rows = all.filter(p => !q || p.name.toLowerCase().includes(q) || 'projects'.includes(q));
  if (q && !rows.length) return;
  list.append(
    treeItem(
      el(
        'div',
        { className: 'row cowork-link cowork-projects', title: 'Projects\nYour Cowork projects. Opens the list on claude.ai in the browser.', onclick: () => command('openCoworkProject', { target: 'list' }) },
        icon('folder-library'),
        el('span', { className: 'name' }, 'Projects'),
        icon('link-external')
      ),
      'n|cowork|projects',
      1
    )
  );
  list.append(
    ...rows.map(p => {
      const selected = !state.detail && state.page === PAGE && state.coworkProject?.id === p.id;
      return treeItem(
        el(
          'div',
          { className: `row nested cowork-project-row${selected ? ' selected' : ''}`, title: `${p.name}\n${p.folder}\n${plural(p.sessions, 'session')} on this PC`, onclick: () => showCoworkProject(p.id) },
          icon('folder'),
          el('span', { className: 'name' }, p.name),
          el('span', { className: 'desc' }, el('span', { className: 'fact' }, plural(p.sessions, 'session')), p.lastActivity ? [' · ', el('span', { className: 'fact' }, fmtAgo(p.lastActivity))] : null)
        ),
        `k|cowork-project|${p.id}`,
        2
      );
    })
  );
}

const fact = (label, value, glyph, tip) => el('div', { className: 'dv-fact', title: tip }, el('span', { className: 'k' }, glyph ? icon(glyph) : null, label), el('span', { className: 'v' }, value));

const note = (text, p) =>
  el(
    'div',
    { className: 'empty flush cowork-missing' },
    el('span', {}, text),
    p?.projectUrl ? el('button', { className: 'link', type: 'button', title: 'Open project\nThe project page on claude.ai in the browser.', onclick: () => command('openCoworkProject', { target: 'project', id: p.id }) }, icon('link-external'), ' Open project') : null
  );

const sizeText = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** A Cowork item of the same name in the Cowork region, when there is one: the row opens its page. */
const coworkItem = (kind, name) => {
  const c = state.views.find(v => v.id === 'cowork')?.categories.find(x => x.kind === kind);
  return c?.items.find(a => a.name.toLowerCase() === name.toLowerCase());
};

const usageTable = (kind, label, rows, withTools) =>
  gridTable(
    [
      { head: label, track: 'minmax(140px, 3fr)', cls: 'at-name', cell: r => [icon(kind === 'tool' ? 'tools' : kind === 'mcp' ? 'plug' : 'sparkle'), el('span', { className: 'at-label' }, r.name)], title: r => (r.item ? `${r.name}\nOpens it in the Cowork region.` : r.name) },
      ...(withTools ? [{ head: 'Tools called', track: 'minmax(120px, 4fr)', muted: true, wide: true, cell: r => (r.tools || []).slice(0, 4).map(t => `${t.name} ${t.count}`).join(', ') }] : []),
      { head: 'Used', track: '72px', num: true, cell: r => String(r.count) },
    ],
    rows.map(r => {
      const item = kind === 'tool' ? null : coworkItem(kind, r.name);
      return item ? Object.assign({}, r, { item, open: () => select(item.id) }) : r;
    }),
    label
  );

function usageBody(d) {
  const u = d.usage;
  if (!u.skills.length && !u.connectors.length && !u.tools.length) return el('div', { className: 'empty flush' }, 'The sessions of this project on this PC record no tool calls.');
  return [
    u.skills.length ? card('Skills', u.skills.length, usageTable('skill', 'Skill', u.skills, false)) : null,
    u.connectors.length ? card('Connectors', u.connectors.length, usageTable('mcp', 'Connector', u.connectors, true)) : null,
    u.tools.length ? card('Tools', u.tools.length, usageTable('tool', 'Tool', u.tools, false)) : null,
  ];
}

function sessionsBody(d) {
  if (!d.sessions.length) return el('div', { className: 'empty flush' }, 'No session of this project ran on this PC.');
  return gridTable(
    [
      { head: 'Session', track: 'minmax(160px, 4fr)', cls: 'at-name', cell: s => [icon('comment-discussion'), el('span', { className: 'at-label' }, s.title || 'Untitled')] },
      { head: 'Model', track: 'minmax(100px, 2fr)', muted: true, wide: true, cell: s => s.model.replace(/^claude-/, '') },
      { head: 'Last activity', track: '110px', muted: true, cell: s => fmtAgo(s.lastActivity) },
      { head: 'Archived', track: '80px', muted: true, wide: true, cell: s => (s.archived ? 'yes' : '') },
    ],
    d.sessions,
    'Sessions on this PC'
  );
}

function memoryBody(d, p) {
  const m = d.memory;
  if (!m.entries.length) return note('Memory is kept in the project on claude.ai; this PC holds none for it.', p);
  return gridTable(
    [
      { head: 'Entry', track: 'minmax(140px, 2fr)', cls: 'at-name', cell: e => [icon('book'), el('span', { className: 'at-label' }, e.name)] },
      { head: 'Type', track: '90px', muted: true, cell: e => e.type },
      { head: 'Description', track: 'minmax(120px, 4fr)', muted: true, wide: true, cell: e => e.description },
      { head: 'Updated', track: '100px', muted: true, cell: e => fmtAgo(e.updated) },
    ],
    m.entries.map(e => Object.assign({}, e, { open: () => openAt(`${m.path}\\${e.file}`) })),
    'Memory entries'
  );
}

function instructionsBody(d, p) {
  const i = d.instructions;
  if (!i) return note('Instructions are set in the project on claude.ai; the project folder has no CLAUDE.md.', p);
  return el(
    'div',
    { className: 'cowork-instructions' },
    el('div', { className: 'path', title: i.path }, el('span', { className: 'file' }, 'CLAUDE.md'), ` · ${sizeText(i.size)} · ${fmtAgo(i.updated)}`),
    el('pre', { className: 'json' }, i.excerpt),
    i.size > i.excerpt.length ? el('div', { className: 'empty flush' }, 'Showing the start of the file.') : null,
    el('div', { className: 'add-field' }, el('button', { className: 'secondary', title: 'Open CLAUDE.md\nThe file in a VS Code editor tab.', onclick: () => openAt(i.path) }, icon('go-to-file'), 'Open CLAUDE.md'))
  );
}

function groundingBody(d, p) {
  const g = d.grounding;
  if (!g) return note('Context files are kept in the project on claude.ai; the project folder is not on this PC.', p);
  if (!g.entries.length) return el('div', { className: 'empty flush' }, 'The project folder is empty.');
  return [
    gridTable(
      [
        { head: 'File', track: 'minmax(160px, 4fr)', cls: 'at-name', cell: e => [icon(e.directory ? 'folder' : 'file'), el('span', { className: 'at-label' }, e.name)] },
        { head: 'Size', track: '90px', num: true, muted: true, cell: e => (e.directory ? '' : sizeText(e.size)) },
      ],
      g.entries.map(e => (e.directory ? e : Object.assign({}, e, { open: () => openAt(`${g.folder}\\${e.name}`) }))),
      'Project folder'
    ),
    g.more ? el('div', { className: 'empty flush' }, `${g.more} more not listed.`) : null,
  ];
}

/** The page of one project: title with the Cowork badge, the command bar, the Details grid and the Contents tabs. */
export function renderCoworkProject() {
  const s = state.coworkProject;
  const p = projectOf(s.id);
  const d = s.data;
  const body = el('div', { className: 'main-body' });
  const back = cmd('arrow-left', 'Back', 'Back\nTo the Cowork projects in the left nav.', () => showPage(undefined));
  const bar = el(
    'div',
    { className: 'cmd-bar' },
    cmdBox('Page', '', back),
    p
      ? cmdBox(
          'Project',
          '',
          cmd('link-external', 'Open project', 'Open project\nThe project page on claude.ai in the browser.', () => command('openCoworkProject', { target: 'project', id: p.id }), { disabled: !p.projectUrl }),
          cmd('folder-opened', 'Open folder', `Open folder\n${p.folder}`, () => command('openCoworkProject', { target: 'folder', id: p.id }), { disabled: !p.folder }),
          cmd('calendar', 'Scheduled', 'Scheduled\nYour scheduled tasks on claude.ai in the browser.', () => command('openScheduled'))
        )
      : null
  );
  const head = el(
    'header',
    { className: 'main-head detail-head' },
    el(
      'div',
      { className: 'title' },
      el(
        'div',
        { className: 'dh-line' },
        el('span', { className: 'dh-kind', title: 'Project\nA Cowork project of the Claude desktop app on this PC.' }, icon('folder-library'), el('span', {}, 'Project')),
        el('h1', { title: p ? p.name : 'Project' }, el('span', { className: 'dh-name' }, p ? p.name : 'Project')),
        el('span', { className: 'dh-source', title: 'Cowork\nRead-only: the project lives in Claude.ai; this page shows what the desktop app keeps on this PC.' }, icon('cloud'), el('span', {}, 'Cowork'))
      )
    ),
    bar
  );
  if (!p) {
    body.append(el('div', { className: 'empty flush' }, state.coworkProjects ? 'This project is not on this PC any more.' : 'Reading the project...'));
    return el('section', { className: 'main' }, head, body);
  }
  body.append(
    el(
      'div',
      { className: 'dv' },
      el(
        'section',
        { className: 'dv-hero' },
        el(
          'div',
          { className: 'dv-cols' },
          el(
            'div',
            { className: 'dv-group' },
            el('div', { className: 'dv-group-cap' }, 'Details'),
            fact('Folder', el('span', { className: 'ell' }, p.folder || '-'), 'folder', p.folder),
            fact('Project link', p.projectUrl ? el('a', { className: 'link', href: p.projectUrl, title: p.projectUrl, onclick: e => (e.preventDefault(), command('openCoworkProject', { target: 'project', id: p.id })) }, p.projectUrl.replace(/^https:\/\//, '')) : '-', 'cloud'),
            fact('Last activity', p.lastActivity ? fmtAgo(p.lastActivity) : '-', 'history'),
            fact('Sessions on this PC', String(p.sessions), 'pulse')
          )
        )
      ),
      contents(s, p, d)
    )
  );
  return el('section', { className: 'main' }, head, body);
}

function contents(s, p, d) {
  const tabs = [
    ['used', 'Used', 'graph', 'The skills, connectors and tools its sessions on this PC called, counted from their tool call records.', d ? d.usage.skills.length + d.usage.connectors.length : undefined, () => usageBody(d)],
    ['sessions', 'Sessions', 'comment-discussion', 'The sessions of this project that ran on this PC.', d ? d.sessions.length : undefined, () => sessionsBody(d)],
    ['memory', 'Memory', 'book', 'The memory entries the desktop app keeps for this project on this PC.', d ? d.memory.entries.length : undefined, () => memoryBody(d, p)],
    ['instructions', 'Instructions', 'checklist', 'The CLAUDE.md in the project folder.', d ? (d.instructions ? 1 : 0) : undefined, () => instructionsBody(d, p)],
    ['grounding', 'Grounding', 'files', 'The files in the project folder, the context a session starts from.', d?.grounding ? d.grounding.entries.length + d.grounding.more : undefined, () => groundingBody(d, p)],
  ];
  const current = () => tabs.find(t => t[0] === s.tab) || tabs[0];
  const panelOf = () => el('div', { className: 'dv-panel', role: 'tabpanel' }, d ? [current()[5]()].flat(Infinity) : el('div', { className: 'empty flush' }, 'Reading...'));
  const barOf = () => tabBar(tabs.map(t => t.slice(0, 5)), current()[0], pick, 'Project contents');
  let bar = barOf();
  let panel = panelOf();
  function pick(id, focus) {
    s.tab = id;
    const nextBar = barOf();
    const nextPanel = panelOf();
    bar.replaceWith(nextBar);
    panel.replaceWith(nextPanel);
    bar = nextBar;
    panel = nextPanel;
    if (focus) bar.querySelector('.view-tab.active')?.focus();
  }
  return el('div', { className: 'recent dv-tabs' }, el('div', { className: 'group-label' }, 'Contents'), bar, panel);
}
