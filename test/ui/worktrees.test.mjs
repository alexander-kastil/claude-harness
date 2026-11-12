// UI test of the Worktrees tab of the repo page, run in a real, isolated VS Code (see harness.mjs). shop-api of the fixture
// becomes a git repository with worktrees; Remove and Prune run only on that scratch repository.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { Session, sleep } from './harness.mjs';
import { repoRoot } from './fixture.mjs';

const { projectSlug } = createRequire(import.meta.url)(path.join(repoRoot, 'out', 'src', 'repos-overview.js'));
const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 240000 };
const SHOTS = process.env.WT_SHOTS;
let repo;
let box;
const wt = name => path.join(box, name);

const g = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

// One Claude session in a worktree folder: a user prompt with the folder as its working directory.
const sessionIn = (dir, id, agoMs, prompt) => {
  const folder = path.join(s.fixture.claude, 'projects', projectSlug(dir));
  fs.mkdirSync(folder, { recursive: true });
  const at = new Date(Date.now() - agoMs);
  const file = path.join(folder, `${id}.jsonl`);
  fs.writeFileSync(file, JSON.stringify({ cwd: dir, gitBranch: 'x', entrypoint: 'cli', sessionId: id, type: 'user', uuid: 'u1', timestamp: at.toISOString(), message: { role: 'user', content: prompt } }) + '\n');
  fs.utimesSync(file, at, at);
};

const rows = () => s.ev(D => [...D.querySelectorAll('.main-body .asset-table [role=row]')].slice(1).map(r => [...r.querySelectorAll('[role=cell]')].map(c => c.textContent.replace(/\s+/g, ' ').trim())));
const note = () => s.ev(D => D.querySelector('.worktrees-note')?.textContent || '');
// A card button press, then the card gone: under the full suite's load the closing card is still there for the next step.
const pressCard = async label => {
  await s.mouse('.cf button', label);
  await s.waitFor(D => !D.querySelector('.cf'));
};

before(async () => {
  await s.start();
  repo = s.fixture.repoDirs['shop-api'];
  box = path.join(s.root, 'worktrees-box');
  fs.rmSync(box, { recursive: true, force: true });
  fs.mkdirSync(box, { recursive: true });
  g(repo, 'init', '-b', 'main');
  g(repo, 'add', '.');
  g(repo, 'commit', '-m', 'first');
  g(repo, 'worktree', 'add', '-b', 'feature-live', wt('wt-live'));
  g(repo, 'worktree', 'add', '-b', 'feature-idle', wt('wt-idle'));
  g(repo, 'worktree', 'add', '-b', 'feature-dirty', wt('wt-dirty'));
  fs.writeFileSync(path.join(wt('wt-dirty'), 'edit.txt'), 'x\n');
  g(repo, 'worktree', 'add', '-b', 'feature-lost', wt('wt-lost'));
  fs.rmSync(wt('wt-lost'), { recursive: true, force: true });
  sessionIn(wt('wt-live'), 'aaaaaaaa-0000-4000-8000-000000000001', 3 * 3600000, 'Work in the live worktree');
  sessionIn(wt('wt-dirty'), 'aaaaaaaa-0000-4000-8000-000000000002', 5 * 3600000, 'Work in the dirty worktree');
  await s.openPanel();
  // The window is 1280 px wide.
  await s.resize(1280, 800);
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.mouse('.sidebar .repo-head', 'shop-api');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'shop-api');
});

after(async () => {
  await s.stop();
  await sleep(500);
  fs.rmSync(box, { recursive: true, force: true });
});

test('the Worktrees tab lists every worktree with branch, changes, ahead, behind, sessions and state', T, async () => {
  await s.mouse('.main-body .view-tab', 'Worktrees');
  await s.waitFor(D => D.querySelectorAll('.main-body .asset-table [role=row]').length === 6);
  const list = await rows();
  const by = name => list.find(r => r[0] === name);
  assert.ok(by('shop-api'), JSON.stringify(list));
  assert.ok(by('shop-api').join(' ').includes('Main'));
  assert.deepEqual([by('wt-live')[1], by('wt-live')[3], by('wt-live')[6]], ['feature-live', 'Clean', '1']);
  assert.match(by('wt-dirty')[3], /1 change/);
  assert.equal(by('wt-live')[7], '', 'a worktree with a recent session is not stale');
  assert.equal(by('wt-idle')[7], 'Stale');
  assert.equal(by('wt-lost')[7], 'Stale');
  const tip = await s.ev(D => [...D.querySelectorAll('.main-body [role=row]')].find(r => r.textContent.includes('wt-lost')).querySelector('.tag.state').title);
  assert.match(tip, /prunable/);
  assert.match(await s.ev(D => D.querySelector('.view-tab.active')?.textContent || ''), /Worktrees/);
  if (SHOTS) await shot('worktrees-list');
});

test('a longer period takes a worktree with an older session out of Stale', T, async () => {
  sessionIn(wt('wt-idle'), 'aaaaaaaa-0000-4000-8000-000000000003', 40 * 24 * 3600000, 'Old work in the idle worktree');
  await s.mouse('.main-body .preset', '90 days');
  await s.waitFor(D => {
    const row = [...D.querySelectorAll('.main-body [role=row]')].find(r => r.textContent.includes('wt-idle'));
    return row && !row.textContent.includes('Stale') && row.textContent.includes('1');
  });
  await s.mouse('.main-body .preset', '30 days');
  await s.waitFor(D => [...D.querySelectorAll('.main-body [role=row]')].find(r => r.textContent.includes('wt-idle'))?.textContent.includes('Stale'));
});

test('Remove asks on a card naming the path; Cancel keeps it, git refuses a worktree with changes', T, async () => {
  // A real pointer press: the card points at the element last pressed.
  const removeIn = name => s.mouse('.main-body .icon-btn', `Remove worktrees-box/${name}`);
  await removeIn('wt-idle');
  await s.waitFor(D => D.querySelector('.cf'));
  const card = await s.ev(D => D.querySelector('.cf').innerText);
  assert.ok(card.replace(/\\/g, '/').includes('wt-idle'), card);
  assert.match(card, /without --force/);
  if (SHOTS) await shot('worktrees-remove-card');
  await pressCard('Cancel');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.ok(fs.existsSync(wt('wt-idle')), 'Cancel removed nothing');
  // The host answers a cancelled card with the list again; wait for that redraw so the next press lands on the new button.
  await sleep(3000);

  await removeIn('wt-dirty');
  await s.waitFor(D => D.querySelector('.cf'));
  await pressCard('Remove');
  await s.waitFor(D => /Could not remove it/.test(D.querySelector('.worktrees-note')?.textContent || ''));
  assert.ok(fs.existsSync(wt('wt-dirty')), 'git refused: the dirty worktree stays');
  assert.ok(fs.existsSync(path.join(wt('wt-dirty'), 'edit.txt')));
});

test('Remove after the card deletes a clean worktree from the list and from disk', T, async () => {
  await s.mouse('.main-body .icon-btn', 'Remove worktrees-box/wt-idle');
  await s.waitFor(D => D.querySelector('.cf'));
  await pressCard('Remove');
  await s.waitFor(D => /Removed/.test(D.querySelector('.worktrees-note')?.textContent || ''));
  assert.equal(fs.existsSync(wt('wt-idle')), false);
  assert.ok(!(await rows()).some(r => r[0] === 'wt-idle'));
  assert.match(g(repo, 'worktree', 'list'), /wt-live/);
});

test('Prune asks on a card naming the folder, then drops the record of the missing one', T, async () => {
  await s.mouse('.main-body button', 'Prune');
  await s.waitFor(D => D.querySelector('.cf'));
  const card = await s.ev(D => D.querySelector('.cf').innerText);
  assert.ok(card.replace(/\\/g, '/').includes('wt-lost'), card);
  if (SHOTS) await shot('worktrees-prune-card');
  await pressCard('Prune');
  await s.waitFor(D => /Pruned 1 record/.test(D.querySelector('.worktrees-note')?.textContent || ''));
  assert.ok(!(await rows()).some(r => r[0] === 'wt-lost'));
  assert.ok(!/wt-lost/.test(g(repo, 'worktree', 'list')));
  assert.match(await note(), /Pruned/);
  if (SHOTS) await shot('worktrees-after');
});

// A screenshot of the repo page body only: no Explorer, no side bar and no nav tree column.
async function shot(name) {
  const clip = await s.ev(D => {
    const r = D.querySelector('.main-body').getBoundingClientRect();
    const f = D.defaultView.frameElement.getBoundingClientRect();
    return { x: r.left + f.left, y: r.top + f.top, width: r.width, height: Math.min(r.height, 420), scale: 1 };
  });
  // The panel sits in a webview iframe of the workbench page: add its offset.
  const outer = await s.pageEv(() => {
    const f = [...document.querySelectorAll('iframe.webview')].find(e => e.getClientRects().length);
    const b = f.getBoundingClientRect();
    return { x: b.left, y: b.top };
  });
  clip.x += outer.x;
  clip.y += outer.y;
  const r = await s.page.send('Page.captureScreenshot', { format: 'png', clip });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'));
}
