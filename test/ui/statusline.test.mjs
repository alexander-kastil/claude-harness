// The Status line page in a real, isolated VS Code: pick fields, order them, watch the preview, Save and Remove after the confirm card.
// Scratch data only: the fixture home stands in for ~/.claude and the fixture repo for the project; nothing real is written.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session, sleep } from './harness.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const SHOTS = 'D:/claude-scratch/statusline/shots';
const PRIOR = { type: 'command', command: 'echo prior' };

// The fixture is built inside start(); the seed runs when start() writes the settings, after the fixture and before VS Code opens.
let seeded = false;
const settings = s.settings.bind(s);
s.settings = (...a) => {
  if (!seeded) {
    seeded = true;
    const file = path.join(s.root, 'home', '.claude', 'settings.json');
    const text = fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    // A line comment and a status line of the owner's own: both must survive and come back.
    fs.writeFileSync(file, `${text.slice(0, -1).trimEnd()},\n  // mine\n  "statusLine": ${JSON.stringify(PRIOR)}\n}\n`);
  }
  return settings(...a);
};

const userSettings = () => path.join(s.root, 'home', '.claude', 'settings.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const main = () => s.ev(D => D.querySelector('.main').innerText);
const preview = () => s.ev(D => D.querySelector('.statusline-preview').innerText.trim());
const names = () => s.ev(D => [...D.querySelectorAll('.statusline-name')].map(n => n.innerText.trim()));

before(async () => {
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  // The side bar closes: the Explorer never shows.
  await s.chord('b', { ctrl: true });
  await sleep(2500);
});
after(() => s.stop());

test('Status line is an item under Settings and opens its page with the line for a sample session', T, async () => {
  await s.mouse('.sidebar [data-nav="s|global|settings"]');
  await sleep(1200);
  if (!(await s.ev(D => !!D.querySelector('.sidebar [data-nav="s|statusline"]')))) await s.mouse('.sidebar [data-nav="s|global|settings"]');
  await s.mouse('.sidebar [data-nav="s|statusline"]');
  await s.waitFor(D => D.querySelector('.statusline-preview'));
  assert.match(await main(), /Status line/);
  assert.equal(await preview(), 'Opus | ctx 42% | main | my-repo');
  assert.deepEqual(await names(), ['Model', 'Context used', 'Git branch', 'Folder', '5-hour limit', 'Weekly limit', 'Session cost']);
});

test('a toggle adds its field to the preview, and Move up puts it where it is wanted', T, async () => {
  await s.click('.statusline-row [role=switch][aria-label="5-hour limit"]');
  assert.equal(await preview(), 'Opus | ctx 42% | main | my-repo | 5h 24%');
  // The page is drawn again after each move, so the row is found again each time.
  for (let i = 0; i < 2; i++) {
    await s.ev(D => [...D.querySelectorAll('.statusline-row')].find(r => r.innerText.includes('5-hour limit')).querySelector('[aria-label="Move up"]').click());
    await sleep(200);
  }
  assert.equal(await preview(), 'Opus | ctx 42% | 5h 24% | main | my-repo');
  await s.click('.statusline-row [role=switch][aria-label="Session cost"]');
  assert.equal(await preview(), 'Opus | ctx 42% | 5h 24% | main | my-repo | $1.23');
});

test('Save asks first, names both files, and writes the script and statusLine only after Save on the card', T, async () => {
  assert.deepEqual(read(userSettings()).statusLine, PRIOR);
  await s.mouse('.main-head button', 'Save');
  const card = await s.waitFor(D => {
    const t = D.querySelector('.cf')?.innerText;
    return /Save the status line/.test(t || '') && t;
  });
  assert.match(card, /harness-statusline\.cjs/);
  assert.match(card, /settings\.json/);
  assert.match(card, /echo prior/);
  await sleep(300);
  assert.deepEqual(read(userSettings()).statusLine, PRIOR, 'nothing is written before the answer');
  await s.mouse('.cf button', 'Cancel');
  await sleep(300);
  assert.deepEqual(read(userSettings()).statusLine, PRIOR, 'Cancel writes nothing');
  await s.mouse('.main-head button', 'Save');
  await s.waitFor(D => !!D.querySelector('.cf'));
  await s.mouse('.cf button.primary', 'Save');
  await s.waitFor(D => /Saved/.test(D.querySelector('.statusline-status')?.innerText || '') && 1);
  const value = read(userSettings()).statusLine;
  assert.equal(value.type, 'command');
  assert.match(value.command, /^node ".*harness-statusline\.cjs"$/);
  const raw = fs.readFileSync(userSettings(), 'utf8');
  assert.match(raw, /\/\/ mine/, 'the rest of the file stays');
  assert.ok(read(userSettings()).enabledPlugins, 'the other keys stay');
  const script = value.command.slice(6, -1);
  const sample = { model: { display_name: 'Opus' }, context_window: { used_percentage: 42 }, rate_limits: { five_hour: { used_percentage: 23.5 } }, cost: { total_cost_usd: 1.234 }, workspace: { current_dir: '/work/my-repo' }, worktree: { branch: 'main' } };
  const out = execFileSync('node', [script], { input: JSON.stringify(sample), encoding: 'utf8' });
  assert.equal(out, 'Opus | ctx 42% | 5h 24% | main | my-repo | $1.23');
  await s.move();
  await sleep(400);
  await s.screenshot(path.join(SHOTS, 'statusline-saved.png'));
});

test('Remove asks first and puts the earlier statusLine back, deleting the script', T, async () => {
  const script = read(userSettings()).statusLine.command.slice(6, -1);
  await s.mouse('.main-head button', 'Remove');
  const card = await s.waitFor(D => {
    const t = D.querySelector('.cf')?.innerText;
    return /Remove the status line/.test(t || '') && t;
  });
  assert.match(card, /before the first Save/);
  assert.ok(fs.existsSync(script), 'nothing is deleted before the answer');
  await s.mouse('.cf button.primary', 'Remove');
  await s.waitFor(D => /Removed/.test(D.querySelector('.statusline-status')?.innerText || '') && 1);
  assert.deepEqual(read(userSettings()).statusLine, PRIOR);
  assert.match(fs.readFileSync(userSettings(), 'utf8'), /\/\/ mine/);
  assert.ok(!fs.existsSync(script));
});

test('the Project scope writes the open folder\'s own settings, and Remove takes the key out again', T, async () => {
  await s.click('.main [role=tab]', 'Project');
  await s.waitFor(D => /No status line is set/.test(D.querySelector('.statusline-status')?.innerText || '') && 1);
  const file = path.join(s.root, 'repos', 'shop-api', '.claude', 'settings.json');
  await s.mouse('.main-head button', 'Save');
  await s.waitFor(D => !!D.querySelector('.cf'));
  assert.match(await s.ev(D => D.querySelector('.cf').innerText), /No status line is replaced/);
  await s.mouse('.cf button.primary', 'Save');
  await s.waitFor(D => /Saved/.test(D.querySelector('.statusline-status')?.innerText || '') && 1);
  assert.match(read(file).statusLine.command, /harness-statusline\.cjs/);
  assert.deepEqual(read(file).hooks.PostToolUse[0].matcher, 'Edit', 'the repo settings keep their hooks');
  await s.mouse('.main-head button', 'Remove');
  await s.waitFor(D => !!D.querySelector('.cf'));
  await s.mouse('.cf button.primary', 'Remove');
  await s.waitFor(D => /Removed/.test(D.querySelector('.statusline-status')?.innerText || '') && 1);
  assert.equal(read(file).statusLine, undefined);
  assert.ok(read(file).hooks);
});
