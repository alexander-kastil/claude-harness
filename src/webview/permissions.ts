// @ts-nocheck
// The Permissions page: the allow, ask and deny rules, the default mode and the additional directories of each scope, and a Prompted in
// tab with the tools that asked for permission. Every change is a message the host answers with its confirm card.
import { showPage, state, vscode } from './core';
import { countHead, el, fmtAgo, icon, iconBtn, plural, stateTag, tag } from './dom';
import { renderMain } from './main';
import { tabBar } from './repo-page';
import { gridTable } from './tables';

const SCOPES = {
  user: ['User', 'account', 'Your own settings, for every repository: ~/.claude/settings.json.'],
  project: ['Project', 'folder', "The repository's shared settings: .claude/settings.json."],
  local: ['Local', 'lock', "Your private settings for the repository: .claude/settings.local.json, kept out of git."],
  managed: ['Managed', 'shield', 'Set by your organisation. Read only here.'],
};
const LISTS = [
  ['allow', 'Allow', 'check', 'Used without asking.'],
  ['ask', 'Ask', 'question', 'Always asks first.'],
  ['deny', 'Deny', 'circle-slash', 'Never used.'],
  ['additionalDirectories', 'Additional directories', 'folder-opened', 'Folders Claude may work in besides the repository.'],
];
const PERIODS = [
  [1, '24 hours'],
  [7, '7 days'],
  [30, '30 days'],
  [0, 'All'],
];

const tab = () => state.permissionsTab || 'rules';
const days = () => (state.permissionsDays === undefined ? 7 : state.permissionsDays);
const files = () => (state.permissionsData ? state.permissionsData.files : []);
const fileOf = scope => files().find(f => f.scope === scope);

const askPrompted = () => {
  state.permissionsPrompted = null;
  vscode.postMessage({ type: 'permissionsPrompted', days: days() });
};
const reload = () => {
  vscode.postMessage({ type: 'permissionsRead', dir: state.permissionsDir });
  if (tab() === 'prompted') askPrompted();
};
const write = (scope, change) => vscode.postMessage({ type: 'permissionsWrite', dir: state.permissionsDir, scope, change });

export function onPermissionsMessage(m, repaint) {
  if (m.type === 'permissionsData') state.permissionsData = m.data;
  else if (m.days === days()) state.permissionsPrompted = { days: m.days, result: m.result };
  repaint();
}

export function permissionsNavRow(treeItem, level) {
  const selected = !state.detail && state.page === 'permissions';
  return treeItem(
    el('div', { className: `row${selected ? ' selected' : ''}`, title: 'Permissions\nThe allow, ask and deny rules, the default mode and the extra folders of each scope, and the tools that asked for permission.', onclick: () => showPage('permissions') }, icon('shield'), el('span', { className: 'name' }, 'Permissions')),
    'p|permissions',
    level
  );
}

// A chip row: one chip is selected.
const chips = (items, current, pick, label) =>
  el(
    'div',
    { className: 'view-tabs permissions-chips', role: 'group', 'aria-label': label },
    items.map(([id, text, glyph, about]) =>
      el('button', { type: 'button', className: `view-tab${id === current ? ' active' : ''}`, 'aria-pressed': id === current ? 'true' : 'false', title: about ? `${text}\n${about}` : undefined, onclick: () => pick(id) }, glyph ? icon(glyph) : null, el('span', {}, text))
    )
  );

const repos = () => state.views.slice(1).filter(v => v.local && v.id !== 'cowork');

const repoChips = () => {
  const all = repos();
  if (!all.length) return null;
  return el(
    'div',
    { className: 'permissions-line' },
    el('span', { className: 'permissions-cap' }, 'Repository'),
    chips(
      all.map(v => [v.path, v.label, 'repo', v.path]),
      state.permissionsDir,
      dir => {
        state.permissionsDir = dir;
        state.permissionsData = undefined;
        vscode.postMessage({ type: 'permissionsRead', dir });
        redraw();
      },
      'Repository'
    )
  );
};

const redraw = () => renderMain();

// One list of a scope: its rows with a remove button each and, unless the file is read only, a field that adds an entry.
function listBlock(file, [id, label, glyph, about]) {
  const rows = file[id];
  const block = el('section', { className: 'permissions-block', 'aria-label': label });
  block.append(el('div', { className: 'group-label permissions-label', title: `${label}\n${about}` }, icon(glyph), el('span', {}, label), el('span', { className: 'tab-count' }, rows.length)));
  if (!rows.length) block.append(el('div', { className: 'permissions-none' }, 'None'));
  for (const value of rows) {
    block.append(
      el(
        'div',
        { className: 'permissions-row', 'data-rule': value },
        icon(glyph),
        el('code', { className: 'permissions-rule', title: value }, value),
        file.readOnly ? null : iconBtn('trash', `Remove\nTakes ${value} out of ${label.toLowerCase()} in this file.`, () => write(file.scope, { op: 'remove', list: id, value }))
      )
    );
  }
  if (!file.readOnly) {
    const field = el('input', { type: 'text', className: 'permissions-input', placeholder: id === 'additionalDirectories' ? 'A folder, for example ../shared' : id === 'allow' ? 'A rule, for example Bash(npm test *)' : 'A rule, for example Bash(rm *)', 'aria-label': `New ${label.toLowerCase()} entry`, spellcheck: false });
    const add = () => {
      const value = field.value.trim();
      if (value) write(file.scope, { op: 'add', list: id, value });
    };
    field.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
    block.append(el('div', { className: 'permissions-add' }, field, el('button', { type: 'button', className: 'primary', title: `Add\nAdds the entry to ${label.toLowerCase()} in this file.`, onclick: add }, icon('add'), 'Add')));
  }
  return block;
}

const modeChips = file => {
  const modes = state.permissionsData.modes;
  const current = file.defaultMode === 'manual' ? 'default' : file.defaultMode || '';
  const unknown = current && !modes.some(m => m.id === current);
  return el(
    'section',
    { className: 'permissions-block', 'aria-label': 'Default mode' },
    el('div', { className: 'group-label permissions-label', title: 'Default mode\nHow Claude Code treats tools no rule covers, when a session starts in this scope.' }, icon('settings-gear'), el('span', {}, 'Default mode')),
    el(
      'div',
      { className: 'view-tabs permissions-chips', role: 'group', 'aria-label': 'Default mode' },
      [['', 'Not set', 'Removes the key: Claude Code uses its default.'], ...modes.map(m => [m.id, m.label, m.about]), ...(unknown ? [[current, current, 'A value this panel does not know.']] : [])].map(([id, text, about]) =>
        el(
          'button',
          { type: 'button', className: `view-tab${id === current ? ' active' : ''}`, 'data-mode': id || 'unset', 'aria-pressed': id === current ? 'true' : 'false', disabled: file.readOnly, title: `${text}${id ? ` (${id})` : ''}\n${about}`, onclick: () => id !== current && write(file.scope, { op: 'mode', value: id }) },
          el('span', {}, text)
        )
      )
    )
  );
};

function renderRules() {
  const body = [];
  const present = Object.keys(SCOPES).filter(s => fileOf(s) || (s === 'project' || s === 'local' ? !!state.permissionsDir : s === 'user'));
  const scope = present.includes(state.permissionsScope) ? state.permissionsScope : 'user';
  body.push(repoChips());
  body.push(
    chips(
      present.map(s => [s, SCOPES[s][0], SCOPES[s][1], SCOPES[s][2]]),
      scope,
      s => {
        state.permissionsScope = s;
        redraw();
      },
      'Scope'
    )
  );
  const file = fileOf(scope);
  if (!file) {
    body.push(el('div', { className: 'empty flush' }, state.permissionsData ? 'Pick a repository.' : 'Reading the settings...'));
    return body;
  }
  body.push(
    el(
      'div',
      { className: 'permissions-line permissions-file' },
      tag(file.readOnly ? 'read only' : file.exists ? 'on disk' : 'not created yet', file.readOnly ? 'Managed settings are set by your organisation and cannot be changed here.' : file.exists ? 'The file exists.' : 'The first change creates the file.'),
      el('span', { className: 'permissions-path', title: file.path }, file.path),
      file.error ? stateTag(file.error, 'fail', 'The file is not valid JSON, so nothing can be added until it is fixed.') : null
    )
  );
  if (state.permissionsData.note) body.push(el('div', { className: 'permissions-note', role: 'status' }, state.permissionsData.note));
  body.push(modeChips(file));
  for (const l of LISTS) body.push(listBlock(file, l));
  return body;
}

const covered = (pattern, allow) => allow.includes(pattern) || allow.includes(pattern.replace(/\(.*$/, ''));

function renderPrompted() {
  const body = [];
  const target = state.permissionsAllowIn || 'user';
  const prompted = state.permissionsPrompted && state.permissionsPrompted.days === days() ? state.permissionsPrompted : undefined;
  if (!prompted && state.permissionsPrompted !== null) askPrompted();
  const scopes = ['user', ...(state.permissionsDir ? ['project', 'local'] : [])];
  body.push(
    el(
      'div',
      { className: 'permissions-line' },
      el('span', { className: 'permissions-cap' }, 'Period'),
      chips(
        PERIODS.map(([d, text]) => [d, text, undefined, d ? `The sessions of the last ${text}.` : 'Every session on this PC.']),
        days(),
        d => {
          state.permissionsDays = d;
          askPrompted();
          redraw();
        },
        'Period'
      ),
      el('span', { className: 'permissions-cap' }, 'Allow in'),
      chips(
        scopes.map(s => [s, SCOPES[s][0], SCOPES[s][1], `Allow adds the rule to the ${SCOPES[s][0].toLowerCase()} settings.`]),
        target,
        s => {
          state.permissionsAllowIn = s;
          redraw();
        },
        'Allow in'
      )
    )
  );
  if (state.permissionsData && state.permissionsData.note) body.push(el('div', { className: 'permissions-note', role: 'status' }, state.permissionsData.note));
  if (!prompted) {
    body.push(el('div', { className: 'empty flush' }, 'Reading the sessions...'));
    return body;
  }
  const rows = prompted.result.rows;
  if (!rows.length) {
    body.push(el('div', { className: 'empty flush' }, 'No tool asked for permission in this period.'));
    return body;
  }
  const allow = (fileOf(target) || { allow: [] }).allow;
  body.push(
    gridTable(
      [
        { head: 'Rule', track: 'minmax(180px, 3fr)', cls: 'at-name', cell: r => [icon('shield'), el('code', { className: 'at-label permissions-rule' }, r.pattern)], title: r => `${r.pattern}\n${r.sample}` },
        { head: 'Tool', track: 'minmax(80px, 120px)', muted: true, low: true, cell: r => tag(r.tool) },
        { head: 'Prompts', track: 'minmax(64px, 80px)', num: true, cell: r => String(r.count), title: r => `${plural(r.count, 'prompt')}: ${r.once} allowed once, ${r.always} allowed for good, ${r.denied} denied.` },
        {
          head: 'Answer',
          track: 'minmax(90px, 110px)',
          align: 'center',
          cell: r => (r.denied && !(r.once + r.always) ? stateTag('Denied', 'fail') : r.denied ? stateTag('Mixed', 'warn') : stateTag('Allowed', 'ok')),
          title: r => `${r.once} allowed once, ${r.always} allowed for good, ${r.denied} denied.`,
        },
        { head: 'Last', track: 'minmax(80px, 110px)', muted: true, low: true, cell: r => fmtAgo(r.last) },
        {
          head: 'Allow',
          track: 'minmax(90px, 110px)',
          align: 'center',
          cell: r =>
            covered(r.pattern, allow)
              ? stateTag('In rules', 'ok', `${r.pattern} is already in allow of the ${SCOPES[target][0].toLowerCase()} settings.`)
              : el('button', { type: 'button', className: 'secondary permissions-allow', title: `Allow\nAdds ${r.pattern} to allow in the ${SCOPES[target][0].toLowerCase()} settings.`, onclick: () => write(target, { op: 'add', list: 'allow', value: r.pattern }) }, icon('check'), 'Allow'),
        },
      ],
      rows,
      'Tools that asked for permission'
    )
  );
  return body;
}

export function renderPermissions() {
  const tabs = [
    ['rules', 'Rules', 'law', 'The allow, ask and deny rules, the default mode and the additional directories of each scope.'],
    ['prompted', 'Prompted in', 'bell', 'The tools that asked for permission in the sessions of a period, counted per rule.'],
  ];
  const result = state.permissionsPrompted && state.permissionsPrompted.result;
  const sub = tab() === 'prompted' && result ? `${plural(result.rows.length, 'rule')} asked in ${plural(result.sessions, 'session')}` : 'What Claude may do without asking';
  return el(
    'section',
    { className: 'main permissions-page' },
    countHead('shield', 'Permissions', sub, iconBtn('refresh', 'Reload', reload)),
    el(
      'div',
      { className: 'main-body' },
      tabBar(
        tabs,
        tab(),
        id => {
          state.permissionsTab = id;
          if (id === 'prompted') askPrompted();
          redraw();
        },
        'Permissions'
      ),
      ...(state.permissionsData ? (tab() === 'rules' ? renderRules() : renderPrompted()) : [el('div', { className: 'empty flush' }, 'Reading the settings...')])
    )
  );
}
