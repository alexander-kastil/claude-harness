// @ts-nocheck
// The Worktrees tab of the repo page: every git worktree with its state and the sessions that ran in it.
import { state, vscode } from './core';
import { el, icon, iconBtn, plural, stateTag, tag, tailPath } from './dom';
import { renderMain } from './main';
import { gridTable } from './tables';

export const WORKTREE_PERIODS = [7, 30, 90];

const periodOf = () => (WORKTREE_PERIODS.includes(state.worktreesDays) ? state.worktreesDays : 30);

// Asks the host for the list again, keeping what is on screen until the answer comes.
export const readWorktrees = scope => vscode.postMessage({ type: 'worktreesRead', scope, days: periodOf() });

const nameOf = w => String(w.path).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || w.path;

const sessionsTip = w => (w.sessions.length ? w.sessions.slice(0, 8).map(s => s.title || s.id).join('\n') + (w.sessions.length > 8 ? `\nand ${w.sessions.length - 8} more` : '') : 'No Claude session ran in this folder.');

const stateCell = w => {
  if (w.main) return tag('Main', 'The repository folder itself. It is never removed here.');
  if (w.stale.length) return stateTag('Stale', 'warn', w.stale.join('\n'));
  return w.locked ? tag('Locked', `Git keeps it from being removed: ${w.locked}`) : '';
};

export function renderWorktrees(view) {
  const days = periodOf();
  const data = state.worktrees && state.worktrees[view.id];
  if (data === undefined) {
    state.worktrees = { ...state.worktrees, [view.id]: null };
    readWorktrees(view.id);
  }
  const pick = n => {
    state.worktreesDays = n;
    // The tag depends on the period: the chip shows at once, the list follows when the host answers.
    readWorktrees(view.id);
    renderMain();
  };
  const periods = el(
    'div',
    { className: 'filter-bar', role: 'group', 'aria-label': 'Period for the Stale tag' },
    WORKTREE_PERIODS.map(n => el('button', { className: `preset${n === days ? ' on' : ''}`, 'aria-pressed': n === days ? 'true' : 'false', title: `Stale\nA worktree with no Claude session in the last ${n} days is tagged Stale.`, onclick: () => pick(n) }, el('span', {}, `${n} days`)))
  );
  const prune = el('button', { className: 'secondary', title: 'Prune\nDeletes git\'s records of worktrees whose folder is gone. Asks first.', onclick: () => vscode.postMessage({ type: 'worktreesPrune', scope: view.id, days }) }, icon('trash'), 'Prune');
  const head = el('div', { className: 'toolbar worktrees-bar' }, periods, prune);
  if (!data) return [head, el('div', { className: 'empty flush' }, 'Reading the worktrees...')];
  const note = data.note ? el('div', { className: `meta worktrees-note${data.failed ? ' bad' : ''}`, role: 'status' }, data.note) : null;
  if (!data.list.length) return [head, note, el('div', { className: 'empty flush' }, 'No worktrees listed.')];
  const table = gridTable(
    [
      { head: 'Worktree', track: 'minmax(96px, 3fr)', cls: 'at-name', cell: w => [icon(w.main ? 'repo' : 'git-branch'), el('span', { className: 'at-label' }, nameOf(w))], title: w => `${w.path}\n${w.stale.join('\n')}`.trim() },
      { head: 'Branch', track: 'minmax(0, 2fr)', muted: true, wide: true, cell: w => w.branch || (w.detached ? 'detached' : w.bare ? 'bare' : ''), title: w => (w.upstream ? `Upstream: ${w.upstream}` : 'No upstream') },
      { head: 'HEAD', track: '72px', num: true, wide: true, align: 'center', cell: w => w.head },
      { head: 'Changes', track: '92px', muted: true, align: 'center', cell: w => (w.changes === undefined ? '' : w.changes ? stateTag(plural(w.changes, 'change'), 'warn') : stateTag('Clean', 'ok')), title: w => (w.changes ? 'Changed or untracked files: git refuses to remove it.' : '') },
      { head: 'Ahead', track: '52px', num: true, align: 'center', cell: w => (w.ahead === undefined ? '-' : String(w.ahead)), title: w => (w.upstream ? `Commits ahead of ${w.upstream}` : 'No upstream') },
      { head: 'Behind', track: '56px', num: true, align: 'center', cell: w => (w.behind === undefined ? '-' : String(w.behind)), title: w => (w.upstream ? `Commits behind ${w.upstream}` : 'No upstream') },
      { head: 'Sessions', track: '68px', num: true, align: 'center', cell: w => String(w.sessions.length), title: sessionsTip },
      { head: 'State', track: '72px', muted: true, align: 'center', cell: stateCell },
      { head: '', track: '32px', align: 'center', cell: w => (w.main ? '' : iconBtn('trash', `Remove ${tailPath(w.path)}...`, e => (e && e.stopPropagation && e.stopPropagation(), vscode.postMessage({ type: 'worktreesRemove', scope: view.id, days, path: w.path })))) },
    ],
    data.list,
    'Worktrees'
  );
  return [head, note, table];
}
