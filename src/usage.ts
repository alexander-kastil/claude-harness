import * as fs from 'fs';
import * as path from 'path';
import { Hit, Listed, ScanState, listTranscripts, scanFile } from './usage-scan';

// Where each agent and skill was used: an index over every Claude Code transcript of every account, kept in the
// extension's storage. A file is read once; after that only what was appended to it, since transcripts only grow.
// Reading a transcript is usage-scan.ts, matching the index to an element is usage-rows.ts.

/** Bumped when the stored shape or what counts as a use changes; an index of another version is built again. */
export const USAGE_VERSION = 1;

export interface FileEntry {
  size: number;
  mtime: number;
  ino: number;
  birth: number;
  /** Byte offset after the last complete line read. */
  offset: number;
  hits: Hit[];
  /** An agent transcript: the main transcript of the session it belongs to. */
  main?: string;
  /** A main transcript: the account folder it was found under. */
  root?: string;
  /** A main transcript: the folder the session ran in. */
  cwd?: string;
  /** A main transcript: its first prompt, as the session list titles it; unset while none was found in the first 4 MB. */
  title?: string;
}

export interface IndexData {
  version: number;
  /** By absolute transcript path. */
  files: Record<string, FileEntry>;
}

export interface Progress {
  done: number;
  total: number;
}

type Plan = 'skip' | 'append' | 'full';

export function planOf(prev: FileEntry | undefined, st: fs.Stats): Plan {
  if (!prev) return 'full';
  if (prev.size === st.size && prev.mtime === st.mtimeMs) return 'skip';
  const replaced = (prev.ino && st.ino && prev.ino !== st.ino) || (prev.birth && st.birthtimeMs && Math.abs(prev.birth - st.birthtimeMs) > 1);
  return !replaced && st.size > prev.size ? 'append' : 'full';
}

async function scanEntry(t: Listed, st: fs.Stats, prev: FileEntry | undefined): Promise<FileEntry> {
  const s: ScanState = prev ? { hits: [...prev.hits], offset: prev.offset, parsed: 0, main: !t.main, cwd: prev.cwd, title: prev.title } : { hits: [], offset: 0, parsed: 0, main: !t.main };
  let size = st.size;
  let mtime = st.mtimeMs;
  try {
    await scanFile(t.file, s, st.size);
  } catch {
    // Unreadable now: keep what was read, and read on from there next time.
    size = s.offset;
    mtime = 0;
  }
  const entry: FileEntry = { size, mtime, ino: st.ino, birth: st.birthtimeMs, offset: s.offset, hits: s.hits };
  if (t.main) entry.main = t.main;
  else {
    entry.root = t.root;
    if (s.cwd !== undefined) entry.cwd = s.cwd;
    if (s.title !== undefined) entry.title = s.title;
  }
  return entry;
}

const yieldNow = () => new Promise<void>(resolve => setImmediate(resolve));

/** The index on disk and in memory. One build or refresh runs at a time; callers in the meantime share it. */
export class UsageIndex {
  private data: IndexData | undefined;
  private loading: Promise<IndexData | undefined> | undefined;
  private running: Promise<IndexData> | undefined;
  /** When the last refresh finished, ms. */
  private checked = 0;
  private readonly listeners = new Set<(p: Progress) => void>();

  constructor(private readonly file: string) {}

  private load(): Promise<IndexData | undefined> {
    if (this.data) return Promise.resolve(this.data);
    this.loading ??= fs.promises
      .readFile(this.file, 'utf8')
      .then(text => {
        const d = JSON.parse(text);
        return d && d.version === USAGE_VERSION && d.files && typeof d.files === 'object' ? (d as IndexData) : undefined;
      })
      .catch(() => undefined)
      .then(d => (this.data ??= d));
    return this.loading;
  }

  /** True when an index was built before (in memory or on disk), or a build is running. */
  async exists(): Promise<boolean> {
    return !!this.running || !!(await this.load());
  }

  /**
   * Brings the index up to date with the transcripts of the account folders; the first call builds it. A refresh that
   * finished less than `maxAge` ms ago is not repeated: the page asks on every repaint, and a listing of every
   * transcript folder is not worth it for each.
   */
  refresh(roots: string[], progress?: (p: Progress) => void, maxAge = 0): Promise<IndexData> {
    if (maxAge && !this.running && this.data && Date.now() - this.checked < maxAge) return Promise.resolve(this.data);
    if (progress) this.listeners.add(progress);
    this.running ??= this.run(roots).finally(() => (this.running = undefined));
    return this.running.finally(() => progress && this.listeners.delete(progress));
  }

  private emit(p: Progress): void {
    for (const l of this.listeners) l(p);
  }

  private async run(roots: string[]): Promise<IndexData> {
    const old = (await this.load()) ?? { version: USAGE_VERSION, files: {} };
    const listed: Listed[] = [];
    for (const root of roots) listed.push(...(await listTranscripts(root)));
    const files: Record<string, FileEntry> = {};
    const jobs: { t: Listed; st: fs.Stats; prev?: FileEntry }[] = [];
    // Without an index on disk the first run saves one, even an empty one, so the badge knows it exists.
    let changed = !this.data;
    for (let i = 0; i < listed.length; i += 64) {
      const batch = listed.slice(i, i + 64);
      const stats = await Promise.all(batch.map(t => fs.promises.stat(t.file).catch(() => undefined)));
      batch.forEach((t, k) => {
        const st = stats[k];
        if (!st || files[t.file]) return;
        const prev = old.files[t.file];
        const plan = planOf(prev, st);
        if (plan === 'skip') files[t.file] = prev;
        else jobs.push({ t, st, prev: plan === 'append' ? prev : undefined });
      });
    }
    const seen = new Set(listed.map(t => t.file));
    if (Object.keys(old.files).some(f => !seen.has(f))) changed = true;
    let done = 0;
    this.emit({ done, total: jobs.length });
    const queue = [...jobs];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const entry = (files[job.t.file] = await scanEntry(job.t, job.st, job.prev));
        // A transcript that only grew without a use in it is not written out: its stored offset still reads on from the right place.
        const was = old.files[job.t.file];
        if (!was || !job.prev || entry.hits.length !== was.hits.length || entry.title !== was.title || entry.cwd !== was.cwd) changed = true;
        done++;
        this.emit({ done, total: jobs.length });
        await yieldNow();
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    const data: IndexData = { version: USAGE_VERSION, files };
    this.data = data;
    this.checked = Date.now();
    if (changed) await this.save(data);
    return data;
  }

  private async save(data: IndexData): Promise<void> {
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8');
      await fs.promises.rename(tmp, this.file);
    } catch {
      // The index stays in memory; the next change tries again.
    }
  }
}
