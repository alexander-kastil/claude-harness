// @ts-nocheck
// The Status line page under Settings: pick the fields and their order, watch the line, Save writes the script and the
// `statusLine` setting of the chosen scope, Remove puts the earlier value back. Both writes ask on the house confirm card first.
import { confirmAt, showConfirm } from './confirm';
import { state, vscode } from './core';
import { el, icon, iconBtn, pageHead } from './dom';
import { renderMain } from './main';
import { tabBar } from './repo-page';
import { STATUSLINE_FIELDS, statuslineText } from '../shared/statusline-fields';
import type { StatuslineInput } from '../shared/statusline-fields';
import type { StatuslineScope, StatuslineState, ToWebview } from '../shared/messages';

// What the preview shows: a session with the figures Claude Code documents, in the shape Claude Code sends them.
const SAMPLE: StatuslineInput = {
  model: { display_name: 'Opus' },
  context_window: { used_percentage: 42 },
  rate_limits: { five_hour: { used_percentage: 23.5 }, seven_day: { used_percentage: 41.2 } },
  cost: { total_cost_usd: 1.234 },
  workspace: { current_dir: '/work/my-repo' },
};

const scope = (): StatuslineScope => state.statuslineScope || 'user';
const data = (): StatuslineState | undefined => state.statuslineData?.[scope()];
const ids = () => STATUSLINE_FIELDS.map(f => f.id as string);

// The order the page holds: the fields of the script already written first, in its order, then the rest. Undefined until the scope was read.
const layout = (): { order: string[]; on: Set<string> } => {
  const key = scope();
  if (!state.statuslineEdit) state.statuslineEdit = {};
  const held = state.statuslineEdit[key];
  if (held) return held;
  const d = data();
  // A scope with no script of this builder starts from the common four.
  const saved = d && d.fields.length ? d.fields : ['model', 'context', 'branch', 'folder'];
  const fresh = { order: [...saved, ...ids().filter(i => !saved.includes(i))], on: new Set(saved) };
  if (d) state.statuslineEdit[key] = fresh;
  return fresh;
};

const askScope = () => vscode.postMessage({ type: 'statuslineRead', scope: scope() });

export function onStatuslineMessage(m: Extract<ToWebview, { type: 'statuslineState' }>) {
  state.statuslineData = { ...state.statuslineData, [m.state.scope]: m.state };
  // A write was saved: the page now holds what the file holds.
  if (m.note) {
    state.statuslineNote = m.note;
    if (state.statuslineEdit) delete state.statuslineEdit[m.state.scope];
  }
  if (state.page === 'statusline' && !state.detail) renderMain();
}

const move = (order: string[], i: number, by: number) => {
  const j = i + by;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  renderMain();
};

const settingsName = (d: StatuslineState) => (d.scope === 'user' ? 'the user settings' : 'the project settings');

export function renderStatusline() {
  const d = data();
  const { order, on } = layout();
  const chosen = order.filter(i => on.has(i));
  const line = statuslineText(chosen, SAMPLE, 'main');
  const available = !d || d.available;

  const save = confirmAt(
    el(
      'button',
      {
        className: 'primary',
        disabled: !d || !available || !chosen.length,
        title: !chosen.length ? 'Save\nTurn on at least one field.' : `Save\nWrites the script and sets statusLine in ${d ? settingsName(d) : 'the settings'}. The rest of the file stays as it is.`,
        onclick: () =>
          showConfirm({
            kind: 'statuslineSave',
            file: d.settingsFile,
            script: d.scriptFile,
            replaces: d.installed ? undefined : d.current === undefined ? undefined : JSON.stringify(d.current),
            onConfirm: () => vscode.postMessage({ type: 'statuslineSave', scope: scope(), fields: chosen }),
          }),
      },
      icon('save'),
      'Save'
    ),
    'statuslineSave'
  );
  const remove = confirmAt(
    el(
      'button',
      {
        className: 'secondary',
        disabled: !d || !d.installed,
        title: d && d.installed ? `Remove\nDeletes the script and puts back the statusLine value that was in ${settingsName(d)} before${d.hasPrevious ? '' : ': none, so the key is removed'}.` : 'Remove\nThis scope has no status line from this builder.',
        onclick: () => showConfirm({ kind: 'statuslineRemove', file: d.settingsFile, script: d.scriptFile, hasPrevious: d.hasPrevious, onConfirm: () => vscode.postMessage({ type: 'statuslineRemove', scope: scope() }) }),
      },
      icon('trash'),
      'Remove'
    ),
    'statuslineRemove'
  );

  const scopes = tabBar(
    [
      ['user', 'User', 'account', 'Every session of yours: the settings in your Claude folder.'],
      ['project', 'Project', 'folder', 'The open folder: its .claude/settings.json.'],
    ],
    scope(),
    id => {
      state.statuslineScope = id;
      state.statuslineNote = '';
      askScope();
      renderMain();
    },
    'Scope'
  );

  const rows = order.map((id, i) => {
    const f = STATUSLINE_FIELDS.find(x => x.id === id);
    const sw = el('input', {
      type: 'checkbox',
      role: 'switch',
      id: `statusline-${id}`,
      checked: on.has(id),
      'aria-label': f.label,
      onchange: e => {
        e.target.checked ? on.add(id) : on.delete(id);
        renderMain();
      },
    });
    return el(
      'div',
      { className: `statusline-row${on.has(id) ? ' on' : ''}`, title: `${f.label}\n${f.hint}` },
      el('span', { className: 'statusline-no' }, on.has(id) ? String(chosen.indexOf(id) + 1) : ''),
      sw,
      el('label', { for: `statusline-${id}`, className: 'statusline-name' }, f.label),
      el('span', { className: 'statusline-move' }, iconBtn('arrow-up', 'Move up', () => move(order, i, -1), i === 0), iconBtn('arrow-down', 'Move down', () => move(order, i, 1), i === order.length - 1))
    );
  });

  const status = !d ? 'Reading the settings...' : !available ? 'Open a folder to set a project status line.' : state.statuslineNote ? `${state.statuslineNote}: ${d.settingsFile}` : d.installed ? `In use: ${d.scriptFile}` : d.current ? 'This scope has a status line of its own. Saving replaces it; Remove puts it back.' : 'No status line is set in this scope.';

  return el(
    'section',
    { className: 'main' },
    pageHead('layout-statusbar', 'Status line', 'The line Claude Code shows under the prompt', save, remove),
    el(
      'div',
      { className: 'main-body statusline-page' },
      scopes,
      el('div', { className: 'group-label' }, 'Preview'),
      el('div', { className: 'statusline-preview', 'aria-label': 'Preview of the status line', title: 'Preview\nThe line for a sample session. Claude Code shows the real figures.' }, line || el('span', { className: 'statusline-none' }, 'Nothing on')),
      el('div', { className: 'group-label' }, 'Fields'),
      el('div', { className: 'statusline-fields' }, rows),
      el('div', { className: 'empty flush statusline-status' }, status)
    )
  );
}
