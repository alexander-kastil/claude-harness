import * as fs from 'fs';
import * as path from 'path';
import { findDataRoot, orgDirs, readSessions } from './cowork-desktop';
import type { RawSession } from './cowork-desktop';
import { runUrl } from './cowork-scheduled';

// Cowork chats and the files they produced, as the Claude desktop app keeps them on this PC, and the Cowork sessions claude.ai lists.
// Read-only. A chat is one local_<id> folder: audit.jsonl (the conversation), outputs\ (files the chat produced), uploads\ (files
// it was given). claude.ai chats are neither on disk nor readable with the Claude Code login, so they are not here.

export interface CoworkChat {
  id: string;
  title: string;
  model: string;
  lastActivity: number;
  archived: boolean;
  /** Files the chat produced and files it was given, counted on disk. */
  produced: number;
  uploaded: number;
  dir: string;
}

export interface ChatMessage {
  role: 'you' | 'claude';
  text: string;
}

export interface ChatFile {
  name: string;
  size: number;
  updated: number;
  kind: 'produced' | 'uploaded';
  file: string;
}

export interface ChatContents {
  messages: ChatMessage[];
  /** Messages beyond the cap, not listed. */
  more: number;
  files: ChatFile[];
}

export interface Artifact extends ChatFile {
  chat: string;
  chatId: string;
}

export interface CoworkChats {
  found: boolean;
  chats: CoworkChat[];
  artifacts: Artifact[];
}

const MAX_AUDIT = 60 * 1024 * 1024;
const MESSAGE_CAP = 400;
const TEXT_CAP = 4000;
const FILE_CAP = 300;
const DEPTH = 3;

const idOf = (s: RawSession): string => path.basename(s.dir);

/** Every file under a folder, up to a depth and a cap; dot folders and node_modules are skipped. */
function filesIn(root: string, kind: ChatFile['kind']): ChatFile[] {
  const out: ChatFile[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= FILE_CAP || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const file = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < DEPTH) walk(file, depth + 1);
        continue;
      }
      try {
        const st = fs.statSync(file);
        out.push({ name: path.relative(root, file).replace(/\\/g, '/'), size: st.size, updated: st.mtimeMs, kind, file });
      } catch {
        // gone while reading
      }
    }
  };
  walk(root, 0);
  return out;
}

const filesOf = (s: RawSession): ChatFile[] => [...filesIn(path.join(s.dir, 'outputs'), 'produced'), ...filesIn(path.join(s.dir, 'uploads'), 'uploaded')];

/** The chats of every account and organisation of the desktop app on this PC, newest first, and the files they produced as artifacts. */
export function loadChats(dataRoot: string | null = findDataRoot()): CoworkChats {
  if (!dataRoot) return { found: false, chats: [], artifacts: [] };
  const chats: CoworkChat[] = [];
  const artifacts: Artifact[] = [];
  for (const org of orgDirs(dataRoot)) {
    for (const s of readSessions(org)) {
      const files = filesOf(s);
      const title = s.title || 'Untitled';
      chats.push({ id: idOf(s), title, model: s.model, lastActivity: s.lastActivity, archived: s.archived, produced: files.filter(f => f.kind === 'produced').length, uploaded: files.filter(f => f.kind === 'uploaded').length, dir: s.dir });
      for (const f of files) if (f.kind === 'produced') artifacts.push({ ...f, chat: title, chatId: idOf(s) });
    }
  }
  chats.sort((a, b) => b.lastActivity - a.lastActivity);
  artifacts.sort((a, b) => b.updated - a.updated);
  return { found: true, chats, artifacts };
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(p => p && p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n');
};

/** The conversation of one chat, from audit.jsonl: what the person wrote and what Claude answered in words; tool calls and results are left out. */
export function loadChat(chat: CoworkChat): ChatContents {
  const messages: ChatMessage[] = [];
  let more = 0;
  const file = path.join(chat.dir, 'audit.jsonl');
  let text = '';
  try {
    if (fs.statSync(file).size <= MAX_AUDIT) text = fs.readFileSync(file, 'utf8');
  } catch {
    text = '';
  }
  for (const line of text.split('\n')) {
    if (!line.includes('"message"')) continue;
    let j: any;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (j?.type !== 'user' && j?.type !== 'assistant') continue;
    const t = textOf(j.message?.content).trim();
    if (!t) continue;
    // The audit records some messages twice in a row.
    const last = messages[messages.length - 1];
    const role = j.type === 'user' ? 'you' : 'claude';
    if (last && last.role === role && last.text === (t.length > TEXT_CAP ? `${t.slice(0, TEXT_CAP)}...` : t)) continue;
    if (messages.length >= MESSAGE_CAP) {
      more++;
      continue;
    }
    messages.push({ role: j.type === 'user' ? 'you' : 'claude', text: t.length > TEXT_CAP ? `${t.slice(0, TEXT_CAP)}...` : t });
  }
  const s = readSessions(path.dirname(chat.dir)).find(x => idOf(x) === chat.id);
  return { messages, more, files: s ? filesOf(s) : [] };
}

export const chatById = (id: string, dataRoot: string | null = findDataRoot()): CoworkChat | undefined => loadChats(dataRoot).chats.find(c => c.id === id);

/** True when a file path lies inside the desktop app's data folder: the only paths the page may ask the host to open. */
export const insideData = (file: string, dataRoot: string | null = findDataRoot()): boolean => {
  if (!dataRoot) return false;
  const rel = path.relative(path.resolve(dataRoot), path.resolve(file));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// ---- Cowork sessions of claude.ai: one GET with the Claude Code login, the list only.

const ENDPOINT = 'https://api.anthropic.com/v1/code/sessions';
const HEADERS = { 'anthropic-beta': 'ccr-triggers-2026-01-30', 'anthropic-version': '2023-06-01', Accept: 'application/json', 'User-Agent': 'claude-code/2.1.0' };

/** The UI tests point the read at a server on this PC; the token never goes to any other address than the API. */
const endpoint = (): string => {
  const own = process.env.CLAUDE_HARNESS_SESSIONS_URL;
  return own && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(own) ? own : ENDPOINT;
};

export interface CloudSession {
  id: string;
  title: string;
  status: string;
  messages: number;
  updated?: number;
  url: string;
}

export type CloudState = 'ok' | 'noLogin' | 'expired' | 'denied' | 'error';
export interface CloudSessions {
  state: CloudState;
  note: string;
  sessions: CloudSession[];
}

const NOTES: Record<Exclude<CloudState, 'ok'>, string> = {
  noLogin: 'Sign in to Claude Code with your claude.ai account to list the Cowork sessions here.',
  expired: 'The Claude Code sign-in has expired; start Claude Code once to renew it.',
  denied: 'claude.ai did not accept the sign-in, so the Cowork sessions are not listed here.',
  error: 'claude.ai could not be reached, so the Cowork sessions are not listed here.',
};

const time = (v: unknown): number | undefined => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

export function parseSessions(body: any): CloudSession[] {
  const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.sessions) ? body.sessions : [];
  return list
    .filter((x: any) => x && typeof x === 'object' && typeof x.id === 'string')
    .map((x: any) => ({
      id: x.id,
      title: typeof x.title === 'string' && x.title ? x.title : 'Untitled',
      status: typeof x.status === 'string' ? x.status : typeof x.session_status === 'string' ? x.session_status : '',
      // The API sends the count as a string.
      messages: Number.isFinite(Number(x.user_message_count)) ? Number(x.user_message_count) : 0,
      updated: time(x.updated_at) ?? time(x.last_event_at) ?? time(x.created_at),
      url: runUrl(x.id),
    }));
}

export type Fetcher = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Reads the OAuth token of Claude Code (never written, refreshed or logged) and lists the sessions with one GET. */
export async function fetchCloudSessions(root: string, opts: { fetcher?: Fetcher; now?: number } = {}): Promise<CloudSessions> {
  const now = opts.now ?? Date.now();
  const fail = (state: Exclude<CloudState, 'ok'>): CloudSessions => ({ state, note: NOTES[state], sessions: [] });
  let oauth: { accessToken?: string; expiresAt?: number } = {};
  try {
    oauth = (JSON.parse(fs.readFileSync(path.join(root, '.credentials.json'), 'utf8')) as any).claudeAiOauth ?? {};
  } catch {
    return fail('noLogin');
  }
  if (!oauth.accessToken) return fail('noLogin');
  if (oauth.expiresAt && oauth.expiresAt <= now) return fail('expired');
  const get: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  try {
    const res = await get(endpoint(), { method: 'GET', headers: { ...HEADERS, Authorization: `Bearer ${oauth.accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 401) return fail('expired');
    if (res.status === 403) return fail('denied');
    if (res.status !== 200) return fail('error');
    return { state: 'ok', note: '', sessions: parseSessions(await res.json()) };
  } catch {
    return fail('error');
  }
}

