import * as fs from 'fs';
import * as path from 'path';
import { isPrompt, promptText, textOf } from './sessions';
import { lineFlags } from './session-flags';

// Reading the transcripts for the usage index: which lines can hold a use, what a use is, and where the files are.

/** `mcp` is a call of an MCP tool (name `mcp__<server>__<tool>`), `memory` a CLAUDE.md or rule file loaded into a session (name its path), `style` an output style that was active (name as in the style's frontmatter). */
export type HitKind = 'agent' | 'skill' | 'command' | 'mcp' | 'memory' | 'style';

/** One use in a transcript. `key` (the tool_use id, or the record uuid of a slash command) counts a use that a fork's transcript replays once. */
export interface Hit {
  kind: HitKind;
  name: string;
  /** ms; 0 when the record has no timestamp. */
  at: number;
  key: string;
  /** A memory file: absent when it was loaded at the start of the session, else the globs that matched ('' for a nested CLAUDE.md). */
  info?: string;
}

// Only lines holding a tool name or a command tag are parsed for uses; the rest of a transcript is never decoded.
// One pass finds every `"name":"` (a few per thousand lines) and a second the command tag: that is half the passes over
// the bytes that one needle per tool takes, and the passes are what a first build spends its time on.
const TOOL_NAME = Buffer.from('"name":"');
const COMMAND = Buffer.from('<command-name>');
const USER = Buffer.from('"type":"user"');
const CWD = Buffer.from('"cwd":"');
// MCP calls, the output style and the memory files loaded are read straight from the bytes of their line, never parsed:
// an MCP call is the highest-volume line there is, and an instructions line holds the contents of every file it lists.
const TIMESTAMP = Buffer.from('"timestamp":"');
const ATTACHMENT = Buffer.from('"attachment":{"type":"');
const STYLE = 'output_style","style":"';
const INSTRUCTIONS = 'instructions","files":[';
const NESTED = 'nested_memory","path":"';
const PATH = Buffer.from('"path":"');
const GLOBS = Buffer.from('"globs":[');
const NL = 0x0a;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const API_REQUEST = '{"type":"api-request';
// summaryOf looks for the first prompt in the first 4 MB.
const TITLE_BYTES = 4 * 1024 * 1024;
const TITLE_CAP = 500;

type Rec = Record<string, any>;

/**
 * What one hook did in one transcript, counted, never one entry per run: a transcript holds thousands of `hook_success`
 * records. A hook is told apart by the name Claude Code gave it (`Event:matcher` or `Event`) and the command it ran.
 */
export interface HookStat {
  hook: string;
  command?: string;
  runs: number;
  /** Runs that ended in a `hook_non_blocking_error` or `hook_blocking_error`. */
  failed: number;
  /** Summed duration, ms, of the `timed` runs that reported one. */
  ms: number;
  timed: number;
  /** The exit code of the last failed run that had one. */
  exit?: number;
  /** ms of the last run; 0 when it has no timestamp. */
  last: number;
}

const HOOK_RUNS = ['hook_success', 'hook_non_blocking_error', 'hook_blocking_error'];
const DENIED = Buffer.from('"is_error":true');

/** What a scan has found so far in one file; a later scan of the appended bytes goes on from it. */
export interface ScanState {
  hits: Hit[];
  /** Hook runs by hook and command. */
  hooks?: HookStat[];
  /** An agent transcript: tool calls a hook or mod denied. */
  denied?: number;
  /** Byte offset after the last complete line scanned. */
  offset: number;
  /** Lines that passed the prefilter and were parsed for uses. */
  parsed: number;
  /** A main transcript, whose cwd and title are looked up too. */
  main: boolean;
  cwd?: string;
  title?: string;
  /** Output styles and memory files already found in this file (`kind\0name`): only the first record of each counts. Built on first use. */
  seen?: Set<string>;
}

/** The string whose opening quote is just before byte `i`, decoded; undefined when it does not end before `end`. */
const stringAt = (buf: Buffer, i: number, end: number): string | undefined => {
  let escaped = false;
  let j = i;
  for (; j < end; j++) {
    const c = buf[j];
    if (c === BACKSLASH) {
      escaped = true;
      j++;
    } else if (c === QUOTE) break;
  }
  if (j >= end) return undefined;
  const raw = buf.toString('utf8', i, j);
  if (!escaped) return raw;
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return undefined;
  }
};

/** The strings of the array whose `[` is just before byte `i`. */
const stringsAt = (buf: Buffer, i: number, end: number): string[] => {
  let inString = false;
  let j = i;
  for (; j < end; j++) {
    const c = buf[j];
    if (inString && c === BACKSLASH) j++;
    else if (c === QUOTE) inString = !inString;
    else if (!inString && c === 0x5d) break;
  }
  try {
    const list = JSON.parse(`[${buf.toString('utf8', i, j)}]`);
    return Array.isArray(list) ? list.filter(g => typeof g === 'string') : [];
  } catch {
    return [];
  }
};

/** The record time of the line from `start` to `end`: its first timestamp key (searched forwards: a backwards search of a buffer is slow). */
const stampIn = (buf: Buffer, start: number, end: number): number => {
  const i = buf.indexOf(TIMESTAMP, start);
  if (i < 0 || i >= end) return 0;
  const t = Date.parse(buf.toString('latin1', i + TIMESTAMP.length, i + TIMESTAMP.length + 24));
  return Number.isNaN(t) ? 0 : t;
};

/** The call of an MCP tool whose `"name":"` is at byte `i`: only a tool_use block counts, so a name quoted anywhere else does not. */
function mcpCallAt(buf: Buffer, i: number, s: ScanState): void {
  // The block is checked before the line is looked up: a name inside a tool list on a megabyte-long line is no call, and a search for that line's start would cost more than the call itself.
  const id = /"type":"tool_use","id":"([^"]*)",$/.exec(buf.toString('latin1', Math.max(0, i - 100), i))?.[1];
  if (id === undefined) return;
  const start = buf.lastIndexOf(NL, i) + 1;
  const end = buf.indexOf(NL, i);
  const name = stringAt(buf, i + TOOL_NAME.length, end);
  // The end of the id tells two calls apart as well as all of it, at less than half the size in the index.
  if (name) s.hits.push({ kind: 'mcp', name, at: stampIn(buf, start, end), key: id.slice(-12) || `${i}` });
}

/** Adds a style or memory hit unless the file has it already. */
function firstOf(buf: Buffer, i: number, s: ScanState, kind: 'style' | 'memory', name: string | undefined, info?: string): void {
  if (!name) return;
  s.seen ??= new Set(s.hits.filter(h => h.kind === 'style' || h.kind === 'memory').map(h => `${h.kind}\0${h.name}`));
  const mark = `${kind}\0${name}`;
  if (s.seen.has(mark)) return;
  s.seen.add(mark);
  const start = buf.lastIndexOf(NL, i) + 1;
  // The name is the key too, so it is not stored twice: usesOf reads an empty key as the name.
  const hit: Hit = { kind, name, at: stampIn(buf, start, buf.indexOf(NL, i)), key: '' };
  if (info !== undefined) hit.info = info;
  s.hits.push(hit);
}

/** Counts the hook run whose attachment record has `"attachment":{"type":"` at byte `i`. */
function hookRunAt(buf: Buffer, i: number, s: ScanState): void {
  const start = buf.lastIndexOf(NL, i) + 1;
  const end = buf.indexOf(NL, i);
  const o = parse(buf, start, end);
  const a = o?.attachment;
  if (!o || !a || !HOOK_RUNS.includes(a.type)) return;
  const hook = String(a.hookName || a.hookEvent || 'hook');
  const command = typeof a.command === 'string' ? a.command : typeof a.blockingError?.command === 'string' ? a.blockingError.command : undefined;
  const list = (s.hooks ??= []);
  let stat = list.find(h => h.hook === hook && h.command === command);
  if (!stat) list.push((stat = { hook, ...(command ? { command } : {}), runs: 0, failed: 0, ms: 0, timed: 0, last: 0 }));
  stat.runs++;
  if (a.type !== 'hook_success') {
    stat.failed++;
    if (typeof a.exitCode === 'number') stat.exit = a.exitCode;
  }
  if (typeof a.durationMs === 'number') {
    stat.ms += a.durationMs;
    stat.timed++;
  }
  stat.last = Math.max(stat.last, timeOf(o));
}

const parse =(buf: Buffer, start: number, end: number): Rec | undefined => {
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
    else if (name.startsWith('mcp__')) mcpCallAt(buf, i, s);
  }
  // One pass over the attachment records for three kinds of them. The output style repeats on every turn: the first
  // record per file and style is the use. Of the memory files only the paths are read, never what the files held.
  for (let i = buf.indexOf(ATTACHMENT); i >= 0; i = buf.indexOf(ATTACHMENT, i + ATTACHMENT.length)) {
    const j = i + ATTACHMENT.length;
    const head = buf.toString('latin1', j, j + 24);
    if (head.startsWith('hook_')) hookRunAt(buf, i, s);
    else if (head.startsWith(STYLE)) firstOf(buf, i, s, 'style', stringAt(buf, j + STYLE.length, buf.indexOf(NL, i)));
    else if (head.startsWith(INSTRUCTIONS)) {
      const end = buf.indexOf(NL, i);
      for (let p = buf.indexOf(PATH, j); p >= 0 && p < end; p = buf.indexOf(PATH, p + PATH.length)) firstOf(buf, i, s, 'memory', stringAt(buf, p + PATH.length, end));
    } else if (head.startsWith(NESTED)) {
      const end = buf.indexOf(NL, i);
      const g = buf.indexOf(GLOBS, j);
      firstOf(buf, i, s, 'memory', stringAt(buf, j + NESTED.length, end), g >= 0 && g < end ? stringsAt(buf, g + GLOBS.length, end).join(', ') : '');
    }
  }
  // In an agent's own transcript, the tool calls that a hook or mod denied (the same test as the session list's Mod flag).
  if (!s.main)
    for (let i = buf.indexOf(DENIED), done = -1; i >= 0; i = buf.indexOf(DENIED, i + DENIED.length)) {
      const start = buf.lastIndexOf(NL, i) + 1;
      if (start === done) continue;
      done = start;
      if (lineFlags(buf.toString('latin1', start, buf.indexOf(NL, i))).modDenied) s.denied = (s.denied ?? 0) + 1;
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
