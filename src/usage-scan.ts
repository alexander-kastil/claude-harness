import * as fs from 'fs';
import * as path from 'path';
import { isPrompt, promptText, textOf } from './sessions';

// Reading the transcripts for the usage index: which lines can hold a use, what a use is, and where the files are.

export type HitKind = 'agent' | 'skill' | 'command';

/** One use in a transcript. `key` (the tool_use id, or the record uuid of a slash command) counts a use that a fork's transcript replays once. */
export interface Hit {
  kind: HitKind;
  name: string;
  /** ms; 0 when the record has no timestamp. */
  at: number;
  key: string;
}

// Only lines holding a tool name or a command tag are parsed for uses; the rest of a transcript is never decoded.
// One pass finds every `"name":"` (a few per thousand lines) and a second the command tag: that is half the passes over
// the bytes that one needle per tool takes, and the passes are what a first build spends its time on.
const TOOL_NAME = Buffer.from('"name":"');
const COMMAND = Buffer.from('<command-name>');
const USER = Buffer.from('"type":"user"');
const CWD = Buffer.from('"cwd":"');
const NL = 0x0a;
const API_REQUEST = '{"type":"api-request';
// summaryOf looks for the first prompt in the first 4 MB.
const TITLE_BYTES = 4 * 1024 * 1024;
const TITLE_CAP = 500;

type Rec = Record<string, any>;

/** What a scan has found so far in one file; a later scan of the appended bytes goes on from it. */
export interface ScanState {
  hits: Hit[];
  /** Byte offset after the last complete line scanned. */
  offset: number;
  /** Lines that passed the prefilter and were parsed for uses. */
  parsed: number;
  /** A main transcript, whose cwd and title are looked up too. */
  main: boolean;
  cwd?: string;
  title?: string;
}

const parse = (buf: Buffer, start: number, end: number): Rec | undefined => {
  // An api-request blob can be megabytes long and is no record of a use: it is rejected before it is decoded.
  if (end <= start || buf.toString('latin1', start, Math.min(end, start + API_REQUEST.length)) === API_REQUEST) return undefined;
  try {
    const o = JSON.parse(buf.toString('utf8', start, end));
    return o && typeof o === 'object' ? o : undefined;
  } catch {
    return undefined;
  }
};

const timeOf = (o: Rec) => {
  const t = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** The uses one record holds: Agent and Task launches (by subagent type, as the session page names them), Skill calls, and a typed slash command. */
export function hitsOf(o: Rec, fallbackKey: string): Hit[] {
  const at = timeOf(o);
  const out: Hit[] = [];
  const content = o.message?.content;
  if (o.type === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (!b || b.type !== 'tool_use') continue;
      const input = b.input ?? {};
      const key = typeof b.id === 'string' ? b.id : `${fallbackKey}:${out.length}`;
      if (b.name === 'Agent' || b.name === 'Task') out.push({ kind: 'agent', name: String(input.subagent_type || 'general-purpose'), at, key });
      else if (b.name === 'Skill' && typeof input.skill === 'string' && input.skill) out.push({ kind: 'skill', name: input.skill, at, key });
    }
  }
  // The record Claude Code writes for a typed slash command starts with its tags; a brief that only quotes one does not.
  if (o.type === 'user' && !o.toolUseResult) {
    const text = textOf(content).trim();
    const name = /^<command-(?:name|message)>/.test(text) ? /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(text)?.[1] : undefined;
    if (name) out.push({ kind: 'command', name, at, key: typeof o.uuid === 'string' ? o.uuid : fallbackKey });
  }
  return out;
}

const cwdAt = (buf: Buffer, i: number, end: number): string | undefined => {
  const m = /^"cwd":("(?:[^"\\]|\\.)*")/.exec(buf.toString('utf8', i, Math.min(end, i + 4096)));
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
};

/** Scans complete lines (`buf` ends with a newline) that start at byte `base` of the file. */
export function scanLines(buf: Buffer, base: number, s: ScanState): void {
  if (s.main && s.cwd === undefined) {
    const i = buf.indexOf(CWD);
    if (i >= 0) s.cwd = cwdAt(buf, i, buf.indexOf(NL, i));
  }
  // The title: the first prompt whose line ends within the first 4 MB, read in order.
  for (let start = 0; s.main && s.title === undefined && start < buf.length && base + start < TITLE_BYTES; ) {
    const end = buf.indexOf(NL, start);
    if (base + end >= TITLE_BYTES) break;
    const at = buf.indexOf(USER, start);
    if (at < 0) break;
    if (at < end) {
      const o = parse(buf, start, end);
      const text = o && isPrompt(o) ? promptText(o.message?.content) : undefined;
      if (text) s.title = text.slice(0, TITLE_CAP);
      start = end + 1;
    } else start = buf.lastIndexOf(NL, at) + 1;
  }
  const lines = new Map<number, number>();
  const add = (i: number) => lines.set(buf.lastIndexOf(NL, i) + 1, buf.indexOf(NL, i));
  for (let i = buf.indexOf(TOOL_NAME); i >= 0; i = buf.indexOf(TOOL_NAME, i + TOOL_NAME.length)) {
    const name = buf.toString('latin1', i + TOOL_NAME.length, i + TOOL_NAME.length + 6);
    if (name === 'Agent"' || name === 'Skill"' || name.startsWith('Task"')) add(i);
  }
  for (let i = buf.indexOf(COMMAND); i >= 0; i = buf.indexOf(COMMAND, i + COMMAND.length)) add(i);
  for (const [start, end] of [...lines].sort((a, b) => a[0] - b[0])) {
    s.parsed++;
    const o = parse(buf, start, end);
    if (o) s.hits.push(...hitsOf(o, `${base + start}`));
  }
}

/** Reads `file` from `s.offset` up to byte `size`, in complete lines; a line still being written is left for the next scan. */
export async function scanFile(file: string, s: ScanState, size: number): Promise<void> {
  if (size <= s.offset) return;
  const stream = fs.createReadStream(file, { start: s.offset, end: size - 1, highWaterMark: 1 << 20 });
  let pending: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const last = chunk.lastIndexOf(NL);
    if (last < 0) {
      pending.push(chunk);
      continue;
    }
    const lines = pending.length ? Buffer.concat([...pending, chunk.subarray(0, last + 1)]) : chunk.subarray(0, last + 1);
    scanLines(lines, s.offset, s);
    s.offset += lines.length;
    pending = last + 1 < chunk.length ? [chunk.subarray(last + 1)] : [];
  }
}

export interface Listed {
  file: string;
  root: string;
  /** For an agent transcript, its session's main transcript. */
  main?: string;
}

const dirents = async (dir: string): Promise<fs.Dirent[]> => {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

async function walk(dir: string, add: (file: string) => void): Promise<void> {
  for (const e of await dirents(dir)) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, add);
    else if (e.isFile() && e.name.endsWith('.jsonl')) add(p);
  }
}

/** Every transcript under `<root>/projects`: `<slug>/<id>.jsonl`, and everything under `<slug>/<id>/subagents/` (workflows included) for session `<id>`. A folder or file starting with a dot is skipped. */
export async function listTranscripts(root: string): Promise<Listed[]> {
  const projects = path.join(root, 'projects');
  const out: Listed[] = [];
  const slugs = (await dirents(projects)).filter(d => d.isDirectory() && !d.name.startsWith('.'));
  // The project folders are read side by side: a listing is a few hundred directory reads.
  await Promise.all(
    slugs.map(async slug => {
      const folder = path.join(projects, slug.name);
      for (const e of await dirents(folder)) {
        if (e.name.startsWith('.')) continue;
        if (e.isFile() && e.name.endsWith('.jsonl')) out.push({ file: path.join(folder, e.name), root });
        else if (e.isDirectory()) {
          const main = path.join(folder, `${e.name}.jsonl`);
          await walk(path.join(folder, e.name, 'subagents'), file => out.push({ file, root, main }));
        }
      }
    })
  );
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
