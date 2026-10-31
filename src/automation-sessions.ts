import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { table } from './cli-core';
import { loadChats } from './cowork-chats';
import { findDataRoot } from './cowork-desktop';
import { isPrompt, promptText, sessionTitle, titleRecords } from './sessions';

// The owner's own sessions that drove a browser or a desktop app, found by a script so Claude reads digests and not transcripts.
// Sources: the Cowork desktop chats (the transcripts under each chat's .claude/projects) and the Claude Code sessions (<root>/projects).
// The prefilter skips a file by its mtime, streams it line by line and parses only the lines that hold an assistant tool call.
// Shared by the panel's host and the command line; nothing here needs VS Code.

export type SessionSource = 'cowork' | 'code';

export interface Candidate {
  source: SessionSource;
  id: string;
  title: string;
  /** Last activity, ms. */
  when: number;
  cwd: string;
  /** Calls of a browser tool to an external page, and calls of a desktop (computer use) tool. */
  browser: number;
  desktop: number;
  hosts: [string, number][];
}

/** A candidate with what its digest is built from; the files and events are not part of any output. */
export interface Hunted extends Candidate {
  files: string[];
  events: string[];
}

export interface Period {
  label: string;
  from: number;
  to: number;
}

const BROWSER = /^mcp__(claude-in-chrome|Claude_in_Chrome|chrome-devtools|playwright)__/;
const DESKTOP = /^mcp__(computer-use|remote-devices)__/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);
const DROP = new Set(['tabId', 'coordinate', 'start_coordinate', 'uid']);

const EVENT_CAP = 400;
const PROMPT_CAP = 600;
const CALL_CAP = 500;
const TEXT_CAP = 400;
export const SESSION_DIGEST_BYTES = 12 * 1024;
export const HUNT_DIGEST_BYTES = 60 * 1024;

/** The host of an http(s) URL that is not this PC; file:, about:, chrome:, data:, devtools: and editor URLs are local too. */
export function externalHost(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  const host = u.hostname.toLowerCase();
  return !host || LOCAL_HOSTS.has(host) ? undefined : host;
}

// ---- periods ----

/** Monday 00:00 local, `weeksBack` calendar weeks before the one `now` is in (negative: after it). */
function monday(now: number, weeksBack: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * weeksBack);
  return d.getTime();
}

/** "this week", "last week" (the same as "week 1") or "week N", N calendar weeks back, Monday to Sunday; undefined for anything else. */
export function parsePeriod(spec: string, now = Date.now()): Period | undefined {
  const s = spec.trim().toLowerCase().replace(/\s+/g, ' ');
  const n = s === 'this week' ? 0 : s === 'last week' ? 1 : /^week \d+$/.test(s) ? Number(s.slice(5)) : undefined;
  if (n === undefined) return undefined;
  return { label: n === 0 ? 'this week' : n === 1 ? 'last week' : `week ${n}`, from: monday(now, n), to: monday(now, n - 1) };
}

/** Whether a chat message asks for the owner's sessions, and for which period (none: all of them). */
export function periodInMessage(message: string, now = Date.now()): { asked: boolean; period?: Period } {
  const m = /\b(this week|last week|week\s+\d+)\b/i.exec(message);
  const period = m ? parsePeriod(m[1], now) : undefined;
  return { asked: !!period || /\bmy (sessions|chats)\b/i.test(message), period };
}

// ---- the prefilter ----

interface Acc {
  browser: number;
  desktop: number;
  hosts: Map<string, number>;
  events: string[];
  firstPrompt: string;
  cwd: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

function callText(name: string, input: unknown): string {
  const rest: Record<string, unknown> = {};
  if (input && typeof input === 'object') for (const [k, v] of Object.entries(input)) if (!DROP.has(k)) rest[k] = v;
  return clip(`${name.replace(/^mcp__/, '')} ${JSON.stringify(rest)}`, CALL_CAP);
}

async function scanFile(file: string, acc: Acc): Promise<void> {
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      let o: any;
      if (!acc.firstPrompt && line.includes('"type":"user"') && !line.includes('"tool_result"')) {
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        if (!acc.cwd && typeof o.cwd === 'string') acc.cwd = o.cwd;
        const t = isPrompt(o) ? promptText(o.message?.content) : undefined;
        if (t) acc.firstPrompt = clip(t, PROMPT_CAP);
        continue;
      }
      if (!line.includes('"tool_use"') || !line.includes('"mcp__')) continue;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o?.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
      if (!acc.cwd && typeof o.cwd === 'string') acc.cwd = o.cwd;
      const mine: string[] = [];
      for (const b of o.message.content) {
        if (!b || b.type !== 'tool_use' || typeof b.name !== 'string') continue;
        if (BROWSER.test(b.name)) {
          const host = externalHost(b.input?.url);
          if (host) {
            acc.browser++;
            acc.hosts.set(host, (acc.hosts.get(host) ?? 0) + 1);
          }
          mine.push(callText(b.name, b.input));
        } else if (DESKTOP.test(b.name)) {
          acc.desktop++;
          mine.push(callText(b.name, b.input));
        }
      }
      if (!mine.length || acc.events.length >= EVENT_CAP) continue;
      const said = o.message.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text.trim()).filter(Boolean).join(' ');
      if (said) acc.events.push(`Claude: ${clip(said.replace(/\s+/g, ' '), TEXT_CAP)}`);
      acc.events.push(...mine.map(m => `Call: ${m}`));
    }
  } finally {
    lines.close();
  }
}

/** Every .jsonl under a folder, up to a depth. */
function jsonlIn(dir: string, depth: number): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0) out.push(...jsonlIn(file, depth - 1));
    } else if (e.name.endsWith('.jsonl')) out.push(file);
  }
  return out;
}

const mtimeOf = (file: string): number => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

interface Group {
  source: SessionSource;
  id: string;
  title?: string;
  /** The session's own transcript, where the title records are. */
  main?: string;
  files: string[];
  when?: number;
}

/** The Claude Code sessions: each transcript with the subagent transcripts under its folder. A file older than `from` is skipped. */
function codeGroups(root: string, from: number): Group[] {
  const groups: Group[] = [];
  const projects = path.join(root, 'projects');
  let dirs: fs.Dirent[] = [];
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true }).filter(e => e.isDirectory());
  } catch {
    return groups;
  }
  for (const p of dirs) {
    const byId = new Map<string, Group>();
    const at = (id: string) => byId.get(id) ?? (byId.set(id, { source: 'code', id, files: [] }), byId.get(id)!);
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(projects, p.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const file = path.join(projects, p.name, e.name);
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        const g = at(path.basename(e.name, '.jsonl'));
        g.main = file;
        if (mtimeOf(file) >= from) g.files.push(file);
      } else if (e.isDirectory()) {
        const subs = jsonlIn(path.join(file, 'subagents'), 4).filter(f => mtimeOf(f) >= from);
        if (subs.length) at(e.name).files.push(...subs);
      }
    }
    groups.push(...byId.values());
  }
  return groups.filter(g => g.files.length);
}

/** The Cowork chats: the transcripts under each chat's .claude/projects. */
function coworkGroups(dataRoot: string | null, from: number): Group[] {
  return loadChats(dataRoot).chats.flatMap(c => {
    const files = jsonlIn(path.join(c.dir, '.claude', 'projects'), 6).filter(f => mtimeOf(f) >= from);
    return files.length ? [{ source: 'cowork' as const, id: c.id, title: c.title, files, when: c.lastActivity || undefined }] : [];
  });
}

export interface FindOptions {
  /** The Claude Code root; default ~/.claude. */
  root?: string;
  /** The Claude desktop app's data folder; default where the app keeps it. */
  dataRoot?: string | null;
  period?: Period;
  source?: SessionSource;
  limit?: number;
}

/** The sessions of the period with at least one external browser call or one desktop call, newest first. */
export async function findSessions(o: FindOptions = {}): Promise<Hunted[]> {
  const from = o.period?.from ?? 0;
  const groups = [...(o.source !== 'code' ? coworkGroups(o.dataRoot === undefined ? findDataRoot() : o.dataRoot, from) : []), ...(o.source !== 'cowork' ? codeGroups(o.root ?? path.join(os.homedir(), '.claude'), from) : [])];
  const out: Hunted[] = [];
  for (const g of groups) {
    const when = g.when ?? Math.max(...g.files.map(mtimeOf));
    if (o.period && (when < o.period.from || when >= o.period.to)) continue;
    const acc: Acc = { browser: 0, desktop: 0, hosts: new Map(), events: [], firstPrompt: '', cwd: '' };
    for (const f of g.files) {
      try {
        await scanFile(f, acc);
      } catch {
        // a file that cannot be read is not a candidate source
      }
    }
    if (!acc.browser && !acc.desktop) continue;
    let title = g.title || '';
    if (!title) {
      let titles: Record<string, string> = {};
      try {
        if (g.main) titles = titleRecords(g.main, fs.statSync(g.main).size);
      } catch {
        titles = {};
      }
      title = sessionTitle(titles, acc.firstPrompt, g.id);
    }
    out.push({ source: g.source, id: g.id, title, when, cwd: acc.cwd, browser: acc.browser, desktop: acc.desktop, hosts: [...acc.hosts].sort((a, b) => b[1] - a[1]), files: g.files, events: acc.events });
  }
  out.sort((a, b) => b.when - a.when);
  return o.limit && o.limit > 0 ? out.slice(0, o.limit) : out;
}

/** A candidate as every output shows it. */
export const plain = (c: Hunted): Candidate => ({ source: c.source, id: c.id, title: c.title, when: c.when, cwd: c.cwd, browser: c.browser, desktop: c.desktop, hosts: c.hosts });

// ---- digests ----

/** What Claude reads of one session: its prompts, then its browser and desktop calls and what Claude said around them, capped. */
export async function digestOf(c: Hunted, cap = SESSION_DIGEST_BYTES): Promise<string> {
  const prompts: string[] = [];
  for (const f of c.files) {
    const lines = readline.createInterface({ input: fs.createReadStream(f, { encoding: 'utf8' }), crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (prompts.length >= 40) break;
        if (!line.includes('"type":"user"') || line.includes('"tool_result"')) continue;
        try {
          const o = JSON.parse(line);
          const t = isPrompt(o) ? promptText(o.message?.content) : undefined;
          if (t) prompts.push(clip(t, PROMPT_CAP));
        } catch {
          // not a record
        }
      }
    } catch {
      // unreadable
    } finally {
      lines.close();
    }
  }
  const text = [`### ${c.title} (${c.source}, ${fmtWhen(c.when)})`, '', 'Prompts:', ...(prompts.length ? prompts.map(p => `- ${p}`) : ['- (none)']), '', 'Browser and desktop calls, with what Claude said:', ...c.events.map(e => `- ${e}`)].join('\n');
  return text.length > cap ? `${text.slice(0, cap - 3)}...` : text;
}

/** The digests of the candidates, newest first, until the hunt's budget is used. */
export async function digestsOf(list: Hunted[], budget = HUNT_DIGEST_BYTES): Promise<{ id: string; source: SessionSource; text: string }[]> {
  const out: { id: string; source: SessionSource; text: string }[] = [];
  let left = budget;
  for (const c of list) {
    if (left < 500) break;
    const text = await digestOf(c, Math.min(SESSION_DIGEST_BYTES, left));
    out.push({ id: c.id, source: c.source, text });
    left -= text.length;
  }
  return out;
}

// ---- the text ----

const pad = (n: number) => String(n).padStart(2, '0');
export const fmtWhen = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const SESSIONS_HEADING = 'Sessions with browser or desktop use';

/** The candidate table, as the command line and the chat prompt both show it. */
export const candidateTable = (list: Candidate[]): string[] =>
  table(['Date', 'Source', 'Session', 'Browser', 'Desktop', 'Hosts'], list.map(c => [fmtWhen(c.when), c.source, c.title, c.browser, c.desktop, c.hosts.slice(0, 3).map(([h, n]) => `${h} (${n})`).join(', ')]), [false, false, false, true, true, false]);

/** The section the chat prompt gets for a message that asks for the owner's sessions. */
export async function sessionsSection(period: Period | undefined, list: Hunted[]): Promise<string> {
  const digests = await digestsOf(list);
  return [`## ${SESSIONS_HEADING} (${period?.label ?? 'all time'})`, '', ...(list.length ? [...candidateTable(list), '', ...digests.map(d => `${d.text}\n`)] : ['(no session in this period used a browser page or a desktop app)'])].join('\n');
}
