import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { goneBranches, listWorktrees, parseWorktrees, same, worktreesRequest } from '../../src/worktrees';
import type { Ask, HostDeps, WorktreeSession } from '../../src/worktrees';

// A scratch repository with a bare remote and four worktrees, under the code drive.
const ROOT = path.join('D:/claude-scratch/worktrees', `unit-${process.pid}-${Date.now()}`);
const repo = path.join(ROOT, 'repo');
const remote = path.join(ROOT, 'remote.git');
const wt = (name: string) => path.join(ROOT, name);

const g = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

const DAY = 24 * 60 * 60 * 1000;
const sessionsByDir: Record<string, WorktreeSession[]> = {};
const deps = (ask: Ask = () => Promise.resolve('ok')): HostDeps => ({
  repo,
  ask,
  sessionsOf: async dir => sessionsByDir[path.basename(dir)] ?? [],
});

before(() => {
  fs.mkdirSync(ROOT, { recursive: true });
  g(ROOT, 'init', '--bare', '-b', 'main', 'remote.git');
  fs.mkdirSync(repo);
  g(repo, 'init', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'first');
  g(repo, 'remote', 'add', 'origin', remote);
  g(repo, 'push', '-u', 'origin', 'main');
  // ahead: pushed with upstream, then one more commit
  g(repo, 'worktree', 'add', '-b', 'ahead', wt('wt-ahead'));
  g(wt('wt-ahead'), 'push', '-u', 'origin', 'ahead');
  fs.writeFileSync(path.join(wt('wt-ahead'), 'b.txt'), 'b\n');
  g(wt('wt-ahead'), 'add', '.');
  g(wt('wt-ahead'), 'commit', '-m', 'second');
  // dirty: an untracked file
  g(repo, 'worktree', 'add', '-b', 'dirty', wt('wt-dirty'));
  fs.writeFileSync(path.join(wt('wt-dirty'), 'new.txt'), 'x\n');
  // gone: its upstream branch is deleted on the remote
  g(repo, 'worktree', 'add', '-b', 'gone', wt('wt-gone'));
  g(wt('wt-gone'), 'push', '-u', 'origin', 'gone');
  g(repo, 'push', 'origin', '--delete', 'gone');
  g(repo, 'fetch', '--prune');
  // missing: its folder is deleted by hand
  g(repo, 'worktree', 'add', '-b', 'missing', wt('wt-missing'));
  fs.rmSync(wt('wt-missing'), { recursive: true, force: true });
  sessionsByDir['wt-ahead'] = [{ id: 's1', title: 'Build the thing', end: Date.now() - DAY }];
  sessionsByDir['wt-dirty'] = [{ id: 's2', title: 'Old work', end: Date.now() - 40 * DAY }];
  sessionsByDir['repo'] = [{ id: 's3', title: 'Main work', end: Date.now() - 200 * DAY }];
});

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('parseWorktrees reads the porcelain blocks', () => {
  const out = ['worktree /r', 'HEAD 1234567890abcdef', 'branch refs/heads/main', '', 'worktree /r-x', 'HEAD abcdef1234567', 'detached', 'locked because', '', 'worktree /r-y', 'HEAD 0000000000000', 'branch refs/heads/y', 'prunable gitdir file points to non-existent location', ''].join('\n');
  const list = parseWorktrees(out);
  assert.equal(list.length, 3);
  assert.deepEqual([list[0].path, list[0].head, list[0].branch], ['/r', '1234567', 'main']);
  assert.equal(list[1].detached, true);
  assert.equal(list[1].locked, 'because');
  assert.match(list[2].prunable ?? '', /non-existent/);
});

test('goneBranches picks the branches whose upstream is gone', () => {
  assert.deepEqual([...goneBranches('main\t\nold\t[gone]\nnew\t[ahead 1]\n')], ['old']);
});

test('listWorktrees gives path, branch, changes, ahead and behind of every worktree', async () => {
  const list = await listWorktrees(repo, 30, deps());
  assert.equal(list.length, 5);
  const by = (name: string) => list.find(w => path.basename(w.path) === name)!;
  assert.equal(list[0].main, true);
  assert.equal(by('repo').branch, 'main');
  assert.equal(by('wt-ahead').changes, 0);
  assert.equal(by('wt-ahead').ahead, 1);
  assert.equal(by('wt-ahead').behind, 0);
  assert.equal(by('wt-ahead').head.length, 7);
  assert.equal(by('wt-dirty').changes, 1);
  assert.equal(by('wt-dirty').upstream, undefined);
  assert.equal(by('wt-ahead').sessions.length, 1);
});

test('Stale: prunable, a gone upstream, or no session in the period; the main folder never', async () => {
  const list = await listWorktrees(repo, 30, deps());
  const by = (name: string) => list.find(w => path.basename(w.path) === name)!;
  assert.deepEqual(by('wt-ahead').stale, []);
  assert.equal(by('repo').stale.length, 0);
  assert.match(by('wt-dirty').stale.join(' '), /No Claude session in the last 30 days/);
  assert.match(by('wt-gone').stale.join(' '), /upstream of gone is gone/);
  assert.equal(by('wt-gone').branchGone, true);
  assert.ok(by('wt-missing').prunable);
  assert.match(by('wt-missing').stale.join(' '), /prunable/);
  // a longer period brings the 40 day old session back in
  const longer = await listWorktrees(repo, 90, deps());
  assert.equal(longer.find(w => path.basename(w.path) === 'wt-dirty')!.stale.length, 0);
});

test('Remove without --force: cancelled, nothing runs; a worktree with changes is refused by git; the main folder is refused', async () => {
  const asked: string[] = [];
  const ask: Ask = card => {
    asked.push(`${card.title}|${card.sub}`);
    return Promise.resolve(card.sub === 'cancel-me' ? 'cancel' : 'ok');
  };
  const cancelled = await worktreesRequest({ op: 'remove', scope: 'repo:x', days: 30, path: wt('wt-gone') }, deps(() => Promise.resolve('cancel')));
  assert.ok(fs.existsSync(wt('wt-gone')));
  assert.equal(cancelled.note, undefined);

  const dirty = await worktreesRequest({ op: 'remove', scope: 'repo:x', days: 30, path: wt('wt-dirty') }, deps(ask));
  assert.equal(dirty.failed, true);
  assert.match(dirty.note ?? '', /Could not remove it/);
  assert.ok(fs.existsSync(wt('wt-dirty')), 'git refused, the folder stays');
  assert.ok(asked[0].replace(/\//g, '\\').toLowerCase().includes(wt('wt-dirty').toLowerCase()), `the card names the path: ${asked[0]}`);

  const main = await worktreesRequest({ op: 'remove', scope: 'repo:x', days: 30, path: repo }, deps(ask));
  assert.equal(main.failed, true);
  assert.equal(asked.length, 1, 'the main folder is refused before any card');

  const unknown = await worktreesRequest({ op: 'remove', scope: 'repo:x', days: 30, path: wt('nope') }, deps(ask));
  assert.equal(unknown.failed, true);
});

test('Remove deletes a clean worktree after the card', async () => {
  const reply = await worktreesRequest({ op: 'remove', scope: 'repo:x', days: 30, path: wt('wt-gone') }, deps());
  assert.equal(reply.failed, undefined);
  assert.match(reply.note ?? '', /Removed/);
  assert.equal(fs.existsSync(wt('wt-gone')), false);
  assert.equal(reply.list.some(w => same(w.path, wt('wt-gone'))), false);
});

test('Prune names what it deletes, runs only after the card, and drops the record of a missing folder', async () => {
  const cards: string[][] = [];
  const cancelled = await worktreesRequest({ op: 'prune', scope: 'repo:x', days: 30 }, deps(card => (cards.push(card.facts), Promise.resolve('cancel'))));
  assert.ok(cards[0].some(f => f.includes('wt-missing')), cards[0].join('\n'));
  assert.ok(cancelled.list.some(w => path.basename(w.path) === 'wt-missing'), 'cancelled: the record stays');
  const done = await worktreesRequest({ op: 'prune', scope: 'repo:x', days: 30 }, deps());
  assert.match(done.note ?? '', /Pruned 1 record/);
  assert.equal(done.list.some(w => path.basename(w.path) === 'wt-missing'), false);
  const again = await worktreesRequest({ op: 'prune', scope: 'repo:x', days: 30 }, deps(() => assert.fail('no card when there is nothing to prune')));
  assert.equal(again.note, 'Nothing to prune.');
});

test('a folder that is not a repository gives the git message as the note', async () => {
  fs.mkdirSync(wt('plain'), { recursive: true });
  const reply = await worktreesRequest({ op: 'read', scope: 'repo:x', days: 30 }, { ...deps(), repo: wt('plain') });
  assert.equal(reply.failed, true);
  assert.match(reply.note ?? '', /not a git repository/i);
});
