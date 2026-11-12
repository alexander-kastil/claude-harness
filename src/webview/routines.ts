// @ts-nocheck
// Routines: Claude Code's scheduled cloud agents (read with one GET, like the Cowork Scheduled page) and the durable scheduled
// tasks each repository keeps in .claude/scheduled_tasks.json. A cloud routine can be switched on or off and renamed or
// rescheduled; a durable task can have its prompt and schedule edited (Claude Code has no off switch for it). Every write
// goes through the confirm card first.
import { state, vscode } from './core';
import { confirmAt, showConfirm } from './confirm';
import { countHead, el, fmtDate, icon, iconBtn, plural, stateTag, tag } from './dom';
import { render } from './main';
import { tabBar } from './repo-page';
import { gridTable } from './tables';

const page = () => (state.routinesPage = state.routinesPage || { filter: 'all' });
const ask = () => vscode.postMessage({ type: 'routinesRead' });

// The row being edited: what the fields hold now, reset when another row opens.
let draft;

const first = text => (text || '').split('\n').find(l => l.trim()) || '';
const when = (t, status) => (t ? `${fmtDate(t)}${status ? ` · ${status}` : ''}` : 'Never');

/** Every row of both sources, in one shape. */
function rows() {
  const l = state.routines;
  if (!l) return [];
  const cloud = l.routines.map(r => ({
    key: r.id,
    kind: 'cloud',
    name: r.name,
    cron: r.cron,
    schedule: r.repeats,
    repo: r.repository || '-',
    prompt: r.instructions,
    last: when(r.lastRunAt, r.lastRunStatus),
    status: r.status,
    on: r.statusKind !== 'off',
    locked: /^Auto-disabled/.test(r.status),
  }));
  const local = l.local.map(t => ({
    key: `${t.dir}|${t.id}`,
    kind: 'repo',
    dir: t.dir,
    id: t.id,
    name: first(t.prompt) || t.id,
    cron: t.cron,
    schedule: t.repeats,
    repo: t.repo,
    prompt: t.prompt,
    last: when(t.lastFiredAt),
    status: t.recurring ? 'Recurring' : 'One-off',
    permanent: t.permanent,
  }));
  return [...cloud, ...local];
}

/** The card before every write: what changes, where, and that nothing else does. */
const confirmWrite = (key, title, sub, facts, action, onConfirm) => showConfirm({ kind: 'routinesWrite', key, title, sub, facts, action, onConfirm });

function send(row, patch) {
  page().note = '';
  if (row.kind === 'cloud') vscode.postMessage({ type: 'routinesCloudUpdate', id: row.key, patch });
  else vscode.postMessage({ type: 'routinesLocalUpdate', dir: row.dir, id: row.id, patch });
}

function toggle(row) {
  const next = !row.on;
  const input = el('input', {
    type: 'checkbox',
    role: 'switch',
    checked: row.on,
    disabled: row.locked,
    'aria-label': `${row.name} enabled`,
    title: row.locked ? `${row.status}\nClaude Code switched this routine off; fix its repository access on claude.ai first.` : `${next ? 'Enable' : 'Disable'}\n${next ? 'Off: the routine does not run.' : 'On: the routine runs on its schedule.'} This changes the routine on claude.ai.`,
    onclick: e => {
      e.preventDefault();
      e.stopPropagation();
      confirmWrite(`on|${row.key}`, `${next ? 'Enable' : 'Disable'} ${row.name}?`, 'cloud routine', [`${next ? 'It runs on its schedule again' : 'It stops running until you enable it'}: ${row.schedule}.`, 'The change is made on claude.ai; its prompt and runs stay as they are.'], next ? 'Enable' : 'Disable', () => send(row, { enabled: next }));
    },
  });
  return confirmAt(input, 'routinesWrite', `on|${row.key}`);
}

function table(list) {
  return gridTable(
    [
      { head: 'Name', track: 'minmax(140px, 2fr)', cls: 'at-name', cell: r => [icon(r.kind === 'cloud' ? 'cloud' : 'repo'), el('span', { className: 'at-label' }, r.name)], title: r => r.name },
      { head: 'Schedule', track: 'minmax(120px, 1.3fr)', muted: true, cell: r => r.schedule, title: r => `${r.schedule}\n${r.cron}${r.kind === 'cloud' ? ' (UTC)' : ''}` },
      { head: 'Repository', track: 'minmax(100px, 1.2fr)', muted: true, cell: r => r.repo, title: r => (r.kind === 'repo' ? `${r.repo}\n${r.dir}` : r.repo) },
      { head: 'Last run', track: 'minmax(120px, 1.3fr)', muted: true, low: true, cell: r => r.last },
      { head: 'Source', track: 'minmax(70px, 90px)', align: 'center', low: true, cell: r => tag(r.kind === 'cloud' ? 'Cloud' : 'Repo', r.kind === 'cloud' ? 'Cloud\nA routine on claude.ai.' : 'Repo\nA durable scheduled task in the repository.') },
      {
        head: 'State',
        track: 'minmax(100px, 130px)',
        align: 'center',
        cell: r => (r.kind === 'cloud' ? stateTag(r.status, r.on ? 'ok' : 'none') : tag(r.status, `${r.status}\nClaude Code keeps this task in the repository's file; it has no off switch.`)),
        title: r => r.status,
      },
      { head: 'On', track: '56px', align: 'center', cell: r => (r.kind === 'cloud' ? toggle(r) : el('span', { className: 'routines-na', title: 'No switch\nClaude Code has no off switch for a repository task; edit or delete it in the file.' }, '-')) },
    ],
    list.map(r => Object.assign({ open: () => open(r.key), className: page().open === r.key ? 'selected' : '' }, r)),
    'Routines'
  );
}

function open(key) {
  const p = page();
  p.open = p.open === key ? undefined : key;
  draft = undefined;
  state.routinesPage.note = '';
  repaint();
}

const field = (label, input, tip) => el('label', { className: 'routines-field', title: tip }, el('span', { className: 'routines-label' }, label), input);

/** The open row: its prompt and the fields that can change, with Save asking first. */
function detail(row) {
  if (!draft || draft.key !== row.key) draft = { key: row.key, name: row.name, cron: row.cron, prompt: row.prompt };
  const text = (value, key, label) => el('input', { type: 'text', className: 'routines-input', spellcheck: false, value, 'aria-label': label, oninput: e => ((draft[key] = e.target.value), sync()) });
  const cron = text(draft.cron, 'cron', 'Schedule');
  const name = row.kind === 'cloud' ? text(draft.name, 'name', 'Name') : null;
  const prompt =
    row.kind === 'repo'
      ? el('textarea', { className: 'routines-prompt', spellcheck: false, rows: 6, 'aria-label': 'Prompt', oninput: e => ((draft.prompt = e.target.value), sync()) })
      : el('div', { className: 'sched-instructions' }, row.prompt || 'No instructions.');
  if (row.kind === 'repo') prompt.value = draft.prompt;
  const changes = () => {
    const out = {};
    if (draft.cron.trim() !== row.cron) out.cron = draft.cron.trim();
    if (row.kind === 'cloud' && draft.name.trim() !== row.name) out.name = draft.name.trim();
    if (row.kind === 'repo' && draft.prompt !== row.prompt) out.prompt = draft.prompt;
    return out;
  };
  const save = confirmAt(
    el(
      'button',
      {
        className: 'secondary',
        'aria-label': 'Save',
        disabled: true,
        title: 'Save\nWrites the changed fields, after you confirm.',
        onclick: () => {
          const patch = changes();
          const what = Object.keys(patch).map(k => ({ cron: 'the schedule', name: 'the name', prompt: 'the prompt' })[k]);
          confirmWrite(
            `save|${row.key}`,
            `Save ${row.name}?`,
            row.kind === 'cloud' ? 'cloud routine' : `task in ${row.repo}`,
            [`Changes ${what.join(' and ')}.`, row.kind === 'cloud' ? 'The change is made on claude.ai.' : `Rewrites ${row.dir.replace(/\\/g, '/')}/.claude/scheduled_tasks.json; every other task and field stays as it is.`, 'Nothing is committed.'],
            'Save',
            () => send(row, patch)
          );
        },
      },
      icon('save'),
      el('span', { className: 'cta-label' }, 'Save')
    ),
    'routinesWrite',
    `save|${row.key}`
  );
  function sync() {
    save.disabled = !Object.keys(changes()).length;
  }
  sync();
  return el(
    'div',
    { className: 'routines-detail' },
    el('div', { className: 'routines-detail-head' }, el('span', { className: 'routines-title' }, icon(row.kind === 'cloud' ? 'cloud' : 'repo'), row.name), save),
    el(
      'div',
      { className: 'routines-fields' },
      name ? field('Name', name, 'Name\nThe routine name on claude.ai.') : null,
      field('Schedule', cron, row.kind === 'cloud' ? 'Schedule\nFive cron fields in UTC, e.g. 0 5 * * 1.' : 'Schedule\nFive cron fields, as Claude Code reads them, e.g. */5 * * * *.'),
      el('div', { className: 'routines-facts' }, el('span', {}, row.schedule), el('span', {}, `Repository: ${row.repo}`), el('span', {}, `Last run: ${row.last}`), row.permanent ? el('span', { title: 'Permanent\nClaude Code does not delete this task by itself.' }, 'Permanent') : null)
    ),
    el('div', { className: 'routines-label' }, 'Prompt'),
    prompt,
    row.kind === 'cloud' ? el('div', { className: 'routines-hint' }, 'The prompt of a cloud routine is edited on claude.ai.') : null
  );
}

const FILTERS = [
  ['all', 'All', 'list-flat', 'Cloud routines and the tasks of your repositories.'],
  ['cloud', 'Cloud', 'cloud', 'The routines on claude.ai.'],
  ['repo', 'Repos', 'repo', 'The durable scheduled tasks in each repository.'],
];

export function renderRoutines() {
  const l = state.routines;
  if (l === undefined) {
    state.routines = null;
    ask();
  }
  const p = page();
  const all = rows();
  const body = el('div', { className: 'main-body' });
  if (!l) body.append(el('div', { className: 'empty flush' }, 'Reading the routines...'));
  else {
    const shown = all.filter(r => p.filter === 'all' || r.kind === p.filter);
    const opened = shown.find(r => r.key === p.open);
    const counts = f => (f === 'all' ? all.length : all.filter(r => r.kind === f).length);
    const bar = tabBar(FILTERS.map(([id, text, glyph, about]) => [id, text, glyph, about, counts(id)]), p.filter, id => ((p.filter = id), repaint()), 'Routines');
    body.append(
      ...[
        bar,
        l.note ? el('div', { className: 'routines-note' }, l.note) : null,
        p.note ? el('div', { className: 'routines-note', role: 'status' }, p.note) : null,
        shown.length ? table(shown) : el('div', { className: 'empty flush' }, p.filter === 'cloud' && l.note ? 'No cloud routines are listed.' : 'None yet.'),
        opened ? detail(opened) : null,
      ].filter(Boolean)
    );
  }
  return el('section', { className: 'main' }, countHead('watch', 'Routines', l ? plural(all.length, 'routine') : 'Claude Code', iconBtn('refresh', 'Reload', ask)), body);
}

const repaint = () => {
  if (state.page === 'routines' && !state.detail) render();
};

/** The host's replies: the list replaces what is shown, a result says what a write did in one line. */
export function onRoutinesMessage(m, paint) {
  if (m.type === 'routinesList') {
    state.routines = m.list;
    draft = undefined;
  } else {
    page().note = m.ok ? 'Saved.' : m.error || 'The change failed.';
    if (m.ok) draft = undefined;
    setTimeout(() => {
      page().note = '';
      paint();
    }, 6000);
  }
  paint();
}
