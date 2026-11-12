// Agent teams of a session: the team's task list and the messages between the lead and the teammates.
// Claude Code keeps a team's tasks at <root>/tasks/<team>/<id>.json and each member's inbox at <root>/teams/<team>/inboxes/<name>.json,
// the team being `session-<first 8 characters of the lead's session id>`. Both folders are removed when the session ends, so the
// transcripts are the base (TaskCreate, TaskUpdate and SendMessage calls, <teammate-message> blocks) and the files, when still there, win.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readRecords } from './sessions';

type Rec = Record<string, any>;

export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed';

export interface TeamTask {
  id: string;
  subject: string;
  status: TeamTaskStatus;
  owner?: string;
  blockedBy: string[];
}

export interface TeamMessage {
  at: number;
  from: string;
  to: string;
  summary?: string;
  text: string;
}

export interface TeamData {
  /** The lead's name in `from` and `to`. */
  lead: string;
  tasks: TeamTask[];
  messages: TeamMessage[];
  /** Where the task list came from: Claude Code's files, or replayed from the transcripts. */
  source: 'files' | 'transcript';
}

export const LEAD = 'team-lead';

/** A transcript to read: the main thread has no name, a teammate's own transcript carries the teammate's name. */
export interface Thread {
  name?: string;
  records: Rec[];
}

const STATUSES: TeamTaskStatus[] = ['pending', 'in_progress', 'completed'];
const time = (o: Rec) => (typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN);

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((b: Rec) => (typeof b?.text === 'string' ? b.text : typeof b?.content === 'string' ? b.content : '')).join('\n') : '';

/** Messages Claude Code sends as JSON (idle notices, shutdown requests, task hand-overs) are protocol, not talk. */
const isProtocol = (text: string) => {
  if (!text.trimStart().startsWith('{')) return false;
  try {
    return typeof JSON.parse(text).type === 'string';
  } catch {
    return false;
  }
};

const cut = (text: string, n = 600) => (text.length > n ? `${text.slice(0, n)}...` : text);

/** The team folder name of a session. */
export const teamName = (sessionId: string) => `session-${sessionId.slice(0, 8)}`;

/** Replays the task and message calls of every thread in time order. Pure: the tests feed it records. */
export function teamFromThreads(threads: Thread[]): { tasks: TeamTask[]; messages: TeamMessage[] } {
  const tasks = new Map<string, TeamTask>();
  const messages: TeamMessage[] = [];
  const named = new Set(threads.filter(t => t.name).map(t => t.name as string));
  type Call = { at: number; owner: string; id: string; name: string; input: Rec };
  const calls: Call[] = [];
  const created = new Map<string, string>();
  for (const thread of threads) {
    const owner = thread.name ?? LEAD;
    for (const o of thread.records) {
      const at = time(o);
      const content = o.message?.content;
      if (!Array.isArray(content)) {
        // A teammate's message to the lead lands in the lead's transcript; one from a teammate with a transcript is read from its own SendMessage.
        if (!thread.name && o.type === 'user' && typeof content === 'string') tagged(content, at, named, messages);
        continue;
      }
      for (const b of content) {
        if (o.type === 'assistant' && b.type === 'tool_use' && ['TaskCreate', 'TaskUpdate', 'SendMessage'].includes(b.name)) calls.push({ at, owner, id: b.id, name: b.name, input: b.input ?? {} });
        else if (o.type === 'user' && b.type === 'tool_result') {
          const m = /Task #(\d+) created/.exec(textOf(b.content));
          if (m) created.set(b.tool_use_id, m[1]);
        } else if (o.type === 'user' && b.type === 'text' && !thread.name) tagged(String(b.text ?? ''), at, named, messages);
      }
    }
  }
  calls.sort((a, b) => a.at - b.at);
  for (const c of calls) {
    const { input } = c;
    if (c.name === 'SendMessage') {
      const text = String(input.message ?? input.summary ?? '');
      if (!text || isProtocol(text)) continue;
      messages.push({ at: c.at, from: c.owner, to: String(input.to ?? ''), summary: typeof input.summary === 'string' ? input.summary : undefined, text: cut(text) });
    } else if (c.name === 'TaskCreate') {
      const id = created.get(c.id);
      if (!id) continue;
      tasks.set(id, { id, subject: String(input.subject ?? ''), status: 'pending', blockedBy: [] });
    } else {
      const task = tasks.get(String(input.taskId ?? ''));
      if (!task) continue;
      if (typeof input.status === 'string') {
        if (input.status === 'deleted') tasks.delete(task.id);
        else if (STATUSES.includes(input.status as TeamTaskStatus)) task.status = input.status as TeamTaskStatus;
      }
      if (typeof input.owner === 'string') task.owner = input.owner || undefined;
      if (typeof input.subject === 'string' && input.subject) task.subject = input.subject;
      if (Array.isArray(input.addBlockedBy)) task.blockedBy.push(...input.addBlockedBy.map(String).filter((x: string) => !task.blockedBy.includes(x)));
    }
  }
  return { tasks: [...tasks.values()].sort((a, b) => Number(a.id) - Number(b.id)), messages: messages.sort((a, b) => a.at - b.at) };
}

function tagged(text: string, at: number, named: Set<string>, out: TeamMessage[]) {
  for (const m of text.matchAll(/<teammate-message teammate_id="([^"]+)"([^>]*)>([\s\S]*?)<\/teammate-message>/g)) {
    const from = m[1];
    if (from === LEAD || named.has(from)) continue;
    const body = m[3].trim();
    if (!body || isProtocol(body)) continue;
    out.push({ at, from, to: LEAD, summary: /summary="([^"]*)"/.exec(m[2])?.[1], text: cut(body) });
  }
}

/** The task files of a team, when Claude Code still has them. */
export function readTaskFiles(root: string, team: string): TeamTask[] {
  const dir = path.join(root, 'tasks', team);
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f));
  } catch {
    return [];
  }
  const out: TeamTask[] = [];
  for (const f of names) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (typeof t.id !== 'string' && typeof t.id !== 'number') continue;
      out.push({
        id: String(t.id),
        subject: String(t.subject ?? ''),
        status: STATUSES.includes(t.status) ? t.status : 'pending',
        owner: typeof t.owner === 'string' && t.owner ? t.owner : undefined,
        blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy.map(String) : [],
      });
    } catch {
      // an unreadable task file is skipped
    }
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id));
}

/** The messages in a team's inbox files, with their protocol entries left out. */
export function readInboxes(root: string, team: string): TeamMessage[] {
  const dir = path.join(root, 'teams', team, 'inboxes');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: TeamMessage[] = [];
  for (const f of names) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        const text = typeof m?.text === 'string' ? m.text : '';
        if (!text || isProtocol(text) || typeof m.from !== 'string') continue;
        const at = Date.parse(String(m.timestamp));
        out.push({ at: Number.isNaN(at) ? 0 : at, from: m.from, to: f.replace(/\.json$/, ''), summary: typeof m.summary === 'string' ? m.summary : undefined, text: cut(text) });
      }
    } catch {
      // an unreadable inbox is skipped
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Reads a session's team: the transcripts of the main thread and its teammates, then Claude Code's own files over them. */
export async function readTeam(transcript: string, sessionId: string, root: string): Promise<TeamData> {
  const threads: Thread[] = [{ records: (await readRecords(transcript)).filter(o => !o.isSidechain) }];
  const dir = path.join(path.dirname(transcript), sessionId, 'subagents');
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  } catch {
    files = [];
  }
  for (const f of files) {
    let name: string | undefined;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, f.replace(/\.jsonl$/, '.meta.json')), 'utf8'));
      if (meta.taskKind === 'in_process_teammate' || meta.name) name = typeof meta.name === 'string' ? meta.name : undefined;
    } catch {
      name = undefined;
    }
    if (name) threads.push({ name, records: await readRecords(path.join(dir, f)) });
  }
  const replay = teamFromThreads(threads);
  const team = teamName(sessionId);
  const files2 = readTaskFiles(root, team);
  const inbox = replay.messages.length ? [] : readInboxes(root, team);
  return {
    lead: LEAD,
    tasks: files2.length ? files2 : replay.tasks,
    messages: replay.messages.length ? replay.messages : inbox,
    source: files2.length ? 'files' : 'transcript',
  };
}
