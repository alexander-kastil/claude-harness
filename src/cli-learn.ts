import * as fs from 'fs';
import * as path from 'path';
import { Args, Io, Stop, emit, headline, one, table } from './cli-core';

// `time`: the repo's time ledger by day; `lessons`: the entries of the repo's tasks/lessons.md.

const DAY = 86400000;
const WORK_CELL = 90;

interface LedgerRow {
  date: string;
  hours: number;
  work: string;
}

interface Entry {
  line: number;
  title: string;
  date: string | null;
  text: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Hours as the ledger writes them, two decimals at most, glued to the unit: 3.5h, 0.05h. */
const fmtHours = (n: number) => `${round2(n)}h`;

/** A delivered-work cell that fits a table: the first words up to the cell width, then dots. */
const shortWork = (s: string) => (s.length > WORK_CELL ? `${s.slice(0, WORK_CELL - 3).trimEnd()}...` : s);

/** The cells of a Markdown table row; an escaped pipe stays inside its cell and reads as a plain pipe. */
function cells(line: string): string[] {
  return line.trim().split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim().replace(/\\\|/g, '|'));
}

/** `--days`: the calendar days the time table covers, counted back from the newest day in the ledger. */
function windowDays(a: Args): number {
  const raw = one(a, 'days');
  if (raw === undefined) return 14;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Stop('--days needs a whole number of days, such as 14.', 2);
  return n;
}

/** The data rows of the ledger table: Date | Hours | From | To | Work. The header and the Total line are not rows. */
function ledgerRows(file: string): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const [date, hours, , , work = ''] = cells(line);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    rows.push({ date, hours: Number(hours) || 0, work });
  }
  return rows;
}

const sumHours = (rows: { hours: number }[]) => rows.reduce((n, r) => n + r.hours, 0);

export async function timeCommand(a: Args, io: Io): Promise<number> {
  const days = windowDays(a);
  const repo = path.resolve(one(a, 'repo') ?? process.cwd());
  const ledger = path.join(repo, '.time', 'working-time.md');
  if (!fs.existsSync(ledger)) throw new Stop(`No time ledger at ${ledger}.`, 1);
  const rows = ledgerRows(ledger);

  const byDate = new Map<string, LedgerRow[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  const perDay = [...byDate].map(([date, rs]) => ({
    date,
    sessions: rs.length,
    hours: round2(sumHours(rs)),
    work: rs.map(r => r.work).filter(Boolean).join('; '),
  })).sort((x, y) => y.date.localeCompare(x.date));

  const newest = perDay[0]?.date;
  const since = newest === undefined ? '' : new Date(Date.parse(`${newest}T00:00:00Z`) - (days - 1) * DAY).toISOString().slice(0, 10);
  const shown = perDay.filter(d => d.date >= since);
  const windowHours = round2(sumHours(shown));
  const totalHours = round2(sumHours(rows));
  const word = days === 1 ? 'day' : 'days';

  const json = { ledger, window_days: days, window_hours: windowHours, total_hours: totalHours, days: shown };
  const text = [
    headline(`Time · last ${days} ${word} · ${fmtHours(windowHours)}`),
    '',
    ...table(
      ['Date', 'Sessions', 'Hours', 'Work'],
      shown.length ? shown.map(d => [d.date, d.sessions, fmtHours(d.hours), shortWork(d.work)]) : [['(none)', '', '', '']],
      [false, true, true, false],
    ),
    '',
    ...table(
      ['Period', 'Sessions', 'Hours'],
      [
        [`Last ${days} ${word}`, shown.reduce((n, d) => n + d.sessions, 0), fmtHours(windowHours)],
        ['Whole ledger', rows.length, fmtHours(totalHours)],
      ],
      [false, true, true],
    ),
  ];
  emit(io, a, json, text);
  return 0;
}

/** The `## ` entries of a lessons file; a heading inside a code fence is body text. */
function lessonEntries(file: string): Entry[] {
  const found: { line: number; title: string; body: string[] }[] = [];
  let fenced = false;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((text, i) => {
    if (text.startsWith('```')) fenced = !fenced;
    if (!fenced && text.startsWith('## ')) found.push({ line: i + 1, title: text.slice(3).trim(), body: [] });
    else found[found.length - 1]?.body.push(text);
  });
  return found.map(e => {
    const text = [e.title, ...e.body].join('\n');
    return { line: e.line, title: e.title, date: text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, text };
  });
}

export async function lessonsCommand(a: Args, io: Io): Promise<number> {
  const repo = path.resolve(one(a, 'repo') ?? process.cwd());
  const file = path.join(repo, 'tasks', 'lessons.md');
  if (!fs.existsSync(file)) throw new Stop(`No lessons file at ${file}.`, 1);
  const find = one(a, 'find');
  const needle = find?.toLowerCase();
  const entries = lessonEntries(file);
  const shown = entries.filter(e => needle === undefined || e.text.toLowerCase().includes(needle));

  const json = {
    file,
    find: find ?? null,
    total: entries.length,
    entries: shown.map(({ line, title, date }) => ({ line, title, date })),
  };
  const text = [
    headline(find === undefined ? `Lessons · ${entries.length} entries` : `Lessons · ${shown.length} of ${entries.length} match "${find}"`),
    '',
    ...table(
      ['Line', 'Title', 'Date'],
      shown.length ? shown.map(e => [e.line, e.title, e.date ?? '']) : [['(none)', '', '']],
      [true, false, false],
    ),
  ];
  emit(io, a, json, text);
  return 0;
}
