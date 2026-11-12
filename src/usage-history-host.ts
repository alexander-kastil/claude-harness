import * as fs from 'fs';
import * as path from 'path';
import { Account, messageCost, readRecords, weekEntries } from './sessions';
import { AccountHistory, HistoryReply, HistoryRow, addRow, historySince } from './usage-history';

// Reads every transcript of an account touched in the last 12 months into rows of day, project folder, cost and tokens.
// A file is read again only when its size or mtime changed; a message id repeated in another file counts once.

interface Counted {
  key: string;
  at: number;
  cost: number;
  tokens: number;
}

const files = new Map<string, { mtime: number; size: number; entries: Counted[] }>();

const readdir = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

/** The main and agent transcripts under `projects/` touched since `since`. */
function transcripts(root: string, since: number): string[] {
  const projects = path.join(root, 'projects');
  const out: string[] = [];
  const add = (file: string) => {
    try {
      if (fs.statSync(file).mtimeMs >= since) out.push(file);
    } catch {
      // gone while reading
    }
  };
  for (const repo of readdir(projects)) {
    const folder = path.join(projects, repo);
    for (const name of readdir(folder)) {
      if (name.endsWith('.jsonl')) add(path.join(folder, name));
      else for (const f of readdir(path.join(folder, name, 'subagents'))) if (f.endsWith('.jsonl')) add(path.join(folder, name, 'subagents', f));
    }
  }
  return out.sort();
}

/** The history of one account. */
export async function accountHistory(account: Account, now = Date.now()): Promise<AccountHistory> {
  const since = historySince(now);
  const rows = new Map<string, HistoryRow>();
  const seen = new Set<string>();
  const projects = path.join(account.root, 'projects');
  for (const file of transcripts(account.root, since)) {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      continue;
    }
    let cached = files.get(file);
    if (!cached || cached.mtime !== stat.mtimeMs || cached.size !== stat.size) {
      const entries = weekEntries(await readRecords(file).catch(() => [])).map(e => ({
        key: e.key,
        at: e.at,
        cost: messageCost(e.model, e.usage),
        tokens: (e.usage.input_tokens ?? 0) + (e.usage.output_tokens ?? 0) + (e.usage.cache_read_input_tokens ?? 0) + (e.usage.cache_creation_input_tokens ?? 0),
      }));
      cached = { mtime: stat.mtimeMs, size: stat.size, entries };
      files.set(file, cached);
    }
    const folder = path.relative(projects, file).split(/[\\/]/)[0];
    for (const e of cached.entries) {
      if (e.at < since || e.at > now || seen.has(e.key)) continue;
      seen.add(e.key);
      addRow(rows, folder, e.at, e.cost, e.tokens);
    }
  }
  return { account: account.label, rows: [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || a.folder.localeCompare(b.folder)) };
}

/** The history of every account. */
export async function usageHistory(accounts: Account[], now = Date.now()): Promise<HistoryReply> {
  return { until: now, accounts: await Promise.all(accounts.map(a => accountHistory(a, now))) };
}
