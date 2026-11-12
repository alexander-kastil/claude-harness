// UI test of the sync-tools page (Memory of Global and of a repo), run in a real, isolated VS Code (see harness.mjs).
// Sync writes into the scratch home and scratch repos only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const SHOTS = process.env.SYNC_TOOLS_SHOTS;
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const rows = () => s.ev(D => [...D.querySelectorAll('.main .asset-table .at-row:not(.at-head)')].map(r => [...r.querySelectorAll('.at-label, .tag')].map(n => n.textContent.trim()).join(' | ')));
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const go = async (selector, label, check, ...args) => {
  for (let i = 0; i < 3; i++) {
    await s.mouse(selector, label);
    try {
      s.waitMs = 5000;
      await s.waitFor(check, ...args);
      s.waitMs = 20000;
      return;
    } catch (e) {
      s.waitMs = 20000;
      if (i === 2) throw e;
    }
  }
};

async function shoot(file) {
  const open = await s.pageEv(() => !!document.querySelector('.part.sidebar') && document.querySelector('.part.sidebar').getClientRects().length > 0);
  if (open) await s.chord('b', { ctrl: true });
  await s.move();
  await new Promise(r => setTimeout(r, 600));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await s.screenshot(file);
}

before(async () => {
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.resize(1280);
});

after(async () => {
  await s.stop();
});

test('Global Memory opens the sync page: CLAUDE.md to the tools global files, each with its state', T, async () => {
  fs.mkdirSync(path.join(s.fixture.home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(s.fixture.home, '.codex', 'AGENTS.md'), '# Something else\n');
  await go('.main .overview .tile', 'Memory', D => D.querySelector('.main-head h1')?.textContent === 'Memory');
  await go('.main-head [aria-label^="Sync instructions"]', '', D => D.querySelector('.main-head h1')?.textContent === 'Sync instructions');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 4);
  const r = await rows();
  assert.match(r[0], /~\/\.agents\/AGENTS\.md.*missing/);
  assert.match(r[1], /~\/\.codex\/AGENTS\.md.*differs/);
  assert.match(r[2], /~\/\.gemini\/GEMINI\.md.*missing/);
  assert.match(r[3], /~\/\.copilot\/copilot-instructions\.md.*missing/);
  assert.match(await text('.sync-tools-source'), /CLAUDE\.md/);
  assert.deepEqual(await labels('.main .cmd-bar button, .main-head .toolbar button'), ['', 'Sync']);
  if (SHOTS) await shoot(path.join(SHOTS, 'sync-tools-global.png'));
});

test('Sync asks first with a card that names every file, Cancel writes nothing, Sync writes and backs up', T, async () => {
  const gemini = path.join(s.fixture.home, '.gemini', 'GEMINI.md');
  await s.mouse('.main-head button', 'Sync');
  const card = await s.waitFor(D => D.querySelector('.cf')?.innerText);
  for (const f of ['.agents', '.codex', '.gemini', '.copilot']) assert.ok(card.includes(f), `${f} named`);
  assert.match(card, /Backup of the files overwritten/);
  if (SHOTS) await shoot(path.join(SHOTS, 'sync-tools-card.png'));
  await s.mouse('.cf button', 'Cancel');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.ok(!fs.existsSync(gemini), 'Cancel wrote nothing');
  await s.mouse('.main-head button', 'Sync');
  await s.waitFor(D => D.querySelector('.cf'));
  await s.mouse('.cf button', 'Sync');
  await s.waitFor(D => !D.querySelector('.cf'));
  for (let i = 0; i < 40 && !fs.existsSync(gemini); i++) await new Promise(r => setTimeout(r, 250));
  const src = fs.readFileSync(path.join(s.fixture.claude, 'CLAUDE.md'), 'utf8');
  assert.equal(fs.readFileSync(gemini, 'utf8'), src);
  assert.equal(fs.readFileSync(path.join(s.fixture.home, '.codex', 'AGENTS.md'), 'utf8'), src);
  const backups = path.join(s.fixture.claude, 'repo-sync-backups');
  const saved = fs.readdirSync(backups, { recursive: true }).filter(f => /AGENTS\.md$/.test(f));
  assert.equal(saved.length, 1, saved.join(','));
  await s.waitFor(D => [...D.querySelectorAll('.main .asset-table .tag')].filter(t => t.textContent.trim() === 'in sync').length === 4);
  assert.match(await text(), /Wrote 4 files/);
  assert.ok(await s.ev(D => D.querySelector('.main-head button.primary')?.disabled), 'Sync is off when nothing differs');
});

test('a repo Memory page syncs AGENTS.md, a Cursor rule and Copilot instructions', T, async () => {
  const dir = s.fixture.repoDirs['shop-api'];
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# old\n');
  await go('.main-head [aria-label^="Back"]', '', D => D.querySelector('.main-head h1')?.textContent === 'Memory');
  await s.chord('Escape');
  await go('.sidebar-head [aria-label="Overview"]', '', D => D.querySelector('.overview-tabs'));
  await go('.sidebar .repo-head', 'shop-api', D => !!D.querySelector('.main-head'));
  await go('.main .tile', 'Memory', D => D.querySelector('.main-head h1')?.textContent === 'Memory');
  await go('.main-head [aria-label^="Sync instructions"]', '', D => D.querySelector('.main-head h1')?.textContent === 'Sync instructions');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 3);
  const r = await rows();
  assert.match(r[0], /AGENTS\.md.*differs/);
  assert.match(r[1], /\.cursor\/rules\/claude\.mdc.*missing/);
  assert.match(r[2], /\.github\/copilot-instructions\.md.*missing/);
  // The AGENTS.md row says whether Claude Code loads it (it does not while a CLAUDE.md sits beside it).
  assert.match(r[0], /not loaded/);
  if (SHOTS) await shoot(path.join(SHOTS, 'sync-tools-repo.png'));
  // Untick Copilot: only two files are named.
  await s.ev(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)')[2].querySelector('input').click());
  await s.mouse('.main-head button', 'Sync');
  const card = await s.waitFor(D => D.querySelector('.cf')?.innerText);
  assert.ok(card.includes('claude.mdc') && !card.includes('copilot-instructions'), card);
  await s.mouse('.cf button', 'Sync');
  const rule = path.join(dir, '.cursor', 'rules', 'claude.mdc');
  for (let i = 0; i < 40 && !fs.existsSync(rule); i++) await new Promise(r => setTimeout(r, 250));
  assert.match(fs.readFileSync(rule, 'utf8'), /^---\n[\s\S]*alwaysApply: true\n---\n/);
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'));
  assert.ok(!fs.existsSync(path.join(dir, '.github', 'copilot-instructions.md')), 'the unticked file stays unwritten');
});

test('Compare opens the target and what the sync would write in the diff editor', T, async () => {
  await s.ev(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)')[2].querySelector('button[aria-label^="Compare"]').click());
  const tab = await s.pageEv(() => new Promise(res => { const t = Date.now(); const f = () => { const n = [...document.querySelectorAll('.tab .label-name, .tab')].find(e => /copilot-instructions\.md: now, after sync/.test(e.textContent)); n || Date.now() - t > 10000 ? res(!!n) : setTimeout(f, 250); }; f(); }));
  assert.ok(tab, 'a diff tab named after the file opened');
});
