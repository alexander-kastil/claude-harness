// @ts-nocheck
// The Team view of the session page: the roster, the team's task list and the messages between the lead and the teammates.
import { agentColorClass, state, vscode } from './core';
import { clip, el, fmtDur, fmtNum, fmtTime, icon, shortModel, shortType, stateTag } from './dom';
import { STATUS_TONE, AGENT_STATUS, endOfAgent } from './session-common';

/** The session ran a team when one of its agents is a teammate. */
export const hasTeam = d => !!d && Array.isArray(d.agents) && d.agents.some(a => a.teammate);

const TASK_STATUS = { pending: ['pending', 'muted', 'Not started yet.'], in_progress: ['in progress', 'run', 'A teammate is working on it.'], completed: ['completed', 'ok', 'Finished.'] };

const keyOf = d => {
  const s = state.session;
  return `${s.scope}:${s.id}:${d.agents.length}:${Math.max(0, ...d.agents.map(a => endOfAgent(a) || 0))}`;
};

const section = (glyph, label, count, body) =>
  el('div', { className: 'teams-section' }, el('div', { className: 'teams-head' }, icon(glyph), el('span', {}, label), el('span', { className: 'badge' }, String(count))), body);

const empty = text => el('div', { className: 'teams-empty muted' }, text);

function roster(d) {
  const team = d.agents.filter(a => a.teammate);
  const rows = team.map(a => {
    const color = agentColorClass(a.color);
    const tokens = a.usage ? a.usage.input + a.usage.cacheCreate + a.usage.output : 0;
    const end = endOfAgent(a);
    return el(
      'tr',
      { 'data-teammate': a.name || a.id },
      el('td', {}, el('span', { className: 'teams-name' }, el('span', { className: `swatch teams-dot ${color}`, title: color ? `Color ${a.color}\nThe color Claude Code gave this teammate when it was spawned.` : undefined }), a.name || shortType(a.type))),
      el('td', {}, shortType(a.type)),
      el('td', { className: 'center' }, a.color || ''),
      el('td', {}, shortModel(a.model)),
      el('td', { className: 'num' }, tokens ? fmtNum(tokens) : ''),
      el('td', { className: 'num' }, typeof a.start === 'number' && end > a.start ? fmtDur(end - a.start) : ''),
      el('td', { className: 'center' }, stateTag(AGENT_STATUS[a.status] || a.status, STATUS_TONE[a.status]))
    );
  });
  return section(
    'organization',
    'Teammates',
    team.length,
    el('table', { className: 'grid teams-table' }, el('thead', {}, el('tr', {}, ['Name', 'Agent type', 'Color', 'Model', 'Tokens', 'Run time', 'State'].map(h => el('th', { className: ['Tokens', 'Run time'].includes(h) ? 'num' : ['Color', 'State'].includes(h) ? 'center' : '' }, h)))), el('tbody', {}, rows))
  );
}

function tasks(data) {
  if (!data.tasks.length) return section('checklist', 'Tasks', 0, empty('The team had no task list.'));
  const rows = data.tasks.map(t => {
    const [word, tone, about] = TASK_STATUS[t.status] || TASK_STATUS.pending;
    return el(
      'tr',
      { 'data-task': t.id },
      el('td', { className: 'num' }, `#${t.id}`),
      el('td', {}, clip(t.subject, 120)),
      el('td', {}, t.owner || ''),
      el('td', { className: 'center' }, stateTag(word, tone, about))
    );
  });
  return section('checklist', 'Tasks', data.tasks.length, el('table', { className: 'grid teams-table' }, el('thead', {}, el('tr', {}, el('th', { className: 'num' }, 'Task'), el('th', {}, 'Subject'), el('th', {}, 'Owner'), el('th', { className: 'center' }, 'Status'))), el('tbody', {}, rows)));
}

function messages(data, d) {
  if (!data.messages.length) return section('comment-discussion', 'Messages', 0, empty('No messages between the teammates and the lead.'));
  const colorOf = name => {
    const a = d.agents.find(x => x.name === name);
    return a ? agentColorClass(a.color) : '';
  };
  const rows = data.messages.map(m =>
    el(
      'div',
      { className: 'teams-msg', 'data-from': m.from },
      el('span', { className: 'teams-time muted' }, m.at ? fmtTime(m.at) : ''),
      el('span', { className: 'teams-who' }, el('span', { className: `swatch teams-dot ${colorOf(m.from)}` }), m.from, el('span', { className: 'muted' }, ' to '), m.to),
      el('span', { className: 'teams-text', title: m.text.length > 160 ? m.text : undefined }, m.summary ? el('b', {}, `${m.summary}: `) : null, clip(m.text, 160))
    )
  );
  return section('comment-discussion', 'Messages', data.messages.length, el('div', { className: 'teams-msgs' }, rows));
}

/** Draws the view; the task list and messages come from the host, so the first draw asks and the reply redraws. */
export function drawTeams(host, d) {
  const key = keyOf(d);
  const read = state.teamsRead;
  state.teamsRead = { key, data: read && read.key === key ? read.data : read && read.data && read.key.split(':').slice(0, 2).join(':') === key.split(':').slice(0, 2).join(':') ? read.data : undefined, host };
  if (!read || read.key !== key) vscode.postMessage({ type: 'teamsRead', scope: state.session.scope, id: state.session.id });
  const data = state.teamsRead.data;
  host.replaceChildren(el('div', { className: 'teams' }, roster(d), data ? tasks(data) : empty('Reading the team files'), data ? messages(data, d) : null));
}

/** The host's reply: keeps it and redraws the view when it is the one on screen. */
export function onTeamsMessage(m) {
  const s = state.session;
  const read = state.teamsRead;
  if (!s || s.scope !== m.scope || s.id !== m.id || !read) return;
  read.data = m.data;
  if (read.host && read.host.isConnected && s.data) drawTeams(read.host, s.data);
}
