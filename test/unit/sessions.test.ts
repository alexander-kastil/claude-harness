import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { projectSlug } from '../../src/repos-overview';
import { listSessions, messageCost, promptText, readSession, renameSession } from '../../src/sessions';

const at = (hms: string) => `2026-10-20T${hms}.000Z`;
const ms = (hms: string) => Date.parse(at(hms));

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sessions-'));
  const root = path.join(tmp, '.claude');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const folder = path.join(root, 'projects', projectSlug(repo));
  const write = (file: string, records: unknown[]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  };
  const sid = '11111111-2222-3333-4444-555555555555';
  const base = { cwd: repo, gitBranch: 'main', entrypoint: 'cli', sessionId: sid, version: '2.1.304' };
  write(path.join(folder, `${sid}.jsonl`), [
    { type: 'bridge-session', bridgeSessionId: 'x' },
    { ...base, type: 'user', uuid: 'u1', timestamp: at('10:00:00'), message: { role: 'user', content: 'build the thing' } },
    {
      ...base,
      type: 'assistant',
      timestamp: at('10:00:05'),
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 50 },
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 'fact-gatherer', description: 'Find facts', prompt: 'Read only', run_in_background: true } },
          { type: 'tool_use', id: 'toolu_2', name: 'Agent', input: { subagent_type: 'nope', description: 'Bad type', prompt: 'x' } },
        ],
      },
    },
    { ...base, type: 'user', timestamp: at('10:00:06'), toolUseResult: { status: 'async_launched', agentId: 'aaa111' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'launched' }] } },
    { ...base, type: 'user', timestamp: at('10:00:06'), toolUseResult: 'Error', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: "Agent type 'nope' not found." }] } },
    {
      ...base,
      type: 'assistant',
      timestamp: at('10:02:00'),
      message: {
        id: 'm2',
        model: 'claude-opus-5-5',
        content: [
          { type: 'tool_use', id: 'toolu_3', name: 'SendMessage', input: { to: 'aaa111', summary: 'more', message: 'also check x' } },
          { type: 'tool_use', id: 'toolu_4', name: 'Edit', input: { file_path: path.join(repo, 'a.txt') } },
        ],
      },
    },
    { type: 'queue-operation', operation: 'enqueue', timestamp: at('10:02:30'), sessionId: sid, content: 'i like svg' },
    { type: 'queue-operation', operation: 'remove', timestamp: at('10:02:31'), sessionId: sid, content: 'i like svg', reason: 'absorbed_mid_turn' },
    {
      ...base,
      type: 'user',
      timestamp: at('10:03:00'),
      origin: { kind: 'task-notification' },
      message: { role: 'user', content: '<task-notification>\n<task-id>aaa111</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>completed</status>\n<summary>Agent done</summary>\n<result>All facts</result>\n</task-notification>' },
    },
    { ...base, type: 'user', timestamp: at('10:04:00'), message: { role: 'user', content: '<command-message>report</command-message>\n<command-name>/report</command-name>\n<command-args>5m</command-args>' } },
  ]);
  const sub = path.join(folder, sid, 'subagents');
  write(path.join(sub, 'agent-aaa111.jsonl'), [
    { isSidechain: true, agentId: 'aaa111', type: 'user', timestamp: at('10:00:06'), message: { role: 'user', content: 'Read only' } },
    { isSidechain: true, agentId: 'aaa111', type: 'assistant', timestamp: at('10:00:10'), message: { id: 's1', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] } },
    { isSidechain: true, agentId: 'aaa111', type: 'assistant', timestamp: at('10:02:50'), message: { id: 's2', model: 'claude-haiku-5-5', usage: { input_tokens: 5, output_tokens: 20 }, content: [{ type: 'text', text: 'All facts' }] } },
  ]);
  fs.writeFileSync(path.join(sub, 'agent-aaa111.meta.json'), JSON.stringify({ agentType: 'fact-gatherer', description: 'Find facts', toolUseId: 'toolu_1', spawnDepth: 1, requestShape: 'background', finished: true }));

  const cid = '99999999-8888-7777-6666-555555555555';
  write(path.join(root, 'projects', projectSlug(path.join(tmp, 'Temp', 'claude', sid, 'scratchpad', 'run')), `${cid}.jsonl`), [
    { type: 'user', timestamp: at('10:01:00'), cwd: tmp, entrypoint: 'sdk-cli', sessionId: cid, message: { role: 'user', content: 'reply ok' } },
  ]);
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: sid, status: 'busy' }));
  return { tmp, root, repo, folder, sid, write };
}

test('promptText reads typed prompts and slash commands, and skips harness messages', () => {
  assert.equal(promptText('  fix   the\nbug '), 'fix the bug');
  assert.equal(promptText('<command-message>r</command-message>\n<command-name>/report</command-name>\n<command-args>5m</command-args>'), '/report 5m');
  assert.equal(promptText('<task-notification><task-id>a</task-id></task-notification>'), undefined);
  assert.equal(promptText('Another Claude session sent a message:\n<teammate-message teammate_id="x">hi</teammate-message>'), undefined);
  assert.equal(promptText([{ type: 'text', text: 'look at this' }, { type: 'image' }]), 'look at this');
});

test('messageCost prices each token kind by model, 1-hour cache writes at twice input', () => {
  const u = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 2e6, cache_creation: { ephemeral_1h_input_tokens: 1e6 } };
  assert.equal(messageCost('claude-opus-5-5', u), 4 + 20 + 0.2 + 4 * 1.25 + 4 * 2);
  assert.equal(messageCost('claude-haiku-5-5', { output_tokens: 2e6 }), 1);
  assert.equal(messageCost('<synthetic>', u), 0);
});

test('listSessions lists a repo session with its live status, agent count and headless child', () => {
  const { root, repo, sid } = fixture();
  const list = listSessions(repo, root);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, sid);
  assert.equal(list[0].title, 'build the thing');
  assert.equal(list[0].agents, 1);
  assert.deepEqual(list[0].types, ['fact-gatherer']);
  assert.equal(list[0].live, 'busy');
  assert.equal(list[0].branch, 'main');
  assert.equal(list[0].start, ms('10:00:00'));
  assert.equal(list[0].children.length, 1);
  assert.equal(list[0].children[0].title, 'reply ok');
  assert.equal(list[0].children[0].headless, true);
});

test('readSession links launches, reports, messages and failures into a timeline', async () => {
  const { root, repo } = fixture();
  const d = await readSession(listSessions(repo, root)[0]);
  assert.deepEqual(
    d.prompts.map(p => p.text),
    ['build the thing', 'i like svg', '/report 5m']
  );
  assert.equal(d.model, 'claude-opus-5-5');
  assert.equal(d.edits, 1);
  assert.equal(d.usage.output, 50);
  assert.ok(Math.abs(d.usage.cost - (10 * 4 + 100 * 4 * 1.25 + 50 * 20) / 1e6) < 1e-12);
  assert.equal(d.agents.length, 2);
  const facts = d.agents.find(a => a.id === 'aaa111')!;
  assert.equal(facts.type, 'fact-gatherer');
  assert.equal(facts.status, 'done');
  assert.equal(facts.background, true);
  assert.equal(facts.launchedAt, ms('10:00:05'));
  assert.equal(facts.start, ms('10:00:06'));
  assert.equal(facts.end, ms('10:02:50'));
  assert.deepEqual(facts.reports, [ms('10:03:00')]);
  assert.equal(facts.turns, 2);
  assert.deepEqual(facts.tools, { Read: 1 });
  assert.equal(facts.result, 'All facts');
  assert.equal(facts.model, 'claude-haiku-5-5');
  assert.ok(Math.abs(facts.usage.cost - (5 * 0.1 + 20 * 0.5) / 1e6) < 1e-12);
  const bad = d.agents.find(a => a.type === 'nope')!;
  assert.equal(bad.status, 'failed');
  assert.match(bad.error!, /not found/);
  assert.deepEqual(
    d.events.map(e => [e.kind, e.agent]),
    [['message', 'aaa111']]
  );
  assert.ok(d.findings.some(f => f.level === 'warn' && /nope "Bad type" failed/.test(f.text)));
  const failed = d.findings.find(f => f.kind === 'failed')!;
  assert.equal(failed.agent, bad.id);
  assert.deepEqual(failed.runs, [bad.id]);
  assert.match(failed.why!, /missing/);
  assert.match(failed.fix!, /Agents page/);
  // One edit on the main thread is no yardstick for a finding.
  assert.ok(!d.findings.some(f => f.kind === 'edits'));
  assert.equal(d.children.length, 1);
  assert.deepEqual(
    d.decisions.map(x => [x.action, x.shape, x.types, x.outcome, x.mainTools]),
    [
      ['delegated', 'agents together', ['fact-gatherer', 'nope'], 'a launch failed', 1],
      ['answered directly', undefined, [], undefined, 0],
      ['answered directly', undefined, [], undefined, 0],
    ]
  );
  assert.deepEqual(d.decisions[0].agents.slice().sort(), d.agents.map(a => a.id).sort());
});

test('readSession reads teammates, their idle reports and the agents they start', async () => {
  const { root, repo, folder, write } = fixture();
  const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const base = { cwd: repo, entrypoint: 'cli', sessionId: sid };
  write(path.join(folder, `${sid}.jsonl`), [
    { ...base, type: 'user', timestamp: at('11:00:00'), message: { role: 'user', content: 'gather facts' } },
    { ...base, type: 'assistant', timestamp: at('11:00:05'), message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_t', name: 'Agent', input: { name: 'facts-a', subagent_type: 'fact-gatherer', description: 'Facts A', prompt: 'go' } }] } },
    { ...base, type: 'user', timestamp: at('11:00:06'), toolUseResult: { status: 'teammate_spawned', agentId: 'afacts-a-123' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_t', content: 'spawned' }] } },
    {
      ...base,
      type: 'user',
      timestamp: at('11:05:01'),
      message: { role: 'user', content: 'Another Claude session sent a message:\n<teammate-message teammate_id="facts-a" color="blue">\n{"type":"idle_notification","from":"facts-a","timestamp":"2026-10-20T11:05:00.000Z","result":"Facts done"}\n</teammate-message>' },
    },
  ]);
  const sub = path.join(folder, sid, 'subagents');
  write(path.join(sub, 'agent-afacts-a-123.jsonl'), [
    { isSidechain: true, type: 'user', timestamp: at('11:00:07'), message: { role: 'user', content: 'go' } },
    { isSidechain: true, type: 'assistant', timestamp: at('11:01:00'), message: { id: 'x1', content: [{ type: 'tool_use', id: 'toolu_n', name: 'Agent', input: { subagent_type: 'fork', description: 'Nested', prompt: 'n' } }] } },
    { isSidechain: true, type: 'user', timestamp: at('11:01:01'), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_n', is_error: true, content: 'Teammates cannot spawn other teammates.' }] } },
    { isSidechain: true, type: 'assistant', timestamp: at('11:04:59'), message: { id: 'x2', content: [{ type: 'text', text: 'done' }] } },
  ]);
  fs.writeFileSync(path.join(sub, 'agent-afacts-a-123.meta.json'), JSON.stringify({ agentType: 'facts-a', name: 'facts-a', taskKind: 'in_process_teammate', customAgentType: 'fact-gatherer', requestShape: 'background', spawnDepth: 0 }));
  const summary = listSessions(repo, root).find(s => s.id === sid)!;
  const d = await readSession(summary);
  const mate = d.agents.find(a => a.id === 'afacts-a-123')!;
  assert.equal(mate.teammate, true);
  assert.equal(mate.name, 'facts-a');
  assert.equal(mate.type, 'fact-gatherer');
  assert.equal(mate.status, 'done');
  assert.equal(mate.result, 'Facts done');
  assert.deepEqual(mate.reports, [ms('11:05:00')]);
  const nested = d.agents.find(a => a.description === 'Nested')!;
  assert.equal(nested.parent, 'afacts-a-123');
  assert.equal(nested.depth, 1);
  assert.equal(nested.status, 'failed');
  assert.deepEqual(
    d.agents.map(a => a.id),
    ['afacts-a-123', nested.id]
  );
});

test('a session is named in the order of /resume and renamed like /rename', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-title-'));
  const root = path.join(tmp, '.claude');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const folder = path.join(root, 'projects', projectSlug(repo));
  fs.mkdirSync(folder, { recursive: true });
  const sid = '99999999-2222-3333-4444-555555555555';
  const file = path.join(folder, `${sid}.jsonl`);
  const prompt = { type: 'user', timestamp: at('10:00:00'), cwd: repo, entrypoint: 'cli', sessionId: sid, message: { role: 'user', content: 'first prompt text' } };
  const write = (extra: unknown[]) => fs.writeFileSync(file, [prompt, ...extra].map(r => JSON.stringify(r)).join('\n') + '\n');
  const title = () => listSessions(repo, root)[0].title;
  write([]);
  assert.equal(title(), 'first prompt text');
  write([{ type: 'summary', summary: 'a summary', leafUuid: 'x' }]);
  assert.equal(title(), 'a summary');
  write([{ type: 'summary', summary: 'a summary' }, { type: 'ai-title', aiTitle: 'ai one', sessionId: sid }, { type: 'ai-title', aiTitle: 'ai two', sessionId: sid }]);
  assert.equal(title(), 'ai two');
  renameSession(file, 'my name');
  assert.equal(title(), 'my name');
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, sid, 'custom-title.json'), 'utf8')).customTitle, 'my name');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('"agent-name"'));
  write([{ type: 'agent-name', agentName: 'named', sessionId: sid }, { type: 'custom-title', customTitle: 'named', sessionId: sid }]);
  assert.equal(title(), 'named');
  renameSession(file, 'renamed');
  assert.equal(title(), 'renamed');
  fs.writeFileSync(file, JSON.stringify({ type: 'system', timestamp: at('10:00:00') }) + '\n');
  assert.equal(title(), sid.slice(0, 8));
  fs.rmSync(tmp, { recursive: true, force: true });
});
