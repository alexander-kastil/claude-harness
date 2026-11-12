import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { messageCost } from '../../src/sessions';
import { HistoryRow, PLAN_PRICES, addRow, advise, byDay, byFolder, byMonth, dayKey, periodRows, periodStart } from '../../src/usage-history';
import { accountHistory } from '../../src/usage-history-host';

// 2026-11-12 noon, local time.
const NOW = new Date(2026, 10, 12, 12, 0).getTime();
const day = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime();

const row = (d: string, folder: string, cost: number): HistoryRow => ({ day: d, folder, cost, tokens: cost * 1000 });

test('plan prices are Pro 20, Max 100, Ultra 200 dollars a month', () => {
  assert.deepEqual(PLAN_PRICES.map(p => [p.id, p.price]), [['pro', 20], ['max', 100], ['ultra', 200]]);
});

test('addRow sums responses of one day and folder', () => {
  const rows = new Map<string, HistoryRow>();
  addRow(rows, 'a', day(2026, 11, 1, 9), 1.5, 100);
  addRow(rows, 'a', day(2026, 11, 1, 23), 0.5, 50);
  addRow(rows, 'b', day(2026, 11, 1, 9), 3, 10);
  assert.equal(rows.size, 2);
  assert.deepEqual(rows.get('2026-11-01|a'), { day: '2026-11-01', folder: 'a', cost: 2, tokens: 150 });
});

test('periods start 30 and 90 days back and on the first of the month 11 months back', () => {
  assert.equal(periodStart('30d', NOW), '2026-10-14');
  assert.equal(periodStart('90d', NOW), '2026-08-15');
  assert.equal(periodStart('12m', NOW), '2025-12-01');
  assert.equal(dayKey(NOW), '2026-11-12');
});

test('byDay gives one bucket per day of the period with the empty days', () => {
  const rows = [row('2026-11-12', 'a', 4), row('2026-10-14', 'a', 1), row('2026-10-01', 'a', 9)];
  const days = byDay(periodRows(rows, '30d', NOW), '30d', NOW);
  assert.equal(days.length, 30);
  assert.equal(days[0].key, '2026-10-14');
  assert.equal(days[29].key, '2026-11-12');
  assert.equal(days.reduce((n, d) => n + d.cost, 0), 5);
});

test('byMonth lists every month of the period, oldest first', () => {
  const rows = [row('2026-11-12', 'a', 4), row('2026-09-30', 'a', 2), row('2026-09-01', 'b', 1)];
  const months = byMonth(periodRows(rows, '12m', NOW), '12m', NOW);
  assert.equal(months.length, 12);
  assert.equal(months[0].key, '2025-12');
  assert.equal(months[11].key, '2026-11');
  assert.equal(months.find(m => m.key === '2026-09')!.cost, 3);
});

test('periodRows narrows to one folder, compared in lower case', () => {
  const rows = [row('2026-11-12', 'D--Repo', 4), row('2026-11-12', 'other', 2)];
  assert.deepEqual(periodRows(rows, '30d', NOW, 'd--repo').map(r => r.folder), ['D--Repo']);
});

test('byFolder sorts the costliest first and counts the days', () => {
  const rows = [row('2026-11-01', 'a', 1), row('2026-11-02', 'a', 1), row('2026-11-01', 'b', 5)];
  assert.deepEqual(byFolder(rows).map(f => [f.folder, f.cost, f.days]), [['b', 5, 1], ['a', 2, 2]]);
});

test('advise: API billing under the Pro price, the cheapest covering plan above it, Ultra flagged over its limit', () => {
  assert.equal(advise(12).best, 'api');
  assert.deepEqual(advise(300), { best: 'pro', over: false, saves: 280 });
  assert.deepEqual(advise(600), { best: 'max', over: false, saves: 500 });
  assert.deepEqual(advise(5000), { best: 'ultra', over: false, saves: 4800 });
  assert.equal(advise(9000).best, 'ultra');
  assert.equal(advise(9000).over, true);
  assert.equal(advise(9000).saves, 8800);
});

test('accountHistory counts a message id once across files and prices it', async () => {
  const root = path.join(fs.mkdtempSync(path.join('D:/claude-scratch/usage-history', 'hist-')), '.claude');
  const usage = { input_tokens: 1_000_000 };
  const rec = (id: string, at: number) => JSON.stringify({ type: 'assistant', uuid: id, timestamp: new Date(at).toISOString(), message: { id, model: 'claude-opus-5-5', usage } });
  fs.mkdirSync(path.join(root, 'projects', 'repo-a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'projects', 'repo-b'), { recursive: true });
  fs.writeFileSync(path.join(root, 'projects', 'repo-a', 's1.jsonl'), [rec('m1', day(2026, 11, 10)), rec('m2', day(2026, 11, 11)), rec('old', day(2024, 1, 1))].join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'projects', 'repo-b', 's2.jsonl'), [rec('m1', day(2026, 11, 10)), rec('m3', day(2026, 11, 10))].join('\n') + '\n');
  try {
    const h = await accountHistory({ label: 'A', root }, NOW);
    const one = messageCost('claude-opus-5-5', usage);
    assert.ok(one > 0);
    assert.equal(h.rows.length, 3);
    assert.ok(!h.rows.some(r => r.day < '2025-12-01'));
    assert.equal(h.rows.reduce((n, r) => n + r.cost, 0), 3 * one);
    assert.equal(h.rows.filter(r => r.day === '2026-11-10').reduce((n, r) => n + r.tokens, 0), 2_000_000);
  } finally {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  }
});
