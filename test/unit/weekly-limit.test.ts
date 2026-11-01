import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WEEK_MS, accountWeek, messageCost, planLimit } from '../../src/sessions';
import { calibratedWeek, parseMeter } from '../../src/weekly-limit';

const NOW = Date.UTC(2026, 10, 1, 12, 0);
const usage = { input_tokens: 1_000_000 };
const cost = messageCost('claude-opus-5-5', usage);

function account(entries: { id: string; at: number }[]) {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cal-')), '.claude');
  fs.mkdirSync(path.join(root, 'projects', 'repo'), { recursive: true });
  const rec = (id: string, at: number) => ({ type: 'assistant', uuid: id, timestamp: new Date(at).toISOString(), message: { id, model: 'claude-opus-5-5', usage } });
  fs.writeFileSync(path.join(root, 'projects', 'repo', 's.jsonl'), entries.map(e => JSON.stringify(rec(e.id, e.at))).join('\n') + '\n');
  return root;
}

test('meter at 10% with X used since its reset gives a limit of 10X', async () => {
  // One reply 2 days before now (after the reset 3 days ago), one 5 days before the reset's week start: only the first counts.
  const root = account([{ id: 'in', at: NOW - 2 * 86_400_000 }, { id: 'out', at: NOW - 6 * 86_400_000 }]);
  const resetsAt = NOW + 4 * 86_400_000;
  const week = await accountWeek({ label: 'A', root, plan: 'max' }, NOW, { percent: 10, resetsAt });
  assert.equal(week.since, resetsAt - WEEK_MS);
  assert.equal(week.limitSource, 'meter');
  assert.ok(Math.abs(week.cost - cost) < 1e-9);
  assert.ok(Math.abs(week.limit - cost * 10) < 1e-6);
  assert.ok(Math.abs((week.share ?? 0) - 0.1) < 1e-9);
});

test('without a meter the fixed figure of the plan stays', async () => {
  const root = account([{ id: 'in', at: NOW - 1000 }]);
  const week = await accountWeek({ label: 'A', root, plan: 'max' }, NOW);
  assert.equal(week.limit, planLimit('max'));
  assert.equal(week.limitSource, 'estimate');
  const zero = await accountWeek({ label: 'A', root, plan: 'max' }, NOW, { percent: 0, resetsAt: NOW + 1000 });
  assert.equal(zero.limit, planLimit('max'));
  const stale = await accountWeek({ label: 'A', root, plan: 'max' }, NOW, { percent: 10, resetsAt: NOW - 1000 });
  assert.equal(stale.limit, planLimit('max'));
});

test('calibratedWeek reads the meter of the account root, and falls back when it cannot', async () => {
  const root = account([{ id: 'in', at: NOW - 1000 }]);
  fs.writeFileSync(path.join(root, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW + 3600_000 } }));
  const resetsAt = new Date(NOW + 3 * 86_400_000).toISOString();
  let auth = '';
  const ok = (async (_url: unknown, init: { headers: Record<string, string> }) => {
    auth = init.headers.Authorization;
    return { status: 200, text: async () => JSON.stringify({ limits: [{ kind: 'weekly_all', percent: 25, resets_at: resetsAt }] }) };
  }) as unknown as typeof fetch;
  const a = { label: 'A', root, plan: 'max' };
  const week = await calibratedWeek(a, NOW, ok);
  assert.equal(auth, 'Bearer tok');
  assert.equal(week.limitSource, 'meter');
  assert.ok(Math.abs(week.limit - cost * 4) < 1e-6);
  const root2 = account([{ id: 'in', at: NOW - 1000 }]);
  const down = (async () => ({ status: 429, text: async () => '' })) as unknown as typeof fetch;
  assert.equal((await calibratedWeek({ label: 'B', root: root2, plan: 'max' }, NOW, down)).limit, planLimit('max'));
});

test('parseMeter takes weekly_all or the legacy seven_day window and needs a reset time', () => {
  const at = '2026-11-05T09:00:00Z';
  assert.deepEqual(parseMeter({ limits: [{ kind: 'weekly_scoped', percent: 90, resets_at: at }, { kind: 'weekly_all', percent: 12, resets_at: at }] }), { percent: 12, resetsAt: Date.parse(at) });
  assert.deepEqual(parseMeter({ seven_day: { utilization: 7, resets_at: at } }), { percent: 7, resetsAt: Date.parse(at) });
  assert.equal(parseMeter({ limits: [{ kind: 'weekly_all', percent: 12 }] }), undefined);
  assert.equal(parseMeter(undefined), undefined);
});
