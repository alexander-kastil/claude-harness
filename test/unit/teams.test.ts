import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { readInboxes, readTaskFiles, readTeam, teamFromThreads, teamName } from '../../src/teams';

const at = (s: number) => new Date(Date.UTC(2026, 10, 1, 9, 0, s)).toISOString();
const use = (s: number, name: string, id: string, input: object) => ({ type: 'assistant', timestamp: at(s), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (s: number, id: string, text: string) => ({ type: 'user', timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

const lead = [
  use(1, 'TaskCreate', 't1', { subject: 'Write the parser', description: 'x' }),
  result(2, 't1', 'Task #1 created successfully: Write the parser'),
  use(3, 'TaskCreate', 't2', { subject: 'Review the parser', description: 'y' }),
  result(4, 't2', 'Task #2 created successfully: Review the parser'),
  use(5, 'TaskUpdate', 'u1', { taskId: '1', owner: 'alice', status: 'in_progress' }),
  use(6, 'SendMessage', 'm1', { to: 'alice', summary: 'Start', message: 'Please start on task 1.' }),
  { type: 'user', timestamp: at(30), message: { role: 'user', content: '<teammate-message teammate_id="carol" summary="Hello">Carol has no transcript.</teammate-message>' } },
  { type: 'user', timestamp: at(31), message: { role: 'user', content: '<teammate-message teammate_id="alice" summary="Done">Duplicate of her own send.</teammate-message>' } },
];
const alice = [
  use(10, 'TaskUpdate', 'u2', { taskId: '1', status: 'completed' }),
  use(11, 'SendMessage', 'm2', { to: 'team-lead', summary: 'Done', message: 'Parser is written.' }),
  use(12, 'SendMessage', 'm3', { to: 'team-lead', message: '{"type":"idle_notification","from":"alice"}' }),
];

test('the task list is replayed from the transcripts in time order', () => {
  const r = teamFromThreads([{ records: lead }, { name: 'alice', records: alice }]);
  assert.deepEqual(r.tasks.map(t => [t.id, t.subject, t.status, t.owner]), [['1', 'Write the parser', 'completed', 'alice'], ['2', 'Review the parser', 'pending', undefined]]);
});

test('messages come from every SendMessage, a teammate without a transcript from its block, and protocol entries are left out', () => {
  const r = teamFromThreads([{ records: lead }, { name: 'alice', records: alice }]);
  assert.deepEqual(r.messages.map(m => [m.from, m.to, m.text]), [
    ['team-lead', 'alice', 'Please start on task 1.'],
    ['alice', 'team-lead', 'Parser is written.'],
    ['carol', 'team-lead', 'Carol has no transcript.'],
  ]);
});

test('Claude Code task files and inboxes are read when they are still there', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-'));
  const team = teamName('0123456789abcdef');
  assert.equal(team, 'session-01234567');
  assert.deepEqual(readTaskFiles(root, team), []);
  fs.mkdirSync(path.join(root, 'tasks', team), { recursive: true });
  fs.writeFileSync(path.join(root, 'tasks', team, '2.json'), JSON.stringify({ id: '2', subject: 'B', status: 'completed', owner: 'bob', blocks: [], blockedBy: ['1'] }));
  fs.writeFileSync(path.join(root, 'tasks', team, '1.json'), JSON.stringify({ id: '1', subject: 'A', status: 'bogus', blocks: [], blockedBy: [] }));
  assert.deepEqual(readTaskFiles(root, team).map(t => [t.id, t.status, t.owner, t.blockedBy]), [['1', 'pending', undefined, []], ['2', 'completed', 'bob', ['1']]]);
  fs.mkdirSync(path.join(root, 'teams', team, 'inboxes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'teams', team, 'inboxes', 'team-lead.json'),
    JSON.stringify([
      { from: 'bob', text: 'hi lead', timestamp: at(5), read: false, summary: 'hi' },
      { from: 'bob', text: '{"type":"idle_notification"}', timestamp: at(6) },
    ])
  );
  assert.deepEqual(readInboxes(root, team).map(m => [m.from, m.to, m.text]), [['bob', 'team-lead', 'hi lead']]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('readTeam reads the main transcript and the teammates named in the agent meta files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-'));
  const file = path.join(root, 'projects', 'p', 'abcdef12-0000.jsonl');
  const sub = path.join(root, 'projects', 'p', 'abcdef12-0000', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const jsonl = (rows: object[]) => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(file, jsonl(lead));
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), jsonl(alice.map(r => ({ ...r, isSidechain: true }))));
  fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ name: 'alice', taskKind: 'in_process_teammate' }));
  const team = await readTeam(file, 'abcdef12-0000', root);
  assert.equal(team.source, 'transcript');
  assert.equal(team.tasks.length, 2);
  assert.equal(team.messages.length, 3);
  fs.rmSync(root, { recursive: true, force: true });
});
