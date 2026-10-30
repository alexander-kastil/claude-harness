// UI tests of the Cowork Design systems node, list page and system page, run in a real, isolated VS Code (see harness.mjs). The two
// servers (the artifact server and Claude Design) are one server on this PC (CLAUDE_HARNESS_ARTIFACTS_URL and CLAUDE_HARNESS_DESIGN_URL,
// loopback only) that answers synthetic bodies; nothing leaves the machine and no real token is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const PORT = Number(process.env.DESIGN_API_PORT || 9668);
const calls = [];
let design = 'scopes';
let version = '1793205115-a85c';
const answer = result => ({ jsonrpc: '2.0', id: 1, result: { structuredContent: result } });
const TYPES = { types: [{ slug: 'type-docs', title: 'Docs', description: 'Docs.' }, { slug: 'type-ds', title: 'Design System', description: "Design systems: a brand's README, tokens (colors, type scale, spacing), components with live previews and assets, one browsable reference." }] };
const INSTANCES = {
  default: 'sys-1',
  instances: [
    { slug: 'sys-1', url: 'https://claude.ai/artifact/AbC123', title: 'Acme Brand', favicon: '🧩', created_at: '2026-09-18T07:35:53Z', published_at: '2026-10-28T22:05:59Z', audience: 'owner', rel: 'mine', current_type_version: '1793205115-a85c' },
    { slug: 'sys-2', url: 'https://claude.ai/artifact/DeF456', title: 'Team Kit', favicon: '', created_at: '2026-10-01T10:00:00Z', published_at: '2026-10-02T10:00:00Z', audience: 'org', rel: 'shared' },
  ],
};
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const params = JSON.parse(raw || '{}').params || {};
    calls.push({ url: req.url, tool: params.name, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/design')) {
      // The design login's token, never the Claude Code one, is what this server is given.
      if (design === 'scopes' || req.headers.authorization !== 'Bearer design-token') return void ((res.statusCode = 403), res.end(JSON.stringify({ error: 'needs_design_scopes', scopes: ['user:design:read'], prompt: 'run /design-login' })));
      const body = { list_design_systems: [{ id: 'proj-1', name: 'Broadsheet', is_default: false }], get_project: { id: 'proj-1', name: 'Broadsheet', type: 'PROJECT_TYPE_DESIGN_SYSTEM', url: 'https://claude.ai/design/p/proj-1', sharing: { scope: 'private', link_permission: 'none' } }, list_files: [{ path: 'README.md', type: 'file' }, { path: 'tokens', type: 'dir' }, { path: 'tokens/tokens.json', type: 'file' }] }[params.name];
      return void res.end(JSON.stringify(answer(body)));
    }
    res.end(JSON.stringify(answer(params.name === 'list_types' ? TYPES : { ...INSTANCES, instances: INSTANCES.instances.map(i => (i.slug === 'sys-1' ? { ...i, current_type_version: version } : i)) })));
  });
});
process.env.CLAUDE_HARNESS_ARTIFACTS_URL = `http://127.0.0.1:${PORT}/artifacts`;
process.env.CLAUDE_HARNESS_DESIGN_URL = `http://127.0.0.1:${PORT}/design`;

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const SHOTS = process.env.DESIGN_SHOTS;
const credentials = (expiresAt, designLogin) => fs.writeFileSync(path.join(s.fixture.claude, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-token', expiresAt }, ...(designLogin && { designOauth: { accessToken: 'design-token', expiresAt, scopes: ['user:design:read'] } }) }));
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => (e.textContent || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()), sel);
const nav = () => s.ev(D => D.querySelector('.sidebar .list')?.innerText || '');
const head = 'Design systems';
// A screenshot shows neither VS Code's Explorer nor the panel's own nav column: the side bar is closed and the nav is cropped out.
async function shot(file, height = 520) {
  const open = () => s.pageEv(() => !!document.querySelector('.part.sidebar') && document.querySelector('.part.sidebar').offsetWidth > 0);
  if (await open()) await s.chord('b', { ctrl: true });
  await s.waitFor(D => D.querySelector('.sidebar'));
  const edge = await s.pageEv(() => {
    const f = [...document.querySelectorAll('iframe')].filter(x => x.offsetWidth > 300).sort((a, b) => b.offsetWidth - a.offsetWidth)[0];
    return f ? f.getBoundingClientRect().left : 0;
  });
  const nav = await s.ev(D => D.querySelector('.sidebar').getBoundingClientRect().width);
  const w = await s.pageEv(() => window.innerWidth);
  const x = Math.ceil(edge + nav);
  const shot = await s.page.send('Page.captureScreenshot', { format: 'png', clip: { x, y: 36, width: w - x, height, scale: 1 } });
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
}

// `claude` on the PATH is a stub: it records its arguments, its environment switch and the prompt, and answers a fixed design system.
const stubDir = path.join(s.root, 'stubbin');
const record = path.join(stubDir, 'record.json');
const READ = {
  readme: '# Acme Brand\nUse the blue.',
  tokens: [{ group: 'colors', name: 'brand-blue', value: '#0a84ff' }, { group: 'spacing', name: 'gap-2', value: '8px' }],
  components: [{ name: 'Button', description: 'The primary action' }],
  files: ['README.md', 'tokens.json', 'components/Button.html'],
};

before(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  fs.rmSync(stubDir, { recursive: true, force: true });
  fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(path.join(stubDir, 'stub.js'), `let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{require('fs').writeFileSync(${JSON.stringify(record)},JSON.stringify({args:process.argv.slice(2),artifact:process.env.CLAUDE_CODE_ARTIFACT,prompt:d}));console.log(JSON.stringify({result:'\`\`\`json\\n'+${JSON.stringify(JSON.stringify(READ))}+'\\n\`\`\`',total_cost_usd:0.004}));});\n`);
  fs.writeFileSync(path.join(stubDir, 'claude.cmd'), '@node "%~dp0stub.js" %*\r\n');
  process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
});

after(async () => {
  await s.stop();
  server.close();
});

test('without a Claude Code login the Design systems node shows one line why, keeps the Memory link, and asks nobody', T, async () => {
  await s.waitFor(D => /Sign in to Claude Code with your claude\.ai account to list the design systems/.test(D.querySelector('.sidebar .list')?.innerText || ''));
  const links = await labels('.sidebar .cowork-region .row.cowork-link .name');
  assert.ok(links.includes('Memory') && !links.includes(head), `Design systems is a node now, Memory stays a link: ${links.join(', ')}`);
  assert.equal(calls.length, 0);
});

test('with a login the node lists the design systems and the list page shows name, usable by, published and type', T, async () => {
  await s.resize(1500);
  credentials(Date.now() + 3600_000);
  await s.mouse('.sidebar .cowork-region .section-head', head);
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 2);
  const list = await nav();
  for (const name of ['Acme Brand', 'Team Kit']) assert.ok(list.includes(name), name);
  assert.deepEqual((await labels('.main .asset-table .at-head > span')).slice(0, 4), ['Name', 'Usable by', 'Published', 'Type']);
  const rows = await labels('.main .asset-table .at-row:not(.at-head)');
  assert.match(rows[0], /Acme Brand.*Just you.*Oct 28/);
  assert.match(rows[1], /Team Kit.*Your organization/);
  // The standalone side asked for design scopes: the page says so once, and the artifact list stays.
  assert.match(await text(), /\/design-login/);
  assert.equal(await s.ev(D => D.querySelectorAll('.design-standalone-note').length), 1);
  if (SHOTS) await shot(path.join(SHOTS, '28-design-systems.png'));
});

test('only list tools were called, each with the login as the bearer token, and the token is on no page', T, async () => {
  const tools = [...new Set(calls.map(c => c.tool))].sort();
  assert.deepEqual(tools, ['list_artifacts', 'list_types'], 'without the design login the design server is not asked');
  assert.ok(calls.every(c => c.auth === 'Bearer synthetic-token'));
  assert.ok(!(await s.ev(D => D.documentElement.innerHTML)).includes('synthetic-token'));
});

test('a design system opens its read-only page: its details, what the type holds, and Open on claude.ai', T, async () => {
  await s.mouse('.main .asset-table .at-row', 'Acme Brand');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('Acme Brand'));
  const page = await text('.main');
  assert.match(page, /Just you/);
  assert.match(page, /Oct 28/);
  assert.match(page, /Design System/);
  assert.match(page, /README, tokens/);
  const bar = await labels('.main .cmd-bar button');
  assert.ok(bar.some(b => b.startsWith('Open on claude.ai')), bar.join(' | '));
  for (const write of ['Edit', 'Rename', 'Delete', 'Publish', 'Pin']) assert.ok(!bar.some(b => b.startsWith(write)), `${write} on a design system`);
  if (SHOTS) await shot(path.join(SHOTS, '29-design-system-page.png'));
});

test('with Claude Design allowed the standalone projects are listed too, marked Standalone, and a project page lists its files', T, async () => {
  design = 'ok';
  credentials(Date.now() + 3600_000, true);
  calls.length = 0;
  await s.mouse('.main-head [aria-label="Back to Design systems"], .cmd-bar button', 'Back');
  await s.waitFor((D, h) => D.querySelector('.main-head h1')?.textContent === h, head);
  await s.mouse('.main-head [aria-label="Reload"]', '');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length === 3);
  assert.equal(await s.ev(D => D.querySelectorAll('.design-standalone-note').length), 0);
  const rows = await labels('.main .asset-table .at-row:not(.at-head)');
  assert.match(rows[2], /Broadsheet.*Standalone/);
  const designCalls = calls.filter(c => c.url.startsWith('/design'));
  assert.deepEqual([...new Set(designCalls.map(c => c.tool))].sort(), ['get_project', 'list_design_systems', 'list_files'], 'only list and read calls');
  assert.ok(designCalls.every(c => c.auth === 'Bearer design-token'), 'the design login, not the Claude Code one');
  await s.mouse('.main .asset-table .at-row', 'Broadsheet');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('Broadsheet'));
  const page = await text('.main');
  assert.match(page, /README\.md/);
  assert.match(page, /tokens\.json/);
  // A standalone project already lists its files here: it has no Read with Claude.
  assert.equal(await s.ev(D => D.querySelectorAll('.main .ai-group').length), 0);
});

const openAcme = async () => {
  await s.mouse('.cmd-bar button', 'Back');
  await s.waitFor((D, h) => D.querySelector('.main-head h1')?.textContent === h, head);
  await s.mouse('.main .asset-table .at-row', 'Acme Brand');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('Acme Brand'));
};

test('Read with Claude sits in the Claude group at the end of the bar, asks in a card first and runs nothing before the press', T, async () => {
  await openAcme();
  const bar = await s.ev(D => { const b = D.querySelector('.main .cmd-bar'); const g = b.querySelector('.ai-group'); return { last: b.lastElementChild === g, buttons: [...g.querySelectorAll('button')].map(x => x.textContent.trim()) }; });
  assert.deepEqual(bar, { last: true, buttons: ['Read with Claude'] });
  assert.ok(!fs.existsSync(record), 'Claude is not run before the press');
  await s.mouse('.ai-group button', 'Read with Claude');
  await s.waitFor(D => D.querySelector('.cf'));
  const card = await text('.cf');
  assert.match(card, /counts against your plan/);
  assert.match(card, /Only reads: nothing is created, published or changed/);
  await s.mouse('.cf button', 'Cancel');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.ok(!fs.existsSync(record), 'Cancel runs nothing');
});

test('after the press Claude reads the design system read-only on the cheapest model, and the README, tokens, components and files show', T, async () => {
  await s.mouse('.ai-group button', 'Read with Claude');
  await s.waitFor(D => D.querySelector('.cf'));
  await s.mouse('.cf button', 'Read');
  await s.waitFor(D => D.querySelector('.main .design-read-note'));
  const page = await text('.main');
  for (const part of ['Use the blue.', 'brand-blue', '#0a84ff', 'gap-2', 'Button', 'The primary action', 'components/Button.html']) assert.ok(page.includes(part), part);
  const run = JSON.parse(fs.readFileSync(record, 'utf8'));
  const at = flag => run.args[run.args.indexOf(flag) + 1];
  assert.equal(at('--model'), 'haiku');
  assert.equal(at('--tools'), 'Artifact');
  assert.equal(at('--allowedTools'), 'Artifact');
  assert.equal(run.artifact, '1');
  assert.match(run.prompt, /https:\/\/claude\.ai\/artifact\/AbC123/);
  assert.match(run.prompt, /Do not call create, publish, pin, unpin, write or delete/);
  assert.equal(await s.ev(D => D.querySelectorAll('.design-read-stale').length), 0);
  assert.deepEqual(await s.ev(D => [...D.querySelectorAll('.main .ai-group button')].map(x => x.textContent.trim())), ['Read again']);
  if (SHOTS) await shot(path.join(SHOTS, '33-design-system-read.png'), 900);
});

test('the read is kept: the page shows it again without running Claude, and a newer version marks it stale', T, async () => {
  fs.rmSync(record);
  await openAcme();
  await s.waitFor(D => D.querySelector('.main .design-read-note'));
  assert.ok((await text('.main')).includes('Use the blue.'));
  assert.ok(!fs.existsSync(record), 'a kept read is not read again');
  version = '1793999999-new1';
  await s.mouse('.main-head [aria-label="Back to Design systems"], .cmd-bar button', 'Back');
  await s.waitFor((D, h) => D.querySelector('.main-head h1')?.textContent === h, head);
  await s.mouse('.main-head [aria-label="Reload"]', '');
  await s.mouse('.main .asset-table .at-row', 'Acme Brand');
  await s.waitFor(D => D.querySelector('.main .design-read-stale'));
  assert.match(await text('.main .design-read-stale'), /newer version/);
  assert.ok((await text('.main')).includes('Use the blue.'), 'the stale read stays visible');
  assert.ok(!fs.existsSync(record));
});
