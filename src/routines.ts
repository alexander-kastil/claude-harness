import * as fs from 'fs';
import * as path from 'path';
import { cronWords, parseTask } from './cowork-scheduled';
import type { ScheduledTask } from './cowork-scheduled';

/**
 * Claude Code routines: the scheduled cloud agents of the triggers API (GET /v1/code/triggers, a change is
 * POST /v1/code/triggers/<id> with a partial body, as Claude Code's own routine tool does), and the durable scheduled tasks
 * Claude Code keeps per repository in <repo>/.claude/scheduled_tasks.json ({ tasks: [...] }; the .lock beside it only
 * names the session that runs them). Reads are GETs; a write happens only after the panel's confirm card.
 */
const ENDPOINT = 'https://api.anthropic.com/v1/code/triggers';
const HEADERS = { 'anthropic-beta': 'ccr-triggers-2026-01-30', 'anthropic-version': '2023-06-01', Accept: 'application/json', 'User-Agent': 'claude-code/2.1.0' };

/** The UI tests point the calls at a server on this PC; the token never goes to any other address than the API. */
const endpoint = (): string => {
  const own = process.env.CLAUDE_HARNESS_TRIGGERS_URL;
  return own && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(own) ? own : ENDPOINT;
};

/** A routine of the cloud: the API item as the Scheduled view parses it, plus the repository it works on. */
export interface Routine extends ScheduledTask {
  repository: string;
}

/** A durable scheduled task of one repository. */
export interface LocalTask {
  id: string;
  /** The repository folder the file is in. */
  dir: string;
  repo: string;
  cron: string;
  repeats: string;
  prompt: string;
  recurring: boolean;
  /** Claude Code's own flag for a task it must not delete; shown, never changed. */
  permanent: boolean;
  createdAt?: number;
  lastFiredAt?: number;
  plugin?: string;
}

export type RoutinesCloud = 'ok' | 'noLogin' | 'expired' | 'denied' | 'error';
export interface RoutinesList {
  cloud: RoutinesCloud;
  /** One short line on what is missing, empty when the cloud routines were read. */
  note: string;
  routines: Routine[];
  local: LocalTask[];
  fetchedAt: number;
}

const NOTES: Record<Exclude<RoutinesCloud, 'ok'>, string> = {
  noLogin: 'Sign in to Claude Code with your claude.ai account to list the cloud routines; the tasks of your repositories are listed below.',
  expired: 'The Claude Code sign-in has expired, so the cloud routines are missing; start Claude Code once to renew it.',
  denied: 'claude.ai did not accept the sign-in, so the cloud routines are missing.',
  error: 'claude.ai could not be reached, so the cloud routines are missing.',
};

type Raw = Record<string, any>;

export type Fetcher = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
const defaultFetch: Fetcher = (url, init) => fetch(url, init);

function tokenOf(root: string, now: number): { token: string } | { cloud: 'noLogin' | 'expired' } {
  let oauth: { accessToken?: string; expiresAt?: number } = {};
  try {
    oauth = (JSON.parse(fs.readFileSync(path.join(root, '.credentials.json'), 'utf8')) as Raw).claudeAiOauth ?? {};
  } catch {
    return { cloud: 'noLogin' };
  }
  if (!oauth.accessToken) return { cloud: 'noLogin' };
  if (oauth.expiresAt && oauth.expiresAt <= now) return { cloud: 'expired' };
  return { token: oauth.accessToken };
}

/** The repository a routine works on: its first git source, as owner/name when it is a GitHub address. */
export function repositoryOf(t: Raw): string {
  const sources: unknown[] = Array.isArray(t.job_config?.ccr?.session_context?.sources) ? t.job_config.ccr.session_context.sources : [];
  const git = sources.find((s): s is Raw => !!s && typeof s === 'object' && (s as Raw).type === 'git_repository' && typeof (s as Raw).url === 'string');
  if (!git) return '';
  const m = /^https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(git.url);
  return m ? m[1] : git.url;
}

export function parseRoutines(body: unknown): Routine[] {
  const data = (body as Raw | undefined)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter(x => x && typeof x === 'object' && typeof x.id === 'string')
    .map(x => ({ ...parseTask(x), repository: repositoryOf(x) }))
    .filter(r => r.source === 'Code');
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const tasksFile = (dir: string): string => path.join(dir, '.claude', 'scheduled_tasks.json');

/** The durable tasks of one repository, shaped as Claude Code reads them: a malformed entry is skipped. */
export function readLocalTasks(dir: string): LocalTask[] {
  let file: Raw;
  try {
    file = JSON.parse(fs.readFileSync(tasksFile(dir), 'utf8'));
  } catch {
    return [];
  }
  const list: unknown = file && typeof file === 'object' ? file.tasks : undefined;
  if (!Array.isArray(list)) return [];
  const out: LocalTask[] = [];
  for (const t of list as Raw[]) {
    if (!t || typeof t.id !== 'string' || typeof t.cron !== 'string' || typeof t.prompt !== 'string') continue;
    out.push({
      id: t.id,
      dir,
      repo: path.basename(dir),
      cron: t.cron,
      repeats: cronWords(t.cron),
      prompt: t.prompt,
      recurring: t.recurring === true,
      permanent: t.permanent === true,
      createdAt: num(t.createdAt),
      lastFiredAt: num(t.lastFiredAt),
      plugin: typeof t.plugin === 'string' ? t.plugin : undefined,
    });
  }
  return out;
}

/** The cloud routines with one GET and the tasks of every repository; the cloud failing never hides the local ones. */
export async function fetchRoutines(root: string, repoDirs: string[], opts: { fetcher?: Fetcher; now?: number } = {}): Promise<RoutinesList> {
  const now = opts.now ?? Date.now();
  const local = [...new Set(repoDirs)].flatMap(readLocalTasks);
  const fail = (cloud: Exclude<RoutinesCloud, 'ok'>): RoutinesList => ({ cloud, note: NOTES[cloud], routines: [], local, fetchedAt: now });
  const auth = tokenOf(root, now);
  if ('cloud' in auth) return fail(auth.cloud);
  try {
    const res = await (opts.fetcher ?? defaultFetch)(endpoint(), { method: 'GET', headers: { ...HEADERS, Authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401) return fail('expired');
    if (res.status === 403) return fail('denied');
    if (res.status !== 200) return fail('error');
    return { cloud: 'ok', note: '', routines: parseRoutines(await res.json()), local, fetchedAt: now };
  } catch {
    return fail('error');
  }
}

export interface RoutinePatch {
  enabled?: boolean;
  name?: string;
  /** A five-field cron in UTC, as the API stores it. */
  cron?: string;
}
export interface WriteResult {
  ok: boolean;
  error?: string;
}

const validCron = (c: string): boolean => c.trim().split(/\s+/).length === 5;

/** The body of the partial update: only the fields the patch names; a bad patch is a word, not a call. */
export function routineBody(patch: RoutinePatch): { body: Raw } | { error: string } {
  const body: Raw = {};
  if (typeof patch.enabled === 'boolean') body.enabled = patch.enabled;
  if (typeof patch.name === 'string') {
    if (!patch.name.trim()) return { error: 'The name cannot be empty.' };
    body.name = patch.name.trim();
  }
  if (typeof patch.cron === 'string') {
    if (!validCron(patch.cron)) return { error: 'The schedule needs five cron fields, e.g. 0 5 * * 1.' };
    body.cron_expression = patch.cron.trim();
  }
  return Object.keys(body).length ? { body } : { error: 'Nothing to change.' };
}

/** Changes one cloud routine: POST /v1/code/triggers/<id> with a partial body. Called only after the confirm card. */
export async function updateRoutine(root: string, id: string, patch: RoutinePatch, opts: { fetcher?: Fetcher; now?: number } = {}): Promise<WriteResult> {
  if (!/^[\w-]+$/.test(id)) return { ok: false, error: 'That routine id is not valid.' };
  const built = routineBody(patch);
  if ('error' in built) return { ok: false, error: built.error };
  const auth = tokenOf(root, opts.now ?? Date.now());
  if ('cloud' in auth) return { ok: false, error: NOTES[auth.cloud] };
  try {
    const res = await (opts.fetcher ?? defaultFetch)(`${endpoint().replace(/\/$/, '')}/${id}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(built.body),
      signal: AbortSignal.timeout(20_000),
    });
    return res.status === 200 ? { ok: true } : { ok: false, error: `claude.ai answered ${res.status}, nothing was changed.` };
  } catch {
    return { ok: false, error: 'claude.ai could not be reached, nothing was changed.' };
  }
}

export interface LocalPatch {
  prompt?: string;
  cron?: string;
}

/** Rewrites the prompt or the schedule of one durable task in place; every other field and task is kept as the file has it. */
export function updateLocalTask(dir: string, id: string, patch: LocalPatch): WriteResult {
  const file = tasksFile(dir);
  let doc: Raw;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, error: 'The task file could not be read.' };
  }
  const task = Array.isArray(doc?.tasks) ? (doc.tasks as Raw[]).find(t => t && t.id === id) : undefined;
  if (!task) return { ok: false, error: 'That task is no longer in the file.' };
  if (typeof patch.prompt === 'string') {
    if (!patch.prompt.trim()) return { ok: false, error: 'The prompt cannot be empty.' };
    task.prompt = patch.prompt;
  }
  if (typeof patch.cron === 'string') {
    if (!validCron(patch.cron)) return { ok: false, error: 'The schedule needs five cron fields, e.g. */5 * * * *.' };
    task.cron = patch.cron.trim();
  }
  try {
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  } catch {
    return { ok: false, error: 'The task file could not be written.' };
  }
  return { ok: true };
}
