// UI tests of Pull to Code on a scheduled task page, run in a real, isolated VS Code (see harness.mjs). The
// triggers API is a server on this PC with a synthetic body (CLAUDE_HARNESS_TRIGGERS_URL, loopback only) and the desktop app's data
// is the synthetic test/fixtures/cowork-desktop. A pull writes into the scratch Global or repo and nowhere else.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const PORT = Number(process.env.PULL_API_PORT || 9632);
const SHOTS = process.env.PULL_SHOTS;
let prompt = 'Summarise the week.\nKeep it short.';
const requests = [];
const server = http.createServer((req, res) => {
  requests.push(req.method);
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      data: [
        {
          id: 'trig_active', name: 'Weekly digest', enabled: true, cron_expression: '0 5 * * 1', created_kind: 'cowork_task', derived_state: { prompt },
          job_config: { ccr: { tags: ['cowork-remote'] } }, mcp_connections: [{ name: 'Mail' }, { name: 'Calendar' }], enabled_plugins: ['plugin-a'],
        },
      ],
    })
  );
});
process.env.CLAUDE_HARNESS_TRIGGERS_URL = `http://127.0.0.1:${PORT}/v1/code/triggers`;

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const fixtures = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'fixtures', 'cowork-desktop');
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const options = sel => s.ev((D, sel) => [...D.querySelector(sel).options].map(o => o.textContent.trim()), sel);
const snapshot = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).sort().map(f => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`).join('|') : '');
/** Chooses an option of a select in the command bar by its text. */
const choose = (cls, label) => s.ev((D, cls, label) => {
  const sel = D.querySelector(`.main .cmd-bar select.${cls}`);
  sel.value = [...sel.options].find(o => o.textContent.includes(label)).value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}, cls, label);

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

before(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const data = path.join(s.root, 'cowork-desktop-data');
  fs.rmSync(data, { recursive: true, force: true });
  fs.cpSync(fixtures, data, { recursive: true });
  process.env.CLAUDE_HARNESS_LOCALAPPDATA = data;
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

test('a task page pulls its instructions into Global as a skill, and nothing else changes', T, async () => {
  await s.mouse('.sidebar .cowork-region .section-head', 'Scheduled');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 1);
  await s.mouse('.sidebar .row', 'Weekly digest');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.trim() === 'Weekly digest');
  assert.deepEqual(await labels('.main .cmd-bar button'), ['Back', 'Open on claude.ai', 'Pull to Code', 'Draw with Claude']);
  const picks = await options('.main .cmd-bar select.pull-target');
  assert.ok(picks[0].startsWith('Global'), picks.join(' | '));
  if (SHOTS) await shoot(path.join(SHOTS, '15-pull-task-to-code.png'), '.main');
  const target = path.join(s.fixture.claude, 'skills', 'weekly-digest', 'SKILL.md');
  await s.mouse('.main .cmd-bar button', 'Pull to Code');
  await s.waitFor(() => true);
  for (let i = 0; i < 40 && !fs.existsSync(target); i++) await new Promise(r => setTimeout(r, 250));
  const skill = fs.readFileSync(target, 'utf8');
  assert.match(skill, /^---\nname: weekly-digest\n/);
  assert.match(skill, /Keep it short\./);
  assert.match(skill, /- Connectors: Mail, Calendar/);
  assert.match(skill, /- Plugins: plugin-a/);
  const origins = JSON.parse(fs.readFileSync(path.join(s.fixture.claude, '.cowork-origins.json'), 'utf8'));
  assert.equal(origins['skills/weekly-digest'].kind, 'task');
  assert.ok(requests.every(m => m === 'GET'), requests.join(','));
});

test('a task that changed on claude.ai after the pull shows Differs from Cowork on the pulled skill', T, async () => {
  prompt = 'Summarise the month instead.';
  await s.mouse('.sidebar .cowork-region .section-head', 'Scheduled');
  await s.mouse('.main [aria-label="Reload"]', '');
  await new Promise(r => setTimeout(r, 1500));
  await s.ev(D => { const h = D.querySelector('[data-nav="s|global|skill"]'); if (h && h.getAttribute('aria-expanded') !== 'true') h.fold(); });
  await s.mouse('.sidebar .row', 'weekly-digest');
  await s.waitFor(D => /Differs from Cowork/.test(D.querySelector('.main')?.innerText || ''));
  assert.match(await text('.main'), /Weekly digest changed/);
});
