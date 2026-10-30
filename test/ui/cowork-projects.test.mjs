// UI tests of the Cowork Projects node and a project's page, run in a real, isolated VS Code (see harness.mjs). The desktop app's
// data is the synthetic test/fixtures/cowork-desktop, copied into the scratch root and named by CLAUDE_HARNESS_LOCALAPPDATA.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const fixtures = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'fixtures', 'cowork-desktop');
const SHOTS = process.env.COWORK_SHOTS || path.join(s.root, 'shots');

const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const tab = async name => {
  await s.mouse('.main .view-tab', name);
  await s.waitFor((D, name) => D.querySelector('.main .view-tab.active')?.textContent.trim().startsWith(name), name);
};

/** A screenshot of one region of the window, the VS Code side bar closed. */
async function shoot(file, selector) {
  const open = await s.pageEv(() => !!document.querySelector('.part.sidebar') && document.querySelector('.part.sidebar').getClientRects().length > 0);
  if (open) await s.chord('b', { ctrl: true });
  await new Promise(r => setTimeout(r, 600));
  const box = await s.ev((D, selector) => {
    const r = D.querySelector(selector).getBoundingClientRect();
    const f = D.defaultView.frameElement.getBoundingClientRect();
    return { x: r.left + f.left, y: r.top + f.top, width: r.width, height: r.height };
  }, selector);
  const outer = await s.pageEv(() => {
    const f = [...document.querySelectorAll('iframe.webview')].find(e => e.getClientRects().length).getBoundingClientRect();
    return { x: f.left, y: f.top };
  });
  const shot = await s.page.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x + outer.x, y: box.y + outer.y, width: box.width, height: box.height, scale: 1 } });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
}

before(async () => {
  const data = path.join(s.root, 'cowork-desktop-data');
  fs.rmSync(data, { recursive: true, force: true });
  fs.cpSync(fixtures, data, { recursive: true });
  process.env.CLAUDE_HARNESS_LOCALAPPDATA = data;
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
});

after(async () => {
  await s.stop();
});

test('the Projects node lists the spaces linked to a project, with sessions and last activity', T, async () => {
  await s.waitFor(D => [...D.querySelectorAll('.sidebar .cowork-region .row')].some(r => r.textContent.includes('Fixture Alpha')));
  const rows = await labels('.sidebar .cowork-region .row');
  assert.ok(rows.some(r => r.startsWith('Projects')), rows.join(' | '));
  assert.ok(rows.some(r => /^Fixture Alpha\s*2 sessions/.test(r)), rows.join(' | '));
  assert.ok(rows.some(r => /^Fixture Beta\s*0 sessions/.test(r)), rows.join(' | '));
  assert.ok(!rows.some(r => r.includes('Fixture Gamma')), 'a space without a project link is not listed');
  await s.ev(D => D.querySelector('.sidebar .list').scrollTo(0, D.querySelector('.sidebar .cowork-region').offsetTop - 120));
  await shoot(path.join(SHOTS, '10-cowork-projects.png'), '.sidebar');
});

test('a project page has the Cowork badge, the three commands, the Details grid and no AI group', T, async () => {
  await s.mouse('.sidebar .row', 'Fixture Alpha');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('Fixture Alpha'));
  assert.equal(await s.ev(D => D.querySelector('.main-head .dh-source')?.textContent.trim()), 'Cowork');
  const bar = await labels('.main .cmd-bar button');
  for (const b of ['Open project', 'Open folder', 'Scheduled']) assert.ok(bar.includes(b), `${b} in ${bar.join(' | ')}`);
  assert.equal(await s.ev(D => D.querySelectorAll('.main .cmd-bar .ai-group').length), 0);
  const order = await s.ev(D => [...D.querySelectorAll('.main .cmd-bar button')].map(b => b.textContent.trim()));
  assert.deepEqual(order.slice(-3), ['Open project', 'Open folder', 'Scheduled']);
  const facts = await s.ev(D => [...D.querySelectorAll('.main .dv-hero .dv-fact')].map(f => f.querySelector('.k').textContent.trim() + '=' + f.querySelector('.v').textContent.trim()));
  assert.ok(facts.some(f => /^Folder=.*alpha$/.test(f)), facts.join(' | '));
  assert.ok(facts.includes('Project link=claude.ai/project/11111111-2222-4333-8444-555555555555'), facts.join(' | '));
  assert.ok(facts.includes('Sessions on this PC=2'), facts.join(' | '));
  assert.ok(facts.some(f => f.startsWith('Last activity=')), facts.join(' | '));
});

test('the Contents tabs show what it used, its sessions, memory, instructions and grounding', T, async () => {
  const tabs = await labels('.main .view-tab');
  for (const t of ['Used', 'Sessions', 'Memory', 'Instructions', 'Grounding']) assert.ok(tabs.some(x => x.startsWith(t)), `${t} in ${tabs.join(' | ')}`);
  let page = await text();
  assert.match(page, /fixture-skill\s*2/);
  assert.match(page, /Fixture Connector/);
  assert.match(page, /Skill\s*3/);
  await tab('Sessions');
  assert.match(await text(), /Fixture session one/);
  assert.match(await text(), /Fixture session two \(archived\)/);
  await tab('Memory');
  assert.match(await text(), /fixture-preference/);
  assert.match(await text(), /Synthetic memory entry for the tests/);
  await tab('Instructions');
  assert.match(await text(), /Fixture instructions/);
  await tab('Grounding');
  page = await text();
  assert.match(page, /docs/);
  assert.match(page, /brief\.txt/);
  assert.doesNotMatch(page, /\.hidden/);
  await tab('Used');
  await shoot(path.join(SHOTS, '11-cowork-project-page.png'), '.main');
});

test('a skill the project used opens its page in the Cowork region when Claude.ai synced one of that name', T, async () => {
  const ORG = 'org-1111_user-2222';
  const write = (rel, body) => {
    const file = path.join(s.fixture.claude, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  write(`skills/synced/${ORG}/manifest.json`, JSON.stringify({ skills: [{ skillId: 'fixture-skill', name: 'fixture-skill', creatorType: 'anthropic', source: 'anthropic-example' }] }));
  write(`skills/synced/${ORG}/fixture-skill/SKILL.md`, '---\nname: fixture-skill\ndescription: A synthetic synced skill.\n---\n\n# fixture-skill\n');
  await s.waitFor(D => /Cowork\s*1$/i.test(D.querySelector('.sidebar .cowork-region > .scope-head')?.innerText.trim() || ''));
  await s.mouse('.sidebar .row', 'Fixture Alpha');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('Fixture Alpha'));
  await tab('Used');
  await s.waitFor(D => D.querySelector('.main .at-row:not(.static):not(.at-head)'));
  const linked = await labels('.main .at-row:not(.static):not(.at-head)');
  assert.deepEqual(linked.map(r => r.replace(/\s+/g, '')), ['fixture-skill2'], 'only the skill with a Cowork item is a link');
  await s.mouse('.main .at-row:not(.static)', 'fixture-skill');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('fixture-skill'));
  fs.rmSync(path.join(s.fixture.claude, 'skills', 'synced'), { recursive: true, force: true });
});

test('a project with nothing on this PC says where each tab lives and links to the project page', T, async () => {
  await s.mouse('.sidebar .row', 'Fixture Beta');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('Fixture Beta'));
  await tab('Memory');
  assert.match(await text(), /Memory is kept in the project on claude\.ai/);
  assert.equal(await s.ev(D => !!D.querySelector('.main .cowork-missing button')), true);
  await tab('Instructions');
  assert.match(await text(), /Instructions are set in the project on claude\.ai/);
  await tab('Grounding');
  assert.match(await text(), /Context files are kept in the project on claude\.ai/);
});
