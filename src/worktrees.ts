// The Worktrees tab of the repo page: every git worktree of a repo with its state, the Claude sessions that ran in it and
// whether it looks stale, plus Remove and Prune. This reads `git worktree list`; the extension's own walk skips worktrees.
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { PanelAsk } from './shared/messages';

export interface WorktreeSession {
  id: string;
  title: string;
  end: number;
}

export interface WorktreeInfo {
  path: string;
  /** The branch checked out, without `refs/heads/`; absent when HEAD is detached. */
  branch?: string;
  /** The first seven characters of HEAD. */
  head: string;
  /** The repository's own folder, the first entry of the list. */
  main: boolean;
  bare: boolean;
  detached: boolean;
  /** Git's reason when the worktree can be pruned (its folder is gone). */
  prunable?: string;
  locked?: string;
  /** Changed or untracked files; undefined when the folder cannot be read. */
  changes?: number;
  upstream?: string;
  ahead?: number;
  behind?: number;
  /** The branch's upstream no longer exists. */
  branchGone: boolean;
  sessions: WorktreeSession[];
  /** Why it is tagged Stale, one plain sentence each; empty when it is not. */
  stale: string[];
}

export interface WorktreesReply {
  scope: string;
  days: number;
  list: WorktreeInfo[];
  /** One plain line: what the last Remove or Prune did, or why nothing is listed. */
  note?: string;
  failed?: boolean;
}

export interface WorktreesRequest {
  op: 'read' | 'remove' | 'prune';
  scope: string;
  days: number;
  path?: string;
}

/** `out` is stdout on success and the error text on failure; `err` is stderr always (`git worktree prune -v` reports there). */
export type Git = (args: string[], cwd: string) => Promise<{ code: number; out: string; err?: string }>;

export const gitRun: Git = (args, cwd) =>
  new Promise(resolve => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, out: code === 0 ? String(stdout) : String(stderr || stdout || (err && err.message) || ''), err: String(stderr || '') });
    });
  });

interface Raw {
  path: string;
  head: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked?: string;
  prunable?: string;
}

/** Parses `git worktree list --porcelain`: blocks separated by a blank line, one `key value` per line. */
export function parseWorktrees(text: string): Raw[] {
  const list: Raw[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let cur: Raw | undefined;
    for (const line of block.split(/\r?\n/)) {
      const space = line.indexOf(' ');
      const key = space < 0 ? line : line.slice(0, space);
      const value = space < 0 ? '' : line.slice(space + 1);
      if (key === 'worktree') {
        cur = { path: value, head: '', detached: false, bare: false };
        list.push(cur);
      } else if (!cur) continue;
      else if (key === 'HEAD') cur.head = value.slice(0, 7);
      else if (key === 'branch') cur.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'detached') cur.detached = true;
      else if (key === 'bare') cur.bare = true;
      else if (key === 'locked') cur.locked = value || 'locked';
      else if (key === 'prunable') cur.prunable = value || 'prunable';
    }
  }
  return list;
}

/** Branches whose upstream is gone, from `git for-each-ref` with the track text. */
export function goneBranches(text: string): Set<string> {
  const gone = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const [name, track] = line.split('\t');
    if (name && track && track.trim() === '[gone]') gone.add(name);
  }
  return gone;
}

export const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export interface ListDeps {
  git?: Git;
  /** The sessions whose working folder is exactly this folder. */
  sessionsOf: (dir: string) => Promise<WorktreeSession[]>;
  now?: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Every worktree of the repo at `repo`, with its facts. Rejects with git's message when `repo` is not a repository. */
export async function listWorktrees(repo: string, days: number, deps: ListDeps): Promise<WorktreeInfo[]> {
  const git = deps.git ?? gitRun;
  const now = deps.now ?? Date.now();
  const listed = await git(['worktree', 'list', '--porcelain'], repo);
  if (listed.code !== 0) throw new Error(listed.out.trim().split(/\r?\n/).pop() || 'git worktree list failed');
  const raws = parseWorktrees(listed.out);
  const refs = await git(['for-each-ref', '--format=%(refname:short)\t%(upstream:track)', 'refs/heads'], repo);
  const gone = refs.code === 0 ? goneBranches(refs.out) : new Set<string>();
  return Promise.all(
    raws.map(async (r, i): Promise<WorktreeInfo> => {
      const exists = !r.prunable && fs.existsSync(r.path);
      let changes: number | undefined;
      let upstream: string | undefined;
      let ahead: number | undefined;
      let behind: number | undefined;
      if (exists && !r.bare) {
        const st = await git(['status', '--porcelain'], r.path);
        if (st.code === 0) changes = st.out.split(/\r?\n/).filter(Boolean).length;
        if (r.branch) {
          const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], r.path);
          if (up.code === 0) {
            upstream = up.out.trim();
            const counts = await git(['rev-list', '--left-right', '--count', '@{u}...HEAD'], r.path);
            const m = /^(\d+)\s+(\d+)/.exec(counts.out.trim());
            if (counts.code === 0 && m) {
              behind = Number(m[1]);
              ahead = Number(m[2]);
            }
          }
        }
      }
      const sessions = r.bare ? [] : await deps.sessionsOf(r.path).catch(() => []);
      const main = i === 0;
      const branchGone = !!r.branch && gone.has(r.branch);
      const stale: string[] = [];
      if (!main) {
        if (r.prunable) stale.push(`Git reports it prunable: ${r.prunable}.`);
        if (branchGone) stale.push(`The upstream of ${r.branch} is gone.`);
        if (!sessions.some(s => s.end >= now - days * DAY)) stale.push(`No Claude session in the last ${days} days.`);
      }
      return { path: r.path, branch: r.branch, head: r.head, main, bare: r.bare, detached: r.detached, prunable: r.prunable, locked: r.locked, changes, upstream, ahead, behind, branchGone, sessions, stale };
    })
  );
}

export type Ask = (card: Omit<PanelAsk, 'kind' | 'token'>) => Promise<'ok' | 'alt' | 'cancel'> | undefined;

export interface HostDeps extends ListDeps {
  /** The repository's folder. */
  repo: string;
  ask: Ask;
}

const lastLine = (text: string) => text.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';

/**
 * One request of the tab. Remove and Prune ask on a card naming the path first; Remove runs `git worktree remove` without
 * `--force`, so git itself refuses a worktree with changes or one that is locked, and its refusal is the note.
 */
export async function worktreesRequest(req: WorktreesRequest, deps: HostDeps): Promise<WorktreesReply> {
  const git = deps.git ?? gitRun;
  const reply = async (note?: string, failed?: boolean): Promise<WorktreesReply> => {
    try {
      return { scope: req.scope, days: req.days, list: await listWorktrees(deps.repo, req.days, deps), note, failed };
    } catch (e) {
      return { scope: req.scope, days: req.days, list: [], note: (e as Error).message, failed: true };
    }
  };
  if (req.op === 'read') return reply();
  if (req.op === 'remove') {
    const current = await listWorktrees(deps.repo, req.days, deps).catch(() => [] as WorktreeInfo[]);
    const target = current.find(w => req.path && same(w.path, req.path));
    if (!target) return reply('That worktree is not in the list any more.', true);
    if (target.main) return reply('The repository folder itself is not removed.', true);
    const answer = await deps.ask({
      key: 'click',
      glyph: 'trash',
      title: 'Remove worktree',
      sub: target.path,
      facts: [`Runs git worktree remove ${target.path}, without --force.`, target.changes ? `It has ${target.changes} changed ${target.changes === 1 ? 'file' : 'files'}, so git refuses until they are committed or discarded.` : 'Its folder is deleted. The branch stays.', ...(target.locked ? ['It is locked, so git refuses.'] : [])],
      action: 'Remove',
      danger: true,
    });
    if (answer !== 'ok') return reply();
    const r = await git(['worktree', 'remove', target.path], deps.repo);
    return r.code === 0 ? reply(`Removed ${target.path}.`) : reply(`Could not remove it: ${lastLine(r.out)}`, true);
  }
  const dry = await git(['worktree', 'prune', '--dry-run', '-v'], deps.repo);
  const gonePaths = dry.code === 0 ? `${dry.out}\n${dry.err ?? ''}`.split(/\r?\n/).filter(Boolean) : [];
  if (!gonePaths.length) return reply('Nothing to prune.');
  // The card names the folders when git lists them as prunable; git's own lines name only the record.
  const named = (await listWorktrees(deps.repo, req.days, deps).catch(() => [] as WorktreeInfo[])).filter(w => w.prunable).map(w => w.path);
  const answer = await deps.ask({
    key: 'click',
    glyph: 'trash',
    title: 'Prune worktrees',
    sub: deps.repo,
    facts: [...(named.length ? named : gonePaths),'Runs git worktree prune. Only records of worktrees whose folder is gone are deleted.'],
    action: 'Prune',
    danger: true,
    scroll: true,
  });
  if (answer !== 'ok') return reply();
  const r = await git(['worktree', 'prune'], deps.repo);
  return r.code === 0 ? reply(`Pruned ${gonePaths.length} ${gonePaths.length === 1 ? 'record' : 'records'}.`) : reply(`Could not prune: ${lastLine(r.out)}`, true);
}
