import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TranscriptHook, hookFailures, transcriptHooks } from './events';
import { projectSlug } from './fleet';
import { EDIT_TOOLS, buildFindings } from './findings';
import { sessionFlags } from './session-flags';

export interface Usage {
  input: number;
  cacheCreate: number;
  /** The part of cacheCreate written with the 1-hour cache lifetime. */
  cacheCreate1h: number;
  cacheRead: number;
  output: number;
  /** Estimated cost in USD at Anthropic API list prices. */
  cost: number;
  /** The same estimate split by token kind. */
  costParts: CostParts;
}

export interface CostParts {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/** API list prices in USD per million tokens, matched against the model id in order. */
const PRICES: [RegExp, { input: number; output: number; cacheRead: number }][] = [
  [/fable|mythos/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus/, { input: 5, output: 25, cacheRead: 0.5 }],
  [/sonnet-4/, { input: 3, output: 15, cacheRead: 0.3 }],
  [/sonnet/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/haiku-4/, { input: 1, output: 5, cacheRead: 0.1 }],
  [/haiku/, { input: 0.1, output: 0.5, cacheRead: 0.01 }],
];

/**
 * Estimated weekly limit of each plan in USD at API list prices; sources next to BILLING in src/webview/session-page.ts.
 * `families`: a separate limit for one model family, matched in the model id. `api` has no limit.
 */
export const PLANS: { id: string; label: string; limit: number; families?: Record<string, number> }[] = [
  { id: 'pro', label: 'Pro', limit: 105 },
  { id: 'max5', label: 'Max 5x', limit: 523 },
  { id: 'max20', label: 'Max 20x', limit: 1643 },
  { id: 'team-standard', label: 'Team Standard', limit: 202, families: { fable: 43 } },
  { id: 'team', label: 'Team Premium', limit: 1010, families: { fable: 215 } },
  { id: 'api', label: 'API billing', limit: 0 },
];

export const planLimit = (plan: string | undefined): number => PLANS.find(p => p.id === plan)?.limit ?? 0;

type ApiUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; cache_creation?: { ephemeral_1h_input_tokens?: number } };

/** Cost of one API response by token kind: 5-minute cache writes at 1.25 times input, 1-hour writes at 2 times. */
export function costParts(model: string | undefined, u: ApiUsage): CostParts {
  const price = model ? PRICES.find(([re]) => re.test(model))?.[1] : undefined;
  if (!price) return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = Math.max(0, (u.cache_creation_input_tokens ?? 0) - write1h);
  return {
    input: ((u.input_tokens ?? 0) * price.input) / 1e6,
    cacheWrite: (write5m * price.input * 1.25 + write1h * price.input * 2) / 1e6,
    cacheRead: ((u.cache_read_input_tokens ?? 0) * price.cacheRead) / 1e6,
    output: ((u.output_tokens ?? 0) * price.output) / 1e6,
  };
}

export const messageCost = (model: string | undefined, u: ApiUsage): number => {
  const p = costParts(model, u);
  return p.input + p.cacheWrite + p.cacheRead + p.output;
};

export interface SessionSummary {
  id: string;
  file: string;
  title: string;
  start?: number;
  end: number;
  size: number;
  agents: number;
  types: string[];
  entrypoint?: string;
  branch?: string;
  headless: boolean;
  /** A hook of the session (or of one of its agents) ended in an error. */
  hookFailed?: boolean;
  /** A mod's hook denied a tool call in the session. */
  modDenied?: boolean;
  live?: string;
  /** Label and config folder of the account the session ran under; set only when more than one account is configured. */
  account?: string;
  accountRoot?: string;
  children: SessionSummary[];
}

export type AgentStatus = 'running' | 'done' | 'stopped' | 'failed' | 'unknown';

export interface AgentRun {
  id: string;
  type: string;
  name?: string;
  /** The color a teammate was given at spawn. */
  color?: string;
  description: string;
  prompt: string;
  parent?: string;
  depth: number;
  background: boolean;
  teammate: boolean;
  model?: string;
  launchedAt?: number;
  start?: number;
  end?: number;
  reports: number[];
  status: AgentStatus;
  turns: number;
  tools: Record<string, number>;
  usage: Usage;
  result?: string;
  error?: string;
  transcript?: string;
}

export interface SessionEvent {
  at: number;
  kind: 'message' | 'stop';
  target: string;
  agent?: string;
  text: string;
}

/** What the main thread did between one prompt and the next. */
export interface SessionDecision {
  at: number;
  action: 'delegated' | 'followed up an agent' | 'worked on the main thread' | 'answered directly';
  launches: number;
  shape?: 'one agent' | 'agents together' | 'agents one after another';
  types: string[];
  /** Ids of the agents this prompt launched, in launch order. */
  agents: string[];
  outcome?: 'all reported back' | 'a launch failed' | 'still running' | 'no report';
  mainTools: number;
  messages: number;
}

export type FindingKind = 'failed' | 'stopped' | 'silent' | 'general' | 'resumed' | 'repeated' | 'hook' | 'edits';

export interface SessionFinding {
  level: 'warn' | 'info';
  /** One sentence naming what happened. */
  text: string;
  /** The agent the finding is about, and where "Show on the map" jumps to. */
  agent?: string;
  kind?: FindingKind;
  /** The evidence behind the headline: what the transcript shows about the cause. */
  note?: string;
  /** Why it matters. */
  why?: string;
  /** What to do about it. */
  fix?: string;
  /** The runs the finding covers; the page adds up their time and tokens. */
  runs?: string[];
}

export type StyleSignal = 'length' | 'format' | 'language' | 'repetition' | 'asking';

/** What the transcript says about how replies should read: the evidence for an output style. */
export interface StyleScan {
  /** Output styles that were active, in order of first appearance. */
  active: string[];
  prompts: number;
  interrupts: number;
  /** The main thread's last reply before each prompt; the counts are replies that use the format. */
  replies: { count: number; medianWords: number; longest: number; headings: number; tables: number; lists: number };
  corrections: { at: number; kind: StyleSignal; text: string }[];
}

export interface SessionDetail {
  id: string;
  file: string;
  title: string;
  cwd?: string;
  branch?: string;
  version?: string;
  entrypoint?: string;
  model?: string;
  start?: number;
  end?: number;
  live?: string;
  prompts: { at: number; text: string }[];
  turns: number;
  tools: Record<string, number>;
  edits: number;
  usage: Usage;
  agents: AgentRun[];
  events: SessionEvent[];
  decisions: SessionDecision[];
  children: SessionSummary[];
  findings: SessionFinding[];
  style: StyleScan;
  /** What hooks did, read from the main and the subagent transcripts; the host turns them into mod layers. */
  hooks: TranscriptHook[];
}

type Rec = Record<string, any>;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const TEXT_CAP = 12000;
const RUNNING_MINUTES = 15;

const cap = (s: string | undefined, n = TEXT_CAP) => (s && s.length > n ? `${s.slice(0, n)}\n...` : s);
const time = (o: Rec) => (typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN);
const emptyUsage = (): Usage => ({ input: 0, cacheCreate: 0, cacheCreate1h: 0, cacheRead: 0, output: 0, cost: 0, costParts: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 } });
const tag = (text: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim();
const shortType = (type: string) => type.split(':').pop() ?? type;

const parseLine = (line: string): Rec[] => {
  if (!line || line.startsWith('{"type":"api-request')) return [];
  try {
    const o = JSON.parse(line);
    return o && typeof o === 'object' ? [o] : [];
  } catch {
    return [];
  }
};

export const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter(b => b && (b.type === 'text' || typeof b === 'string'))
          .map(b => (typeof b === 'string' ? b : b.text))
          .join('\n')
      : '';

export function promptText(content: unknown): string | undefined {
  const text = textOf(content).trim();
  if (!text || /^(<task-notification>|<local-command|<system-reminder>|<bash-|<teammate-message|Another Claude session sent a message|\[Request interrupted)/.test(text)) return undefined;
  const command = tag(text, 'command-name');
  if (command) return `${command} ${tag(text, 'command-args') ?? ''}`.trim();
  return text.startsWith('<') ? undefined : text.replace(/\s+/g, ' ');
}

export const isPrompt = (o: Rec) => o.type === 'user' && !o.isSidechain && !o.isMeta && !o.toolUseResult && o.origin?.kind !== 'task-notification';

const STYLE_SIGNALS: [StyleSignal, RegExp][] = [
  ['length', /\b(too long|shorter|shorten|more concise|be concise|be brief|too verbose|less text|too much text|tl;?dr|kürzer|zu lang)\b/i],
  ['format', /\b(no tables?|without (a )?tables?|as a table|in a table|no bullets?|no bullet points|no headings?|no headers|no markdown|plain text|keine tabellen?)\b/i],
  ['language', /\b(in german|auf deutsch|in english|auf englisch)\b/i],
  ['repetition', /\b(don'?t repeat|stop repeating|no summary|no recap|just the answer|only the answer)\b/i],
  ['asking', /\b(don'?t ask|stop asking|just do it)\b/i],
];

function scanStyle(main: Rec[], prompts: { at: number; text: string }[]): StyleScan {
  const active: string[] = [];
  const replies: string[] = [];
  let interrupts = 0;
  let reply = '';
  let replyId: unknown;
  for (const o of main) {
    if (o.type === 'attachment' && o.attachment?.type === 'output_style' && typeof o.attachment.style === 'string' && !active.includes(o.attachment.style)) active.push(o.attachment.style);
    if (o.type === 'user' && /^\[Request interrupted by user/.test(textOf(o.message?.content).trim())) interrupts++;
    if (isPrompt(o) && promptText(o.message?.content)) {
      if (reply.trim()) replies.push(reply);
      reply = '';
      replyId = undefined;
    }
    if (o.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    const text = o.message.content.filter((b: Rec) => b.type === 'text' && b.text).map((b: Rec) => b.text).join('\n');
    if (!text.trim()) continue;
    reply = o.message.id && o.message.id === replyId ? `${reply}\n${text}` : text;
    replyId = o.message.id;
  }
  if (reply.trim()) replies.push(reply);
  const words = replies.map(r => r.split(/\s+/).filter(Boolean).length).sort((a, b) => a - b);
  const using = (re: RegExp) => replies.filter(r => re.test(r)).length;
  return {
    active,
    prompts: prompts.length,
    interrupts,
    replies: {
      count: replies.length,
      medianWords: words.length ? words[Math.floor(words.length / 2)] : 0,
      longest: words.length ? words[words.length - 1] : 0,
      headings: using(/^#{1,6}\s/m),
      tables: using(/^\s*\|.*\|\s*$\n^\s*\|?\s*:?-{3,}/m),
      lists: using(/^\s*([-*+]|\d+\.)\s/m),
    },
    corrections: prompts.flatMap(p => {
      const kind = STYLE_SIGNALS.find(([, re]) => re.test(p.text))?.[0];
      return kind ? [{ at: p.at, kind, text: p.text.slice(0, 240) }] : [];
    }),
  };
}

function readHead(file: string, bytes: number, size: number): Rec[] {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(bytes, size));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const lines = buf.subarray(0, n).toString('utf8').split('\n');
    if (n < size) lines.pop();
    return lines.flatMap(parseLine);
  } finally {
    fs.closeSync(fd);
  }
}

const readdir = (dir: string) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Status of the Claude Code processes running now, by session id, from the registry each one writes to `<root>/sessions/<pid>.json`. */
export function liveSessions(root: string): Map<string, string> {
  const live = new Map<string, string>();
  const dir = path.join(root, 'sessions');
  for (const f of readdir(dir).filter(f => /^\d+\.json$/.test(f))) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (e.sessionId && typeof e.pid === 'number' && alive(e.pid)) live.set(e.sessionId, e.status === 'waiting' && e.waitingFor ? `waiting: ${e.waitingFor}` : String(e.status ?? 'running'));
    } catch {
      // a registry file being rewritten
    }
  }
  return live;
}

const summaries = new Map<string, { mtime: number; size: number; summary: SessionSummary }>();

function summaryOf(file: string, live: Map<string, string>): SessionSummary | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return undefined;
  }
  const id = path.basename(file, '.jsonl');
  const cached = summaries.get(file);
  let summary = cached && cached.mtime === stat.mtimeMs && cached.size === stat.size ? cached.summary : undefined;
  if (!summary) {
    let records = readHead(file, 256 * 1024, stat.size);
    let prompt = records.filter(isPrompt).map(o => promptText(o.message?.content)).find(Boolean);
    if (!prompt && stat.size > 256 * 1024) {
      records = readHead(file, 4 * 1024 * 1024, stat.size);
      prompt = records.filter(isPrompt).map(o => promptText(o.message?.content)).find(Boolean);
    }
    const first = records.find(o => !Number.isNaN(time(o)));
    if (!first) return undefined;
    const meta = records.find(o => o.entrypoint) ?? {};
    const subDir = path.join(path.dirname(file), id, 'subagents');
    const agentFiles = readdir(subDir).filter(f => f.endsWith('.jsonl'));
    const types = new Set<string>();
    for (const f of agentFiles) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(subDir, f.replace(/\.jsonl$/, '.meta.json')), 'utf8'));
        const type = m.customAgentType ?? (m.taskKind === 'in_process_teammate' ? (m.spawnedAgentType ?? 'claude') : m.agentType);
        if (type) types.add(shortType(String(type)));
      } catch {
        // an agent without a meta file
      }
    }
    summary = {
      id,
      file,
      title: prompt ?? 'No prompt',
      start: time(first),
      end: stat.mtimeMs,
      size: stat.size,
      agents: agentFiles.length,
      types: [...types].sort(),
      entrypoint: meta.entrypoint,
      branch: meta.gitBranch,
      headless: meta.entrypoint === 'sdk-cli',
      children: [],
    };
    summaries.set(file, { mtime: stat.mtimeMs, size: stat.size, summary });
  }
  return { ...summary, live: live.get(id), children: [], ...sessionFlags(file) };
}

const sessionFiles = (folder: string) =>
  readdir(folder)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(folder, f));

/**
 * The Claude Code sessions of a repo, newest first. `root` is the Claude config folder (`~/.claude`).
 * Headless sessions started from a session's scratchpad (`claude -p` in a folder whose path holds the
 * session id) are attached to that session as children.
 */
export function listSessions(dir: string, root: string): SessionSummary[] {
  const projects = path.join(root, 'projects');
  const slug = projectSlug(dir).toLowerCase();
  const live = liveSessions(root);
  const own = sessionFiles(path.join(projects, projectSlug(dir)))
    .map(f => summaryOf(f, live))
    .filter((s): s is SessionSummary => !!s);
  const byId = new Map(own.map(s => [s.id, s]));
  for (const name of readdir(projects)) {
    if (name.toLowerCase() === slug) continue;
    const id = UUID.exec(name)?.[0];
    const parent = id ? byId.get(id) : undefined;
    if (!parent) continue;
    parent.children.push(...sessionFiles(path.join(projects, name)).map(f => summaryOf(f, live)).filter((s): s is SessionSummary => !!s));
  }
  for (const s of own) s.children.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  return own.sort((a, b) => b.end - a.end);
}

/** A Claude config folder with the plan of the seat that uses it. Claude Code reads another one from `CLAUDE_CONFIG_DIR`. */
export interface Account {
  label: string;
  root: string;
  /** An id of PLANS. */
  plan?: string;
  /** When the plan's weekly limit resets, as `Mon 11:00` in UTC. Unset means a rolling 7 days. */
  weekStart?: string;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Reads `Mon 11:00` (weekday, UTC hour and optional minute; `Monday 9` also works). Anything else is undefined. */
export function parseWeekStart(spec: unknown): { day: number; hour: number; minute: number } | undefined {
  const m = typeof spec === 'string' ? /^([a-z]{3})[a-z]*\s+(\d{1,2})(?::(\d{2}))?$/i.exec(spec.trim()) : null;
  if (!m) return undefined;
  const day = DAYS.indexOf(m[1].toLowerCase());
  const hour = Number(m[2]);
  const minute = m[3] ? Number(m[3]) : 0;
  return day < 0 || hour > 23 || minute > 59 ? undefined : { day, hour, minute };
}

/** The latest reset at or before `now`, in ms: the start of the current weekly window. Undefined for an unset or invalid spec. */
export function lastReset(spec: string | undefined, now: number): number | undefined {
  const w = parseWeekStart(spec);
  if (!w) return undefined;
  const d = new Date(now);
  let at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() - w.day + 7) % 7), w.hour, w.minute);
  if (at > now) at -= WEEK_MS;
  return at;
}

const expandHome = (p: string, home: string) => (p === '~' ? home : /^~[\\/]/.test(p) ? path.join(home, p.slice(2)) : p);
const samePlace = (a: string, b: string) => {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
};

/**
 * The accounts to read: the main config folder first, then each entry of the `claudeHarness.accounts` setting.
 * Entries without a path, with a path that repeats an earlier one, or that are not objects are dropped; an
 * unknown plan or week start becomes none and a missing label becomes the folder name. With no extra entry the list is just the main one.
 */
export function parseAccounts(mainRoot: string, mainPlan: string | undefined, raw: unknown, home = os.homedir(), mainWeekStart?: string): Account[] {
  const known = (plan: unknown) => (typeof plan === 'string' && PLANS.some(p => p.id === plan) ? plan : undefined);
  const start = (v: unknown) => (parseWeekStart(v) ? (v as string).trim() : undefined);
  const accounts: Account[] = [{ label: 'Default', root: mainRoot, plan: known(mainPlan), weekStart: start(mainWeekStart) }];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== 'object') continue;
    const p = typeof entry.path === 'string' ? entry.path.trim() : '';
    if (!p) continue;
    const root = expandHome(p, home);
    if (accounts.some(a => samePlace(a.root, root))) continue;
    const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : path.basename(path.resolve(root)) || root;
    accounts.push({ label, root, plan: known(entry.plan), weekStart: start(entry.weekStart) });
  }
  return accounts;
}

/**
 * The sessions of a repo in every account, newest first. With more than one account each session, and each
 * headless child, carries its account label and folder; with one account the list equals `listSessions`.
 */
export function listAccountSessions(dir: string, accounts: Account[]): SessionSummary[] {
  if (accounts.length === 1) return listSessions(dir, accounts[0].root);
  const tag = (s: SessionSummary, a: Account): SessionSummary => ({ ...s, account: a.label, accountRoot: a.root, children: s.children.map(c => tag(c, a)) });
  return accounts.flatMap(a => listSessions(dir, a.root).map(s => tag(s, a))).sort((x, y) => y.end - x.end);
}

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeekModel {
  model: string;
  /** API responses counted, each message id once. */
  messages: number;
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
  /** Cost at API list prices. */
  cost: number;
}

/** What one account used from `since` to `until` (the last 7 days, or since the plan's reset), over every repo, agents included. */
export interface WeekTotal {
  account: string;
  plan?: string;
  /** Estimated weekly limit of the plan in USD at list prices; 0 when there is no plan or it bills by the token. */
  limit: number;
  since: number;
  until: number;
  /** True when the window starts at the plan's last reset, false for a rolling 7 days. */
  fromReset: boolean;
  models: WeekModel[];
  /** Model families with a limit of their own on this plan, with what the account used of each. */
  families: { family: string; cost: number; limit: number; share: number }[];
  cost: number;
  tokens: number;
  /** cost / limit; absent without a limit. */
  share?: number;
  /** The same window per project folder (the repo's `projectSlug`), costliest first. Absent from older hosts. */
  repos?: WeekRepo[];
  /** The same window per agent type, costliest first. Absent from older hosts. */
  agents?: WeekAgent[];
}

/** What one project folder used in the window. */
export interface WeekRepo {
  /** Folder name under `projects/`, the repo's `projectSlug`. */
  folder: string;
  cost: number;
  tokens: number;
  messages: number;
  models: WeekModel[];
}

/** What the agents of one type used in the window. The main thread is not an agent. */
export interface WeekAgent {
  type: string;
  cost: number;
  tokens: number;
  messages: number;
  /** Agent transcripts with a response in the window. */
  launches: number;
}

/** One assistant response as it counts toward a week. */
export interface WeekEntry {
  key: string;
  at: number;
  model: string;
  usage: ApiUsage;
  /** Project folder the transcript lives in. */
  folder?: string;
  /** Agent type, for a response from an agent transcript. */
  agent?: string;
  /** The agent transcript the response is in. */
  run?: string;
}

/** The priced-or-not responses of a transcript: assistant records with a model and usage. A model like `<synthetic>` is no response. */
export function weekEntries(records: Rec[], where: { folder?: string; agent?: string; run?: string } = {}): WeekEntry[] {
  const out: WeekEntry[] = [];
  for (const o of records) {
    const m = o.message;
    const key = m?.id ?? o.uuid;
    const at = time(o);
    if (o.type !== 'assistant' || !m?.usage || typeof m.model !== 'string' || m.model.startsWith('<') || typeof key !== 'string' || Number.isNaN(at)) continue;
    out.push({ key, at, model: m.model, usage: m.usage, ...where });
  }
  return out;
}

/** Sums entries inside [since, until] by model. `seen` holds the message ids already counted, so a message repeated in another file counts once. `keep` narrows the entries, such as to one folder. */
export function addWeek(models: Map<string, WeekModel>, seen: Set<string>, entries: WeekEntry[], since: number, until: number, keep?: (e: WeekEntry) => boolean): void {
  for (const e of entries) {
    if (e.at < since || e.at > until || seen.has(e.key) || (keep && !keep(e))) continue;
    seen.add(e.key);
    const row = models.get(e.model) ?? { model: e.model, messages: 0, input: 0, cacheCreate: 0, cacheRead: 0, output: 0, cost: 0 };
    row.messages += 1;
    row.input += e.usage.input_tokens ?? 0;
    row.cacheCreate += e.usage.cache_creation_input_tokens ?? 0;
    row.cacheRead += e.usage.cache_read_input_tokens ?? 0;
    row.output += e.usage.output_tokens ?? 0;
    row.cost += messageCost(e.model, e.usage);
    models.set(e.model, row);
  }
}

/** Costliest model first. */
export function weekTotal(account: Account, models: Map<string, WeekModel>, since: number, until: number, extra: { repos?: WeekRepo[]; agents?: WeekAgent[] } = {}): WeekTotal {
  const rows = [...models.values()].sort((a, b) => b.cost - a.cost || b.messages - a.messages || a.model.localeCompare(b.model));
  const cost = rows.reduce((n, r) => n + r.cost, 0);
  const limit = planLimit(account.plan);
  return {
    account: account.label,
    plan: account.plan,
    limit,
    since,
    until,
    fromReset: !!lastReset(account.weekStart, until),
    models: rows,
    families: Object.entries(PLANS.find(p => p.id === account.plan)?.families ?? {}).map(([family, fl]) => {
      const used = rows.filter(r => r.model.toLowerCase().includes(family)).reduce((n, r) => n + r.cost, 0);
      return { family, cost: used, limit: fl, share: used / fl };
    }),
    cost,
    tokens: rows.reduce((n, r) => n + r.input + r.cacheCreate + r.cacheRead + r.output, 0),
    share: limit > 0 ? cost / limit : undefined,
    ...extra,
  };
}

const modelTokens = (r: WeekModel) => r.input + r.cacheCreate + r.cacheRead + r.output;

/** The window per project folder: `addWeek` run once per folder, costliest first. */
export function weekRepos(entries: WeekEntry[], since: number, until: number): WeekRepo[] {
  const folders = new Set(entries.flatMap(e => (e.folder ? [e.folder] : [])));
  const out: WeekRepo[] = [];
  for (const folder of folders) {
    const models = new Map<string, WeekModel>();
    addWeek(models, new Set(), entries, since, until, e => e.folder === folder);
    const rows = [...models.values()].sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model));
    if (!rows.length) continue;
    out.push({ folder, cost: rows.reduce((n, r) => n + r.cost, 0), tokens: rows.reduce((n, r) => n + modelTokens(r), 0), messages: rows.reduce((n, r) => n + r.messages, 0), models: rows });
  }
  return out.sort((a, b) => b.cost - a.cost || a.folder.localeCompare(b.folder));
}

/** The window per agent type, from the responses of agent transcripts only. */
export function weekAgents(entries: WeekEntry[], since: number, until: number): WeekAgent[] {
  const byType = new Map<string, WeekAgent & { runs: Set<string> }>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.agent || e.at < since || e.at > until || seen.has(e.key)) continue;
    seen.add(e.key);
    const row = byType.get(e.agent) ?? { type: e.agent, cost: 0, tokens: 0, messages: 0, launches: 0, runs: new Set<string>() };
    row.cost += messageCost(e.model, e.usage);
    row.tokens += (e.usage.input_tokens ?? 0) + (e.usage.cache_creation_input_tokens ?? 0) + (e.usage.cache_read_input_tokens ?? 0) + (e.usage.output_tokens ?? 0);
    row.messages += 1;
    row.runs.add(e.run ?? e.key);
    row.launches = row.runs.size;
    byType.set(e.agent, row);
  }
  return [...byType.values()].map(({ runs: _runs, ...r }) => r).sort((a, b) => b.cost - a.cost || a.type.localeCompare(b.type));
}

const weekFiles = new Map<string, { mtime: number; size: number; entries: WeekEntry[] }>();

/** The type of an agent transcript, from its neighbouring `.meta.json`; `agent` when there is none. */
function agentTypeOf(file: string): string {
  try {
    const m = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    const type = m.customAgentType ?? (m.taskKind === 'in_process_teammate' ? (m.spawnedAgentType ?? 'claude') : m.agentType);
    return type ? shortType(String(type)) : 'agent';
  } catch {
    return 'agent';
  }
}

/** The transcripts of an account touched since `since`: every repo's sessions and their agents' files. */
function transcriptFiles(root: string, since: number): string[] {
  const projects = path.join(root, 'projects');
  const files: string[] = [];
  const add = (file: string) => {
    try {
      if (fs.statSync(file).mtimeMs >= since) files.push(file);
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
  return files.sort();
}

/** The week of one account by model: since the plan's last reset when `weekStart` is set, else the last 7 days. Reads transcripts touched in that window only, and keeps what it read per file until the file changes. */
export async function accountWeek(account: Account, now = Date.now()): Promise<WeekTotal> {
  const models = new Map<string, WeekModel>();
  const seen = new Set<string>();
  const since = lastReset(account.weekStart, now) ?? now - WEEK_MS;
  const all: WeekEntry[] = [];
  const projects = path.join(account.root, 'projects');
  for (const file of transcriptFiles(account.root, since)) {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      continue;
    }
    let cached = weekFiles.get(file);
    if (!cached || cached.mtime !== stat.mtimeMs || cached.size !== stat.size) {
      const folder = path.relative(projects, file).split(/[\\/]/)[0];
      const agent = path.basename(path.dirname(file)) === 'subagents' ? agentTypeOf(file) : undefined;
      cached = { mtime: stat.mtimeMs, size: stat.size, entries: weekEntries(await readRecords(file).catch(() => []), { folder, agent, run: agent ? file : undefined }) };
      weekFiles.set(file, cached);
    }
    addWeek(models, seen, cached.entries, since, now);
    all.push(...cached.entries);
  }
  return weekTotal(account, models, since, now, { repos: weekRepos(all, since, now), agents: weekAgents(all, since, now) });
}

/** Finds a session of the repo, or a headless child of one, by id, in any account. */
export function findAccountSession(dir: string, accounts: Account[], id: string): SessionSummary | undefined {
  for (const a of accounts) {
    const hit = findSession(dir, a.root, id);
    if (hit) return accounts.length === 1 ? hit : { ...hit, account: a.label, accountRoot: a.root };
  }
  return undefined;
}

/** Finds a session of the repo, or a headless child of one, by id. */
/**
 * Copies an exported transcript into the repo's Claude project folder, where `claude --resume <id>` finds it.
 * The id comes from the records, not the file name, and an existing session file is never replaced.
 */
export function importTranscript(file: string, dir: string, root: string): { id: string; existed: boolean } {
  const records = fs.readFileSync(file, 'utf8').split('\n').flatMap(parseLine);
  const id = records.find(o => typeof o.sessionId === 'string' && UUID.test(o.sessionId))?.sessionId as string | undefined;
  if (!id || !records.some(o => o.type === 'user' || o.type === 'assistant')) throw new Error('This file is not a Claude Code transcript.');
  const folder = path.join(root, 'projects', projectSlug(dir));
  const target = path.join(folder, `${id}.jsonl`);
  if (fs.existsSync(target)) return { id, existed: true };
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(file, target);
  return { id, existed: false };
}

export function findSession(dir: string, root: string, id: string): SessionSummary | undefined {
  for (const s of listSessions(dir, root)) {
    if (s.id === id) return s;
    const child = s.children.find(c => c.id === id);
    if (child) return child;
  }
  return undefined;
}

async function readRecords(file: string): Promise<Rec[]> {
  const text = await fs.promises.readFile(file, 'utf8');
  return text.split('\n').flatMap(parseLine);
}

interface Launch {
  toolUseId: string;
  at: number;
  owner: string;
  type: string;
  description: string;
  prompt: string;
  background?: boolean;
  model?: string;
  name?: string;
  status?: string;
  agentId?: string;
  error?: string;
  doneAt?: number;
  result?: string;
}

interface Thread {
  start?: number;
  end?: number;
  model?: string;
  turns: Set<string>;
  tools: Record<string, number>;
  usage: Usage;
  edits: number;
  /** Times of the thread's own tool calls, delegation calls left out. */
  toolTimes: number[];
  firstUser?: string;
  lastText?: string;
}

const DELEGATION_TOOLS = new Set(['Agent', 'Task', 'SendMessage', 'TaskStop']);

function readThread(records: Rec[], owner: string, launches: Map<string, Launch>, events: SessionEvent[] | undefined): Thread {
  const thread: Thread = { turns: new Set(), tools: {}, usage: emptyUsage(), edits: 0, toolTimes: [] };
  const counted = new Set<string>();
  for (const o of records) {
    const at = time(o);
    if (!Number.isNaN(at) && (o.type === 'user' || o.type === 'assistant' || o.type === 'system')) {
      thread.start = thread.start === undefined ? at : Math.min(thread.start, at);
      thread.end = thread.end === undefined ? at : Math.max(thread.end, at);
    }
    const content = o.message?.content;
    if (o.type === 'user' && thread.firstUser === undefined && !o.toolUseResult) thread.firstUser = textOf(content);
    if (o.type === 'assistant' && o.message) {
      const key = o.message.id ?? o.uuid;
      if (key) thread.turns.add(key);
      thread.model ??= o.message.model;
      if (o.message.usage && key && !counted.has(key)) {
        counted.add(key);
        const u = o.message.usage;
        thread.usage.input += u.input_tokens ?? 0;
        thread.usage.cacheCreate += u.cache_creation_input_tokens ?? 0;
        thread.usage.cacheCreate1h += u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
        thread.usage.cacheRead += u.cache_read_input_tokens ?? 0;
        thread.usage.output += u.output_tokens ?? 0;
        const parts = costParts(o.message.model, u);
        for (const k of Object.keys(parts) as (keyof CostParts)[]) {
          thread.usage.costParts[k] += parts[k];
          thread.usage.cost += parts[k];
        }
      }
      if (!Array.isArray(content)) continue;
      const text = content.filter((b: Rec) => b.type === 'text' && b.text).map((b: Rec) => b.text).join('\n');
      if (text.trim()) thread.lastText = text;
      for (const b of content) {
        if (b.type !== 'tool_use') continue;
        thread.tools[b.name] = (thread.tools[b.name] ?? 0) + 1;
        if (EDIT_TOOLS.has(b.name)) thread.edits++;
        if (!DELEGATION_TOOLS.has(b.name) && !Number.isNaN(at)) thread.toolTimes.push(at);
        const input = b.input ?? {};
        if ((b.name === 'Agent' || b.name === 'Task') && !launches.has(b.id))
          launches.set(b.id, {
            toolUseId: b.id,
            at,
            owner,
            type: input.subagent_type || 'general-purpose',
            description: input.description ?? '',
            prompt: input.prompt ?? '',
            background: input.run_in_background === undefined ? undefined : input.run_in_background === true || input.run_in_background === 'true',
            model: input.model,
            name: input.name,
          });
        if (events && b.name === 'SendMessage') events.push({ at, kind: 'message', target: String(input.to ?? ''), text: String(input.summary || input.message || '').slice(0, 400) });
        if (events && b.name === 'TaskStop') events.push({ at, kind: 'stop', target: String(input.task_id ?? input.shell_id ?? ''), text: 'stopped' });
      }
    }
    if (o.type === 'user' && Array.isArray(content)) {
      for (const b of content) {
        if (b.type !== 'tool_result') continue;
        const launch = launches.get(b.tool_use_id);
        if (!launch) continue;
        const r = o.toolUseResult && typeof o.toolUseResult === 'object' ? o.toolUseResult : {};
        if (r.agentId) launch.agentId = String(r.agentId);
        if (r.resolvedModel) launch.model = r.resolvedModel;
        if (b.is_error) launch.error = textOf(b.content).slice(0, 600) || 'The launch failed.';
        else if (r.status) launch.status = String(r.status);
        else {
          launch.status = 'completed';
          launch.doneAt = at;
          launch.result = textOf(b.content);
        }
      }
    }
  }
  return thread;
}

interface Report {
  at: number;
  status?: string;
  result?: string;
}

function reportsOf(records: Rec[]) {
  const byTask = new Map<string, Report[]>();
  const byTeammate = new Map<string, Report[]>();
  const add = (map: Map<string, Report[]>, key: string, r: Report) => map.set(key, [...(map.get(key) ?? []), r]);
  for (const o of records) {
    if (o.type !== 'user' || o.isSidechain) continue;
    const text = textOf(o.message?.content);
    const at = time(o);
    if (text.startsWith('<task-notification>')) {
      const id = tag(text, 'task-id');
      if (id) add(byTask, id, { at, status: tag(text, 'status'), result: tag(text, 'result') });
      continue;
    }
    for (const m of text.matchAll(/<teammate-message teammate_id="([^"]+)"[^>]*>([\s\S]*?)<\/teammate-message>/g)) {
      const body = m[2].trim();
      let result: string | undefined = body;
      let when = at;
      try {
        const json = JSON.parse(body);
        result = json.result ?? json.message ?? json.summary;
        if (json.timestamp) when = Date.parse(json.timestamp);
        if (json.type && json.type !== 'idle_notification' && !result) continue;
      } catch {
        // a plain-text message
      }
      add(byTeammate, m[1], { at: when, result: typeof result === 'string' ? result : JSON.stringify(result) });
    }
  }
  return { byTask, byTeammate };
}

function midTurnPrompts(records: Rec[]): { at: number; text: string }[] {
  const queued = new Map<string, number>();
  const out: { at: number; text: string }[] = [];
  for (const o of records) {
    if (o.type !== 'queue-operation' || typeof o.content !== 'string') continue;
    if (o.operation === 'enqueue') queued.set(o.content, time(o));
    else if (o.operation === 'remove' && o.reason === 'absorbed_mid_turn') {
      const text = promptText(o.content);
      if (text) out.push({ at: queued.get(o.content) ?? time(o), text });
    }
  }
  return out;
}

function statusOf(run: AgentRun, reports: Report[], stopped: boolean, finished: boolean | undefined, live: boolean, mtime: number): AgentStatus {
  if (run.error) return 'failed';
  const last = reports[reports.length - 1];
  if (last?.status) {
    if (/complet/i.test(last.status)) return 'done';
    if (/kill|stop|cancel/i.test(last.status)) return 'stopped';
    if (/fail|error/i.test(last.status)) return 'failed';
  }
  if (finished || (run.teammate && reports.length)) return 'done';
  if (live && Date.now() - mtime < RUNNING_MINUTES * 60000) return 'running';
  if (stopped) return 'stopped';
  return reports.length ? 'done' : 'unknown';
}

const details = new Map<string, { mtime: number; size: number; detail: SessionDetail }>();

/** Reads a session transcript and its subagent transcripts into a delegation timeline. */
export async function readSession(summary: SessionSummary): Promise<SessionDetail> {
  const file = summary.file;
  const stat = fs.statSync(file);
  const dir = path.join(path.dirname(file), summary.id, 'subagents');
  const agentFiles = readdir(dir).filter(f => f.endsWith('.jsonl'));
  const newest = Math.max(stat.mtimeMs, ...agentFiles.map(f => fs.statSync(path.join(dir, f)).mtimeMs));
  const cached = details.get(file);
  if (cached && cached.mtime === newest && cached.size === stat.size) return { ...cached.detail, live: summary.live, children: summary.children };

  const records = await readRecords(file);
  const main = records.filter(o => !o.isSidechain);
  const launches = new Map<string, Launch>();
  const events: SessionEvent[] = [];
  const thread = readThread(main, 'main', launches, events);
  const prompts = [
    ...main.filter(isPrompt).flatMap(o => {
      const text = promptText(o.message?.content);
      return text ? [{ at: time(o), text: text.slice(0, 600) }] : [];
    }),
    ...midTurnPrompts(main).map(p => ({ ...p, text: p.text.slice(0, 600) })),
  ].sort((a, b) => a.at - b.at);
  const { byTask, byTeammate } = reportsOf(main);
  const first = main.find(o => o.cwd) ?? {};

  type Sub = { id: string; meta: Rec; thread: Thread; transcript: string; mtime: number };
  const subs: Sub[] = [];
  const hooks = transcriptHooks(main);
  for (const f of agentFiles) {
    const transcript = path.join(dir, f);
    let meta: Rec = {};
    try {
      meta = JSON.parse(fs.readFileSync(transcript.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    } catch {
      meta = {};
    }
    const id = f.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const subRecords = await readRecords(transcript);
    hooks.push(...transcriptHooks(subRecords, id));
    subs.push({ id, meta, thread: readThread(subRecords, id, launches, undefined), transcript, mtime: fs.statSync(transcript).mtimeMs });
  }

  const live = !!summary.live;
  const used = new Set<string>();
  const agents: AgentRun[] = [];
  for (const s of subs) {
    const launch =
      (s.meta.toolUseId && launches.get(s.meta.toolUseId)) ||
      [...launches.values()].find(l => l.agentId === s.id) ||
      (s.meta.name ? [...launches.values()].find(l => l.name === s.meta.name && !used.has(l.toolUseId)) : undefined);
    if (launch) used.add(launch.toolUseId);
    const teammate = s.meta.taskKind === 'in_process_teammate' || launch?.status === 'teammate_spawned';
    const name = s.meta.name ?? launch?.name;
    const reports = [...(byTask.get(s.id) ?? []), ...(name ? (byTeammate.get(name) ?? []) : [])].sort((a, b) => a.at - b.at);
    if (launch?.doneAt) reports.push({ at: launch.doneAt, status: 'completed', result: launch.result });
    const parent = launch && launch.owner !== 'main' ? launch.owner : s.meta.parentAgentId;
    const run: AgentRun = {
      id: s.id,
      type: launch?.type ?? s.meta.customAgentType ?? (s.meta.spawnedAgentType && s.meta.spawnedAgentType !== 'claude' ? s.meta.spawnedAgentType : undefined) ?? (teammate ? 'claude' : s.meta.agentType) ?? 'general-purpose',
      name,
      color: typeof s.meta.color === 'string' ? s.meta.color : undefined,
      description: launch?.description || s.meta.description || '',
      prompt: cap(launch?.prompt || s.thread.firstUser || '') ?? '',
      parent: parent && parent !== s.id ? String(parent) : undefined,
      depth: 0,
      background: s.meta.requestShape ? s.meta.requestShape === 'background' : launch?.background ?? false,
      teammate,
      model: s.thread.model ?? launch?.model ?? s.meta.model,
      launchedAt: launch?.at,
      start: s.thread.start,
      end: s.thread.end,
      reports: reports.map(r => r.at).filter(t => !Number.isNaN(t)),
      status: 'unknown',
      turns: s.thread.turns.size,
      tools: s.thread.tools,
      usage: s.thread.usage,
      result: cap([...reports].reverse().find(r => r.result)?.result ?? s.thread.lastText),
      error: launch?.error,
      transcript: s.transcript,
    };
    const stopped = events.some(e => e.kind === 'stop' && (e.target === s.id || e.target === name));
    run.status = statusOf(run, reports, stopped, s.meta.finished, live, s.mtime);
    agents.push(run);
  }
  for (const l of launches.values()) {
    if (used.has(l.toolUseId) || (l.agentId && agents.some(a => a.id === l.agentId))) continue;
    const reports = (l.agentId ? byTask.get(l.agentId) : undefined) ?? [];
    const run: AgentRun = {
      id: l.agentId ?? l.toolUseId,
      type: l.type,
      name: l.name,
      description: l.description,
      prompt: cap(l.prompt) ?? '',
      parent: l.owner === 'main' ? undefined : l.owner,
      depth: 0,
      background: l.background ?? false,
      teammate: l.status === 'teammate_spawned',
      model: l.model,
      launchedAt: l.at,
      start: l.at,
      end: l.doneAt ?? reports[reports.length - 1]?.at ?? l.at,
      reports: [...reports.map(r => r.at), ...(l.doneAt ? [l.doneAt] : [])],
      status: 'unknown',
      turns: 0,
      tools: {},
      usage: emptyUsage(),
      result: cap(l.result ?? reports[reports.length - 1]?.result),
      error: l.error,
    };
    run.status = l.error ? 'failed' : l.doneAt || reports.some(r => r.status && /complet/i.test(r.status)) ? 'done' : 'unknown';
    agents.push(run);
  }

  const byId = new Map(agents.map(a => [a.id, a]));
  for (const a of agents) if (a.parent && !byId.has(a.parent)) a.parent = undefined;
  for (const a of agents) {
    let depth = 0;
    for (let p = a.parent; p && depth < 8; p = byId.get(p)?.parent) depth++;
    a.depth = depth;
  }
  const order = (list: AgentRun[]) => list.sort((x, y) => (x.launchedAt ?? x.start ?? 0) - (y.launchedAt ?? y.start ?? 0));
  const sorted: AgentRun[] = [];
  const visit = (a: AgentRun) => {
    sorted.push(a);
    order(agents.filter(c => c.parent === a.id)).forEach(visit);
  };
  order(agents.filter(a => !a.parent)).forEach(visit);

  for (const e of events) {
    const target = agents.find(a => a.id === e.target || (a.name && a.name === e.target));
    if (target) e.agent = target.id;
  }

  const findings = buildFindings({ agents: sorted, events, prompts, hookFailures: hookFailures(hooks), mainEdits: thread.edits });

  const roots = sorted.filter(a => !a.parent && typeof a.launchedAt === 'number');
  const decisions: SessionDecision[] = prompts.map((p, i) => {
    const until = i + 1 < prompts.length ? prompts[i + 1].at : Infinity;
    const inside = (t: number) => t >= p.at && t < until;
    const launched = roots.filter(a => inside(a.launchedAt!));
    const messages = events.filter(e => e.kind === 'message' && inside(e.at)).length;
    const mainTools = thread.toolTimes.filter(inside).length;
    const together = launched.length > 1 && launched.every((a, k) => k === 0 || a.launchedAt! - launched[k - 1].launchedAt! <= 60000);
    return {
      at: p.at,
      action: launched.length ? 'delegated' : messages ? 'followed up an agent' : mainTools ? 'worked on the main thread' : 'answered directly',
      launches: launched.length,
      shape: !launched.length ? undefined : launched.length === 1 ? 'one agent' : together ? 'agents together' : 'agents one after another',
      types: [...new Set(launched.map(a => shortType(a.type)))].sort(),
      agents: launched.map(a => a.id),
      outcome: !launched.length
        ? undefined
        : launched.some(a => a.status === 'failed')
          ? 'a launch failed'
          : launched.some(a => a.status === 'running')
            ? 'still running'
            : launched.some(a => a.status === 'unknown' || a.status === 'stopped')
              ? 'no report'
              : 'all reported back',
      mainTools,
      messages,
    };
  });

  const detail: SessionDetail = {
    id: summary.id,
    file,
    title: summary.title,
    cwd: first.cwd,
    branch: [...main].reverse().find(o => o.gitBranch)?.gitBranch,
    version: first.version,
    entrypoint: first.entrypoint,
    model: thread.model,
    start: thread.start ?? summary.start,
    end: thread.end ?? summary.end,
    live: summary.live,
    prompts,
    turns: thread.turns.size,
    tools: thread.tools,
    edits: thread.edits,
    usage: thread.usage,
    agents: sorted,
    events: events.sort((a, b) => a.at - b.at),
    decisions,
    children: summary.children,
    findings,
    style: scanStyle(main, prompts),
    hooks,
  };
  details.set(file, { mtime: newest, size: stat.size, detail });
  return detail;
}
