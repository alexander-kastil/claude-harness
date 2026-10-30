// UI tests of the Cowork scope, run in a real, isolated VS Code (see harness.mjs) on scratch data (fixture.mjs).
// The scratch home has no synced items: the empty scope is checked first, then the synced folders are written into the
// scratch `.claude` (never the real one) and removed again at the end.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const claude = () => s.fixture.claude;
const ORG = 'org-1111_user-2222';

before(async () => {
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
});

after(async () => {
  fs.rmSync(path.join(claude(), 'skills', 'synced'), { recursive: true, force: true });
  fs.rmSync(path.join(claude(), 'plugins', 'synced'), { recursive: true, force: true });
  await s.stop();
});

const write = (rel, text) => {
  const file = path.join(claude(), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const coworkHead = () => s.ev(D => D.querySelector('.sidebar .cowork-region > .scope-head')?.innerText || '');
// The Cowork region is always open: its head does not fold.
const unfold = () => s.waitFor(D => D.querySelector('.sidebar .cowork-region .row.cowork-link'));

test('a PC without synced items shows an empty Cowork scope with one line on why', T, async () => {
  await s.waitFor(D => D.querySelector('.sidebar .cowork-region > .scope-head'));
  assert.match(await coworkHead(), /Cowork\s*0$/i);
  await unfold();
  const list = await text('.sidebar .list');
  assert.match(list, /Nothing from Claude\.ai is on this PC/);
  assert.doesNotMatch(list, /not on disk|stay Code only/);
  assert.equal(await s.ev(D => [...D.querySelectorAll('.sidebar .cowork-region .empty')].filter(e => /Nothing from Claude\.ai/.test(e.textContent)).length), 1, 'the region states what is missing once');
});

test('synced skills and plugins show under Cowork with the cloud icon, and none of them can be changed', T, async () => {
  write(`plugins/synced/${ORG}/manifest.json`, JSON.stringify({ plugins: [{ pluginId: 'plugin_1', name: 'design', version: '0040', marketplaceName: 'knowledge-work-plugins', marketplaceKind: 'anthropic_catalog' }] }));
  write(`plugins/synced/${ORG}/design.meta.json`, JSON.stringify({ server_plugin_id: 'plugin_1', marketplace_name: 'knowledge-work-plugins', marketplace_kind: 'anthropic_catalog' }));
  write(`plugins/synced/${ORG}/design/.claude-plugin/plugin.json`, JSON.stringify({ name: 'design', version: '1.2.0', description: 'Design workflows.' }));
  write(`skills/synced/${ORG}/manifest.json`, JSON.stringify({ skills: [{ skillId: 'docs', name: 'docs', creatorType: 'anthropic', source: 'anthropic-example' }] }));
  write(`skills/synced/${ORG}/docs/SKILL.md`, '---\nname: docs\ndescription: Editable docs people share.\n---\n\n# docs\n\nMake the doc first.\n');
  await s.waitFor(D => /Cowork\s*2$/i.test(D.querySelector('.sidebar .cowork-region > .scope-head')?.innerText.trim() || ''));
  assert.equal(await s.ev(D => (D.querySelector('.sidebar .cowork-region > .scope-head .codicon-cloud') ? 'cloud' : '')), 'cloud');
  await unfold();
  assert.ok(!(await text('.sidebar .list')).includes('Nothing from Claude.ai is on this PC'));
  // No add button on the Cowork kinds.
  assert.equal(await s.ev(D => [...D.querySelectorAll('.sidebar .section-head')].filter(h => ['Skills', 'Plugins'].includes(h.querySelector('.label')?.textContent) && h.closest('[role=treeitem]')?.dataset.nav?.startsWith('s|cowork|')).filter(h => h.querySelector('[aria-label^="New"], [aria-label^="Install"]')).length), 0);
  // The kinds inside the scope fold like any other; open the two that hold the synced items.
  for (const kind of ['skill', 'plugin']) await s.mouse(`.sidebar [data-nav="s|cowork|${kind}"]`, '');
  // A synced skill: read-only page, "Managed by Claude.ai", a link to the claude.ai settings, no write command.
  await s.mouse('.sidebar .row', 'docs');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('docs'));
  assert.doesNotMatch(await text('.main'), /Managed by Claude\.ai|overwrites this/, 'no notice box on a Cowork page');
  assert.equal(await s.ev(D => D.querySelectorAll('.main .cowork-notice').length), 0);
  const bar = await labels('.main .cmd-bar button');
  assert.ok(bar.includes('Manage on claude.ai'), bar.join(' | '));
  // Pull to Code and its target sit in the header bar, right after Manage on claude.ai and left of the AI group.
  const order = await s.ev(D => [...D.querySelectorAll('.main .cmd-bar > .dg-modes')].map(g => g.getAttribute('aria-label')));
  assert.ok(order.indexOf('Pull to Code') === order.indexOf('Claude.ai') + 1 && order.indexOf('Claude.ai') > 0, `Pull to Code follows Manage on claude.ai: ${order}`);
  assert.equal(await s.ev(D => !!D.querySelector('.main .cmd-bar .pull-to-code select.pull-target option')), true, 'the target choice is in the same box');
  for (const write of ['Edit', 'Rename', 'Duplicate', 'Delete', 'Retire', 'Consolidate', 'Edit with Claude', 'Move into repo']) assert.ok(!bar.some(b => b.startsWith(write)), `${write} is offered on a Cowork skill`);
  // A synced plugin: its version and owner come from the meta files (the manifest entry before the plugin.json); it cannot be enabled or uninstalled.
  await s.mouse('.sidebar .row', 'design');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('design'));
  const page = await text();
  assert.doesNotMatch(page, /Managed by Claude\.ai/);
  const details = await s.ev(D => [...D.querySelectorAll('.main .dv-hero .dv-fact')].map(f => f.querySelector('.k').textContent.trim() + '=' + f.querySelector('.v').textContent.trim()));
  assert.ok(details.includes('Version=0040'), details.join(' | '));
  assert.ok(details.some(d => /^Owner=knowledge-work-plugins/.test(d)), details.join(' | '));
  assert.ok(await s.ev(D => D.querySelectorAll('.main .dv-card .dv-file').length > 0), 'the files are rows of the Files card');
  const pluginBar = await labels('.main .cmd-bar button');
  for (const write of ['Enable', 'Disable', 'Uninstall', 'Rename', 'Delete']) assert.ok(!pluginBar.some(b => b.startsWith(write)), `${write} is offered on a Cowork plugin`);
  // The files on disk stayed as written.
  assert.match(fs.readFileSync(path.join(claude(), 'skills', 'synced', ORG, 'docs', 'SKILL.md'), 'utf8'), /Make the doc first\./);
});

test('the Skills type page groups the synced skills under a Cowork heading', T, async () => {
  await s.mouse('.sidebar-head [aria-label="Overview"]', '');
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.mouse('.main .overview .tile', 'Skills');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Skills');
  // Opened from the overview the page lists Global alone; the Scope chip comes off to widen it to every scope.
  await s.mouse('.main .filter-bar .chip', 'Scope: Global');
  await s.waitFor(D => /Cowork/.test(D.querySelector('.main-body')?.innerText || ''));
  const page = await text();
  assert.match(page, /Cowork/);
  assert.ok((await labels('.main [role=row]')).some(r => r.startsWith('docs')), 'the synced skill is listed');
});

test('Cowork is a region of its own between the Code tree and Repositories, with a Memory link that carries no count', T, async () => {
  const order = await s.ev(D => {
    const kids = [...D.querySelector('.sidebar .list').children];
    const at = sel => kids.findIndex(k => k.matches(sel));
    return { code: at('.scope-block'), cowork: at('.cowork-region'), repos: kids.findIndex(k => k.dataset.region === 'repos'), inCode: D.querySelectorAll('.scope-block .cowork-region, .scope-block [data-nav^="s|cowork|"]').length };
  });
  assert.ok(order.code >= 0 && order.code < order.cowork && order.cowork < order.repos, JSON.stringify(order));
  assert.equal(order.inCode, 0, 'no Cowork item renders inside the Code tree');
  assert.deepEqual(await labels('.sidebar .cowork-region > .scope-head .label'), ['Cowork']);
  assert.deepEqual(await labels('.sidebar .cowork-region .row[data-nav^="l|cowork|"] .name'), ['Memory']);
  assert.equal(await s.ev(D => D.querySelectorAll('.sidebar .cowork-region .row[data-nav^="l|cowork|"] .count').length), 0);
  assert.equal(await s.ev(D => D.querySelectorAll('.sidebar .cowork-region .row[data-nav^="l|cowork|"] .codicon-link-external').length), 1);
});

test('claudeHarness.cowork.show hides the Cowork region from the nav and shows it again, and the Cowork pages stay', T, async () => {
  s.settings({ 'claudeHarness.cowork.show': false });
  await s.waitFor(D => !D.querySelector('.sidebar .cowork-region') && D.querySelector('.sidebar .list'));
  assert.equal(await s.ev(D => D.querySelectorAll('.sidebar [data-nav^="s|cowork|"], .sidebar [data-nav^="l|cowork|"]').length), 0);
  s.settings({ 'claudeHarness.cowork.show': true });
  await s.waitFor(D => D.querySelector('.sidebar .cowork-region > .scope-head'));
  // The data was untouched: the region counts the same two synced items.
  assert.match(await coworkHead(), /Cowork\s*2$/i);
});

test('the nav head repeats no title: the tab says Claude Harness, the head holds the mark and its buttons', T, async () => {
  assert.equal(await s.ev(D => D.querySelector('.sidebar-head').textContent.trim()), '');
  assert.equal(await s.ev(D => D.querySelectorAll('.sidebar-head button').length), 5);
});

test('each of the three region heads folds its region on a click and opens it on the next', T, async () => {
  // [region, what only that region holds]
  const parts = { code: '.scope-block .section-head', cowork: '.cowork-region .row.cowork-link', repos: '.repo-head' };
  const count = sel => s.ev((D, sel) => D.querySelectorAll(`.sidebar .list ${sel}`).length, sel);
  for (const [region, sel] of Object.entries(parts)) {
    assert.ok((await count(sel)) > 0, `${region} shows its items`);
    // The label, not the middle of the head: a crowded head has a tool button there.
    await s.mouse(`.sidebar [data-region="${region}"] .label`, '');
    await s.waitFor((D, sel) => D.querySelectorAll(`.sidebar .list ${sel}`).length === 0, sel);
    assert.equal(await s.ev((D, r) => D.querySelector(`.sidebar [data-region="${r}"]`).getAttribute('aria-expanded'), region), 'false');
    await s.mouse(`.sidebar [data-region="${region}"] .label`, '');
    await s.waitFor((D, sel) => D.querySelectorAll(`.sidebar .list ${sel}`).length > 0, sel);
  }
});

test('the head button collapses all three regions while any is open and expands them all otherwise, on the same fold state', T, async () => {
  const state = () => s.ev(D => ({ label: D.querySelector('.sidebar-head .codicon-collapse-all, .sidebar-head .codicon-expand-all')?.closest('button')?.getAttribute('aria-label'), open: [...D.querySelectorAll('.sidebar [data-region]')].map(h => h.getAttribute('aria-expanded')) }));
  assert.deepEqual(await state(), { label: 'Collapse all', open: ['true', 'true', 'true'] });
  // One region folded by its own head: some are still open, so the button still collapses.
  await s.mouse('.sidebar [data-region="cowork"] .label', '');
  await s.waitFor(D => D.querySelector('.sidebar [data-region="cowork"]').getAttribute('aria-expanded') === 'false');
  assert.equal((await state()).label, 'Collapse all');
  await s.mouse('.sidebar-head [aria-label="Collapse all"]', '');
  await s.waitFor(D => [...D.querySelectorAll('.sidebar [data-region]')].every(h => h.getAttribute('aria-expanded') === 'false'));
  assert.equal((await state()).label, 'Expand all');
  await s.mouse('.sidebar-head [aria-label="Expand all"]', '');
  await s.waitFor(D => [...D.querySelectorAll('.sidebar [data-region]')].every(h => h.getAttribute('aria-expanded') === 'true'));
  assert.deepEqual(await state(), { label: 'Collapse all', open: ['true', 'true', 'true'] });
});
