import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { Io, Stop, parse } from '../../src/cli-core';
import { lessonsCommand, timeCommand } from '../../src/cli-learn';

function capture(): Io & { text: () => string } {
  const out: string[] = [];
  return { out: t => out.push(t), err: t => out.push(t), text: () => out.join('\n') };
}

/** Table padding is not part of the content under test. */
const squash = (s: string) => s.replace(/ +/g, ' ');

const LEDGER = [
  '# Working Time — fixture',
  '',
  '| Date | Hours | From | To | Work |',
  '|------|-------|------|-----|------|',
  '| 2026-10-12 | 0.75 | 01:35 | 02:20 | First change |',
  '| 2026-10-12 | 1.25 | 09:54 | 11:20 | Second change |',
  '| 2026-10-20 | 2.27 | 17:46 | 20:02 | Plan review with a very long delivered description that goes on and on past the cell width of ninety characters |',
  '| 2026-10-28 | 0.5 | 07:16 | 07:46 | Instruction audit with a pipe \\| inside |',
  '',
  '**Total: 4.77h**',
  '',
].join('\n');

const LESSONS = [
  '# Lessons',
  '',
  '## Edit scripts through the Bash tool lose their escapes',
  '',
  '**Pattern:** a heredoc broke the compile.',
  '**Recurred (2026-10-20, 0.2.5):** the same again.',
  '',
  '## Marketplace publishing runs without a PAT',
  '',
  '**Pattern:** federation with a managed identity.',
  '',
  '## Fenced heading',
  '',
  '```md',
  '## Not an entry',
  '```',
  '',
  '**Pattern (2026-10-27):** a fence keeps its inner heading as body text.',
  '',
].join('\n');

function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-learn-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('time lists the newest days first with sessions, hours and a trimmed work cell', async () => {
  const dir = repo({ '.time/working-time.md': LEDGER });
  const io = capture();
  assert.equal(await timeCommand(parse(['time', '--repo', dir, '--days', '30']), io), 0);
  const text = squash(io.text());
  assert.match(text, /^\*\*Time · last 30 days · 4\.77h\*\*/);
  const rows = text.split('\n').filter(l => /^\| 2026-/.test(l));
  assert.equal(rows.length, 3);
  assert.match(rows[0], /^\| 2026-10-28 \| 1 \| 0\.5h \| Instruction audit with a pipe \\\| inside \|$/);
  assert.match(rows[1], /^\| 2026-10-20 \| 1 \| 2\.27h \| Plan review .{60,}\.\.\. \|$/);
  assert.match(rows[2], /^\| 2026-10-12 \| 2 \| 2h \| First change; Second change \|$/);
});

test('time counts --days back from the newest ledger day and totals the window and the ledger', async () => {
  const dir = repo({ '.time/working-time.md': LEDGER });
  const io = capture();
  await timeCommand(parse(['time', '--repo', dir]), io);
  const text = squash(io.text());
  assert.doesNotMatch(text, /2026-10-12 \| 2 \|/);
  assert.match(text, /\| Last 14 days \| 2 \| 2\.77h \|/);
  assert.match(text, /\| Whole ledger \| 4 \| 4\.77h \|/);
});

test('time with --json returns one object with the window, the totals and the days', async () => {
  const dir = repo({ '.time/working-time.md': LEDGER });
  const io = capture();
  await timeCommand(parse(['time', '--repo', dir, '--days', '1', '--json']), io);
  const json = JSON.parse(io.text());
  assert.equal(json.applied, false);
  assert.equal(json.window_days, 1);
  assert.equal(json.window_hours, 0.5);
  assert.equal(json.total_hours, 4.77);
  assert.deepEqual(json.days, [{ date: '2026-10-28', sessions: 1, hours: 0.5, work: 'Instruction audit with a pipe | inside' }]);
});

test('time with no rows in the window prints a (none) row', async () => {
  const dir = repo({ '.time/working-time.md': '| Date | Hours | From | To | Work |\n|---|---|---|---|---|\n' });
  const io = capture();
  await timeCommand(parse(['time', '--repo', dir]), io);
  assert.match(io.text(), /\| \(none\) \|/);
});

test('time names the path when the ledger is missing', async () => {
  const dir = repo({});
  await assert.rejects(timeCommand(parse(['time', '--repo', dir]), capture()), (e: unknown) => e instanceof Stop && e.code === 1 && e.message.includes(path.join(dir, '.time', 'working-time.md')));
});

test('time rejects a non-numeric or zero --days with code 2', async () => {
  const dir = repo({ '.time/working-time.md': LEDGER });
  for (const days of ['abc', '0']) {
    await assert.rejects(timeCommand(parse(['time', '--repo', dir, '--days', days]), capture()), (e: unknown) => e instanceof Stop && e.code === 2);
  }
});

test('lessons lists one row per entry with its line and first date', async () => {
  const dir = repo({ 'tasks/lessons.md': LESSONS });
  const io = capture();
  assert.equal(await lessonsCommand(parse(['lessons', '--repo', dir]), io), 0);
  const text = squash(io.text());
  assert.match(text, /^\*\*Lessons · 3 entries\*\*/m);
  assert.match(text, /^\| 3 \| Edit scripts through the Bash tool lose their escapes \| 2026-10-20 \|$/m);
  assert.match(text, /^\| 8 \| Marketplace publishing runs without a PAT \| \|$/m);
  assert.match(text, /^\| 12 \| Fenced heading \| 2026-10-27 \|$/m);
  assert.doesNotMatch(text, /Not an entry/);
});

test('lessons --find filters case-insensitively on title and body', async () => {
  const dir = repo({ 'tasks/lessons.md': LESSONS });
  const io = capture();
  await lessonsCommand(parse(['lessons', '--repo', dir, '--find', 'MANAGED identity']), io);
  const text = squash(io.text());
  assert.match(text, /^\*\*Lessons · 1 of 3 match "MANAGED identity"\*\*/m);
  assert.match(text, /^\| 8 \| Marketplace publishing runs without a PAT \|/m);
  assert.doesNotMatch(text, /Edit scripts/);
});

test('lessons --find with no match prints a (none) row, and --json lists the entries', async () => {
  const dir = repo({ 'tasks/lessons.md': LESSONS });
  const none = capture();
  await lessonsCommand(parse(['lessons', '--repo', dir, '--find', 'zzz-no-such-text']), none);
  assert.match(none.text(), /\| \(none\) \|/);

  const io = capture();
  await lessonsCommand(parse(['lessons', '--repo', dir, '--find', 'zzz-no-such-text', '--json']), io);
  const json = JSON.parse(io.text());
  assert.equal(json.applied, false);
  assert.equal(json.total, 3);
  assert.deepEqual(json.entries, []);
});

test('lessons names the path when the file is missing', async () => {
  const dir = repo({});
  await assert.rejects(lessonsCommand(parse(['lessons', '--repo', dir]), capture()), (e: unknown) => e instanceof Stop && e.code === 1 && e.message.includes(path.join(dir, 'tasks', 'lessons.md')));
});
