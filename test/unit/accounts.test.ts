import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as os from 'node:os';
import { projectSlug } from '../../src/repos-overview';
import { PLANS, WEEK_MS, accountWeek, lastReset, parseWeekStart, addWeek, findAccountSession, listAccountSessions, listSessions, messageCost, parseAccounts, planLimit, planRewrites, renamedAccounts, renamedPlan, weekEntries, WeekModel } from '../../src/sessions';

test('PLANS matches the BILLING table of the panel, ids, labels and figures', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'session-page.ts'), 'utf8');
  const table = /export const BILLING = \[([\s\S]*?)\n\];/.exec(source)?.[1] ?? '';
  const rows = [...table.matchAll(/\['([^']+)', '([^']+)', '[^']+', (\d+)(?:, '[^']+')?\]/g)].map(m => ({ id: m[1], label: m[2], limit: Number(m[3]) }));
  assert.deepEqual(rows, PLANS.map(({ id, label, limit }) => ({ id, label, limit })));
  assert.equal(PLANS[PLANS.length - 1].id, 'api', 'api stays last: the panel falls back to the last row');
});

test('Team Standard is a fifth of Team Premium and Pro a fifth of Max, rounded', () => {
  assert.equal(planLimit('team-standard'), Math.round(planLimit('team') / 5));
  assert.equal(planLimit('pro'), Math.round(planLimit('max') / 5));
});

test('an unknown or missing plan has no limit', () => {
  assert.equal(planLimit(undefined), 0);
  assert.equal(planLimit('platinum'), 0);
  assert.equal(planLimit('api'), 0);
});

test('parseAccounts with no setting is the main folder alone', () => {
  assert.deepEqual(parseAccounts('/h/.claude', undefined, undefined, '/h'), [{ label: 'Default', root: '/h/.claude', plan: undefined, weekStart: undefined }]);
  assert.deepEqual(parseAccounts('/h/.claude', 'team', [], '/h'), [{ label: 'Default', root: '/h/.claude', plan: 'team', weekStart: undefined }]);
});

test('parseAccounts expands ~, defaults the label, and drops bad entries and repeats', () => {
  const list = parseAccounts(
    '/h/.claude',
    'bogus',
    [
      { path: '~/.claude-work', plan: 'team-standard' },
      { label: 'Side', path: '/x/side', plan: 'platinum' },
      { label: 'Again', path: '/h/.claude-work/' },
      { label: 'Main again', path: '/h/.claude' },
      { label: 'No path' },
      { path: '   ' },
      null,
      'text',
    ],
    '/h'
  );
  assert.deepEqual(list, [
    { label: 'Default', root: '/h/.claude', plan: undefined, weekStart: undefined },
    { label: '.claude-work', root: path.join('/h', '.claude-work'), plan: 'team-standard', weekStart: undefined },
    { label: 'Side', root: '/x/side', plan: undefined, weekStart: undefined },
  ]);
  assert.deepEqual(parseAccounts('/m', undefined, 'not an array', '/h').length, 1);
});

function twoAccounts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-accounts-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const make = (name: string, id: string, at: string) => {
    const root = path.join(tmp, name);
    const file = path.join(root, 'projects', projectSlug(repo), `${id}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ type: 'user', timestamp: at, sessionId: id, message: { role: 'user', content: `prompt of ${name}` } }) + '\n');
    // A session ends at its file's mtime; two files written in the same millisecond would tie.
    fs.utimesSync(file, new Date(at), new Date(at));
    return root;
  };
  const a = make('.claude', '11111111-2222-3333-4444-555555555555', '2026-10-20T10:00:00.000Z');
  const b = make('.claude-work', '66666666-7777-8888-9999-000000000000', '2026-10-20T11:00:00.000Z');
  return { repo, a, b };
}

test('listAccountSessions lists every account, labeled, and one account stays unlabeled', () => {
  const { repo, a, b } = twoAccounts();
  const one = listAccountSessions(repo, [{ label: 'Default', root: a }]);
  assert.deepEqual(one, listSessions(repo, a));
  assert.equal(one[0].account, undefined);
  const both = listAccountSessions(repo, [{ label: 'Default', root: a }, { label: 'Work', root: b, plan: 'team' }]);
  assert.deepEqual(both.map(s => [s.title, s.account, s.accountRoot]), [
    ['prompt of .claude-work', 'Work', b],
    ['prompt of .claude', 'Default', a],
  ]);
});

test('findAccountSession finds a session of the second account', () => {
  const { repo, a, b } = twoAccounts();
  const accounts = [{ label: 'Default', root: a }, { label: 'Work', root: b }];
  assert.equal(findAccountSession(repo, accounts, '66666666-7777-8888-9999-000000000000')?.account, 'Work');
  assert.equal(findAccountSession(repo, accounts, 'ffffffff-7777-8888-9999-000000000000'), undefined);
});

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const reply = (id: string, model: string, at: number, usage: object = { input_tokens: 1000, output_tokens: 1000 }) => ({
  type: 'assistant',
  uuid: `u-${id}`,
  timestamp: new Date(at).toISOString(),
  message: { id, model, usage, content: [] },
});

test('weekly totals keep the 7-day window edges and group by model', () => {
  const models = new Map<string, WeekModel>();
  addWeek(
    models,
    new Set(),
    weekEntries([
      reply('a', 'claude-opus-5-5', NOW - 1000),
      reply('b', 'claude-opus-5-5', NOW - WEEK_MS + 1000),
      reply('c', 'claude-opus-5-5', NOW - WEEK_MS - 1000),
      reply('d', 'claude-sonnet-5-5', NOW - 5000),
    ]),
    NOW - WEEK_MS,
    NOW
  );
  assert.deepEqual([...models.keys()].sort(), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  const opus = models.get('claude-opus-5-5')!;
  assert.equal(opus.messages, 2, 'the reply 1 s outside the window is left out');
  assert.equal(opus.input, 2000);
  assert.equal(opus.output, 2000);
  assert.equal(opus.cost, 2 * messageCost('claude-opus-5-5', { input_tokens: 1000, output_tokens: 1000 }));
  assert.equal(models.get('claude-sonnet-5-5')!.messages, 1);
});

test('weekly totals count a repeated message id once, across files', () => {
  const models = new Map<string, WeekModel>();
  const seen = new Set<string>();
  const once = weekEntries([reply('a', 'claude-opus-5-5', NOW - 1000), reply('a', 'claude-opus-5-5', NOW - 900)]);
  addWeek(models, seen, once, NOW - WEEK_MS, NOW);
  addWeek(models, seen, weekEntries([reply('a', 'claude-opus-5-5', NOW - 1000)]), NOW - WEEK_MS, NOW);
  assert.equal(models.get('claude-opus-5-5')!.messages, 1);
});

test('weekEntries skips synthetic models, records without usage and without a time', () => {
  const entries = weekEntries([
    reply('a', '<synthetic>', NOW),
    { type: 'assistant', timestamp: new Date(NOW).toISOString(), message: { id: 'x', model: 'claude-opus-5-5' } },
    { type: 'assistant', message: { id: 'y', model: 'claude-opus-5-5', usage: { input_tokens: 1 } } },
    { type: 'user', timestamp: new Date(NOW).toISOString(), message: { id: 'z', model: 'claude-opus-5-5', usage: { input_tokens: 1 } } },
    reply('ok', 'claude-opus-5-5', NOW),
  ]);
  assert.deepEqual(entries.map(e => e.key), ['ok']);
});

test('accountWeek sums every repo and the agent files of an account, as a share of its plan', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-week-'));
  const root = path.join(tmp, '.claude');
  const write = (file: string, records: unknown[]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  };
  const usage = { input_tokens: 1_000_000 };
  write(path.join(root, 'projects', 'repo-one', 's1.jsonl'), [reply('a', 'claude-opus-5-5', NOW - 1000, usage)]);
  write(path.join(root, 'projects', 'repo-two', 's2.jsonl'), [reply('a', 'claude-opus-5-5', NOW - 1000, usage), reply('b', 'claude-opus-5-5', NOW - 2000, usage)]);
  write(path.join(root, 'projects', 'repo-two', 's2', 'subagents', 'agent-1.jsonl'), [reply('c', 'claude-sonnet-5-5', NOW - 3000, usage)]);
  write(path.join(root, 'projects', 'repo-two', 'old.jsonl'), [reply('d', 'claude-opus-5-5', NOW - WEEK_MS - 5000, usage)]);
  const week = await accountWeek({ label: 'Work', root, plan: 'team-standard' }, NOW);
  assert.equal(week.account, 'Work');
  assert.deepEqual(week.models.map(m => [m.model, m.messages]), [['claude-opus-5-5', 2], ['claude-sonnet-5-5', 1]]);
  const cost = messageCost('claude-opus-5-5', { input_tokens: 1_000_000 }) * 2 + messageCost('claude-sonnet-5-5', { input_tokens: 1_000_000 });
  assert.ok(Math.abs(week.cost - cost) < 1e-9);
  assert.equal(week.tokens, 3_000_000);
  assert.equal(week.limit, planLimit('team-standard'));
  assert.ok(Math.abs((week.share ?? 0) - cost / planLimit('team-standard')) < 1e-9);
  assert.equal((await accountWeek({ label: 'Plain', root }, NOW)).share, undefined);
});

test('accountWeek splits the week by project folder and by agent type', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-week-split-'));
  const root = path.join(tmp, '.claude');
  const write = (file: string, records: unknown[]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  };
  const usage = { input_tokens: 1_000_000 };
  const opus = messageCost('claude-opus-5-5', usage);
  const sonnet = messageCost('claude-sonnet-5-5', usage);
  write(path.join(root, 'projects', 'repo-one', 's1.jsonl'), [reply('a', 'claude-opus-5-5', NOW - 1000, usage)]);
  write(path.join(root, 'projects', 'repo-two', 's2.jsonl'), [reply('b', 'claude-opus-5-5', NOW - 2000, usage)]);
  write(path.join(root, 'projects', 'repo-two', 's2', 'subagents', 'agent-1.jsonl'), [reply('c', 'claude-sonnet-5-5', NOW - 3000, usage), reply('d', 'claude-sonnet-5-5', NOW - 3500, usage)]);
  fs.writeFileSync(path.join(root, 'projects', 'repo-two', 's2', 'subagents', 'agent-1.meta.json'), JSON.stringify({ agentType: 'plugin:reviewer' }));
  write(path.join(root, 'projects', 'repo-two', 's2', 'subagents', 'agent-2.jsonl'), [reply('e', 'claude-sonnet-5-5', NOW - 4000, usage)]);
  fs.writeFileSync(path.join(root, 'projects', 'repo-two', 's2', 'subagents', 'agent-2.meta.json'), JSON.stringify({ agentType: 'reviewer' }));
  const week = await accountWeek({ label: 'Work', root }, NOW);
  assert.deepEqual(week.repos?.map(r => [r.folder, r.messages, r.tokens]), [['repo-two', 4, 4_000_000], ['repo-one', 1, 1_000_000]]);
  assert.ok(Math.abs(week.repos![0].cost - (opus + 3 * sonnet)) < 1e-9);
  assert.ok(Math.abs(week.repos!.reduce((n, r) => n + r.cost, 0) - week.cost) < 1e-9, 'the folders add up to the account');
  assert.deepEqual(week.agents?.map(a => [a.type, a.launches, a.messages]), [['reviewer', 2, 3]]);
  assert.ok(Math.abs(week.agents![0].cost - 3 * sonnet) < 1e-9, 'the main thread is not an agent');
});

test('addWeek with a folder filter counts that folder only', () => {
  const models = new Map<string, WeekModel>();
  const entries = [...weekEntries([reply('a', 'claude-opus-5-5', NOW - 1000)], { folder: 'x' }), ...weekEntries([reply('b', 'claude-opus-5-5', NOW - 1000)], { folder: 'y' })];
  addWeek(models, new Set(), entries, NOW - WEEK_MS, NOW, e => e.folder === 'y');
  assert.equal(models.get('claude-opus-5-5')!.messages, 1);
});

test('Team Premium is the measured 1010 and Standard a fifth of it, with Fable limits', () => {
  assert.equal(planLimit('team'), 1010);
  assert.equal(planLimit('team-standard'), 202);
  assert.deepEqual(PLANS.find(p => p.id === 'team')?.families, { fable: 215 });
  assert.deepEqual(PLANS.find(p => p.id === 'team-standard')?.families, { fable: 43 });
});

test('parseWeekStart reads weekday and UTC hour, and refuses the rest', () => {
  assert.deepEqual(parseWeekStart('Mon 11:00'), { day: 1, hour: 11, minute: 0 });
  assert.deepEqual(parseWeekStart(' sunday 9 '), { day: 0, hour: 9, minute: 0 });
  assert.deepEqual(parseWeekStart('Fri 23:59'), { day: 5, hour: 23, minute: 59 });
  for (const bad of ['', 'Mon', 'Mon 24:00', 'Mon 11:60', 'Xyz 11:00', '11:00 Mon', undefined, 5]) assert.equal(parseWeekStart(bad), undefined, String(bad));
});

test('lastReset is the latest reset at or before now, one second either side of the hour', () => {
  const reset = Date.parse('2026-10-19T11:00:00.000Z');
  assert.equal(lastReset('Mon 11:00', Date.parse('2026-10-22T12:00:00.000Z')), reset);
  assert.equal(lastReset('Mon 11:00', reset), reset);
  assert.equal(lastReset('Mon 11:00', reset - 1000), reset - WEEK_MS);
  assert.equal(lastReset('Mon 11:00', reset + 1000), reset);
  assert.equal(lastReset('Thu 12:00', Date.parse('2026-10-22T12:00:00.000Z')), Date.parse('2026-10-22T12:00:00.000Z'));
  assert.equal(lastReset('Thu 12:30', Date.parse('2026-10-22T12:00:00.000Z')), Date.parse('2026-10-15T12:30:00.000Z'));
  assert.equal(lastReset(undefined, NOW), undefined);
  assert.equal(lastReset('nonsense', NOW), undefined);
});

test('parseAccounts keeps a valid weekStart and drops an invalid one', () => {
  const list = parseAccounts('/h/.claude', undefined, [{ path: '/a', weekStart: ' Mon 11:00 ' }, { path: '/b', weekStart: 'whenever' }], '/h', 'Tue 8:00');
  assert.deepEqual(list.map(a => a.weekStart), ['Tue 8:00', 'Mon 11:00', undefined]);
  assert.equal(parseAccounts('/h/.claude', undefined, undefined, '/h')[0].weekStart, undefined);
});

test('accountWeek with a weekStart sums since the reset and reports the Fable share of its own limit', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reset-'));
  const root = path.join(tmp, '.claude');
  const file = path.join(root, 'projects', 'repo', 's.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const reset = Date.parse('2026-10-19T11:00:00.000Z');
  const usage = { output_tokens: 1_000_000 };
  fs.writeFileSync(
    file,
    [reply('before', 'claude-opus-5-5', reset - 1000, usage), reply('after', 'claude-opus-5-5', reset + 1000, usage), reply('f', 'claude-fable-1', NOW - 1000, usage)].map(r => JSON.stringify(r)).join('\n') + '\n'
  );
  const week = await accountWeek({ label: 'Work', root, plan: 'team', weekStart: 'Mon 11:00' }, NOW);
  assert.equal(week.fromReset, true);
  assert.equal(week.since, reset);
  assert.equal(week.models.find(m => m.model === 'claude-opus-5-5')?.messages, 1, 'the reply before the reset is left out');
  const fableCost = messageCost('claude-fable-1', usage);
  assert.ok(fableCost > 0);
  assert.equal(week.families.length, 1);
  assert.equal(week.families[0].family, 'fable');
  assert.ok(Math.abs(week.families[0].share - fableCost / 215) < 1e-9);
  const rolling = await accountWeek({ label: 'Work', root, plan: 'team' }, NOW);
  assert.equal(rolling.fromReset, false);
  assert.equal(rolling.since, NOW - WEEK_MS);
  assert.equal(rolling.models.find(m => m.model === 'claude-opus-5-5')?.messages, 2);
  assert.deepEqual((await accountWeek({ label: 'P', root, plan: 'max' }, NOW)).families, []);
});

test('plural adds es to a word that ends in a hissing sound, so 11 launches', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'webview', 'dom.ts'), 'utf8');
  const line = /export const plural = (.*);$/m.exec(source)?.[1] ?? '';
  const plural = new Function(`return ${line}`)() as (n: number, word: string) => string;
  assert.equal(plural(11, 'launch'), '11 launches');
  assert.equal(plural(1, 'launch'), '1 launch');
  assert.equal(plural(0, 'launch'), '0 launches');
  assert.equal(plural(2, 'match'), '2 matches');
  assert.equal(plural(3, 'tool'), '3 tools');
  assert.equal(plural(2, 'hook run'), '2 hook runs');
  assert.equal(plural(2, 'memory file'), '2 memory files');
  assert.equal(plural(5, 'use'), '5 uses');
  assert.equal(plural(2, 'repository'), '2 repositories');
  assert.equal(plural(1, 'repository'), '1 repository');
  assert.equal(plural(2, 'day'), '2 days');
});

test('a saved plan id from before the rename (max5, max20) is rewritten to max and ultra; current ids stay', () => {
  assert.equal(renamedPlan('max5'), 'max');
  assert.equal(renamedPlan('max20'), 'ultra');
  for (const keep of ['', 'pro', 'max', 'ultra', 'team', 'api', undefined, 5]) assert.equal(renamedPlan(keep), undefined);
  const accounts = [{ label: 'A', root: '/a', plan: 'max5' }, { label: 'B', root: '/b', plan: 'pro' }, { label: 'C', root: '/c', plan: 'max20', weekStart: 'mon' }, { label: 'D', root: '/d' }];
  assert.deepEqual(renamedAccounts(accounts), [{ label: 'A', root: '/a', plan: 'max' }, { label: 'B', root: '/b', plan: 'pro' }, { label: 'C', root: '/c', plan: 'ultra', weekStart: 'mon' }, { label: 'D', root: '/d' }]);
  assert.equal(renamedAccounts([{ label: 'B', root: '/b', plan: 'max' }]), undefined, 'nothing to rewrite, so no write');
  assert.equal(renamedAccounts(undefined), undefined);
  assert.equal(accounts[0].plan, 'max5', 'the saved value is not mutated');
  // The decision per target (global, workspace, each folder): only the setting that holds an old id is written.
  assert.deepEqual(planRewrites('max20', undefined), { plan: 'ultra', accounts: undefined });
  assert.deepEqual(planRewrites('pro', [{ label: 'A', root: '/a', plan: 'max5' }]), { plan: undefined, accounts: [{ label: 'A', root: '/a', plan: 'max' }] });
  assert.deepEqual(planRewrites(undefined, undefined), { plan: undefined, accounts: undefined });
});
