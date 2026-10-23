// The Used in tab of an agent or skill on the detail page: the sessions that used it, from the host's transcript index.
// Opening the tab builds the index the first time; every other render only asks for an index that exists.
import type { Asset } from '../harness';
import type { UsageSession } from '../shared/messages';
import { kindLabel, state, vscode } from './core';
import { card } from './detail-view';
import type { Tab } from './detail-view';
import { el, fmtDate, icon } from './dom';
import { showSession } from './sessions';
import type { UsageState } from './state';
import { gridTable } from './tables';

const ABOUT: Record<string, string> = {
  agent: 'The sessions that launched the agent, newest first.',
  skill: 'The sessions that called the skill or ran it as a slash command, newest first.',
};

const usesText = (a: Asset, n: number) => (a.kind === 'agent' ? `${n} ${n === 1 ? 'launch' : 'launches'}` : `${n} ${n === 1 ? 'use' : 'uses'}`);

/** Asks the host where the element was used: `build` builds the transcript index when there is none yet. */
export const askUsage = (a: Asset, build: boolean) => vscode.postMessage({ type: 'usage', id: a.id, build });

function usageCard(a: Asset, info: UsageState | undefined): HTMLElement {
  const sessions = info?.sessions;
  const indexing = info?.indexing;
  return card(
    'Used in',
    sessions ? sessions.length : null,
    indexing
      ? el('div', { className: 'dv-empty' }, `Indexing ${indexing.done} of ${indexing.total} transcripts`)
      : !sessions
        ? el('div', { className: 'dv-empty' }, 'Reading the transcripts...')
        : !sessions.length
          ? el('div', { className: 'dv-empty' }, `This ${kindLabel(a.kind).toLowerCase()} was not used in any session.`)
          : null,
    sessions && sessions.length
      ? gridTable(
          [
            { head: 'Last used', track: '120px', muted: true, cell: (s: UsageSession) => (s.last ? fmtDate(s.last) : '-') },
            { head: 'Repo', track: 'minmax(0, 1fr)', muted: true, cell: (s: UsageSession) => s.repo },
            { head: 'Session', track: 'minmax(160px, 3fr)', cls: 'at-name', cell: (s: UsageSession) => [icon('comment-discussion'), el('span', { className: 'at-label' }, s.title)], title: (s: UsageSession) => s.title },
            { head: a.kind === 'agent' ? 'Launches' : 'Uses', track: '96px', num: true, cell: (s: UsageSession) => usesText(a, s.count) },
          ],
          sessions.map(s => Object.assign({ open: s.scope ? () => showSession(s.scope, s.id) : undefined }, s)),
          'Sessions'
        )
      : null
  );
}

export function usageTab(a: Asset): Tab {
  return {
    id: 'usage',
    label: 'Used in',
    glyph: 'history',
    about: ABOUT[a.kind] || '',
    live: true,
    get count() {
      return state.usage[a.id]?.sessions?.length;
    },
    onOpen: () => askUsage(a, true),
    body: () => usageCard(a, state.usage[a.id]),
  };
}
