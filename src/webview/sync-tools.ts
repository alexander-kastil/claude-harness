// @ts-nocheck
// Sync instructions across tools: CLAUDE.md is the source; AGENTS.md, Cursor rules and Copilot instructions (or, globally, the
// tools' own global files) are the targets. Each row says whether the target exists and matches, and opens the compare.
import { confirmAt } from './confirm';
import { showPage, state, viewOf, vscode } from './core';
import { countHead, el, icon, iconBtn, plural, stateTag, tag } from './dom';
import { hideHover } from './hover';
import { showKindPage } from './kind-page';
import { render } from './main';
import { gridTable } from './tables';

const STATE_TONE = { same: 'ok', differs: 'warn', missing: 'none' };
const STATE_WORD = { same: 'in sync', differs: 'differs', missing: 'missing' };
const STATE_TIP = {
  same: 'In sync\nThis file holds the CLAUDE.md text as the tool reads it.',
  differs: 'Differs\nThis file exists and its text is not the CLAUDE.md text. Compare shows both side by side; Sync overwrites it after a backup.',
  missing: 'Missing\nThe tool has no instruction file here. Sync creates it.',
};

// Opened from the Memory page of Global or of a repo.
export function openSyncTools(scope) {
  state.syncToolsPage = { scope };
  state.syncToolsPick = undefined;
  showPage('sync-tools');
}

export const askSyncTools = () => {
  const p = state.syncToolsPage;
  if (p) vscode.postMessage({ type: 'syncToolsRead', scope: p.scope });
};

const picked = data => {
  if (!state.syncToolsPick || state.syncToolsPick.scope !== data.scope) state.syncToolsPick = { scope: data.scope, ids: new Set(data.targets.filter(t => t.state !== 'same').map(t => t.id)) };
  return state.syncToolsPick.ids;
};

export function renderSyncTools() {
  const p = state.syncToolsPage || { scope: 'global' };
  const data = state.syncTools && state.syncTools.scope === p.scope ? state.syncTools : undefined;
  const view = viewOf(p.scope);
  const where = p.scope === 'global' ? 'Global' : view ? view.label : p.scope;
  const back = iconBtn('arrow-left', `Back to Memory in ${where}`, () => (hideHover(), showKindPage('memory', p.scope)));
  const body = el('div', { className: 'main-body' });
  if (!data) {
    body.append(el('div', { className: 'empty flush' }, 'Reading the instruction files...'));
    return el('section', { className: 'main' }, countHead('sync', 'Sync instructions', where, back), body);
  }
  const ids = picked(data);
  const todo = data.targets.filter(t => ids.has(t.id) && t.state !== 'same');
  const sync = confirmAt(
    el(
      'button',
      {
        className: 'primary',
        disabled: !todo.length,
        title: todo.length ? `Sync\nWrites the chosen files from ${data.source.label}. A card names every file first, and the files it overwrites are backed up.` : 'Sync\nNo chosen file differs from CLAUDE.md.',
        onclick: () => (hideHover(), vscode.postMessage({ type: 'syncToolsWrite', scope: data.scope, targets: [...ids] })),
      },
      icon('sync'),
      'Sync'
    ),
    'panel',
    'sync-tools'
  );
  const sub = data.error ? data.error : data.source.exists ? `${data.source.label} to ${plural(data.targets.length, 'tool file')}` : `No ${data.source.label}`;
  const head = countHead('sync', 'Sync instructions', `${where} · ${sub}`, back, sync);
  if (data.error || !data.source.exists) {
    body.append(el('div', { className: 'empty flush' }, data.error || `There is no ${data.source.label}, so there is nothing to sync.`));
    return el('section', { className: 'main' }, head, body);
  }
  const src = data.source;
  body.append(
    el(
      'div',
      { className: 'sync-tools-source', title: `Source\n${src.file}` },
      icon('markdown'),
      el('span', { className: 'sync-tools-name' }, src.label),
      tag(`${src.chars.toLocaleString()} chars`),
      src.imports ? tag(plural(src.imports, 'import'), 'Imports\nOther tools do not follow @imports: the text of this file is copied as it stands, the imported files are not.') : ''
    )
  );
  const table = gridTable(
    [
      {
        head: '',
        track: '48px',
        align: 'center',
        cell: t =>
          el('input', {
            type: 'checkbox',
            role: 'switch',
            checked: ids.has(t.id),
            disabled: t.state === 'same',
            'aria-label': `Sync ${t.label}`,
            onclick: e => e.stopPropagation(),
            onchange: e => {
              e.target.checked ? ids.add(t.id) : ids.delete(t.id);
              render();
            },
          }),
        title: t => (t.state === 'same' ? 'Already in sync' : 'Include in Sync'),
      },
      { head: 'File', track: 'minmax(160px, 2fr)', cls: 'at-name', cell: t => [icon(t.exists ? 'file' : 'new-file'), el('span', { className: 'at-label' }, t.label)], title: t => t.file },
      { head: 'Tool', track: 'minmax(100px, 1.2fr)', muted: true, cell: t => t.tool },
      { head: 'State', track: '96px', align: 'center', cell: t => stateTag(STATE_WORD[t.state], STATE_TONE[t.state]), title: t => STATE_TIP[t.state] },
      {
        head: 'Claude Code',
        track: '96px',
        muted: true,
        align: 'center',
        wide: true,
        cell: t => (t.load ? stateTag(t.load.state, t.load.state === 'not loaded' ? 'warn' : 'ok') : ''),
        title: t => (t.load ? `Claude Code ${t.load.state === 'not loaded' ? 'does not load' : 'loads'} this file\n${t.load.why}` : ''),
      },
      {
        head: 'Compare',
        track: '72px',
        align: 'center',
        cell: t =>
          el(
            'button',
            {
              type: 'button',
              className: 'icon-btn',
              title: `Compare\nOpens ${t.exists ? t.label : 'an empty file'} and what the sync would write side by side.`,
              'aria-label': `Compare ${t.label}`,
              onclick: e => (e.stopPropagation(), hideHover(), vscode.postMessage({ type: 'syncToolsDiff', scope: data.scope, target: t.id })),
            },
            icon('diff')
          ),
      },
    ],
    data.targets.map(t => Object.assign({}, t)),
    'Instruction files'
  );
  body.append(table);
  if (data.wrote && data.wrote.length) body.append(el('div', { className: 'sync-tools-note' }, `Wrote ${plural(data.wrote.length, 'file')}.`));
  return el('section', { className: 'main' }, head, body);
}
