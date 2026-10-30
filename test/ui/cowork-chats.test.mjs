// UI tests of the Cowork Chats and Artifacts nodes, the chat page and Continue in terminal, run in a real, isolated VS Code (see harness.mjs).
// The desktop app's data is the synthetic test/fixtures/cowork-desktop (CLAUDE_HARNESS_LOCALAPPDATA); the Cowork sessions API is a server
// on this PC (CLAUDE_HARNESS_SESSIONS_URL, loopback only) that answers a synthetic body; nothing leaves the machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const PORT = Number(process.env.CHATS_API_PORT || 9644);
const requests = [];
const body = { data: [{ id: 'cse_fixture1', title: 'Fixture cloud session', status: 'idle', user_message_count: 7, updated_at: '2026-10-29T10:00:00Z' }, { id: 'cse_fixture2', title: 'Another cloud session', status: 'archived', user_message_count: 2, updated_at: '2026-10-20T10:00:00Z' }] };
const server = http.createServer((req, res) => {
  requests.push({ method: req.method, url: req.url, auth: req.headers.authorization });
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
});
process.env.CLAUDE_HARNESS_SESSIONS_URL = `http://127.0.0.1:${PORT}/v1/code/sessions`;

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const fixtures = path.join(here, '..', 'fixtures', 'cowork-desktop');
const SHOTS = process.env.CHATS_SHOTS || path.join(s.root, 'shots');

const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const typeInto = (sel, value) =>
  s.ev(
    (D, sel, value) => {
      const i = D.querySelector(sel);
      i.value = value;
      i.dispatchEvent(new Event('input', { bubbles: true }));
    },
    sel,
    value
  );

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
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const data = path.join(s.root, 'cowork-desktop-data');
  fs.rmSync(data, { recursive: true, force: true });
  fs.cpSync(fixtures, data, { recursive: true });
  process.env.CLAUDE_HARNESS_LOCALAPPDATA = data;
  // Continue in terminal starts `echo <prompt>` here, never a real Claude.
  s.settings({ 'claudeHarness.terminal.command': 'echo' });
  await s.start();
  fs.writeFileSync(path.join(s.fixture.claude, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-token', expiresAt: Date.now() + 3600_000 } }));
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.resize(1500);
});

after(async () => {
  await s.stop();
  server.close();
});

test('the Cowork region has Chats and Artifacts with their counts', T, async () => {
  await s.waitFor(D => [...D.querySelectorAll('.sidebar .cowork-region .row')].some(r => /^Artifacts\s*2$/.test(r.textContent.trim())));
  const rows = await labels('.sidebar .cowork-region .row');
  assert.ok(rows.some(r => /^Chats\s*\d+/.test(r)), rows.join(' | '));
  // The counts are the shared pill: same class, size and right edge as the Cowork head's, wide enough for their digits.
  const pills = await s.ev(D => {
    const box = e => {
      const r = e.getBoundingClientRect();
      const c = D.defaultView.getComputedStyle(e);
      return { right: Math.round(r.right), height: Math.round(r.height), width: r.width, text: e.scrollWidth <= Math.ceil(e.clientWidth), size: c.fontSize, radius: c.borderRadius, bg: c.backgroundColor };
    };
    const rows = [...D.querySelectorAll('.sidebar .cowork-region .row.cowork-link')];
    const find = name => rows.find(r => r.textContent.trim().startsWith(name)).querySelector(':scope > .count');
    return { head: box(D.querySelector('.sidebar .cowork-region .scope-head .count, .sidebar .cowork-region [data-region="cowork"] .count')), chats: box(find('Chats')), artifacts: box(find('Artifacts')) };
  });
  for (const k of ['chats', 'artifacts']) {
    assert.equal(pills[k].size, pills.head.size, `${k} font size`);
    assert.equal(pills[k].radius, pills.head.radius, `${k} radius`);
    assert.equal(pills[k].bg, pills.head.bg, `${k} colour`);
    assert.equal(pills[k].height, pills.head.height, `${k} height ${JSON.stringify(pills)}`);
    assert.ok(pills[k].text, `${k} digits fit inside the pill`);
    assert.ok(Math.abs(pills[k].right - pills.head.right) <= 2, `${k} right edge ${pills[k].right} vs ${pills.head.right}`);
  }
});

test('the Chats page lists the chats on this PC and the Cowork sessions of claude.ai, read with GET only, and a filter narrows both', T, async () => {
  await s.mouse('.sidebar .cowork-region .row', 'Chats');
  await s.waitFor(D => /Fixture cloud session/.test(D.querySelector('.main-body')?.innerText || ''));
  const page = await text();
  assert.match(page, /Fixture research chat/);
  assert.match(page, /2 out, 1 in/);
  assert.match(page, /Another cloud session/);
  assert.match(page, /not stored on this PC/);
  assert.ok(requests.length >= 1 && requests.every(r => r.method === 'GET' && r.auth === 'Bearer synthetic-token'));
  await shoot(path.join(SHOTS, '16-cowork-chats.png'), '.main');
  await typeInto('.main .cowork-filter input', 'another');
  await s.waitFor(D => !/Fixture research chat/.test(D.querySelector('.main-body').innerText));
  const narrowed = await text();
  assert.match(narrowed, /Another cloud session/);
  assert.doesNotMatch(narrowed, /Fixture cloud session/);
  assert.match(narrowed, /No chat matches/);
  await typeInto('.main .cowork-filter input', '');
  await s.waitFor(D => /Fixture research chat/.test(D.querySelector('.main-body').innerText));
});

test('the nav search finds a chat and an artifact by name', T, async () => {
  await typeInto('.sidebar input[type=search]', 'research');
  await s.waitFor(D => [...D.querySelectorAll('.sidebar .row.nested')].some(r => r.textContent.includes('Fixture research chat')));
  await typeInto('.sidebar input[type=search]', 'chart');
  await s.waitFor(D => [...D.querySelectorAll('.sidebar .row.nested')].some(r => r.textContent.includes('charts/chart.txt')));
  await typeInto('.sidebar input[type=search]', '');
});

test('a chat page shows the whole conversation and every file it produced or was given', T, async () => {
  await s.mouse('.main .asset-table .at-row', 'Fixture research chat');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.trim() === 'Fixture research chat');
  await s.waitFor(D => /Understood, the fixture brief/.test(D.querySelector('.main-body').innerText));
  const page = await text();
  assert.match(page, /Please research the fixture topic/);
  assert.match(page, /Use only the uploaded fixture brief/);
  assert.doesNotMatch(page, /tool_result/);
  for (const f of ['report.md', 'charts/chart.txt', 'fixture-brief.txt']) assert.ok(page.includes(f), f);
  assert.match(page, /Produced/);
  assert.match(page, /Given/);
  assert.deepEqual(await labels('.main .cmd-bar button'), ['Back', 'Continue in terminal', 'Draw with Claude']);
  await shoot(path.join(SHOTS, '17-cowork-chat.png'), '.main');
});

test('the Artifacts page lists the produced files with their chat and filters', T, async () => {
  await s.mouse('.sidebar .cowork-region .row', 'Artifacts');
  await s.waitFor(D => /report\.md/.test(D.querySelector('.main-body')?.innerText || ''));
  const page = await text();
  assert.match(page, /charts\/chart\.txt/);
  assert.match(page, /Fixture research chat/);
  assert.doesNotMatch(page, /fixture-brief/);
  await shoot(path.join(SHOTS, '18-cowork-artifacts.png'), '.main');
  await typeInto('.main .cowork-filter input', 'chart');
  await s.waitFor(D => !/report\.md/.test(D.querySelector('.main-body').innerText));
  await typeInto('.main .cowork-filter input', '');
  await s.waitFor(D => /report\.md/.test(D.querySelector('.main-body').innerText));
  // Back to the chat for the next step.
  await s.mouse('.sidebar .cowork-region .row', 'Chats');
  await s.mouse('.main .asset-table .at-row', 'Fixture research chat');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.trim() === 'Fixture research chat');
});

test('Continue in terminal on a chat page opens the Handover card with that chat on it', T, async () => {
  await s.mouse('.main .cmd-bar button', 'Continue in terminal');
  await s.waitFor(D => D.querySelector('.main-head')?.textContent.includes('Handover'));
  await s.waitFor(D => D.querySelector('.hv-source-title')?.textContent === 'Fixture research chat');
  const files = await labels('.hv-file-name');
  assert.deepEqual(files.sort(), ['outputs/charts/chart.txt', 'outputs/report.md', 'uploads/fixture-brief.txt']);
});

