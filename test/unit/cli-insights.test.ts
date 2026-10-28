import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { Io, Stop, parse } from '../../src/cli-core';
import { delegationCommand, usageCommand } from '../../src/cli-insights';
import { projectSlug } from '../../src/fleet';
import { messageCost } from '../../src/sessions';

const NOW = Date.now();
/** A timestamp this many minutes before now, so the week window of `accountWeek` always holds the fixture. */
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60000).toISOString();
const SID = '11111111-2222-3333-4444-555555555555';
const SID2 = '66666666-7777-8888-9999-000000000000';

const OPUS_USAGE = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 50 };
const HAIKU_USAGE = { input_tokens: 20, output_tokens: 10 };
const SONNET_USAGE = { input_tokens: 5, output_tokens: 5 };
const LATER_USAGE = { input_tokens: 1000, output_tokens: 1000 };

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-insights-'));
  const root = path.join(tmp, '.claude');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const folder = path.join(root, 'projects', projectSlug(repo));
  const write = (file: string, records: unknown[]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  };
  const base = { cwd: repo, gitBranch: 'main', entrypoint: 'cli', version: '2.1.304' };
  write(path.join(folder, `${SID}.jsonl`), [
    { ...base, sessionId: SID, type: 'user', uuid: 'u1', timestamp: at(120), message: { role: 'user', content: 'build the thing' } },
    {
      ...base,
      sessionId: SID,
      type: 'assistant',
      timestamp: at(118),
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        usage: OPUS_USAGE,
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { subagent_type: 'fact-gatherer', description: 'Find facts', prompt: 'Read only', run_in_background: true } },
          { type: 'tool_use', id: 'toolu_2', name: 'Agent', input: { subagent_type: 'wpf-expert', description: 'Build the view', prompt: 'Build it' } },
        ],
      },
    },
    { ...base, sessionId: SID, type: 'user', timestamp: at(117), toolUseResult: { status: 'async_launched', agentId: 'aaa111' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'launched' }] } },
    { ...base, sessionId: SID, type: 'user', timestamp: at(110), toolUseResult: { status: 'async_launched', agentId: 'bbb222' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'launched' }] } },
    {
      ...base,
      sessionId: SID,
      type: 'user',
      timestamp: at(105),
      origin: { kind: 'task-notification' },
      message: { role: 'user', content: '<task-notification>\n<task-id>aaa111</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>completed</status>\n<summary>Agent done</summary>\n<result>All facts</result>\n</task-notification>' },
    },
  ]);
  const sub = path.join(folder, SID, 'subagents');
  // The message id m1 comes back in the subagent file: it must count once.
  write(path.join(sub, 'agent-aaa111.jsonl'), [
    { isSidechain: true, agentId: 'aaa111', type: 'user', timestamp: at(117), message: { role: 'user', content: 'Read only' } },
    { isSidechain: true, agentId: 'aaa111', type: 'assistant', timestamp: at(116), message: { id: 's1', model: 'claude-haiku-5-5', usage: HAIKU_USAGE, content: [{ type: 'text', text: 'All facts' }] } },
    { isSidechain: true, agentId: 'aaa111', type: 'assistant', timestamp: at(115), message: { id: 'm1', model: 'claude-opus-5-5', usage: OPUS_USAGE, content: [{ type: 'text', text: 'again' }] } },
  ]);
  fs.writeFileSync(path.join(sub, 'agent-aaa111.meta.json'), JSON.stringify({ agentType: 'fact-gatherer', description: 'Find facts', toolUseId: 'toolu_1', finished: true }));
  write(path.join(sub, 'agent-bbb222.jsonl'), [
    { isSidechain: true, agentId: 'bbb222', type: 'assistant', timestamp: at(108), message: { id: 's2', model: 'claude-sonnet-5-5', usage: SONNET_USAGE, content: [{ type: 'text', text: 'partial' }] } },
  ]);
  fs.writeFileSync(path.join(sub, 'agent-bbb222.meta.json'), JSON.stringify({ agentType: 'wpf-expert', description: 'Build the view', toolUseId: 'toolu_2' }));

  // An earlier session of the same repo, with no subagents and no delegation files.
  write(path.join(folder, `${SID2}.jsonl`), [
    { ...base, sessionId: SID2, type: 'user', uuid: 'v1', timestamp: at(600), message: { role: 'user', content: 'an earlier prompt' } },
    { ...base, sessionId: SID2, type: 'assistant', timestamp: at(599), message: { id: 'm9', model: 'claude-sonnet-5-5', usage: LATER_USAGE, content: [{ type: 'text', text: 'done' }] } },
  ]);
  // The list orders sessions by their last write, so the earlier session is made older than the fixture's.
  const older = new Date(NOW - 600 * 60000);
  fs.utimesSync(path.join(folder, `${SID2}.jsonl`), older, older);

  write(path.join(folder, SID, 'delegation-events.jsonl'), [
    { at: at(115), hook: 'PreToolUse', tone: 'warn', text: 'Main thread read a file' },
    { at: at(110), hook: 'PreToolUse', tone: 'ok', text: 'Agent launched' },
    { at: at(100), hook: 'SubagentStop', tone: 'warn', text: 'Agent stopped early' },
  ]);
  write(path.join(root, 'delegation-errors.jsonl'), [
    { session: SID, kind: 'lookup-on-main', status: 'open' },
    { session: SID, kind: 'lookup-on-main', status: 'closed' },
    { session: SID, kind: 'generic-owned', status: 'fixed' },
    { session: SID2, kind: 'lookup-on-main', status: 'open' },
  ]);
  return { tmp, root, repo };
}

function capture(): Io & { text: () => string } {
  const out: string[] = [];
  return { out: t => out.push(t), err: t => out.push(t), text: () => out.join('\n') };
}

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
const sessionCost = () => messageCost('claude-opus-5-5', OPUS_USAGE) + messageCost('claude-haiku-5-5', HAIKU_USAGE) + messageCost('claude-sonnet-5-5', SONNET_USAGE);

test('usage --json prices each model once across the main and subagent transcripts', async () => {
  const { root, repo } = fixture();
  const io = capture();
  assert.equal(await usageCommand(parse(['usage', '--session', 'latest', '--repo', repo, '--root', root, '--json']), io), 0);
  const json = JSON.parse(io.text());
  assert.equal(json.applied, false);
  assert.equal(json.session, SID);
  const models = Object.fromEntries(json.models.map((m: { model: string }) => [m.model, m]));
  assert.equal(models['claude-opus-5-5'].tokens, 160);
  assert.equal(models['claude-haiku-5-5'].tokens, 30);
  assert.equal(models['claude-sonnet-5-5'].tokens, 10);
  near(json.usd, sessionCost());
  near(models['claude-opus-5-5'].share + models['claude-haiku-5-5'].share + models['claude-sonnet-5-5'].share, 1);
  assert.equal(json.agents.find((g: { type: string }) => g.type === 'fact-gatherer').launches, 1);
  assert.equal(json.agents.find((g: { type: string }) => g.type === 'wpf-expert').launches, 1);
  assert.equal(json.week, undefined);
});

test('usage --week --week-used adds the week and the share of this session in it', async () => {
  const { root, repo } = fixture();
  const io = capture();
  assert.equal(await usageCommand(parse(['usage', '--session', SID, '--repo', repo, '--root', root, '--week', '--week-used', '40', '--json']), io), 0);
  const json = JSON.parse(io.text());
  const week = json.week;
  near(week.usd, sessionCost() + messageCost('claude-sonnet-5-5', LATER_USAGE));
  near(week.share, json.usd / week.usd);
  assert.equal(week.week_pct, Math.round(week.share * 40 * 1000) / 1000);
  assert.ok(!Number.isNaN(Date.parse(week.since)) && !Number.isNaN(Date.parse(week.until)));
});

test('usage --previous reads the session before the latest one', async () => {
  const { root, repo } = fixture();
  const io = capture();
  await usageCommand(parse(['usage', '--session', 'previous', '--repo', repo, '--root', root, '--json']), io);
  const json = JSON.parse(io.text());
  assert.equal(json.session, SID2);
  assert.equal(json.models.length, 1);
  assert.equal(json.models[0].model, 'claude-sonnet-5-5');
  assert.deepEqual(json.agents, []);
});

test('usage without --session stops with code 2, and an unknown session with code 1', async () => {
  const { root, repo } = fixture();
  await assert.rejects(usageCommand(parse(['usage', '--repo', repo, '--root', root]), capture()), (e: unknown) => e instanceof Stop && e.code === 2);
  await assert.rejects(usageCommand(parse(['usage', '--session', 'nope', '--repo', repo, '--root', root]), capture()), (e: unknown) => e instanceof Stop && e.code === 1);
});

test('delegation --json lists the agents, the decisions, the slips and the findings', async () => {
  const { root, repo } = fixture();
  const io = capture();
  assert.equal(await delegationCommand(parse(['delegation', '--session', 'latest', '--repo', repo, '--root', root, '--json']), io), 0);
  const json = JSON.parse(io.text());
  assert.equal(json.applied, false);
  assert.equal(json.session, SID);
  const agents = Object.fromEntries(json.agents.map((g: { type: string }) => [g.type, g]));
  assert.equal(agents['fact-gatherer'].status, 'done');
  assert.equal(agents['wpf-expert'].status, 'unknown');
  assert.deepEqual(json.decisions, { byHook: { PreToolUse: 2, SubagentStop: 1 }, byTone: { warn: 2, ok: 1 } });
  assert.deepEqual(json.slips, { open: 1, closed: 2, byKind: { 'lookup-on-main': 2, 'generic-owned': 1 } });
  assert.ok(json.findings.includes('The main thread did 2 lookups that a fact-gatherer should have made.'));
  assert.ok(json.findings.includes('A general-purpose agent did 1 piece of work that a specialist owned.'));
  assert.ok(json.findings.some((f: string) => f.includes('bbb222') && f.endsWith('not completed.')));
  assert.ok(!json.findings.some((f: string) => f.includes('aaa111')));
});

test('usage text is a headline and tables, with the week table when --week is given', async () => {
  const { root, repo } = fixture();
  const io = capture();
  await usageCommand(parse(['usage', '--session', SID, '--repo', repo, '--root', root, '--week', '--week-used', '40']), io);
  const text = io.text();
  assert.ok(text.startsWith('**Usage · 11111111 · $'));
  assert.ok(text.includes('| Model'));
  assert.ok(text.includes('| Agent type'));
  assert.ok(text.includes('| Week'));
  assert.match(text, /\| \d+\.\d{3}% \|$/m);
  assert.ok(!/\| \d+\.\d%/.test(text), 'shares are whole percentages');
});

test('delegation text is a headline, tables and a list of findings', async () => {
  const { root, repo } = fixture();
  const io = capture();
  await delegationCommand(parse(['delegation', '--session', SID, '--repo', repo, '--root', root]), io);
  const text = io.text();
  assert.ok(text.startsWith('**Delegation · 2 agents · 3 decisions · 1 open slips**'));
  assert.ok(text.includes('| Agent'));
  assert.ok(text.includes('| Hook'));
  assert.ok(text.includes('| Tone'));
  assert.ok(text.includes('| Slip kind'));
  assert.ok(text.includes('- The main thread did 2 lookups that a fact-gatherer should have made.'));
});

test('delegation with no delegation-events file reads zero decisions; slips are read from the shared file', async () => {
  const { root, repo } = fixture();
  const io = capture();
  await delegationCommand(parse(['delegation', '--session', 'previous', '--repo', repo, '--root', root, '--json']), io);
  const json = JSON.parse(io.text());
  assert.equal(json.session, SID2);
  assert.deepEqual(json.agents, []);
  assert.deepEqual(json.decisions, { byHook: {}, byTone: {} });
  assert.deepEqual(json.slips, { open: 1, closed: 0, byKind: { 'lookup-on-main': 1 } });
  assert.deepEqual(json.findings, ['The main thread did 1 lookup that a fact-gatherer should have made.']);
});

test('delegation with no delegation files at all reads zero counts and no findings', async () => {
  const { root, repo } = fixture();
  fs.rmSync(path.join(root, 'delegation-errors.jsonl'));
  const io = capture();
  await delegationCommand(parse(['delegation', '--session', 'previous', '--repo', repo, '--root', root, '--json']), io);
  const json = JSON.parse(io.text());
  assert.deepEqual(json.slips, { open: 0, closed: 0, byKind: {} });
  assert.deepEqual(json.findings, []);
});

test('delegation without --session stops with code 2', async () => {
  const { root, repo } = fixture();
  await assert.rejects(delegationCommand(parse(['delegation', '--repo', repo, '--root', root]), capture()), (e: unknown) => e instanceof Stop && e.code === 2);
});
