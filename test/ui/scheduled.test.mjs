// UI tests of the Cowork Scheduled node and task pages, run in a real, isolated VS Code (see harness.mjs). The triggers API is a
// server on this PC (CLAUDE_HARNESS_TRIGGERS_URL, loopback only) that answers a synthetic body; nothing leaves the machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const PORT = Number(process.env.SCHED_API_PORT || 9613);
const requests = [];
const mcp = n => Array.from({ length: n }, (_, i) => ({ connector_uuid: `uuid-${i}`, name: i === 0 ? 'Mail' : `Connector ${i}`, transport_type: 'http', url: `https://example.test/${i}` }));
const body = {
  has_more: false,
  data: [
    {
      id: 'trig_active', name: 'Weekly digest', enabled: true, cron_expression: '0 5 * * 1', chat_project_id: 'proj-1', created_kind: 'cowork_task', created_via: 'meta_mcp',
      suspension_reason: '', ended_reason: '', next_run_at: '2026-11-02T05:00:00Z', last_fired_at: '2026-10-26T05:00:00Z',
      last_run: { fired_at: '2026-10-26T05:00:00Z', session_id: 'cse_run1', status: 'ROUTINE_RUN_STATUS_ABANDONED', failure_reason: 'ROUTINE_RUN_FAILURE_REASON_UNSPECIFIED' },
      derived_state: { prompt: 'Summarise the week.\nKeep it short.' }, job_config: { ccr: { tags: ['cowork-remote'], session_context: { allowed_tools: ['a', 'b'] } } },
      mcp_connections: mcp(3), enabled_plugins: ['plugin-a'], extra_marketplaces: [],
    },
    {
      id: 'trig_wait', name: 'Daily sweep', enabled: true, bound_device: { display_name: 'Test PC', id: 'device-1' }, cron_expression: '0 0 * * *', chat_project_id: '', created_kind: 'ROUTINE_CREATED_KIND_UNSPECIFIED', created_via: 'meta_mcp',
      suspension_reason: 'device_absent', ended_reason: '', next_run_at: '2026-11-01T00:00:00Z',
      last_run: { fired_at: '2026-10-31T00:00:00Z', session_id: 'cse_run2', status: 'ROUTINE_RUN_STATUS_SUCCEEDED' },
      derived_state: { prompt: 'Sweep.' }, job_config: { ccr: { tags: ['cowork-remote'] } }, mcp_connections: mcp(1),
    },
    {
      id: 'trig_off', name: 'Nightly check', enabled: false, cron_expression: '0 7 * * *', chat_project_id: '', created_kind: 'ROUTINE_CREATED_KIND_UNSPECIFIED', created_via: 'http_api',
      suspension_reason: '', ended_reason: 'auto_disabled_repo_access', derived_state: { prompt: 'Check.' }, job_config: { ccr: {} }, mcp_connections: [],
    },
  ],
};
const server = http.createServer((req, res) => {
  requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, beta: req.headers['anthropic-beta'] });
  res.setHeader('content-type', 'application/json');
  if (req.url.startsWith('/v1/code/sessions')) {
    const url = new URL(req.url, 'http://x');
    const second = url.searchParams.get('cursor') === 'c1';
    const n = url.searchParams.get('trigger_id') === 'trig_active' ? (second ? 5 : 20) : 0;
    const from = second ? 20 : 0;
    const data = Array.from({ length: n }, (_, i) => ({
      id: `cse_${from + i}`, created_at: new Date(Date.UTC(2026, 9, 30, 8, 5) - (from + i) * 86400_000).toISOString(), status: 'active', status_bucket: 'review_ready', unread: (from + i) % 3 !== 0,
      title: `Run ${from + i}`, config: { permission_mode: 'auto' }, trigger_id: 'trig_active',
    }));
    res.end(JSON.stringify(second || n === 0 ? { data } : { data, next_cursor: 'c1' }));
    return;
  }
  res.end(JSON.stringify(body));
});
process.env.CLAUDE_HARNESS_TRIGGERS_URL = `http://127.0.0.1:${PORT}/v1/code/triggers`;

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const SHOTS = process.env.SCHED_SHOTS;
const credentials = (expiresAt) => fs.writeFileSync(path.join(s.fixture.claude, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-token', expiresAt } }));
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => (e.textContent || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()), sel);
const nav = () => s.ev(D => D.querySelector('.sidebar .list')?.innerText || '');

before(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
});

after(async () => {
  await s.stop();
  server.close();
});

test('without a Claude Code login the Scheduled node shows one line why and the two links, and asks nobody', T, async () => {
  await s.waitFor(D => D.querySelector('.sidebar .cowork-region'));
  await s.waitFor(D => /Sign in to Claude Code/.test(D.querySelector('.sidebar .list')?.innerText || ''));
  assert.match(await nav(), /Scheduled/i);
  const buttons = await s.ev(D => [...D.querySelectorAll('.sidebar .cowork-region .section-head [aria-label]')].map(b => b.getAttribute('aria-label')));
  assert.ok(buttons.includes('Open on claude.ai') && buttons.includes('Templates on claude.ai'), buttons.join(' | '));
  assert.equal(requests.length, 0);
});

test('with a login the node lists the tasks and the list page shows name, status, repeats, next run, project and source', T, async () => {
  await s.resize(1500);
  credentials(Date.now() + 3600_000);
  await s.mouse('.sidebar .cowork-region .section-head', 'Scheduled');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 3);
  const list = await nav();
  for (const name of ['Weekly digest', 'Daily sweep', 'Nightly check']) assert.ok(list.includes(name), name);
  const head = await labels('.main .asset-table .at-head > span');
  assert.deepEqual(head.slice(0, 6), ['Name', 'Status', 'Repeats', 'Next run', 'Project', 'Source']);
  const rows = await labels('.main .asset-table .at-row:not(.at-head)');
  assert.match(rows[0], /Weekly digest.*Active.*Every Monday at \d\d:\d\d.*Project.*Cowork/);
  assert.match(rows[1], /Daily sweep.*Waiting for Claude Desktop.*Every day at/);
  assert.match(rows[2], /Nightly check.*Auto-disabled, lost access to its repository.*Code/);
  // Read only: one GET per ask, the bearer token and the beta header, never another method.
  assert.ok(requests.length >= 1);
  assert.ok(requests.every(r => r.method === 'GET' && r.auth === 'Bearer synthetic-token' && r.beta === 'ccr-triggers-2026-01-30'));
  assert.ok(!(await text('.sidebar .list')).includes('not on disk') || !/scheduled tasks live/.test(await nav()));
  if (SHOTS) {
    await shoot(path.join(SHOTS, '14-cowork-scheduled-list.png'), '.main');
    await s.ev(D => D.querySelector('[data-nav="s|cowork-scheduled"]').scrollIntoView({ block: 'start' }));
    await shoot(path.join(SHOTS, '12-cowork-scheduled.png'), '.sidebar');
  }
});

test('a task page: Cowork badge, header commands without an AI group, details, instructions and what the task uses', T, async () => {
  await s.mouse('.sidebar .row', 'Weekly digest');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.trim() === 'Weekly digest');
  assert.match(await text('.main-head'), /Cowork/);
  const bar = await labels('.main .cmd-bar button');
  assert.deepEqual(bar, ['Back', 'Open on claude.ai', 'Open project', 'Open last run', 'Pull to Code', 'Draw with Claude']);
  assert.equal(await s.ev(D => D.querySelectorAll('.main .cmd-bar > .ai-group').length), 1);
  const facts = await s.ev(D => [...D.querySelectorAll('.main .dv-fact')].map(f => f.querySelector('.k').textContent.trim() + '=' + f.querySelector('.v').textContent.trim()));
  const byKey = Object.fromEntries(facts.map(f => f.split(/=(.*)/s).slice(0, 2)));
  assert.deepEqual(Object.keys(byKey), ['Repeats', 'Next run', 'Last run', 'Runs on', 'Project', 'Connectors', 'Permissions']);
  assert.match(byKey.Repeats, /Every Monday at/);
  assert.match(byKey['Last run'], /abandoned/);
  assert.equal(byKey['Runs on'], 'Cloud');
  assert.equal(byKey.Connectors, '3');
  // The permission mode is the newest run's, so it appears when the runs are read.
  await s.waitFor(D => [...D.querySelectorAll('.main .dv-fact')].some(f => /Permissions/.test(f.textContent) && /Auto, runs without asking/.test(f.textContent)));
  assert.match(await text(), /Summarise the week\.\nKeep it short\./);
  if (SHOTS) await shoot(path.join(SHOTS, '13-cowork-task-page.png'), '.main');
  await s.mouse('.main .view-tab', 'Uses');
  const uses = await text();
  assert.match(uses, /Mail/);
  assert.match(uses, /plugin-a/);
  // Runs: every page of the API, newest first, the dot on the unread ones, a row opens the run on claude.ai.
  await s.mouse('.main .view-tab', 'Runs');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 25);
  assert.match(await s.ev(D => D.querySelector('.main .view-tab.active')?.textContent || ''), /Runs\s*25/);
  assert.deepEqual(await labels('.main .asset-table .at-head > span'), ['Started', 'State', 'Permissions']);
  const first = await s.ev(D => D.querySelector('.main .asset-table .at-row:not(.at-head)').innerText.replace(/\s+/g, ' '));
  assert.match(first, /Oct 30.*Review ready.*Auto, runs without asking/);
  assert.equal(await s.ev(D => D.querySelectorAll('.main .sched-dot.on').length), 16);
  assert.ok(requests.filter(r => r.url.startsWith('/v1/code/sessions')).every(r => r.method === 'GET' && r.url.includes('trigger_id=trig_active')));
  assert.ok(requests.some(r => r.url.includes('cursor=c1')));
  if (SHOTS) await shoot(path.join(SHOTS, '30-scheduled-runs.png'), '.main');
  // A task bound to a computer says so, as claude.ai does.
  await s.mouse('.sidebar .row', 'Daily sweep');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.trim() === 'Daily sweep');
  assert.match(await s.ev(D => [...D.querySelectorAll('.main .dv-fact')].find(f => /Runs on/.test(f.textContent))?.textContent || ''), /Requires Claude Desktop \(Test PC\)/);
  // A task without a project or a run offers neither command.
  await s.mouse('.sidebar .row', 'Nightly check');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.trim() === 'Nightly check');
  assert.deepEqual(await labels('.main .cmd-bar button'), ['Back', 'Open on claude.ai', 'Pull to Code', 'Draw with Claude']);
});

test('an expired sign-in is reported and not refreshed', T, async () => {
  credentials(1000);
  const before = fs.readFileSync(path.join(s.fixture.claude, '.credentials.json'), 'utf8');
  const n = requests.length;
  await s.mouse('.main-head [aria-label="Back to Scheduled"], .main-head [aria-label="Back"]', '');
  await s.waitFor(D => /has expired/.test(D.querySelector('.main')?.innerText || ''));
  assert.equal(requests.length, n);
  assert.equal(fs.readFileSync(path.join(s.fixture.claude, '.credentials.json'), 'utf8'), before);
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
