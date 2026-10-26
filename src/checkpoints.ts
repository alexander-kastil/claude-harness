import * as fs from 'fs';
import * as path from 'path';

type Rec = Record<string, any>;

/** The point Claude Code saved at one prompt: the files it had tracked then, each with the backup that holds the file as it was. */
interface Snapshot {
  id: string;
  at: number;
  /** Absolute file path to the backup's file name, or null when the file did not exist yet. */
  files: Map<string, string | null>;
}

/** A prompt with a checkpoint, as the Timeline marks it. */
export interface Checkpoint {
  id: string;
  at: number;
}

/** A file Claude changed after a checkpoint, with what restoring it does. `backup` is the saved copy; none when the file did not exist then. */
export interface CheckpointFile {
  path: string;
  action: 'overwrite' | 'remove' | 'recreate';
  backup?: string;
}

const leaf = (p: string) => p.split(/[\\/]/).pop() ?? p;

/**
 * Reads the `file-history-snapshot` lines of a transcript. A line per prompt, plus updates that add the files Claude
 * touched in that turn; the entries of one prompt are merged, the later line winning. A key is the path relative to the
 * session's folder, or absolute outside it, so the file's place is `realParentDir` plus the key's last part.
 */
export function readSnapshots(records: Rec[]): Snapshot[] {
  const promptTime = new Map<string, number>();
  for (const o of records) if (o.type === 'user' && typeof o.uuid === 'string' && typeof o.timestamp === 'string') promptTime.set(o.uuid, Date.parse(o.timestamp));
  const byId = new Map<string, Snapshot>();
  for (const o of records) {
    if (o.type !== 'file-history-snapshot' || typeof o.messageId !== 'string') continue;
    const backups = o.snapshot?.trackedFileBackups;
    const stamp = typeof o.snapshot?.timestamp === 'string' ? Date.parse(o.snapshot.timestamp) : NaN;
    const snap = byId.get(o.messageId) ?? { id: o.messageId, at: promptTime.get(o.messageId) ?? stamp, files: new Map<string, string | null>() };
    byId.set(o.messageId, snap);
    if (!backups || typeof backups !== 'object') continue;
    for (const [key, b] of Object.entries<any>(backups)) {
      const dir = typeof b?.realParentDir === 'string' ? b.realParentDir : undefined;
      const file = dir ? path.join(dir, leaf(key)) : path.isAbsolute(key) ? key : undefined;
      if (file) snap.files.set(file, typeof b?.backupFileName === 'string' ? b.backupFileName : null);
    }
  }
  return [...byId.values()].filter(s => !Number.isNaN(s.at)).sort((a, b) => a.at - b.at);
}

/** The prompts that have a checkpoint; none when Claude never edited a file in the session. */
export function checkpointsOf(snaps: Snapshot[]): Checkpoint[] {
  return snaps.some(s => s.files.size) ? snaps.map(s => ({ id: s.id, at: s.at })) : [];
}

/** The folder that holds a session's backups: next to the `projects` folder of the account the transcript is in. */
export const historyDir = (transcript: string, sessionId: string) => path.join(path.dirname(path.dirname(path.dirname(transcript))), 'file-history', sessionId);

const same = (a: Buffer, b: Buffer) => a.length === b.length && a.equals(b);

/**
 * The files Claude changed since the checkpoint whose content differs from the checkpoint's now. A file the checkpoint
 * does not list was first touched by a later prompt, whose snapshot holds its content from before that edit, which is
 * its content at the checkpoint too. Files whose backup is gone from disk are left out.
 */
export function changedSince(snaps: Snapshot[], id: string, history: string): CheckpointFile[] {
  const at = snaps.findIndex(s => s.id === id);
  if (at < 0) return [];
  const then = new Map<string, string | null>();
  for (const s of snaps.slice(at)) for (const [file, backup] of s.files) if (!then.has(file)) then.set(file, backup);
  const out: CheckpointFile[] = [];
  for (const [file, name] of then) {
    const exists = fs.existsSync(file) && fs.statSync(file).isFile();
    if (name === null) {
      if (exists) out.push({ path: file, action: 'remove' });
      continue;
    }
    const backup = path.join(history, name);
    if (!fs.existsSync(backup)) continue;
    if (!exists) out.push({ path: file, action: 'recreate', backup });
    else if (!same(fs.readFileSync(backup), fs.readFileSync(file))) out.push({ path: file, action: 'overwrite', backup });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Puts each file back as the checkpoint had it: the saved copy over it, or the file removed. Returns what failed. */
export function restoreFiles(files: CheckpointFile[]): { restored: number; failed: { path: string; error: string }[] } {
  let restored = 0;
  const failed: { path: string; error: string }[] = [];
  for (const f of files) {
    try {
      if (f.action === 'remove') fs.rmSync(f.path, { force: true });
      else if (f.backup) {
        fs.mkdirSync(path.dirname(f.path), { recursive: true });
        fs.copyFileSync(f.backup, f.path);
      }
      restored++;
    } catch (e) {
      failed.push({ path: f.path, error: (e as Error).message });
    }
  }
  return { restored, failed };
}
