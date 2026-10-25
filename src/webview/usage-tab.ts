// The Used in tab of an agent, skill, command or output style on the detail page, and the Loaded in tab of a rule or CLAUDE.md:
// the sessions that used or loaded it, from the host's transcript index, and a 7-day strip of its uses.
// Opening the tab builds the index the first time; every other render only asks for an index that exists.
import type { Asset } from '../harness';
import type { UsageSession } from '../shared/messages';
import { kindLabel, metaOf, state, viewOf, vscode } from './core';
import { analyzeRowButton } from './confirm';
import { card } from './detail-view';
import type { Tab } from './detail-view';
import { el, fmtDate, icon, plural } from './dom';
import { showSession } from './sessions';
import type { UsageState } from './state';
import { gridTable } from './tables';
import { askMore, dayStrip, elementCount, moreOf } from './usage-more';

const ABOUT: Record<string, string> = {
  agent: 'The sessions that launched the agent, newest first.',
  skill: 'The sessions that called the skill or ran it as a slash command, newest first.',
  command: 'The sessions that ran the command, newest first.',
  outputStyle: 'The sessions that ran with this output style, newest first. The style is matched by the name in its frontmatter.',
  rule: 'The sessions that loaded the rule, newest first.',
  memory: 'The sessions that loaded the file, newest first.',
};

/** The kinds with a Used in (or, for rules and memory, Loaded in) tab. */
export const hasUsageTab = (a: Asset) => a.kind in ABOUT;

const loads = (a: Asset) => a.kind === 'rule' || a.kind === 'memory';

const launches = (n: number) => `${n} ${n === 1 ? 'launch' : 'launches'}`;
const usesText = (a: Asset, n: number) => (a.kind === 'agent' ? launches(n) : plural(n, 'use'));

/** How a memory file came into the session: at its start, or when Claude read a file its globs match. */
const howText = (info: string | undefined) => (info === undefined ? 'At start' : info ? `Matched ${info}` : 'Read in its folder');

/** Asks the host where the element was used, and for its 7-day strip: `build` builds the transcript index when there is none yet. */
export const askUsage = (a: Asset, build: boolean) => {
  vscode.postMessage({ type: 'usage', id: a.id, build });
  askMore(a, build);
};

function usageCard(a: Asset, info: UsageState | undefined): HTMLElement {
  const sessions = info?.sessions;
  const indexing = info?.indexing;
  const more = moreOf(a.id)?.more;
  const scoped = loads(a) && a.kind === 'rule' && !!(metaOf(a).paths || []).length;
  // The marker is a claim about sessions: it needs sessions in the rule's repo. A repo without any says so instead.
  const repo = scoped && a.scope !== state.views[0]?.id ? viewOf(a.scope) : undefined;
  const repoSessions = repo ? state.sessions[repo.id] : undefined;
  if (repo && repoSessions === undefined) {
    state.sessions[repo.id] = null;
    vscode.postMessage({ type: 'sessions', scope: repo.id });
  }
  const noneYet = !!repo && Array.isArray(repoSessions) && !repoSessions.length;
  const never = scoped && !noneYet && (!repo || Array.isArray(repoSessions));
  const word = loads(a) ? 'loaded' : 'used';
  return card(
    loads(a) ? 'Loaded in' : 'Used in',
    sessions ? sessions.length : null,
    indexing
      ? el('div', { className: 'dv-empty' }, `Indexing ${indexing.done} of ${indexing.total} transcripts`)
      : !sessions
        ? el('div', { className: 'dv-empty' }, 'Reading the transcripts...')
        : !sessions.length
          ? el(
              'div',
              { className: `dv-empty${never ? ' warn' : ''}` },
              never ? el('span', { className: 'dv-chip warn' }, icon('warning'), 'Never matched') : null,
              never
                ? ' No session read a file that matches its paths.'
                : noneYet
                  ? `No session has run in ${repo!.label} yet, so nothing could load this rule.`
                  : scoped && repo
                    ? `Checking the sessions of ${repo.label}...`
                    : `This ${kindLabel(a.kind).toLowerCase()} was not ${word} in any session.`
            )
          : null,
    sessions && sessions.length && more ? dayStrip(more.days) : null,
    sessions && sessions.length
      ? gridTable(
          [
            { head: loads(a) ? 'Last loaded' : 'Last used', track: '120px', muted: true, cell: (s: UsageSession) => (s.last ? fmtDate(s.last) : '') },
            { head: 'Repo', track: 'minmax(88px, 1.2fr)', muted: true, cell: (s: UsageSession) => s.repo, title: (s: UsageSession) => s.repo },
            { head: 'Session', track: 'minmax(100px, 3fr)', cls: 'at-name', cell: (s: UsageSession) => [icon('comment-discussion'), el('span', { className: 'at-label' }, s.title)], title: (s: UsageSession) => s.title },
            loads(a)
              ? { head: 'Loaded', track: 'minmax(96px, 1fr)', muted: true, cell: (s: UsageSession) => howText(s.info), title: (s: UsageSession) => howText(s.info) }
              : { head: a.kind === 'agent' ? 'Launches' : 'Uses', track: '96px', num: true, cell: (s: UsageSession) => usesText(a, s.count) },
            ...(a.kind === 'agent'
              ? [{ head: 'Hooks', track: 'minmax(96px, 1fr)', muted: true, wide: true, cell: (s: UsageSession) => agentHooksText(s), title: (s: UsageSession) => agentHooksTip(s) }]
              : []),
            { head: '', track: '58px', cell: (s: UsageSession) => (s.scope ? analyzeRowButton(s.scope, s.id) : null) },
          ],
          sessions.map(s => Object.assign({ open: s.scope ? () => showSession(s.scope, s.id) : undefined }, s)),
          'Sessions'
        )
      : null
  );
}

/** What hooks and mods did inside the agent's own transcript in a session: tool calls denied, hook failures. */
const agentHooksText = (s: UsageSession) => {
  const h = s.hooks;
  if (!h || (!h.denied && !h.failed)) return '';
  return [h.denied ? `${h.denied} denied` : '', h.failed ? `${h.failed} failed` : ''].filter(Boolean).join(' · ');
};

const agentHooksTip = (s: UsageSession) => {
  const h = s.hooks;
  if (!h || (!h.denied && !h.failed)) return '';
  return `Hook events in this agent's transcript\n${h.denied ? `${plural(h.denied, 'tool call')} denied by a hook or mod\n` : ''}${h.failed ? `${plural(h.failed, 'hook run')} failed` : ''}`.trim();
};

const FIRED_ABOUT: Record<string, string> = {
  hook: 'The sessions where the hook ran, newest first, with the runs, the failures and the average time. Runs are matched by event and matcher, and by command when the transcript records one, so two hooks with the same event, matcher and command cannot be told apart.',
  hookScript: 'The sessions where a hook that runs this script ran, newest first. Runs are matched by event and matcher, and by command when the transcript records one, so two hooks with the same event, matcher and command cannot be told apart.',
};

export const hasFiredTab = (a: Asset) => a.kind in FIRED_ABOUT;

const FIRED_TAB = 'fired';

/** Asks the host where the hook ran; `build` builds the transcript index when there is none yet. */
export const askFired = (a: Asset, build: boolean) => vscode.postMessage({ type: 'usage', id: a.id, build });

const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

function firedCard(a: Asset, info: UsageState | undefined): HTMLElement {
  const sessions = info?.sessions;
  return card(
    'Fired in',
    sessions ? sessions.length : null,
    info?.indexing
      ? el('div', { className: 'dv-empty' }, `Indexing ${info.indexing.done} of ${info.indexing.total} transcripts`)
      : !sessions
        ? el('div', { className: 'dv-empty' }, info?.built === false ? 'Open this tab to read the transcripts.' : 'Reading the transcripts...')
        : !sessions.length
          ? el('div', { className: 'dv-empty' }, `This ${kindLabel(a.kind).toLowerCase()} did not run in any session.`)
          : null,
    sessions && sessions.length
      ? gridTable(
          [
            { head: 'Last run', track: '120px', muted: true, cell: (s: UsageSession) => (s.last ? fmtDate(s.last) : '') },
            { head: 'Repo', track: 'minmax(88px, 1.2fr)', muted: true, cell: (s: UsageSession) => s.repo, title: (s: UsageSession) => s.repo },
            { head: 'Session', track: 'minmax(100px, 3fr)', cls: 'at-name', cell: (s: UsageSession) => [icon('comment-discussion'), el('span', { className: 'at-label' }, s.title)], title: (s: UsageSession) => s.title },
            { head: 'Runs', track: '64px', num: true, cell: (s: UsageSession) => String(s.fired?.runs ?? s.count) },
            {
              head: 'Failed',
              track: '96px',
              num: true,
              tone: (s: UsageSession) => (s.fired?.failed ? 'bad' : ''),
              cell: (s: UsageSession) => (s.fired?.failed ? `${s.fired.failed}${s.fired.exit !== undefined ? ` (exit ${s.fired.exit})` : ''}` : ''),
              title: (s: UsageSession) => (s.fired?.failed ? `${plural(s.fired.failed, 'failed run')}${s.fired.exit !== undefined ? `\nLast exit code ${s.fired.exit}` : ''}` : ''),
            },
            { head: 'Avg time', track: '84px', num: true, wide: true, cell: (s: UsageSession) => (s.fired?.avgMs ? secs(s.fired.avgMs) : '') },
            { head: '', track: '58px', cell: (s: UsageSession) => (s.scope ? analyzeRowButton(s.scope, s.id) : null) },
          ],
          sessions.map(s => Object.assign({ open: s.scope ? () => showSession(s.scope, s.id) : undefined }, s)),
          'Sessions'
        )
      : null
  );
}

/** The Fired in tab of a hook or hook script: the sessions where it ran. Opening it builds the transcript index the first time. */
export function firedTab(a: Asset): Tab {
  return {
    id: FIRED_TAB,
    label: 'Fired in',
    glyph: 'zap',
    about: FIRED_ABOUT[a.kind] || '',
    live: true,
    get count() {
      return state.usage[a.id]?.sessions?.length;
    },
    onOpen: () => askFired(a, true),
    body: () => firedCard(a, state.usage[a.id]),
  };
}

export function usageTab(a: Asset): Tab {
  return {
    id: 'usage',
    label: loads(a) ? 'Loaded in' : 'Used in',
    glyph: loads(a) ? 'list-flat' : 'history',
    about: ABOUT[a.kind] || '',
    live: true,
    get count() {
      return state.usage[a.id]?.sessions?.length;
    },
    onOpen: () => askUsage(a, true),
    body: () => usageCard(a, state.usage[a.id]),
  };
}

interface Row {
  kind: 'skill' | 'agent' | 'command';
  name: string;
  count: number;
  sessions: number;
  last: number;
}

/** The plugin page's Used in tab: every skill, agent and command of the plugin with how often it was used, and the 7-day strip. */
export function pluginUsageTab(plugin: Asset, skills: { a: Asset }[], agents: { a: Asset }[]): Tab {
  const body = () => {
    const mine = moreOf(plugin.id);
    const more = mine?.more;
    const rows: Row[] = [];
    const known = new Set<string>();
    const add = (kind: 'skill' | 'agent', name: string) => {
      known.add(`${kind === 'agent' ? 'agent' : 'use'}\0${name}`);
      const e = more?.elements?.find(x => x.kind === (kind === 'agent' ? 'agent' : 'use') && x.name === name);
      rows.push({ kind, name, count: e?.count ?? 0, sessions: e?.sessions ?? 0, last: e?.last ?? 0 });
    };
    for (const s of skills) add('skill', s.a.name);
    for (const s of agents) add('agent', s.a.name);
    // What was used and is not a skill or agent the plugin lists now: its commands, or an element since removed.
    for (const e of more?.elements ?? []) if (!known.has(`${e.kind}\0${e.name}`)) rows.push({ kind: e.kind === 'agent' ? 'agent' : 'command', name: e.name, count: e.count, sessions: e.sessions, last: e.last });
    rows.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
    return card(
      'Used in',
      more ? more.total : null,
      mine?.indexing
        ? el('div', { className: 'dv-empty' }, `Indexing ${mine.indexing.done} of ${mine.indexing.total} transcripts`)
        : !more
          ? el('div', { className: 'dv-empty' }, 'Reading the transcripts...')
          : !more.total
            ? el('div', { className: 'dv-empty' }, 'None of its skills, agents or commands was used in any session.')
            : null,
      more && more.total ? dayStrip(more.days) : null,
      more && rows.length
        ? gridTable(
            [
              { head: 'Element', track: 'minmax(160px, 3fr)', cls: 'at-name', cell: (r: Row) => [icon(r.kind === 'agent' ? 'hubot' : r.kind === 'skill' ? 'mortar-board' : 'terminal'), el('span', { className: 'at-label' }, r.name)], title: (r: Row) => r.name },
              { head: 'Kind', track: '90px', muted: true, cell: (r: Row) => (r.kind === 'agent' ? 'Agent' : r.kind === 'skill' ? 'Skill' : 'Command') },
              { head: 'Last used', track: '120px', muted: true, cell: (r: Row) => (r.last ? fmtDate(r.last) : '') },
              { head: 'Sessions', track: '84px', num: true, cell: (r: Row) => String(r.sessions) },
              { head: 'Uses', track: '84px', num: true, cell: (r: Row) => (r.kind === 'agent' ? launches(r.count) : plural(r.count, 'use')) },
            ],
            rows,
            'Plugin elements'
          )
        : null
    );
  };
  return {
    id: 'usage',
    label: 'Used in',
    glyph: 'history',
    about: 'How often the plugin\'s skills, agents and commands were used, and on which days.',
    live: true,
    get count() {
      return moreOf(plugin.id)?.more?.total;
    },
    onOpen: () => askMore(plugin, true),
    body,
  };
}

/** A list of a plugin's skills or agents, each row ending in how often it was used once the usage index is known. */
export function usedRefList(plugin: Asset, entries: { a: Asset; v: unknown }[], empty: string, kind: 'agent' | 'use', refRow: (e: any) => HTMLElement): HTMLElement {
  if (!entries.length) return el('div', { className: 'dv-empty' }, empty);
  return el(
    'div',
    { className: 'ref-list' },
    entries.map(e => {
      const row = refRow(e);
      const n = elementCount(plugin, kind, e.a.name);
      if (n === undefined) return row;
      row.classList.add('has-uses');
      row.append(el('span', { className: `ref-uses${n ? '' : ' none'}` }, n ? (kind === 'agent' ? launches(n) : plural(n, 'use')) : 'never used'));
      return row;
    })
  );
}
