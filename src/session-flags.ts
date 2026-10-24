import * as fs from 'fs';
import * as path from 'path';

/** What a session's transcripts say about hooks, found without parsing them: the list filters read it. */
export interface SessionFlags {
  hookFailed: boolean;
  modDenied: boolean;
}

const CHUNK = 1024 * 1024;
const HOOK_FAILURE = /"type":\s*"hook_(?:non_)?blocking_error"/;
const DENIAL = /hook error: |<tool_use_error>[a-z0-9][a-z0-9._-]*: /;

/** The flags of one line of a transcript. */
export function lineFlags(line: string): Partial<SessionFlags> {
  if (line.includes('hook_') && HOOK_FAILURE.test(line) && /"type":\s*"attachment"/.test(line)) return { hookFailed: true };
  if (/"is_error":\s*true/.test(line) && DENIAL.test(line) && /"type":\s*"tool_result"/.test(line)) return { modDenied: true };
  return {};
}

interface Scanned {
  /** The bytes already read; a transcript only grows, so a longer file is read from here. */
  offset: number;
  rest: string;
  flags: SessionFlags;
}

const scanned = new Map<string, Scanned>();

/**
 * A list of sessions may spend this long reading transcripts; what it leaves unread is read in the background, so the
 * list comes up at once and its flags are complete from the next read on. 2.4 GB of transcripts took 7 s cold.
 */
const LIST_BUDGET_MS = 250;
const LIST_WINDOW_MS = 1000;
const SLICE_MS = 80;
let windowAt = 0;
const pending = new Set<string>();
let timer: NodeJS.Timeout | undefined;

const overListBudget = () => {
  const now = Date.now();
  if (now - windowAt > LIST_WINDOW_MS) windowAt = now;
  return now - windowAt > LIST_BUDGET_MS;
};

function schedule(): void {
  if (timer || !pending.size) return;
  timer = setTimeout(() => {
    timer = undefined;
    const until = Date.now() + SLICE_MS;
    for (const file of [...pending]) {
      pending.delete(file);
      scanFile(file, () => Date.now() > until);
      if (Date.now() > until) break;
    }
    schedule();
  }, 20);
  timer.unref();
}

function scanFile(file: string, over: () => boolean = () => false): SessionFlags {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { hookFailed: false, modDenied: false };
  }
  let s = scanned.get(file);
  if (!s || size < s.offset) s = { offset: 0, rest: '', flags: { hookFailed: false, modDenied: false } };
  if (s.flags.hookFailed && s.flags.modDenied) s.offset = size;
  if (size > s.offset) {
    let fd: number | undefined;
    try {
      fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(CHUNK);
      while (s.offset < size) {
        if (over()) {
          pending.add(file);
          schedule();
          break;
        }
        const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - s.offset), s.offset);
        if (n <= 0) break;
        s.offset += n;
        // latin1 keeps the bytes of a multibyte character that a chunk splits; the markers are ASCII.
        const lines = (s.rest + buf.toString('latin1', 0, n)).split('\n');
        s.rest = lines.pop() ?? '';
        if (s.flags.hookFailed && s.flags.modDenied) continue;
        for (const line of lines) {
          const f = lineFlags(line);
          if (f.hookFailed) s.flags.hookFailed = true;
          if (f.modDenied) s.flags.modDenied = true;
        }
      }
    } catch {
      // a transcript being rewritten shows no flags this round
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  scanned.set(file, s);
  return s.flags;
}

/**
 * The memory and rule files a session loaded at its start: the paths of the first `instructions` attachment, near the top
 * of the transcript. The contents of the files are never kept. Undefined when the transcript holds no such attachment.
 */
export function loadedFiles(file: string): string[] | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(CHUNK);
    let rest = '';
    let at = 0;
    let lines = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, at);
      if (n <= 0) break;
      at += n;
      const parts = (rest + buf.toString('utf8', 0, n)).split('\n');
      rest = parts.pop() ?? '';
      for (const line of parts) {
        if (++lines > 60) return undefined;
        if (!line.includes('"instructions"')) continue;
        try {
          const a = JSON.parse(line).attachment;
          if (a?.type === 'instructions' && Array.isArray(a.files)) return a.files.map((f: { path?: unknown }) => f.path).filter((p: unknown): p is string => typeof p === 'string');
        } catch {
          // a line that only mentions the word
        }
      }
      if (at > 16 * CHUNK) break;
    }
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return undefined;
}

/** The flags of a session: its transcript and its subagents' transcripts. Each file is read once, then only what it grew by. */
export function sessionFlags(file: string): SessionFlags {
  const out = { ...scanFile(file, overListBudget) };
  const dir = path.join(path.dirname(file), path.basename(file, '.jsonl'), 'subagents');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  } catch {
    // no subagents
  }
  for (const f of names) {
    const sub = scanFile(path.join(dir, f), overListBudget);
    out.hookFailed ||= sub.hookFailed;
    out.modDenied ||= sub.modDenied;
  }
  return out;
}
