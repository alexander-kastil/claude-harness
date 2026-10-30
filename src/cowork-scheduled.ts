import * as fs from 'fs';
import * as path from 'path';

/** Cowork scheduled tasks, read from the beta triggers API that claude.ai itself shows. Read only: one GET, never a write. */
export const SCHEDULED_URL = 'https://claude.ai/scheduled-task';
export const SCHEDULED_TEMPLATES_URL = 'https://claude.ai/scheduled-task?view=templates';
const ENDPOINT = 'https://api.anthropic.com/v1/code/triggers';
// Same reasoning as the quota endpoint: the API answers only a claude-code/* client.
const HEADERS = { 'anthropic-beta': 'ccr-triggers-2026-01-30', 'anthropic-version': '2023-06-01', Accept: 'application/json', 'User-Agent': 'claude-code/2.1.0' };

/** The UI tests point the read at a server on this PC; the token never goes to any other address than the API. */
const endpoint = (): string => {
  const own = process.env.CLAUDE_HARNESS_TRIGGERS_URL;
  return own && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(own) ? own : ENDPOINT;
};

export const taskUrl =(id: string): string => `${SCHEDULED_URL}/${id}`;
export const projectUrl = (id: string): string => `https://claude.ai/project/${id}`;
export const runUrl = (sessionId: string): string => `https://claude.ai/cowork/${sessionId}`;

export interface ScheduledTask {
  id: string;
  name: string;
  /** Active, Paused, Auto-disabled ..., Waiting for Claude Desktop. */
  status: string;
  /** ok: running as scheduled; wait: suspended; off: paused or ended. */
  statusKind: 'ok' | 'wait' | 'off';
  cron: string;
  repeats: string;
  nextRunAt?: number;
  lastRunAt?: number;
  /** Status of the last run in words, e.g. "abandoned"; empty when it never ran. */
  lastRunStatus: string;
  lastRunSessionId?: string;
  runsOn: string;
  projectId?: string;
  connectors: number;
  /** Names of the connectors the task uses (mcp_connections), for linking to the Cowork connectors. */
  connectorNames: string[];
  /** Names of the plugins (enabled_plugins) and extra marketplaces the task uses. */
  pluginNames: string[];
  marketplaceNames: string[];
  permissions: string;
  source: 'Cowork' | 'Code';
  instructions: string;
}

export type ScheduledState = 'ok' | 'noLogin' | 'expired' | 'denied' | 'error';
export interface ScheduledList {
  state: ScheduledState;
  /** One short line why the list is empty, for every state but ok. */
  note: string;
  tasks: ScheduledTask[];
  fetchedAt: number;
}

type Raw = Record<string, any>;

/** ROUTINE_RUN_STATUS_ABANDONED -> abandoned; an UNSPECIFIED enum is nothing. */
const enumWords = (s: unknown): string => {
  if (typeof s !== 'string' || !s || /UNSPECIFIED$/.test(s)) return '';
  return s.replace(/^ROUTINE_(?:RUN_)?(?:STATUS_|FAILURE_REASON_)/, '').replace(/_/g, ' ').toLowerCase();
};
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const time = (v: unknown): number | undefined => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const localOffsetMin = (): number => -new Date().getTimezoneOffset();
const pad = (n: number): string => String(n).padStart(2, '0');

/** A five-field cron (UTC, as the API stores it) in plain words at the PC's own clock; anything it cannot read stays as written. */
export function cronWords(cron: string, offsetMin: number = localOffsetMin()): string {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return cron;
  const [mi, hr, dom, mon, dow] = f;
  const num = /^\d+$/;
  if (mi.startsWith('*/') && hr === '*' && dom === '*' && mon === '*' && dow === '*' && num.test(mi.slice(2))) return `Every ${mi.slice(2)} minutes`;
  if (num.test(mi) && hr === '*' && dom === '*' && mon === '*' && dow === '*') return mi === '0' ? 'Every hour' : `Every hour at minute ${Number(mi)}`;
  if (hr.startsWith('*/') && num.test(mi) && dom === '*' && mon === '*' && dow === '*' && num.test(hr.slice(2))) return `Every ${hr.slice(2)} hours`;
  if (!num.test(mi) || !num.test(hr) || mon !== '*') return cron;
  const total = Number(hr) * 60 + Number(mi) + offsetMin;
  const shift = Math.floor(total / 1440);
  const at = ((total % 1440) + 1440) % 1440;
  const clock = `${pad(Math.floor(at / 60))}:${pad(at % 60)}`;
  if (dom === '*' && dow === '*') return `Every day at ${clock}`;
  if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow)) {
    const names = dow.split(',').map(d => DAYS[(((Number(d) % 7) + shift) % 7 + 7) % 7]);
    return `Every ${names.join(', ')} at ${clock}`;
  }
  if (dow === '*' && num.test(dom) && shift === 0) return `Day ${Number(dom)} of every month at ${clock}`;
  return cron;
}

const REASONS: Record<string, string> = {
  device_absent: 'waiting for Claude Desktop',
  auto_disabled_repo_access: 'lost access to its repository',
};

function statusOf(t: Raw): { status: string; statusKind: ScheduledTask['statusKind'] } {
  const ended = typeof t.ended_reason === 'string' ? t.ended_reason : '';
  const suspended = typeof t.suspension_reason === 'string' ? t.suspension_reason : '';
  if (ended) return { status: `Auto-disabled, ${REASONS[ended] ?? ended.replace(/^auto_disabled_/, '').replace(/_/g, ' ')}`, statusKind: 'off' };
  if (suspended) return { status: cap(REASONS[suspended] ?? suspended.replace(/_/g, ' ')), statusKind: 'wait' };
  return t.enabled === false ? { status: 'Paused', statusKind: 'off' } : { status: 'Active', statusKind: 'ok' };
}

/** Names from a list of strings or objects (name, else id, else url); unnamed entries are dropped, repeats kept once. */
function namesOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = list.map(x => (typeof x === 'string' ? x : x && typeof x === 'object' ? x.name ?? x.id ?? x.url : undefined)).filter((x): x is string => typeof x === 'string' && !!x);
  return [...new Set(out)];
}

/** One API item as the extension shows it. The instructions are derived_state.prompt. */
export function parseTask(t: Raw): ScheduledTask {
  const { status, statusKind } = statusOf(t);
  const cron = typeof t.cron_expression === 'string' ? t.cron_expression : '';
  const run = t.last_run && typeof t.last_run === 'object' ? t.last_run : undefined;
  const tags: unknown[] = Array.isArray(t.job_config?.ccr?.tags) ? t.job_config.ccr.tags : [];
  const cowork = t.created_kind === 'cowork_task' || tags.some(x => typeof x === 'string' && x.startsWith('cowork'));
  const lastStatus = enumWords(run?.status);
  const failure = enumWords(run?.failure_reason);
  return {
    id: String(t.id ?? ''),
    name: typeof t.name === 'string' && t.name ? t.name : '(unnamed)',
    status,
    statusKind,
    cron,
    repeats: cron ? cronWords(cron) : '-',
    nextRunAt: statusKind === 'ok' ? time(t.next_run_at) : undefined,
    lastRunAt: time(run?.fired_at ?? t.last_fired_at),
    lastRunStatus: lastStatus ? (failure ? `${lastStatus}, ${failure}` : lastStatus) : '',
    lastRunSessionId: typeof run?.session_id === 'string' && run.session_id ? run.session_id : undefined,
    // A task bound to a device only runs while that PC's Claude Desktop is open, as claude.ai says.
    runsOn: t.bound_device ? `Requires Claude Desktop${typeof t.bound_device.display_name === 'string' && t.bound_device.display_name ? ` (${t.bound_device.display_name})` : ''}` : 'Cloud',
    projectId: typeof t.chat_project_id === 'string' && t.chat_project_id ? t.chat_project_id : undefined,
    connectors: Array.isArray(t.mcp_connections) ? t.mcp_connections.length : 0,
    connectorNames: namesOf(t.mcp_connections),
    pluginNames: namesOf(t.enabled_plugins),
    marketplaceNames: namesOf(t.extra_marketplaces),
    // The trigger carries no permission mode; the runs do, and the task page fills it in from the newest one.
    permissions: '',
    source: cowork ? 'Cowork' : 'Code',
    instructions: typeof t.derived_state?.prompt === 'string' ? t.derived_state.prompt : '',
  };
}

export function parseTriggers(body: unknown): ScheduledTask[] {
  const data = (body as Raw | undefined)?.data;
  return Array.isArray(data) ? data.filter(x => x && typeof x === 'object' && typeof x.id === 'string').map(parseTask) : [];
}

const NOTES: Record<Exclude<ScheduledState, 'ok'>, string> = {
  noLogin: 'Sign in to Claude Code with your claude.ai account to list the tasks here.',
  expired: 'The Claude Code sign-in has expired; start Claude Code once to renew it.',
  denied: 'claude.ai did not accept the sign-in, so the tasks are not listed here.',
  error: 'claude.ai could not be reached, so the tasks are not listed here.',
};

export type Fetcher = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/** The token of Claude Code's login (never written, never refreshed, never logged), or why there is none. */
function tokenOf(root: string, now: number): { token: string } | { state: 'noLogin' | 'expired' } {
  let oauth: { accessToken?: string; expiresAt?: number } = {};
  try {
    oauth = (JSON.parse(fs.readFileSync(path.join(root, '.credentials.json'), 'utf8')) as Raw).claudeAiOauth ?? {};
  } catch {
    return { state: 'noLogin' };
  }
  if (!oauth.accessToken) return { state: 'noLogin' };
  if (oauth.expiresAt && oauth.expiresAt <= now) return { state: 'expired' };
  return { token: oauth.accessToken };
}

/** One GET; the status and the parsed body, or a state for a refused or failed call. */
async function getJson(url: string, token: string, get: Fetcher): Promise<{ body: unknown } | { state: Exclude<ScheduledState, 'ok' | 'noLogin'> }> {
  try {
    const res = await get(url, { method: 'GET', headers: { ...HEADERS, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401) return { state: 'expired' };
    if (res.status === 403) return { state: 'denied' };
    if (res.status !== 200) return { state: 'error' };
    return { body: await res.json() };
  } catch {
    return { state: 'error' };
  }
}

const defaultGet: Fetcher = (url, init) => fetch(url, init);

/** Lists the tasks with one GET. */
export async function fetchScheduled(root: string, opts: { fetcher?: Fetcher; now?: number } = {}): Promise<ScheduledList> {
  const now = opts.now ?? Date.now();
  const fail = (state: Exclude<ScheduledState, 'ok'>): ScheduledList => ({ state, note: NOTES[state], tasks: [], fetchedAt: now });
  const auth = tokenOf(root, now);
  if ('state' in auth) return fail(auth.state);
  const got = await getJson(endpoint(), auth.token, opts.fetcher ?? defaultGet);
  return 'state' in got ? fail(got.state) : { state: 'ok', note: '', tasks: parseTriggers(got.body), fetchedAt: now };
}

/** One run of a task: a session that the schedule started. */
export interface ScheduledRun {
  id: string;
  startedAt?: number;
  /** How the run stands, in words: Ready for review, Active, Archived ... */
  state: string;
  /** The dot on claude.ai: the run has not been opened yet. */
  unread: boolean;
  /** The run's own permission mode in words, e.g. "Auto, runs without asking". */
  permissions: string;
  title: string;
}

export interface ScheduledRuns {
  taskId: string;
  state: ScheduledState;
  note: string;
  /** Newest first. */
  runs: ScheduledRun[];
  /** More runs exist than were read (the page cap was reached). */
  more: boolean;
  fetchedAt: number;
}

const PERMISSIONS: Record<string, string> = {
  auto: 'Auto, runs without asking',
  default: 'Manual, asks before acting',
  acceptEdits: 'Accept edits, asks for the rest',
  plan: 'Plan, no changes',
  bypassPermissions: 'Bypass, runs without asking',
};
export const permissionWords = (mode: unknown): string => (typeof mode === 'string' && mode ? PERMISSIONS[mode] ?? cap(mode.replace(/[_-]/g, ' ')) : '');

const bucketWords = (s: unknown): string => (typeof s === 'string' && s ? cap(s.replace(/_/g, ' ').toLowerCase()) : '');

export function parseRun(r: Raw): ScheduledRun {
  const mode = r.config?.permission_mode ?? r.external_metadata?.permission_mode;
  return {
    id: String(r.id ?? ''),
    startedAt: time(r.created_at),
    state: bucketWords(r.status_bucket) || bucketWords(r.status),
    unread: r.unread === true,
    permissions: permissionWords(mode),
    title: typeof r.title === 'string' ? r.title : '',
  };
}

export const RUN_PAGE_CAP = 10;

/** Every run of a task, newest first: GET /v1/code/sessions?trigger_id=<id>, following next_cursor up to RUN_PAGE_CAP pages of 20. */
export async function fetchRuns(root: string, taskId: string, opts: { fetcher?: Fetcher; now?: number } = {}): Promise<ScheduledRuns> {
  const now = opts.now ?? Date.now();
  const out = (state: ScheduledState, runs: ScheduledRun[] = [], more = false): ScheduledRuns => ({ taskId, state, note: state === 'ok' ? '' : NOTES[state].replace('the tasks are', 'the runs are'), runs, more, fetchedAt: now });
  const auth = tokenOf(root, now);
  if ('state' in auth) return out(auth.state);
  const base = `${endpoint().replace(/\/triggers\/?$/, '/sessions')}?trigger_id=${encodeURIComponent(taskId)}`;
  const runs: ScheduledRun[] = [];
  let cursor = '';
  for (let page = 0; page < RUN_PAGE_CAP; page++) {
    const got = await getJson(cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base, auth.token, opts.fetcher ?? defaultGet);
    if ('state' in got) return runs.length ? out('ok', runs, true) : out(got.state);
    const body = got.body as Raw;
    if (Array.isArray(body?.data)) runs.push(...body.data.filter((x: unknown) => x && typeof x === 'object').map(parseRun));
    cursor = typeof body?.next_cursor === 'string' ? body.next_cursor : '';
    if (!cursor) return out('ok', runs);
  }
  return out('ok', runs, true);
}
