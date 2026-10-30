// UI tests of Draw with Claude on the Cowork pages (skill, plugin, connector, scheduled task, project, chat), run in a real, isolated VS Code
// (see harness.mjs). Claude is never started: the drawing is stored the way Draw with Claude stores it, keyed by the text the host draws from.
// The desktop app's data is the synthetic test/fixtures/cowork-desktop, the triggers API a loopback server with a synthetic body, and `claude`
// a stub on PATH that lists one connector; nothing leaves the machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { repoRoot } from './fixture.mjs';
import { Session } from './harness.mjs';

const PORT = Number(process.env.DRAW_API_PORT || 9680);
const body = {
  has_more: false,
  data: [
    {
      id: 'trig_active', name: 'Weekly digest', enabled: true, cron_expression: '0 5 * * 1', chat_project_id: 'proj-1', created_kind: 'cowork_task', created_via: 'meta_mcp',
      suspension_reason: '', ended_reason: '', next_run_at: '2026-11-02T05:00:00Z',
      derived_state: { prompt: 'Summarise the week.\nKeep it short.' }, job_config: { ccr: { tags: ['cowork-remote'], session_context: { allowed_tools: ['a'] } } },
      mcp_connections: [{ connector_uuid: 'uuid-0', name: 'Mail', transport_type: 'http', url: 'https://example.test/0' }], enabled_plugins: ['plugin-a'], extra_marketplaces: [],
    },
  ],
};
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
});
process.env.CLAUDE_HARNESS_TRIGGERS_URL = `http://127.0.0.1:${PORT}/v1/code/triggers`;

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const fixtures = path.join(here, '..', 'fixtures', 'cowork-desktop');
const SHOTS = process.env.DRAW_SHOTS || path.join(s.root, 'shots');
const ORG = 'org-1111_user-2222';
const req = createRequire(import.meta.url);
const out = f => req(path.join(repoRoot, 'out', 'src', f));
const claude = () => s.fixture.claude;
const drawings = () => path.join(s.ud, 'User', 'globalStorage', 'integrations-at.claude-harness', 'drawings');

const SVG = name => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 240"><rect x="20" y="20" width="240" height="60" fill="none" stroke="currentColor"/><text x="36" y="56" fill="currentColor">${name}</text></svg>`;
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const card = () => s.ev(D => { const c = D.querySelector('.cf'); return c ? { text: c.innerText } : null; });
const closeCard = async () => {
  await s.chord('Escape');
  await s.waitFor(D => !D.querySelector('.cf'));
};
const write = (rel, text) => {
  const file = path.join(claude(), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** Stores a drawing under the id (and its process id) for the text the host draws from. */
function store(id, text, name) {
  const { contentHash, writeDrawing } = out('drawing.js');
  writeDrawing(drawings(), id, contentHash(text), SVG(name));
  writeDrawing(drawings(), `${id}#process`, contentHash(text), SVG(`${name} process`));
}

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

/** The page's AI group: at the right end of the bar, one Claude mark, the draw button. */
const aiGroup = () =>
  s.ev(D => {
    const bar = D.querySelector('.main .cmd-bar');
    const g = bar?.querySelector(':scope > .ai-group');
    if (!g) return null;
    const b = bar.getBoundingClientRect();
    const r = g.getBoundingClientRect();
    return { buttons: [...g.querySelectorAll('button')].map(x => x.textContent.trim()), marks: g.querySelectorAll('.ai-mark').length, last: g === bar.lastElementChild, right: Math.round(b.right - r.right) };
  });

/** The drawing above the details, with both perspectives, once the stored one is read. */
const figure = () =>
  s.waitFor(D => {
    const f = D.querySelector('.main .dv > figure.dv-draw');
    return f && { first: f === f.parentElement.firstElementChild, text: f.querySelector('svg')?.textContent, modes: [...f.querySelectorAll('.dv-persp button')].map(b => b.textContent.trim()) };
  });

before(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const data = path.join(s.root, 'cowork-desktop-data');
  fs.rmSync(data, { recursive: true, force: true });
  fs.cpSync(fixtures, data, { recursive: true });
  process.env.CLAUDE_HARNESS_LOCALAPPDATA = data;
  // `claude mcp list` lists one claude.ai connector, the way the CLI prints it.
  const stub = path.join(s.root, 'claude-stub');
  fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(path.join(stub, 'claude.cmd'), '@echo off\r\necho claude.ai Mail: https://example.test/0 (HTTP) - v Connected\r\n');
  process.env.PATH = `${stub}${path.delimiter}${process.env.PATH}`;
  s.settings({ 'claudeHarness.terminal.command': 'echo' });
  await s.start();
  fs.writeFileSync(path.join(claude(), '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-token', expiresAt: Date.now() + 3600_000 } }));
  write(`plugins/synced/${ORG}/manifest.json`, JSON.stringify({ plugins: [{ pluginId: 'plugin_1', name: 'design', version: '0040', marketplaceName: 'knowledge-work-plugins', marketplaceKind: 'anthropic_catalog' }] }));
  write(`plugins/synced/${ORG}/design.meta.json`, JSON.stringify({ server_plugin_id: 'plugin_1', marketplace_name: 'knowledge-work-plugins', marketplace_kind: 'anthropic_catalog' }));
  write(`plugins/synced/${ORG}/design/.claude-plugin/plugin.json`, JSON.stringify({ name: 'design', version: '1.2.0', description: 'Design workflows.' }));
  write(`skills/synced/${ORG}/manifest.json`, JSON.stringify({ skills: [{ skillId: 'docs', name: 'docs', creatorType: 'anthropic', source: 'anthropic-example' }] }));
  write(`skills/synced/${ORG}/docs/SKILL.md`, '---\nname: docs\ndescription: Editable docs people share.\n---\n\n# docs\n\nSend the doc with Mail when it is done.\n');
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.resize(1500);
});

after(async () => {
  fs.rmSync(path.join(claude(), 'skills', 'synced'), { recursive: true, force: true });
  fs.rmSync(path.join(claude(), 'plugins', 'synced'), { recursive: true, force: true });
  await s.stop();
  server.close();
});

test('a scheduled task has Draw with Claude at the right end of its bar, asks first, and a stored drawing shows above the details', T, async () => {
  await s.waitFor(D => [...D.querySelectorAll('.sidebar .cowork-region .row')].some(r => r.textContent.includes('Weekly digest')));
  await s.mouse('.sidebar .row', 'Weekly digest');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.trim() === 'Weekly digest');
  const g = await aiGroup();
  assert.deepEqual(g.buttons, ['Draw with Claude']);
  assert.equal(g.marks, 1);
  assert.ok(g.last, 'the AI group ends the bar');
  await s.mouse('.main .cmd-bar button', 'Draw with Claude');
  const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(c.text, /Draw Weekly digest with Claude/);
  assert.match(c.text, /schedule/);
  assert.match(c.text, /twice/);
  await closeCard();
  const { parseTriggers } = out('cowork-scheduled.js');
  const tasks = parseTriggers(body);
  store('cowork-task:trig_active', out('cowork-draw.js').coworkSource('cowork-task:trig_active', tasks).text, 'Weekly digest');
  // Reopen the page: the stored drawing is read once the page is loaded.
  await s.mouse('.sidebar .row', 'Weekly digest');
  await s.mouse('.main .cmd-bar button', 'Back');
  await s.mouse('.sidebar .row', 'Weekly digest');
  const fig = await figure();
  assert.ok(fig.first, 'the drawing sits above the details');
  assert.equal(fig.text, 'Weekly digest');
  assert.deepEqual(fig.modes, ['Harness', 'Process']);
  assert.deepEqual((await aiGroup()).buttons, ['Redraw with Claude']);
  await shoot(path.join(SHOTS, '25-cowork-task-draw.png'), '.main');
});

test('a chat has Draw with Claude beside Continue in terminal and shows its stored drawing', T, async () => {
  await s.mouse('.sidebar .cowork-region .row', 'Chats');
  await s.waitFor(D => /Fixture research chat/.test(D.querySelector('.main-body')?.innerText || ''));
  await s.mouse('.main .asset-table .at-row', 'Fixture research chat');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.trim() === 'Fixture research chat');
  assert.deepEqual(await labels('.main .cmd-bar button'), ['Back', 'Continue in terminal', 'Draw with Claude']);
  const g = await aiGroup();
  assert.ok(g.last, 'the AI group ends the bar');
  await s.mouse('.main .cmd-bar button', 'Draw with Claude');
  const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(c.text, /Draw Fixture research chat with Claude/);
  assert.match(c.text, /conversation/);
  await closeCard();
  store('cowork-chat:local_cccc0001', out('cowork-draw.js').coworkSource('cowork-chat:local_cccc0001', undefined).text, 'Fixture research chat');
  await s.mouse('.main .cmd-bar button', 'Back');
  await s.waitFor(D => /Fixture research chat/.test(D.querySelector('.main-body')?.innerText || ''));
  await s.mouse('.main .asset-table .at-row', 'Fixture research chat');
  const fig = await figure();
  assert.ok(fig.first);
  assert.equal(fig.text, 'Fixture research chat');
  await shoot(path.join(SHOTS, '27-cowork-chat-draw.png'), '.main');
});

test('a synced skill, a synced plugin and a connector have Draw with Claude in the AI group', T, async () => {
  for (const [kind, name] of [['skill', 'docs'], ['plugin', 'design'], ['mcp', 'Mail']]) {
    await s.waitFor((D, k) => !!D.querySelector(`.sidebar [data-nav="s|cowork|${k}"]`), kind);
    if (!(await s.ev((D, n) => [...D.querySelectorAll('.sidebar .row')].some(r => r.getClientRects().length && r.textContent.includes(n)), name))) await s.mouse(`.sidebar [data-nav="s|cowork|${kind}"]`, '');
    await s.mouse('.sidebar .row', name);
    await s.waitFor(D => /Cowork/.test(D.querySelector('.main-head')?.innerText || ''));
    const g = await aiGroup();
    assert.deepEqual(g.buttons, ['Draw with Claude'], `${name}: the AI group`);
    assert.ok(g.last, `${name}: the AI group ends the bar`);
    await s.mouse('.main .cmd-bar button', 'Draw with Claude');
    const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card, e => Promise.reject(new Error(`${name}: ${e.message}`)));
    assert.match(c.text, new RegExp(`Draw .*${name}.* with Claude`));
    await closeCard();
  }
});

test('the connector card names who uses it, and a stored drawing of the connector, the plugin and the skill shows above the details', T, async () => {
  const { connectorSource } = out('cowork-draw.js');
  const { parseTriggers } = out('cowork-scheduled.js');
  const skillFile = path.join(claude(), 'skills', 'synced', ORG, 'docs', 'SKILL.md');
  const src = connectorSource('Mail', parseTriggers(body), [{ name: 'docs', file: skillFile }]);
  assert.match(src.text, /### Scheduled tasks that use it\n- Weekly digest/);
  assert.match(src.text, /### Skills that name it\n- docs/);
  store('cowork|mcp:claude.ai Mail', src.text, 'Mail');
  await s.mouse('.sidebar .row', 'Weekly digest');
  await s.mouse('.sidebar .row', 'Mail');
  await s.waitFor(D => /Cowork/.test(D.querySelector('.main-head')?.innerText || ''));
  const fig = await figure();
  assert.ok(fig.first);
  assert.equal(fig.text, 'Mail');
  assert.deepEqual(fig.modes, ['Harness', 'Process']);
  const { drawSource, contentHash, writeDrawing } = out('drawing.js');
  const plugin = { id: 'cowork|plugin:design', kind: 'plugin', name: 'design', file: '' };
  const dir = path.join(claude(), 'plugins', 'synced', ORG, 'design');
  writeDrawing(drawings(), plugin.id, contentHash(drawSource(plugin, dir).text), SVG('design'));
  await s.mouse('.sidebar .row', 'design');
  const pf = await figure();
  assert.ok(pf.first);
  assert.equal(pf.text, 'design');
});
