import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFindings, fitGeneralFindings, fitSpecialist, span } from '../../src/findings';
import type { AgentRun, SessionEvent, Usage } from '../../src/sessions';

const usage = (): Usage => ({ input: 0, cacheCreate: 0, cacheCreate1h: 0, cacheRead: 0, output: 0, cost: 0, costParts: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 } });
const T = Date.parse('2026-10-24T10:00:00Z');
const at = (min: number, sec = 0) => T + min * 60000 + sec * 1000;

const run = (over: Partial<AgentRun> & { id: string }): AgentRun => ({
  type: 'article-writer',
  description: 'Write the article',
  prompt: '',
  depth: 0,
  background: false,
  teammate: false,
  launchedAt: at(0),
  start: at(0),
  end: at(5),
  reports: [at(5)],
  status: 'done',
  turns: 4,
  tools: {},
  usage: usage(),
  ...over,
});

const base = { events: [] as SessionEvent[], prompts: [], hookFailures: [], mainEdits: 0 };

test('a stopped run names the prompt that came right before the stop and the run that finished the job', () => {
  const stopped = run({ id: 's', status: 'stopped', launchedAt: at(1), start: at(1) });
  const again = run({ id: 'r', launchedAt: at(6), start: at(6), end: at(20), reports: [at(20)] });
  const stop: SessionEvent = { at: at(4, 10), kind: 'stop', target: 's', agent: 's', text: 'stopped' };
  const [f] = buildFindings({ ...base, agents: [stopped, again], events: [stop], prompts: [{ at: at(3, 30), text: 'This is not an article!' }] });
  assert.equal(f.kind, 'stopped');
  assert.equal(f.level, 'info');
  assert.match(f.text, /was stopped and run again$/);
  assert.match(f.note!, /Stopped 40 s after your prompt "This is not an article!", so most likely on purpose\./);
  assert.match(f.note!, /article-writer "Write the article" finished the job afterwards/);
  assert.match(f.why!, /bought nothing/);
  assert.deepEqual(f.runs, ['s']);
  assert.equal(f.agent, 's');
});

test('a stopped run nothing replaced stays a warning, and a stop without a recent prompt says Claude did it', () => {
  const stopped = run({ id: 's', status: 'stopped' });
  const stop: SessionEvent = { at: at(40), kind: 'stop', target: 's', agent: 's', text: 'stopped' };
  const [f] = buildFindings({ ...base, agents: [stopped], events: [stop], prompts: [{ at: at(2), text: 'go' }] });
  assert.equal(f.level, 'warn');
  assert.equal(f.text, 'article-writer "Write the article" was stopped');
  assert.match(f.note!, /Claude stopped it without a prompt of yours shortly before/);
  assert.match(f.why!, /probably missing/);
  const [none] = buildFindings({ ...base, agents: [stopped] });
  assert.match(none.note!, /holds no stop request/);
});

test('failed, silent and resumed runs say why they matter and what to do', () => {
  const failed = run({ id: 'f', description: 'One', status: 'failed', error: "Agent type 'x' not found.\nmore" });
  const silent = run({ id: 'q', description: 'Two', status: 'unknown', turns: 0 });
  const talked = run({ id: 't', description: 'Three', reports: [at(5)] });
  const messages: SessionEvent[] = [at(6), at(7)].map(t => ({ at: t, kind: 'message', target: 't', agent: 't', text: 'again' }));
  const out = buildFindings({ ...base, agents: [failed, silent, talked], events: messages });
  const by = (kind: string) => out.find(f => f.kind === kind)!;
  assert.equal(by('failed').text, `article-writer "One" failed: Agent type 'x' not found.`);
  assert.match(by('failed').fix!, /Agents page/);
  assert.match(by('silent').note!, /left no transcript/);
  assert.match(by('silent').fix!, /transcript on the map/);
  assert.equal(by('resumed').text, 'article-writer "Three" got 2 messages after it reported');
  assert.ok(out.every(f => f.why && f.fix), 'every finding carries why and fix');
  assert.deepEqual(
    out.map(f => f.level),
    ['warn', 'warn', 'info'],
    'warnings come first'
  );
});

test('a job launched several times lists the runs and says whether the earlier ones finished', () => {
  const runs = [run({ id: 'a', status: 'failed' }), run({ id: 'b' }), run({ id: 'c', description: 'Other' })];
  const [f] = buildFindings({ ...base, agents: runs }).filter(x => x.kind === 'repeated');
  assert.equal(f.text, 'article-writer "Write the article" was launched 2 times');
  assert.deepEqual(f.runs, ['a', 'b']);
  assert.equal(f.note, 'Runs: failed, done.');
  assert.match(f.why!, /1 run did not finish/);
  const same = buildFindings({ ...base, agents: [run({ id: 'a' }), run({ id: 'b' })] }).find(x => x.kind === 'repeated')!;
  assert.match(same.why!, /Every run finished/);
});

test('a failed hook names the command to run by hand', () => {
  const [f] = buildFindings({ ...base, agents: [], hookFailures: [{ hook: 'PreToolUse', count: 3, exitCode: 2, command: 'node guard.js' }] });
  assert.equal(f.text, 'Hook PreToolUse failed 3 times, exit 2');
  assert.equal(f.level, 'warn');
  assert.match(f.fix!, /node guard\.js/);
  assert.equal(f.agent, undefined);
});

test('main-thread edits are a finding only above the floor and beyond what the agents made, with the share as yardstick', () => {
  const worker = run({ id: 'w', tools: { Edit: 4, Write: 3, Read: 20 } });
  assert.deepEqual(buildFindings({ ...base, agents: [worker], mainEdits: 9 }), []);
  assert.deepEqual(buildFindings({ ...base, agents: [worker], mainEdits: 7 }), []);
  assert.deepEqual(buildFindings({ ...base, agents: [], mainEdits: 40 }), []);
  const [f] = buildFindings({ ...base, agents: [worker], mainEdits: 73 });
  assert.equal(f.text, 'The main thread made 73 file edits itself');
  assert.equal(f.note, "91% of the session's 80 edits. The 1 agent made 7.");
  assert.match(f.fix!, /Hand the next batch of edits to an agent/);
  assert.equal(f.runs, undefined);
});

test('a general-purpose run is a finding only when the roster has a specialist whose name its description mentions', () => {
  const general = run({ id: 'g', type: 'general-purpose', description: 'Upgrade the dotnet packages', prompt: 'Bump the dotnet packages of the MCP server.' });
  const other = run({ id: 'o', type: 'general-purpose', description: 'Add a topic to module 04', prompt: 'Write the teaching text.' });
  const roster = [
    { use: 'dotnet-expert', name: 'dotnet-expert', description: 'Writes C# for .NET services and reviews NuGet updates.' },
    { use: 'article-writer', name: 'article-writer', description: 'Drafts long-form articles in the house voice.' },
  ];
  assert.equal(fitSpecialist(general, roster)?.specialist.name, 'dotnet-expert');
  assert.equal(fitSpecialist(other, roster), undefined);
  const all = buildFindings({ ...base, agents: [general, other] });
  assert.equal(all.filter(f => f.kind === 'general').length, 2);
  const fit = fitGeneralFindings(all, [general, other], roster);
  assert.deepEqual(
    fit.map(f => f.agent),
    ['g']
  );
  assert.match(fit[0].note!, /Its description mentions "dotnet", what dotnet-expert is for/);
  assert.match(fit[0].fix!, /Launch it as dotnet-expert/);
  assert.deepEqual(fitGeneralFindings(all, [general, other], []), []);
});

test('span writes a gap in seconds, minutes and hours', () => {
  assert.equal(span(400), '1 s');
  assert.equal(span(42000), '42 s');
  assert.equal(span(3 * 60000), '3 min');
  assert.equal(span(125 * 60000), '2 h 5 min');
});
