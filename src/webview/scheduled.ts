// @ts-nocheck
// Cowork scheduled tasks: a node in the Cowork region, a list page and a read-only page per task. The tasks come from claude.ai
// (`scheduled` message); Run now, pause and rename stay on claude.ai, which every page links to.
import { COWORK_NODES } from './cowork';
import { command, labelOf, persist, showPage, state, vscode } from './core';
import { cmd, cmdBox } from './detail';
import { card } from './detail-view';
import { countHead, el, fmtDate, icon, iconBtn, plural } from './dom';
import { refChip, viewEntry } from './refs';
import { gridTable } from './tables';

const FOLD = 'cowork-scheduled';
const tasks = () => (state.scheduled && state.scheduled.tasks) || [];
const open = (target, id) => command('openScheduled', { target, id });
const STATUS_GLYPH = { ok: 'pass', wait: 'watch', off: 'circle-slash' };
const SOURCE_GLYPH = { Cowork: 'cloud', Code: 'terminal' };

const ask = () => vscode.postMessage({ type: 'scheduled' });

export function openTask(id) {
  state.scheduledPage = { id };
  showPage('scheduled-task');
}

const iconText = (glyph, text) => el('span', { className: 'sched-cell' }, icon(glyph), text);
const when = t => (t ? fmtDate(t) : '-');

function renderNode(list, q, { treeItem, render }) {
  if (state.scheduled === undefined) {
    state.scheduled = null;
    ask();
  }
  const all = tasks().filter(t => !q || t.name.toLowerCase().includes(q));
  if (q && !all.length) return;
  const folded = state.foldedGroups.has(FOLD) && !q;
  const toggle = () => {
    folded ? state.foldedGroups.delete(FOLD) : state.foldedGroups.add(FOLD);
    persist();
  };
  const current = !state.detail && state.page === 'scheduled';
  const stop = fn => e => (e.stopPropagation(), fn());
  list.append(
    treeItem(
      el(
        'div',
        { className: `section-head${current ? ' selected' : ''}`, title: 'Scheduled\nThe Cowork tasks that run on a schedule, read from claude.ai. Read-only here.', onclick: () => showPage('scheduled') },
        el('span', { className: 'twistie', onclick: stop(() => (toggle(), render())) }, icon(folded ? 'chevron-right' : 'chevron-down')),
        el('span', { className: 'label' }, 'Scheduled'),
        iconBtn('link-external', 'Open on claude.ai', stop(() => open('list'))),
        iconBtn('library', 'Templates on claude.ai', stop(() => open('templates'))),
        el('span', { className: 'count' }, state.scheduled ? all.length : '...')
      ),
      's|cowork-scheduled',
      1,
      !folded,
      () => (toggle(), render())
    )
  );
  if (folded) return;
  if (!state.scheduled) return void list.append(el('div', { className: 'empty' }, 'Reading the scheduled tasks...'));
  if (state.scheduled.state !== 'ok') return void list.append(el('div', { className: 'empty' }, state.scheduled.note));
  if (!all.length) return void list.append(el('div', { className: 'empty' }, 'None'));
  list.append(
    ...all.map(t => {
      const selected = !state.detail && state.page === 'scheduled-task' && state.scheduledPage && state.scheduledPage.id === t.id;
      return treeItem(
        el('div', { className: `row${selected ? ' selected' : ''}`, title: `${t.name}\n${t.status} · ${t.repeats}`, onclick: () => openTask(t.id) }, icon(STATUS_GLYPH[t.statusKind]), el('span', { className: 'name' }, t.name), el('span', { className: 'desc' }, t.status)),
        `k|cowork-scheduled|${t.id}`,
        2
      );
    })
  );
}
COWORK_NODES.push(renderNode);

const linksNotice = () =>
  el(
    'div',
    { className: 'notice' },
    el('span', {}, state.scheduled.note),
    el('button', { className: 'secondary', onclick: () => open('list') }, icon('link-external'), 'Open on claude.ai'),
    el('button', { className: 'secondary', onclick: () => open('templates') }, icon('library'), 'Templates')
  );

export function renderScheduledList() {
  const s = state.scheduled;
  const body = el('div', { className: 'main-body' });
  if (!s) body.append(el('div', { className: 'empty flush' }, 'Reading the scheduled tasks...'));
  else if (s.state !== 'ok') body.append(linksNotice());
  else if (!s.tasks.length) body.append(el('div', { className: 'empty flush' }, 'No scheduled task yet. Create one on claude.ai.'));
  else
    body.append(
      gridTable(
        [
          { head: 'Name', track: 'minmax(120px, 2fr)', cls: 'at-name', cell: t => [icon('calendar'), el('span', { className: 'at-label' }, t.name)] },
          { head: 'Status', track: 'minmax(110px, 1.5fr)', cell: t => iconText(STATUS_GLYPH[t.statusKind], t.status), title: t => t.status },
          { head: 'Repeats', track: 'minmax(100px, 1.2fr)', muted: true, cell: t => t.repeats, title: t => `${t.repeats}\n${t.cron}` },
          { head: 'Next run', track: 'minmax(100px, 130px)', muted: true, cell: t => when(t.nextRunAt) },
          {
            head: 'Project',
            track: 'minmax(64px, 90px)',
            muted: true,
            low: true,
            cell: t => (t.projectId ? el('button', { type: 'button', className: 'link', title: 'Open project\nThe project on claude.ai.', onclick: e => (e.stopPropagation(), open('project', t.projectId)) }, iconText('folder', 'Project')) : '-'),
          },
          { head: 'Source', track: 'minmax(64px, 90px)', muted: true, low: true, cell: t => iconText(SOURCE_GLYPH[t.source], t.source) },
        ],
        s.tasks.map(t => Object.assign({ open: () => openTask(t.id) }, t)),
        'Scheduled tasks'
      )
    );
  return el(
    'section',
    { className: 'main' },
    countHead('calendar', 'Scheduled', s && s.state === 'ok' ? plural(s.tasks.length, 'task') : 'Cowork', iconBtn('refresh', 'Reload', ask), iconBtn('link-external', 'Open on claude.ai', () => open('list')), iconBtn('library', 'Templates on claude.ai', () => open('templates'))),
    body
  );
}

const fact = (label, value, glyph, tip) => el('div', { className: 'dv-fact', title: tip }, el('span', { className: 'k' }, icon(glyph), label), el('span', { className: 'v' }, value));

/** The Cowork item a name from the task stands for, if the Cowork region has one. */
function coworkItem(kind, name) {
  const view = state.views.find(v => v.id === 'cowork');
  const cat = view && view.categories.find(c => c.kind === kind);
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = norm(name);
  return cat && cat.items.find(a => norm(labelOf(a)) === key || norm(a.name.split('@')[0]) === key);
}

function usesRow(title, glyph, kind, names, tip) {
  if (!names.length) return null;
  return el(
    'div',
    { className: 'dv-tools' },
    el('div', { className: 'dv-tools-head', title: tip }, icon(glyph), el('span', {}, title), el('span', { className: 'dv-count' }, String(names.length))),
    el('div', { className: 'dv-tool-chips' }, names.map(n => {
      const a = coworkItem(kind, n);
      return a ? refChip(viewEntry(a), n) : el('span', { className: 'dv-tool' }, n);
    }))
  );
}

export function renderScheduledTask() {
  const s = state.scheduled;
  const t = tasks().find(x => x.id === (state.scheduledPage && state.scheduledPage.id));
  const back = cmd('arrow-left', 'Back', 'Back to Scheduled', () => showPage('scheduled'));
  if (!t)
    return el('section', { className: 'main' }, countHead('calendar', 'Scheduled task', s ? 'Not found' : 'Reading...', iconBtn('arrow-left', 'Back to Scheduled', () => showPage('scheduled'))), el('div', { className: 'main-body' }, el('div', { className: 'empty flush' }, s ? 'This task is not in the list claude.ai returned.' : 'Reading the scheduled tasks...')));
  const head = el(
    'header',
    { className: 'main-head detail-head' },
    el(
      'div',
      { className: 'title' },
      el(
        'div',
        { className: 'dh-line' },
        el('span', { className: 'dh-kind', title: 'Scheduled task\nA task Claude runs on a schedule. This page is read-only.' }, icon('calendar'), el('span', {}, 'Scheduled task')),
        el('h1', { title: t.name }, el('span', { className: 'dh-name' }, t.name)),
        el('span', { className: 'dh-source', title: `${t.source}\n${t.source === 'Cowork' ? 'Created in Cowork.' : 'Created from Claude Code.'}` }, icon(SOURCE_GLYPH[t.source]), el('span', {}, t.source)),
        el('span', { className: 'dh-source', title: `${t.status}\n${t.cron}` }, icon(STATUS_GLYPH[t.statusKind]), el('span', {}, t.status))
      )
    ),
    el(
      'div',
      { className: 'cmd-bar' },
      cmdBox('Page', '', back),
      cmdBox(
        'Claude.ai',
        '',
        cmd('link-external', 'Open on claude.ai', 'Open on claude.ai\nThe task on claude.ai, where you run, pause and rename it.', () => open('task', t.id)),
        t.projectId ? cmd('folder', 'Open project', 'Open project\nThe project of this task on claude.ai.', () => open('project', t.projectId)) : null,
        t.lastRunSessionId ? cmd('history', 'Open last run', 'Open last run\nThe session of the last run on claude.ai.', () => open('run', t.lastRunSessionId)) : null
      )
    )
  );
  const details = el(
    'div',
    { className: 'dv-group' },
    el('div', { className: 'dv-group-cap' }, 'Details'),
    fact('Repeats', t.repeats, 'clock', `Repeats\n${t.cron}`),
    fact('Next run', when(t.nextRunAt), 'calendar'),
    fact('Last run', t.lastRunAt ? `${fmtDate(t.lastRunAt)}${t.lastRunStatus ? ` · ${t.lastRunStatus}` : ''}` : 'Never', 'pulse'),
    fact('Runs on', t.runsOn, t.runsOn === 'Cloud' ? 'cloud' : 'device-desktop'),
    fact('Project', t.projectId ? el('button', { type: 'button', className: 'link', onclick: () => open('project', t.projectId) }, 'Open on claude.ai') : '-', 'folder'),
    fact('Connectors', String(t.connectors), 'plug', 'Connectors\nThe claude.ai connectors the task can use, listed below.'),
    fact('Permissions', t.permissions, 'lock')
  );
  const uses = [usesRow('Connectors', 'plug', 'mcp', t.connectorNames, 'Connectors\nA name with a link is also in the Cowork region of the left nav.'), usesRow('Plugins', 'extensions', 'plugin', t.pluginNames), usesRow('Marketplaces', 'package', null, t.marketplaceNames)].filter(Boolean);
  const body = el(
    'div',
    { className: 'main-body' },
    el(
      'div',
      { className: 'dv' },
      el('section', { className: 'dv-hero' }, el('div', { className: 'dv-cols' }, details)),
      el('div', { className: 'group-label' }, 'Contents'),
      card('Instructions', null, t.instructions ? el('div', { className: 'sched-instructions' }, t.instructions) : el('div', { className: 'dv-empty' }, 'No instructions.')),
      uses.length ? card('Uses', null, uses) : null,
      card('History', null, el('div', { className: 'dv-empty' }, 'Every run, with its session, is on claude.ai.'), el('button', { className: 'secondary', onclick: () => open('task', t.id) }, icon('link-external'), 'Open history on claude.ai'))
    )
  );
  return el('section', { className: 'main' }, head, body);
}
