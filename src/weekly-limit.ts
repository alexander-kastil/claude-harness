import * as fs from 'fs';
import * as path from 'path';
import { Account, WeekTotal, accountWeek } from './sessions';

// No vscode import: the host and the command line both read the weekly meter through here.
export type Meter = { percent: number; resetsAt: number };

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const HEADERS = { 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json', 'User-Agent': 'claude-code/2.1.0' };
const KEEP_MS = 60_000;

type Entry = { kind?: string; percent?: unknown; resets_at?: string };
type Legacy = { utilization?: unknown; resets_at?: string } | null | undefined;

/** The all-models weekly window of a usage response, or undefined when it holds none or carries no reset time. */
export function parseMeter(usage: { limits?: Entry[]; seven_day?: Legacy } | undefined): Meter | undefined {
  const entry = (Array.isArray(usage?.limits) ? usage!.limits : []).find(e => e.kind === 'weekly_all');
  const raw = entry ? { percent: entry.percent, at: entry.resets_at } : usage?.seven_day ? { percent: usage.seven_day.utilization, at: usage.seven_day.resets_at } : undefined;
  if (!raw) return undefined;
  const percent = Number(raw.percent);
  const resetsAt = raw.at ? Date.parse(raw.at) : NaN;
  return Number.isFinite(percent) && Number.isFinite(resetsAt) ? { percent, resetsAt } : undefined;
}

const cache = new Map<string, { at: number; meter: Meter | undefined }>();

/** The weekly meter of the account whose config folder is `root`; undefined without a valid token or an answer. Kept a minute per folder. */
export async function readMeter(root: string, now = Date.now(), get: typeof fetch = fetch): Promise<Meter | undefined> {
  const hit = cache.get(root);
  if (hit && now - hit.at < KEEP_MS) return hit.meter;
  let meter: Meter | undefined;
  try {
    const oauth = (JSON.parse(fs.readFileSync(path.join(root, '.credentials.json'), 'utf8')).claudeAiOauth ?? {}) as { accessToken?: string; expiresAt?: number };
    if (oauth.accessToken && !(oauth.expiresAt && oauth.expiresAt <= now)) {
      const res = await get(ENDPOINT, { headers: { ...HEADERS, Authorization: `Bearer ${oauth.accessToken}` }, signal: AbortSignal.timeout(10_000) });
      if (res.status === 200) meter = parseMeter(JSON.parse(await res.text()));
    }
  } catch {
    meter = undefined;
  }
  cache.set(root, { at: now, meter });
  return meter;
}

/** The week of an account with its limit calibrated by Claude's meter when that can be read; the fixed figure of the plan otherwise. */
export async function calibratedWeek(account: Account, now = Date.now(), get?: typeof fetch): Promise<WeekTotal> {
  const meter = account.plan ? await readMeter(account.root, now, get) : undefined;
  return accountWeek(account, now, meter);
}
