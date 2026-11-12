// UI test of the Routines page, run in a real, isolated VS Code (see harness.mjs). The triggers API is a server on this PC
// (CLAUDE_HARNESS_TRIGGERS_URL, loopback only) that answers a synthetic body and takes the partial POST; nothing leaves the machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const PORT = Number(process.env.ROUTINES_API_PORT || 9614);
const requests = [];
const routines = [
  {
    id: 'trig_code', name: 'Nightly triage', enabled: true, cron_expression: '0 3 * * *', created_kind: 'ROUTINE_CREATED_KIND_UNSPECIFIED',
    next_run_at: '2026-11-13T03:00:00Z', last_run: { fired_at: '2026-11-12T03:00:00Z', session_id: 'cse_1', status: 'ROUTINE_RUN_STATUS_SUCCEEDED' },
    derived_state: { prompt: 'Triage the open issues.' }, job_config: { ccr: { session_context: { sources: [{ type: 'git_repository', url: 'https://github.com/acme/widgets' }] } } },
  },
  { id: 'trig_cowork', name: 'Weekly digest', enabled: true, cron_expression: '0 5 * * 1', created_kind: 'cowork_task', derived_state: { prompt: 'Summarise.' }, job_config: { ccr: { tags: ['cowork-remote'] } } },
];
const server = http.createServer((req, res) => {
  let data = '';
  req.on('data', c => (data += c));
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: data });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      const r = routines.find(x => req.url.endsWith(`/${x.id}`));
      if (r) Object.assign(r, JSON.parse(data));
      res.end('{}');
      return;
    }
    res.end(JSON.stringify({ has_more: false, data: routines }));
  });
});
process.env.CLAUDE_HARNESS_TRIGGERS_URL = `http://127.0.0.1:${PORT}/v1/code/triggers`;

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const SHOTS = process.env.ROUTINES_SHOTS;
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => (e.textContent || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()), sel);
const tasksFile = () => path.join(s.fixture.repoDirs['shop-api'], '.claude', 'scheduled_tasks.json');
const type = (selector, value) =>
  s.ev((D, selector, value) => {
    const n = D.querySelector(selector);
    n.value = value;
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector, value);
const rows = () => labels('.main .asset-table .at-row:not(.at-head)');

before(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  await s.start();
  fs.mkdirSync(path.dirname(tasksFile()), { recursive: true });
  fs.writeFileSync(tasksFile(), JSON.stringify({ tasks: [{ id: 'loc1', cron: '*/5 * * * *', prompt: 'Check the build\nand tell me.', createdAt: 1794503208871, recurring: true, lastFiredAt: 1794503508871 }, { id: 'loc2', cron: '0 9 * * 1', prompt: 'Weekly dependency review', createdAt: 1794503208871, recurring: true, permanent: true }] }, null, 2));
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
});

after(async () => {
  await s.stop();
  server.close();
});

test('without a sign-in the page lists the repo tasks and says what is missing in one muted line', T, async () => {
  await s.resize(1500);
  await s.mouse('.sidebar [aria-label="Routines"]', '');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 2);
  assert.match(await text('.routines-note'), /Sign in to Claude Code/);
  assert.equal(await s.ev(D => D.querySelectorAll('.main .notice, .main .notice button').length), 0);
  const list = await rows();
  assert.match(list[0], /Check the build.*Every 5 minutes.*shop-api.*Repo.*Recurring/);
  assert.match(list[1], /Weekly dependency review.*Every Monday at/);
  assert.equal(requests.length, 0);
  // A durable task has no off switch, so no slide toggle on its row.
  assert.equal(await s.ev(D => D.querySelectorAll('.main .asset-table input[role="switch"]').length), 0);
});

test('with a sign-in the Code routines join the list, Cowork ones stay out, and the cloud is only read', T, async () => {
  fs.writeFileSync(path.join(s.fixture.claude, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-token', expiresAt: Date.now() + 3600_000 } }));
  await s.mouse('.main-head [aria-label="Reload"]', '');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 3);
  const list = await rows();
  assert.ok(list.some(r => /Nightly triage.*widgets|Nightly triage.*acme\/widgets/.test(r)), list.join(' | '));
  assert.ok(!list.some(r => /Weekly digest/.test(r)));
  assert.match(list.find(r => /Nightly triage/.test(r)), /Every day at.*acme\/widgets.*Succeeded.*Cloud.*Active/i);
  assert.equal(await s.ev(D => D.querySelectorAll('.routines-note').length), 0);
  assert.ok(requests.length >= 1 && requests.every(r => r.method === 'GET' && r.auth === 'Bearer synthetic-token'));
  const chips = await labels('.main .view-tab');
  assert.deepEqual(chips.map(c => c.replace(/\d+$/, '').trim()), ['All', 'Cloud', 'Repos']);
  await s.mouse('.main .view-tab', 'Cloud');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 1);
  await s.mouse('.main .view-tab', 'All');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 3);
  if (SHOTS) await shoot(path.join(SHOTS, 'routines-list.png'), '.main');
});

test('switching a cloud routine off asks first: Cancel changes nothing, Disable sends one partial POST', T, async () => {
  const sw = 'input[aria-label="Nightly triage enabled"]';
  await s.mouse(sw, '');
  await s.waitFor(D => !!D.querySelector('.cf'));
  assert.match(await text('.cf'), /Disable Nightly triage\?/);
  assert.match(await text('.cf'), /claude\.ai/);
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
  assert.equal(await s.ev((D, sw) => D.querySelector(sw).checked, sw), true);
  await s.mouse('.cf button', 'Cancel');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
  await s.mouse(sw, '');
  await s.waitFor(D => !!D.querySelector('.cf'));
  await s.mouse('.cf .primary', '');
  await s.waitFor(D => !D.querySelector('.cf') && D.querySelector('input[aria-label="Nightly triage enabled"]')?.checked === false);
  const posts = requests.filter(r => r.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/v1\/code\/triggers\/trig_code$/);
  assert.equal(posts[0].body, '{"enabled":false}');
  assert.equal(posts[0].auth, 'Bearer synthetic-token');
  assert.match((await rows()).find(r => /Nightly triage/.test(r)), /Paused/);
});

test('editing a repo task rewrites its prompt and schedule in the file after the card', T, async () => {
  await s.mouse('.main .at-row', 'Check the build');
  await s.waitFor(D => !!D.querySelector('.routines-detail .routines-prompt'));
  assert.equal(await s.ev(D => D.querySelector('.routines-detail button[aria-label="Save"]').disabled), true);
  await type('.routines-detail .routines-prompt', 'Check the build and the lint run.');
  await type('.routines-detail .routines-input', '*/10 * * * *');
  await s.waitFor(D => !D.querySelector('.routines-detail button[aria-label="Save"]').disabled);
  if (SHOTS) await shoot(path.join(SHOTS, 'routines-edit.png'), '.main');
  const before = fs.readFileSync(tasksFile(), 'utf8');
  await s.mouse('.routines-detail button[aria-label="Save"]', '');
  await s.waitFor(D => !!D.querySelector('.cf'));
  assert.match(await text('.cf'), /the schedule and the prompt|the prompt and the schedule|the schedule/);
  assert.equal(fs.readFileSync(tasksFile(), 'utf8'), before);
  await s.mouse('.cf .primary', '');
  await s.waitFor(D => /Saved\./.test(D.querySelector('.routines-note')?.innerText || ''));
  const doc = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
  assert.equal(doc.tasks[0].prompt, 'Check the build and the lint run.');
  assert.equal(doc.tasks[0].cron, '*/10 * * * *');
  assert.equal(doc.tasks[0].createdAt, 1794503208871);
  assert.equal(doc.tasks[1].prompt, 'Weekly dependency review');
  await s.waitFor(D => [...D.querySelectorAll('.main .at-row')].some(r => /Every 10 minutes/.test(r.textContent)));
});

/** A screenshot of one region of the window, the VS Code side bar closed. */
async function shoot(file, selector) {
  const open = await s.pageEv(() => !!document.querySelector('.part.sidebar') && document.querySelector('.part.sidebar').getClientRects().length > 0);
  if (open) await s.chord('b', { ctrl: true });
  await s.move();
  await s.ev(D => D.querySelectorAll('.tl-hover').forEach(n => n.remove()));
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
