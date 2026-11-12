// UI test of the Team view of the session page, run in a real, isolated VS Code (see harness.mjs) on a fixture session
// with two teammates, a team task list and messages. Nothing here points at the real ~/.claude: the instance gets the fixture home.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { repoRoot } from './fixture.mjs';
import { Session } from './harness.mjs';

const { projectSlug } = createRequire(import.meta.url)(path.join(repoRoot, 'out', 'src', 'repos-overview.js'));
const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const SHOTS = process.env.TEAMS_SHOTS;

const ID = 'abcdef12-0000-4000-8000-000000000042';
const TITLE = 'Coordinate the parser team';
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const jsonl = (file, records) => write(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');

// A lead that spawns alice and bob as teammates, creates two tasks, hands one out and gets a message back.
function teamSession(repo, claude) {
  const start = Date.now() - 3600_000;
  const at = sec => new Date(start + sec * 1000).toISOString();
  const base = { cwd: repo, gitBranch: 'main', entrypoint: 'cli', sessionId: ID, version: '2.1.304' };
  const usage = { input_tokens: 40, cache_creation_input_tokens: 9000, cache_read_input_tokens: 52000, output_tokens: 1800 };
  const use = (sec, name, id, input) => ({ ...base, type: 'assistant', timestamp: at(sec), message: { id: `m${id}`, model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id, name, input }] } });
  const result = (sec, id, text, extra = {}) => ({ ...base, type: 'user', timestamp: at(sec), ...extra, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  const spawn = (sec, name, id, agentId) => [
    use(sec, 'Agent', id, { subagent_type: 'general-purpose', name, description: `${name} works on the parser`, prompt: 'Join the team', run_in_background: true }),
    result(sec + 1, id, 'spawned', { toolUseResult: { status: 'teammate_spawned', agentId, name } }),
  ];
  const main = [
    { ...base, type: 'user', timestamp: at(5), message: { role: 'user', content: TITLE } },
    ...spawn(10, 'alice', 'toolu_a', 'agent-alice-1'),
    ...spawn(12, 'bob', 'toolu_b', 'agent-bob-1'),
    use(20, 'TaskCreate', 'toolu_t1', { subject: 'Write the parser', description: 'x' }),
    result(21, 'toolu_t1', 'Task #1 created successfully: Write the parser'),
    use(22, 'TaskCreate', 'toolu_t2', { subject: 'Review the parser', description: 'y' }),
    result(23, 'toolu_t2', 'Task #2 created successfully: Review the parser'),
    use(24, 'TaskCreate', 'toolu_t3', { subject: 'Publish the parser', description: 'z' }),
    result(25, 'toolu_t3', 'Task #3 created successfully: Publish the parser'),
    use(30, 'TaskUpdate', 'toolu_u1', { taskId: '1', owner: 'alice', status: 'in_progress' }),
    use(31, 'SendMessage', 'toolu_s1', { to: 'alice', summary: 'Start the parser', message: 'Please start on task 1.' }),
    use(32, 'TaskUpdate', 'toolu_u2', { taskId: '2', owner: 'bob', status: 'in_progress' }),
    { ...base, type: 'assistant', timestamp: at(400), message: { id: 'last', model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'Finished.' }] } },
  ];
  const folder = path.join(claude, 'projects', projectSlug(repo));
  jsonl(path.join(folder, `${ID}.jsonl`), main);
  const sub = path.join(folder, ID, 'subagents');
  const member = (agentId, name, color, model, records) => {
    jsonl(path.join(sub, `agent-${agentId}.jsonl`), records.map(r => ({ isSidechain: true, agentId, ...r })));
    write(path.join(sub, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: `${name} works on the parser`, name, color, model, taskKind: 'in_process_teammate', spawnedAgentType: 'claude', spawnDepth: 1 }));
  };
  const turn = (sec, id, content, model) => ({ type: 'assistant', timestamp: at(sec), message: { id, model, usage: { input_tokens: 800, output_tokens: 600, cache_read_input_tokens: 12000 }, content } });
  member('agent-alice-1', 'alice', 'green', 'claude-sonnet-5-5', [
    { type: 'user', timestamp: at(15), message: { role: 'user', content: 'Join the team' } },
    turn(60, 'a1', [{ type: 'tool_use', id: 'ta1', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }], 'claude-sonnet-5-5'),
    turn(70, 'a2', [{ type: 'tool_use', id: 'ta2', name: 'SendMessage', input: { to: 'team-lead', summary: 'Parser done', message: 'The parser is written and the tests pass.' } }], 'claude-sonnet-5-5'),
    turn(80, 'a3', [{ type: 'tool_use', id: 'ta3', name: 'SendMessage', input: { to: 'bob', summary: 'Ready for review', message: 'Task 1 is finished, you can review it.' } }], 'claude-sonnet-5-5'),
    turn(90, 'a4', [{ type: 'tool_use', id: 'ta4', name: 'SendMessage', input: { to: 'team-lead', message: '{"type":"idle_notification","from":"alice"}' } }], 'claude-sonnet-5-5'),
  ]);
  member('agent-bob-1', 'bob', 'orange', 'claude-haiku-5-5', [
    { type: 'user', timestamp: at(16), message: { role: 'user', content: 'Join the team' } },
    turn(120, 'b1', [{ type: 'tool_use', id: 'tb1', name: 'SendMessage', input: { to: 'alice', summary: 'Review notes', message: 'Two naming nits, nothing blocking.' } }], 'claude-haiku-5-5'),
  ]);
  const last = new Date(start + 400 * 1000);
  for (const f of [path.join(folder, `${ID}.jsonl`), ...fs.readdirSync(sub).map(f => path.join(sub, f))]) fs.utimesSync(f, last, last);
}

before(async () => {
  await s.start();
  teamSession(s.fixture.repoDirs['shop-api'], s.fixture.claude);
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
});

after(() => s.stop());

const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);

test('a session with teammates has a Team view with the roster, the tasks and the messages in order', T, async () => {
  await s.mouse('.overview-tabs .view-tab', 'Last sessions');
  await s.waitFor(D => D.querySelector('.overview-tabs .view-tab.active')?.textContent.includes('Last sessions'));
  await s.mouse('.main [role=row]', TITLE);
  await s.waitFor(D => D.querySelector('.view-tab[data-view="teams"]'));
  const tabs = await s.ev(D => [...D.querySelectorAll('.view-tabs[aria-label="Session views"] .view-tab')].map(t => t.dataset.view));
  assert.equal(tabs.length, 7, `seven views: ${tabs}`);
  assert.equal(tabs[6], 'teams');
  await s.mouse('.view-tab[data-view="teams"]');
  await s.waitFor(D => D.querySelector('.teams-msg'));

  const roster = await s.ev(D => [...D.querySelectorAll('[data-teammate]')].map(r => [...r.children].map(c => c.textContent.trim())));
  assert.equal(roster.length, 2);
  const alice = roster.find(r => r[0] === 'alice');
  assert.deepEqual([alice[2], alice[3]], ['green', 'sonnet-5-5']);
  assert.match(alice[4], /\d/, `alice's tokens: ${alice[4]}`);
  assert.ok(alice[5], `alice's run time: ${alice[5]}`);
  assert.equal(roster.find(r => r[0] === 'bob')[2], 'orange');
  assert.ok(await s.ev(D => D.querySelector('[data-teammate="alice"] .teams-dot').classList.contains('ac-green')), 'the dot has the spawn color');

  const tasks = await s.ev(D => [...D.querySelectorAll('[data-task]')].map(r => [...r.children].map(c => c.textContent.trim())));
  assert.deepEqual(tasks, [['#1', 'Write the parser', 'alice', 'completed'], ['#2', 'Review the parser', 'bob', 'in progress'], ['#3', 'Publish the parser', '', 'pending']]);

  const msgs = await s.ev(D => [...D.querySelectorAll('.teams-msg')].map(m => m.querySelector('.teams-who').textContent.replace(/\s+/g, ' ').trim() + ' | ' + m.querySelector('.teams-text').textContent.trim()));
  assert.deepEqual(msgs, [
    'team-lead to alice | Start the parser: Please start on task 1.',
    'alice to team-lead | Parser done: The parser is written and the tests pass.',
    'alice to bob | Ready for review: Task 1 is finished, you can review it.',
    'bob to alice | Review notes: Two naming nits, nothing blocking.',
  ]);
  assert.doesNotMatch(await text(), /idle_notification/, 'protocol messages are not shown');
  assert.doesNotMatch(await text('.teams'), /—/, 'no em dashes');
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await s.ev(D => D.querySelector('.teams').scrollIntoView({ block: 'start' }));
    await s.screenshot(path.join(SHOTS, 'teams.png'));
  }
});

test('a session without teammates has no Team view', T, async () => {
  await s.chord('Escape');
  await s.mouse('.sidebar-head [aria-label="Overview"]');
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.mouse('.overview-tabs .view-tab', 'Last sessions');
  await s.mouse('.main [role=row]', 'Add the checkout endpoint');
  await s.waitFor(D => D.querySelector('.view-tab[data-view="timeline"]'));
  const tabs = await s.ev(D => [...D.querySelectorAll('.view-tabs[aria-label="Session views"] .view-tab')].map(t => t.dataset.view));
  assert.equal(tabs.length, 6, `six views: ${tabs}`);
  assert.ok(!tabs.includes('teams'));
  assert.ok(await s.ev(D => D.querySelector('.view-tab[data-view="timeline"]').classList.contains('active')), 'a stored Team choice falls back to the Timeline');
});
