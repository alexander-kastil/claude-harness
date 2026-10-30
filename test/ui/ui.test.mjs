// UI tests of the Claude Harness webview, run in a real, isolated VS Code (see harness.mjs) on scratch data (fixture.mjs).
// `npm run test:ui` compiles, starts the instance on UI_PORT (default 9478) with its own user data and a scratch home,
// drives the panel with real mouse and key events over the Chrome DevTools Protocol, and stops only that instance.
// A test marked `todo` describes a bug found in the walk-through: it states the behaviour the page should have, is reported
// as todo, and never fails the run until the bug is fixed (then remove the mark).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { repoRoot } from './fixture.mjs';
import { Session, sleep } from './harness.mjs';
import { contrast, unfocusable } from './probes.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const claude = () => s.fixture.claude;

before(async () => {
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
});

after(() => s.stop());

// A failing test leaves a screenshot of the workbench beside the scratch data, named after the test.
afterEach(async t => {
  if (t.passed) return;
  try {
    await s.screenshot(path.join(s.root, 'failures', `${t.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`));
  } catch {}
  await dropDraft();
});

// Navigation helpers: all through real mouse events, the way a hand reaches the page. A background refresh can replace the
// sidebar between press and release, so a click that changed nothing is repeated once or twice.
const go = async (selector, label, check, ...args) => {
  const keep = s.waitMs;
  for (let i = 0; i < 3; i++) {
    await s.mouse(selector, label);
    s.waitMs = 5000;
    try {
      await s.waitFor(check, ...args);
      s.waitMs = keep;
      return;
    } catch (e) {
      s.waitMs = keep;
      if (i === 2) throw e;
    }
  }
};
const home = async () => {
  await s.chord('Escape');
  await go('.sidebar-head [aria-label="Overview"]', '', D => D.querySelector('.overview-tabs'));
  // The Home button opens the overview with a clean search.
  assert.equal(await s.ev(D => D.querySelector('.overview-search input')?.value), '', 'Home clears the search');
};
const tile = async label => {
  await home();
  await go('.main .overview .tile', label, (D, label) => D.querySelector('.main-head h1')?.textContent === label, label);
};
const openRow = async (kindTile, name) => {
  await tile(kindTile);
  await go('.main [role=row]', name, (D, name) => D.querySelector('.main-head h1')?.textContent.startsWith(name), name);
};
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const notBlank = async what => {
  const r = await s.ev(D => ({ head: !!D.querySelector('.main-head'), len: (D.querySelector('.main-body')?.innerText || '').trim().length }));
  assert.ok(r.head && r.len > 40, `${what} rendered a blank panel (${JSON.stringify(r)})`);
};
const card = () => s.ev(D => { const c = D.querySelector('.cf'); return c ? { text: c.innerText, focus: D.activeElement.textContent.trim(), buttons: [...c.querySelectorAll('button')].filter(b => b.getClientRects().length).map(b => b.textContent.trim()), switches: c.querySelectorAll('.cf-switch').length, role: c.getAttribute('role') } : null; });
const closeCard = async () => {
  await s.chord('Escape');
  await s.waitFor(D => !D.querySelector('.cf'));
};
const read = rel => fs.readFileSync(path.join(claude(), rel), 'utf8');

test('the panel opens on the overview with every tile counted and data in the lists', T, async () => {
  await home();
  await notBlank('overview');
  const tiles = await labels('.main .overview .tile');
  assert.deepEqual(tiles.map(t => t.replace(/^\d+/, '')), ['Memory', 'Rules', 'Agents', 'Skills', 'Commands', 'Output Styles', 'Workflows', 'Hooks', 'Mods', 'MCP Servers', 'Plugins', 'Settings']);
  assert.match(await text('.main-head .path'), /69 global assets · 5 repositories/);
});

test('before the index exists the Used and Cost columns and the detail page agree, and Count usage builds it', T, async () => {
  await openRow('Skills', 'release-playbook');
  const detail = await text();
  assert.doesNotMatch(detail, /in 0 sessions|never ran/, 'the detail page claims nothing without an index');
  await tile('Skills');
  const zeros = await s.waitFor(D => [...D.querySelectorAll('.main [role=row]')].filter(r => r.textContent.startsWith('release-playbook')).flatMap(r => [...r.querySelectorAll('.at-fact.bad')].filter(c => c.textContent === '0')).length);
  assert.equal(zeros, 2, 'Used and Cost both show a red 0');
  await s.mouse('.main-head button', 'Count usage');
  await s.waitFor(D => !/Count usage|Counting/.test(D.querySelector('.main-head').innerText) && ![...D.querySelectorAll('.main [role=row] .at-fact.bad')].some(c => c.textContent === '0'));
});

test('Ctrl+Alt+A brings the panel back after it was closed, and does not open a second one', T, async () => {
  const tabs = () => s.pageEv(() => [...document.querySelectorAll('.tabs-container .tab')].map(t => t.getAttribute('aria-label') || t.textContent.trim()).filter(n => /Claude Harness/.test(n)).length);
  assert.equal(await tabs(), 1);
  const close = await s.pageEv(() => {
    const t = [...document.querySelectorAll('.tabs-container .tab')].find(x => /Claude Harness/.test(x.getAttribute('aria-label') || x.textContent));
    const r = t.querySelector('.codicon-close, .action-label').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await s.page.send('Input.dispatchMouseEvent', { type, ...close, button: 'left', clickCount: 1 });
  for (let i = 0; i < 20 && (await tabs()); i++) await sleep(250);
  assert.equal(await tabs(), 0, 'the tab closed');
  await s.chord('a', { ctrl: true, alt: true });
  for (let i = 0; i < 20 && !(await tabs()); i++) await sleep(250);
  assert.equal(await tabs(), 1, 'the shortcut opened the panel');
  await s.chord('a', { ctrl: true, alt: true });
  assert.equal(await tabs(), 1, 'a second press reveals the same panel');
  await s.waitFor(D => D.querySelector('.overview-tabs'));
});

test('overview tabs: newest sessions first with the live one marked, every repo with counts, recently changed', T, async () => {
  await home();
  await s.mouse('.overview-tabs .view-tab', 'Last sessions');
  const rows = await labels('.main [role=row]');
  const sessions = rows.filter(r => /feature\/|main|hotfix/.test(r) && !/^Repository/.test(r));
  assert.ok(sessions.length >= 8, `8 sessions listed, got ${sessions.length}`);
  assert.match(sessions[0], /Still working on the checkout page.*busy/, 'the live session is first and marked busy');
  const started = await s.ev(D => [...D.querySelectorAll('.main [role=row]')].filter(r => r.getClientRects().length).slice(1).map(r => r.textContent));
  assert.ok(started.length >= 8);
  await s.mouse('.overview-tabs .view-tab', 'Repositories');
  const repos = await labels('.main [role=row]');
  for (const name of ['shop-api', 'shop-web', 'data-pipeline', 'docs-site', 'empty-repo']) assert.ok(repos.some(r => r.includes(name)), `${name} listed`);
  await s.mouse('.overview-tabs .view-tab', 'Recently changed');
  assert.ok((await labels('.main [role=row]')).length >= 10, 'recently changed lists assets');
  await s.mouse('.overview-tabs .view-tab', 'Last sessions');
});

test('the chosen overview tab survives leaving and coming back', T, async () => {
  await home();
  await s.mouse('.overview-tabs .view-tab', 'Repositories');
  await s.mouse('.main .overview .tile', 'Rules');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Rules');
  await s.mouse('.sidebar-head [aria-label="Overview"]');
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  assert.deepEqual(await s.ev(D => [...D.querySelectorAll('.overview-tabs .view-tab.active')].map(t => t.textContent.replace(/\d+$/, '').trim())), ['Repositories']);
  await s.mouse('.overview-tabs .view-tab', 'Last sessions');
});

test('combined search finds harness assets and sessions, and says so when nothing matches', T, async () => {
  await home();
  const search = q => s.ev((D, q) => { const i = D.querySelector('.overview-search input'); i.focus(); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); }, q);
  await search('checkout');
  await sleep(500);
  const groups = await labels('.main .group-label');
  const harness = groups.find(g => g.startsWith('Harness ('));
  const sess = groups.find(g => g.startsWith('Sessions ('));
  assert.ok(harness && Number(harness.match(/\d+/)[0]) >= 1, `harness hit for the checkout skill: ${groups}`);
  assert.ok(sess && Number(sess.match(/\d+/)[0]) >= 2, `two sessions mention checkout: ${groups}`);
  assert.ok((await labels('.recent .row')).some(r => r.includes('shop-checkout')));
  await search('zzqqxx');
  await sleep(300);
  const none = await s.ev(D => ({ groups: [...D.querySelectorAll('.main .group-label')].filter(g => g.getClientRects().length).length, empty: D.querySelector('.search-empty')?.innerText || '' }));
  assert.equal(none.groups, 0, 'no empty group per source');
  assert.match(none.empty, /No match for "zzqqxx"/, 'one message names the search');
  assert.match(none.empty, /Searched \d+ harness items .* \d+ sessions/, 'and says what was searched');
  await search('');
  await sleep(300);
  assert.ok(await s.ev(D => D.querySelector('.overview-tabs').getClientRects().length > 0), 'the tabs are back');
  // a session hit opens the session
  await search('nightly');
  await sleep(300);
  await s.mouse('.recent .row', 'Why is the nightly load slow');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('Why is the nightly'));
  await notBlank('session page');
});

test('a type page lists every skill of the scope, with a heading per origin and the counts of the tile', T, async () => {
  await tile('Skills');
  await notBlank('skills page');
  assert.match(await text('.main-head .path'), /^32 in Global · 4 from plugins · \d+ in \d+ scopes/);
  const rows = await labels('.main [role=row]');
  for (const n of ['release-playbook', 'api-design', 'webhook-debug']) assert.ok(rows.some(r => r.startsWith(n)), `${n} listed`);
  assert.ok((await labels('.main button')).some(b => b.startsWith('Scope')), 'the plugins are a value of the Scope filter');
});

test('detail page of a skill: the command bar, the header tiles and the size flag', T, async () => {
  await openRow('Skills', 'release-playbook');
  await notBlank('skill page');
  assert.deepEqual(await labels('.main .view-tab').then(l => l.slice(0, 13)), ['Back', 'View', 'Edit', 'Open in editor', 'Reveal', 'Edit with Claude', 'Slim with Claude', 'Draw with Claude', 'Try it', 'Connect to source', 'Move into repo', 'Rename', 'Duplicate']);
  await s.mouse('.view-tab', 'Instructions');
  const body = await text();
  assert.match(body, /SKILL\.md is long/);
  assert.match(body, /LARGEST SECTIONS|Largest sections/i);
  await s.mouse('.view-tab', 'References');
  assert.match(await text(), /6 not linked/);
});

test('Edit then Ctrl+S saves the file and returns the page to View', T, async () => {
  const rel = 'skills/api-design/SKILL.md';
  const before = read(rel);
  try {
    await openRow('Skills', 'api-design');
    await s.mouse('.main button', 'Edit');
    await s.waitFor(D => D.querySelector('.main textarea'));
    await s.ev(D => { const t = D.querySelector('.main .editor textarea'); t.focus(); t.value += ' UITEST-MARK'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.ok((await labels('.main button')).includes('Save'));
    await s.chord('s', { ctrl: true });
    await s.waitFor(D => !D.querySelector('.main textarea'));
    assert.ok(read(rel).includes('UITEST-MARK'), 'the file holds the edit');
    assert.deepEqual(await s.ev(D => [...D.querySelectorAll('.main button.view-tab.active')].map(t => t.textContent.trim())).then(a => a.filter(x => ['View', 'Edit'].includes(x))), ['View']);
    assert.match(await text('.main-body'), /UITEST-MARK/, 'the page shows the saved text');
  } finally {
    fs.writeFileSync(path.join(claude(), rel), before);
  }
});

test('leaving a page with unsaved edits asks first: Cancel stays, Don\'t Save drops, Escape cancels', T, async () => {
  const rel = 'skills/api-design/SKILL.md';
  const before = read(rel);
  await openRow('Skills', 'api-design');
  await s.mouse('.main button', 'Edit');
  await s.waitFor(D => D.querySelector('.main textarea'));
  await s.ev(D => { const t = D.querySelector('.main textarea'); t.value += ' UNSAVED'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await s.mouse('.main button', 'Back');
  const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(c.text, /Save changes to api-design\?/);
  assert.deepEqual(c.buttons, ['Cancel', "Don't Save", 'Save']);
  assert.equal(c.focus, 'Save', 'the safe answer holds the focus');
  await s.chord('Escape');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.ok(await s.ev(D => D.querySelector('.main textarea').value.includes('UNSAVED')), 'Escape keeps the edit');
  await s.mouse('.main button', 'Back');
  await s.waitFor(D => D.querySelector('.cf'));
  await s.mouse('.cf button', "Don't Save");
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Skills');
  assert.equal(read(rel), before, 'Don\'t Save leaves the file alone');
});

test('the Save choice of that card writes the file, then opens the next page', T, async () => {
  const rel = 'skills/api-design/SKILL.md';
  const before = read(rel);
  try {
    await openRow('Skills', 'api-design');
    await s.mouse('.main button', 'Edit');
    await s.waitFor(D => D.querySelector('.main textarea'));
    await s.ev(D => { const t = D.querySelector('.main textarea'); t.value += ' CARDSAVE'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await s.mouse('.main button', 'Back');
    await s.waitFor(D => D.querySelector('.cf'));
    await s.ev(D => [...D.querySelectorAll('.cf button')].find(b => b.textContent.trim() === 'Save').click());
    await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Skills');
    assert.ok(read(rel).includes('CARDSAVE'));
  } finally {
    fs.writeFileSync(path.join(claude(), rel), before);
  }
});

test('Slim with Claude asks in a card: keyboard focus on the action, Tab stays inside, Esc and Cancel close it', T, async () => {
  await openRow('Skills', 'release-playbook');
  await s.mouse('.main button', 'Slim with Claude');
  const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.equal(c.role, 'dialog');
  assert.match(c.text, /Slim release-playbook with Claude/);
  assert.match(c.text, /8 files/);
  assert.equal(c.focus, 'Open in terminal');
  assert.equal(c.switches, 1, "the Don't ask again switch is there");
  for (let i = 0; i < 5; i++) {
    await s.chord('Tab');
    assert.ok(await s.ev(D => !!D.activeElement.closest('.cf')), 'focus stays in the card');
  }
  await closeCard();
  await s.mouse('.main button', 'Slim with Claude');
  await s.waitFor(D => D.querySelector('.cf'));
  await s.mouse('.cf button', 'Cancel');
  await s.waitFor(D => !D.querySelector('.cf'));
});

test('Edit with Claude and Try it ask too; nothing starts a terminal without the card', T, async () => {
  await openRow('Skills', 'release-playbook');
  const before = await s.pageEv(() => document.querySelectorAll('.terminal-tab, .terminal-tabs-entry').length);
  await s.mouse('.main button', 'Edit with Claude');
  const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(c.text, /Edit release-playbook with Claude/);
  assert.match(c.text, /changes nothing until you agree/);
  await closeCard();
  assert.equal(await s.pageEv(() => document.querySelectorAll('.terminal-tab, .terminal-tabs-entry').length), before);
});

test('Used in builds the index from the transcripts and lists the session that ran the skill', T, async () => {
  await openRow('Skills', 'release-playbook');
  await s.mouse('.view-tab', 'Used in');
  const body = await s.waitFor(D => { const t = D.querySelector('.main-body').innerText; return /LAST USED/.test(t) && /Fix the rounding/.test(t) && t; });
  assert.match(body, /shop-api/);
  assert.match(body, /1 use/);
  assert.ok(await s.ev(D => !!D.querySelector('.main .view-tab .badge, .main .view-tab .count, .main .view-tab [class*=badge]') || /Used in\s*1/.test(D.querySelector('.main').innerText)), 'the tab carries its count');
});

test('Fired in lists the sessions a hook ran in with its failures', T, async () => {
  await openRow('Hooks', 'PreToolUse · Bash');
  await s.mouse('.view-tab', 'Fired in');
  const row = await s.waitFor(D => [...D.querySelectorAll('.main [role=row]')].map(r => r.textContent).find(t => /shop-api/.test(t) && /exit 2/.test(t)));
  assert.match(row, /Add the checkout endpoint/);
  assert.match(row, /3 \(exit 2\)/);
});

test('Loaded in lists the sessions that loaded a rule or memory file', T, async () => {
  await tile('Rules');
  await s.mouse('.main [role=row]', 'style');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('style'));
  assert.ok((await labels('.main .view-tab')).some(t => t.startsWith('Loaded in')), 'a rule has a Loaded in tab');
  await s.mouse('.view-tab', 'Loaded in');
  const body = await s.waitFor(D => { const t = D.querySelector('.main-body').innerText; return /LOADED IN|Loaded in/.test(t) && t; });
  assert.ok(body.length > 40);
});

test('Consolidate asks in a card: a copy identical to global offers Retire, a differing one offers Compare, Cancel changes nothing', T, async () => {
  await home();
  const find = q => s.ev((D, q) => { const i = D.querySelector('.overview-search input'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); }, q);
  await find('commit-helper');
  await go('.recent .row', 'shop-api · ', D => /^commit-helper/.test(D.querySelector('.main-head h1')?.textContent) && D.querySelector('.main-head').textContent.includes('shop-api'));
  assert.ok((await labels('.main button')).includes('Consolidate'));
  await s.mouse('.main button', 'Consolidate');
  const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(c.text, /Consolidate commit-helper/);
  assert.ok(c.buttons.includes('Retire repo copy'));
  assert.equal(c.switches, 0, 'a destructive question has no Don\'t ask again switch');
  assert.equal(c.focus, 'Cancel', 'the destructive action does not hold the focus');
  await s.mouse('.cf button', 'Cancel');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.ok(fs.existsSync(path.join(s.fixture.repoDirs['shop-api'], '.claude/skills/commit-helper/SKILL.md')), 'Cancel kept the repo copy');
  await home();
  await find('db-migrate');
  await go('.recent .row', 'shop-api · ', D => D.querySelector('.main-head h1')?.textContent.startsWith('db-migrate'));
  await s.mouse('.main button', 'Consolidate');
  const d = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.ok(d.buttons.includes('Compare in editor'), `differing copy offers Compare: ${d.buttons}`);
  await closeCard();
});

test('a session page lists its findings, Show on map selects the run, and the map shows a row per agent with its figures', T, async () => {
  await home();
  await go('.overview-tabs .view-tab', 'Last sessions', D => D.querySelector('.overview-tabs .view-tab.active')?.textContent.includes('Last sessions'));
  await go('.main [role=row]', 'Add the checkout endpoint', D => D.querySelector('.finding'));
  await notBlank('session page');
  const kinds = await s.ev(D => [...D.querySelectorAll('.finding')].map(f => f.getAttribute('data-kind')));
  for (const k of ['failed', 'silent', 'hook', 'stopped', 'repeated', 'edits']) assert.ok(kinds.includes(k), `finding ${k} present in ${kinds}`);
  assert.ok(await s.ev(D => [...D.querySelectorAll('.finding')].every(f => f.querySelector('dt') && /Why it matters/.test(f.innerText))), 'every finding says why it matters');
  await s.mouse('.finding[data-kind="failed"] button', 'Show on map');
  await s.waitFor(D => D.querySelector('.dg-node.sel'));
  assert.ok(await s.ev(D => D.querySelector('.view-tab[data-view="map"]').classList.contains('active')), 'the Delegation map tab is on');
  assert.match(await s.ev(D => D.querySelector('.dg-node.sel').parentElement.textContent), /nope-agent/);
  assert.match(await s.ev(D => D.querySelector('.agent-detail')?.innerText || ''), /failed/);
  const rows = await s.ev(D => [...D.querySelectorAll('.dg-node')].map(n => n.parentElement.textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(rows.length >= 7, `7 agent rows, got ${rows.length}`);
  assert.ok(rows.some(r => /db-expert.*haiku.*k tokens/.test(r)), `a finished run shows model and tokens: ${rows.slice(0, 3)}`);
  assert.ok(rows.some(r => /nope-agent.*0 tokens/.test(r)), 'a run that never started shows 0 tokens');
  assert.ok((await labels('.main .view-tab')).some(x => /Mods/.test(x)), 'the session has a Mods toggle for the delegation mod');
});

// ---- Sessions: the fixes of the sessions usability hunt. ----

const openSession = async () => {
  await home();
  await go('.overview-tabs .view-tab', 'Last sessions', D => D.querySelector('.overview-tabs .view-tab.active')?.textContent.includes('Last sessions'));
  await go('.main [role=row]', 'Add the checkout endpoint', D => D.querySelector('.finding'));
};
const cardSwitches = async (selector, text) => {
  await s.mouse(selector, text);
  await s.waitFor(D => !!D.querySelector('.cf'));
  const on = await switches();
  await s.mouse('.cf button', 'Cancel');
  await s.waitFor(D => !D.querySelector('.cf'));
  return on;
};

test('the sessions list and the session page count the same agents; a launch that never started is named, not counted', T, async () => {
  await home();
  await go('.overview-tabs .view-tab', 'Last sessions', D => D.querySelector('.overview-tabs .view-tab.active')?.textContent.includes('Last sessions'));
  // A narrow table drops its Agents column, so the list is read on a wide panel.
  await s.resize(1700, 900);
  await sleep(500);
  const listed = await s.ev(D => {
    const heads = [...D.querySelectorAll('.main .at-head [role=columnheader]')].filter(c => c.getClientRects().length).map(c => c.textContent.trim());
    const r = [...D.querySelectorAll('.main [role=row]')].find(x => x.innerText.includes('Add the checkout endpoint'));
    return [...r.children].filter(c => c.getClientRects().length)[heads.indexOf('Agents')]?.textContent.trim();
  });
  await s.resize();
  await go('.main [role=row]', 'Add the checkout endpoint', D => D.querySelector('.finding'));
  const tile = await s.ev(D => D.querySelector('.kpis .tile').innerText.replace(/\s+/g, ' '));
  assert.ok(tile.startsWith(`${listed} Agents`), `list says ${listed}, page says: ${tile}`);
  assert.match(tile, /never started/, 'the launches that left no transcript are named');
});

test('Analyze, Continue session and Draft output style cards open with Don\'t ask again off, and Analyze works from a list row', T, async () => {
  await openSession();
  await s.mouse('.view-tabs .view-tab', 'Delegation map');
  await s.waitFor(D => D.querySelector('.dg-toggle'));
  assert.deepEqual(await cardSwitches('.ai-group .view-tab', 'Analyze'), ['false'], 'Analyze starts off');
  assert.deepEqual(await cardSwitches('.ai-group .view-tab', 'Continue session'), ['false'], 'Continue session starts off');
  await s.mouse('[aria-label=Review] .view-tab', 'Output style');
  assert.deepEqual(await cardSwitches('.review-box button[data-confirm=draftStyle]', 'Draft'), ['false'], 'Draft output style starts off');
  await s.mouse('[aria-label=Review] .view-tab', 'Findings');
  await go('.sidebar [aria-label="Search sessions"]', '', D => D.querySelector('.main [role=row] button[aria-label="Analyze this session"]'));
  await notBlank('sessions list');
  assert.deepEqual(await cardSwitches('.main [role=row] button[aria-label="Analyze this session"]', ''), ['false'], 'the row\'s Analyze card starts off');
  assert.ok(await s.ev(D => !D.querySelector('.finding')), 'the row button did not open the session');
});

test('the concurrency and scatter diagrams keep their labels clear of lines, ticks and each other', T, async () => {
  for (const [width, mode] of [[1400, 'dark'], [900, 'light']]) {
    await s.resize(width, 1000);
    await s.theme(mode);
    await openSession();
    await s.mouse('.view-tabs .view-tab', 'Concurrency');
    await s.waitFor(D => D.querySelector('.view-box svg text'));
    const c = await s.ev(D => {
      const box = t => { const b = t.getBBox(); return { text: t.textContent, x: b.x, y: b.y, width: b.width, height: b.height }; };
      const svg = D.querySelector('.view-box svg');
      const boxes = [...svg.querySelectorAll('text')].map(box);
      const hit = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      const peak = boxes.find(b => /^Peak /.test(b.text));
      const out = b => b.x < 0 || b.x + b.width > svg.viewBox.baseVal.width + 1;
      const clipped = boxes.filter(out).map(b => b.text);
      // The tick texts depend on the clock: set every one to the widest style and measure again.
      const ticks = [...svg.querySelectorAll('text')].filter(t => /^\d+:\d\d [AP]M$/.test(t.textContent));
      ticks.forEach(t => (t.textContent = '12:59 AM'));
      const wide = ticks.map(box).filter(out).map(b => b.text);
      return { peak: !!peak, clash: boxes.filter(b => b !== peak && peak && hit(peak, b)).map(b => b.text), clipped, wide, prompts: boxes.find(b => b.text === 'prompts')?.x };
    });
    assert.ok(c.peak, 'the peak label is drawn');
    assert.deepEqual(c.clash, [], `${mode} ${width}: the peak label sits on ${c.clash}`);
    assert.deepEqual(c.clipped, [], `${mode} ${width}: clipped labels ${c.clipped}`);
    assert.deepEqual(c.wide, [], `${mode} ${width}: widest tick labels clipped ${c.wide}`);
    assert.ok(c.prompts >= 0, 'the prompts label starts inside the diagram');
    await s.mouse('.view-tabs .view-tab', 'Scatter');
    await s.waitFor(D => D.querySelector('.dg-labels text'));
    const sc = await s.ev(D => {
      const box = t => { const b = t.getBBox(); return { text: t.textContent, x: b.x, y: b.y, width: b.width, height: b.height }; };
      const svg = D.querySelector('.view-box svg');
      const lines = [...svg.querySelectorAll('.dg-median')].map(l => ({ x1: +l.getAttribute('x1'), x2: +l.getAttribute('x2'), y1: +l.getAttribute('y1'), y2: +l.getAttribute('y2') }));
      const labels = [...svg.querySelectorAll('.dg-labels text')].map(box);
      const onLine = labels.filter(b => lines.some(l => (l.x1 === l.x2 ? l.x1 > b.x && l.x1 < b.x + b.width : l.y1 > b.y && l.y1 < b.y + b.height)));
      const hit = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      const crossing = labels.flatMap((a, i) => labels.slice(i + 1).filter(b => hit(a, b)).map(b => `${a.text}/${b.text}`));
      return { onLine: onLine.map(b => b.text), crossing, n: labels.length };
    });
    assert.ok(sc.n > 0, 'the scatter labels its agents');
    assert.deepEqual(sc.onLine, [], `${mode} ${width}: labels on a median line: ${sc.onLine}`);
    assert.deepEqual(sc.crossing, [], `${mode} ${width}: labels over each other: ${sc.crossing}`);
  }
  await s.theme('dark');
  await s.resize();
});

test('Show on map works for every finding that names an agent', T, async () => {
  await openSession();
  const kinds = await s.ev(D => [...D.querySelectorAll('.finding')].filter(f => f.querySelector('.finding-jump')).map(f => f.getAttribute('data-kind')));
  assert.ok(kinds.length >= 3, `findings with a jump: ${kinds}`);
  for (const kind of kinds) {
    await s.ev(D => D.querySelector('.view-tab[data-view="timeline"]').click());
    await sleep(500);
    await s.mouse(`.finding[data-kind="${kind}"] button`, 'Show on map');
    await s.waitFor(D => D.querySelector('.view-tab[data-view="map"]').classList.contains('active') && D.querySelector('.dg-node.sel'));
    assert.ok(await s.ev(D => !!D.querySelector('.agent-detail')), `${kind}: the agent's detail opens`);
  }
});

test('a session row\'s hover card tells what the session is and where it ran, never the transcript path', T, async () => {
  await openSession();
  await go('.sidebar [aria-label="Search sessions"]', '', D => D.querySelector('.main [role=row] button[aria-label="Analyze this session"]'));
  const tips = await s.ev(D => [...D.querySelectorAll('.main [role=row]:not(.at-head) .at-name')].map(r => r.getAttribute('title') || r.dataset.tip || ''));
  assert.ok(tips.length > 2, 'the list has rows');
  for (const tip of tips) assert.doesNotMatch(tip, /\.jsonl|[\\/]\.claude[\\/]/, `no transcript path: ${tip}`);
  assert.ok(tips.every(t => /^(Session|Headless session|Running now: .+)\n.+\n.+/.test(t)), `each card has a heading, the first prompt and the facts: ${tips[0]}`);
  assert.ok(tips.some(t => /Add the checkout endpoint/.test(t) && /feature\/checkout/.test(t) && /5 agents/.test(t)), 'a session card has its prompt, branch and agents');
});

test('a session page groups Findings and Output style as tabs in one box, and the view legend sits inside the view box', T, async () => {
  await home();
  await go('.overview-tabs .view-tab', 'Last sessions', D => D.querySelector('.overview-tabs .view-tab.active')?.textContent.includes('Last sessions'));
  await go('.main [role=row]', 'Add the checkout endpoint', D => D.querySelector('.finding'));
  assert.deepEqual(await labels('.main .group-label').then(l => l.filter(x => /How the work ran|Review|Delegation/.test(x))), ['How the work ran', 'Review']);
  assert.ok(await s.ev(D => D.querySelector('.view-box > .timeline') && D.querySelector('.view-box > .legend.below')), 'the legend is inside the view box');
  const tabs = () => s.ev(D => [...D.querySelectorAll('.review-box')].length && [...D.querySelectorAll('[aria-label=Review] .view-tab')].map(t => `${t.textContent.trim()}${t.classList.contains('active') ? '*' : ''}`));
  const [findings, style] = await tabs();
  assert.match(findings, /^Findings\d+\*$/, `Findings is the default tab and carries its count: ${findings}`);
  assert.equal(style, 'Output style');
  assert.ok(await s.ev(D => !!D.querySelector('.review-box .finding') && !D.querySelector('.review-box .style-draft')), 'the findings are in the box, Output style is not');
  await s.mouse('[aria-label=Review] .view-tab', 'Output style');
  await s.waitFor(D => D.querySelector('.review-box .style-draft'));
  assert.ok(await s.ev(D => !D.querySelector('.review-box .finding') && !!D.querySelector('.review-box button[data-confirm=draftStyle]') && !!D.querySelector('.review-box .style-model select')), 'Output style holds the Model select and Draft output style');
  assert.equal((await tabs())[1], 'Output style*');
  await s.mouse('[aria-label=Review] .view-tab', 'Findings');
  await s.waitFor(D => D.querySelector('.review-box .finding'));
});

test('every page renders on a narrow panel without sideways scrolling of the page', T, async () => {
  await s.resize(1000, 900);
  try {
    const wide = () => s.ev(D => { const b = D.querySelector('.main-body'); return { sw: b.scrollWidth, cw: b.clientWidth }; });
    await home();
    for (const [name, nav] of [
      ['overview', async () => {}],
      ['skills', async () => s.mouse('.main .overview .tile', 'Skills')],
    ]) {
      await nav();
      await sleep(600);
      const w = await wide();
      assert.ok(w.sw <= w.cw + 1, `${name}: page is ${w.sw}px in ${w.cw}px`);
      await notBlank(name);
    }
    await s.mouse('.main [role=row]', 'release-playbook');
    await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('release-playbook'));
    const w = await wide();
    assert.ok(w.sw <= w.cw + 1, `detail: page is ${w.sw}px in ${w.cw}px`);
  } finally {
    await s.resize();
  }
});

test('light and dark: the panel follows the theme and its text stays above 4.5:1', T, async () => {
  for (const mode of ['dark', 'light']) {
    await s.theme(mode);
    for (const [name, nav] of [
      ['overview', async () => home()],
      ['skills', async () => tile('Skills')],
      ['skill', async () => s.mouse('.main [role=row]', 'release-playbook')],
    ]) {
      await nav();
      await sleep(600);
      const low = await s.ev(contrast, 4.5);
      assert.deepEqual(low, [], `${mode} ${name}: ${JSON.stringify(low.slice(0, 3))}`);
    }
  }
  await s.theme('dark');
});

test('tiles and tabs are keyboard operable: focus a tile, press Enter, the page opens', T, async () => {
  await home();
  await s.ev(D => [...D.querySelectorAll('.main .overview .tile')].find(t => /Agents/.test(t.textContent)).focus());
  await s.chord('Enter');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Agents');
  assert.deepEqual(await s.ev(unfocusable).then(l => l.filter(x => x.where !== 'sidebar')), [], 'nothing in the main area looks clickable and cannot take focus');
});

test('an empty repository and a repository without agents still render a page', T, async () => {
  await home();
  for (const name of ['empty-repo', 'docs-site']) {
    await s.mouse('.sidebar .repo-head', name);
    await s.waitFor((D, name) => D.querySelector('.main-head h1')?.textContent.startsWith(name), name);
    await notBlank(name);
    const tiles = await labels('.main .tile');
    assert.ok(tiles.length >= 12, `${name}: tiles drawn`);
  }
});

test('the Sessions tab of a repo lists its sessions and opens one', T, async () => {
  await home();
  await s.mouse('.sidebar .repo-head', 'shop-web');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'shop-web');
  await s.mouse('.main .view-tab', 'Sessions');
  const rows = await s.waitFor(D => { const r = [...D.querySelectorAll('.main [role=row]')].map(x => x.textContent); return r.length >= 3 && r; });
  assert.ok(rows.some(r => /Build the cart page/.test(r)));
});

test('the Models tab of a repo breaks the last 7 days down by model and agent type', T, async () => {
  await home();
  await s.mouse('.sidebar .repo-head', 'shop-api');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'shop-api');
  await s.mouse('.main .view-tab', 'Models');
  const body = await s.waitFor(D => { const t = D.querySelector('.main-body').innerText; return /BY MODEL/i.test(t) && t; });
  assert.match(body, /opus-5-5/);
  assert.match(body, /haiku-5-5/);
  assert.match(body, /BY AGENT TYPE/i);
  const bars = await s.ev(D => ({ share: D.querySelectorAll('.main-body .wk-share .wk-bar').length, mix: D.querySelectorAll('.main-body .wk-mix').length }));
  assert.ok(bars.share >= 2, `every row shows its share of the cost as a bar, got ${bars.share}`);
  assert.ok(bars.mix >= 2, `every model row shows its token mix as a bar, got ${bars.mix}`);
});

test('the MCP server page says why a server failed and offers Retry', T, async () => {
  await openRow('MCP Servers', 'filesystem');
  const body = await s.waitFor(D => { const t = D.querySelector('.main .cmd-bar').textContent; return /Retry/.test(t) && t; });
  assert.match(body, /Failed|exited with code/);
  assert.equal(await s.ev(D => !!D.querySelector('.main-body .dv-notice')), false, 'the status is in the header bar, not in the info card');
});

// ---- Detail pages and confirm cards: the usability fixes of the 0.4.0 hunt. ----

const type = text => s.ev((D, text) => { const t = D.querySelector('.main textarea'); t.value += text; t.dispatchEvent(new Event('input', { bubbles: true })); }, text);
const switches = () => s.ev(D => [...D.querySelectorAll('.cf .cf-switch')].map(b => b.getAttribute('aria-checked')));
// A test that fails in the middle of an edit must not leave its draft behind: the next page would ask about it.
const dropDraft = async () => {
  try {
    await s.chord('Escape');
    if (await s.ev(D => !!D.querySelector('.main textarea') && !D.querySelector('.main .cmd-bar button[disabled][aria-label="Revert"]'))) {
      await s.mouse('.main .cmd-bar button', 'Revert');
      await s.mouse('.cf button', 'Discard');
    }
  } catch {}
};
const barRows = () => s.ev(D => new Set([...D.querySelectorAll('.cmd-bar .dg-modes')].map(g => Math.round(g.getBoundingClientRect().top))).size);

test('Try it asks in a card with its own switch; Edit, Slim and Try it cards open with Don\'t ask again off', T, async () => {
  await openRow('Skills', 'release-playbook');
  const before = await s.pageEv(() => document.querySelectorAll('.terminal-tab, .terminal-tabs-entry').length);
  for (const [button, title] of [['Try it', /Try release-playbook in Claude/], ['Edit with Claude', /Edit release-playbook with Claude/], ['Slim with Claude', /Slim release-playbook with Claude/]]) {
    await s.mouse('.main button', button);
    const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
    assert.match(c.text, title);
    assert.equal(c.switches, 1, `${button}: the switch is there`);
    assert.deepEqual(await switches(), ['false'], `${button}: Don't ask again starts off`);
    await s.mouse('.cf button', 'Cancel');
    await s.waitFor(D => !D.querySelector('.cf'));
  }
  assert.equal(await s.pageEv(() => document.querySelectorAll('.terminal-tab, .terminal-tabs-entry').length), before, 'Cancel started nothing');
});

test('a skill that comes from a plugin is read-only: no Edit, Rename, Duplicate or Delete, the file and Claude commands stay', T, async () => {
  await home();
  await s.ev(D => { const i = D.querySelector('.overview-search input'); i.value = 'estimate'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await go('.recent .row', 'estimate', D => D.querySelector('.main-head h1')?.textContent === 'estimate');
  await notBlank('plugin skill page');
  const bar = await labels('.main .cmd-bar .view-tab');
  for (const gone of ['View', 'Edit', 'Rename', 'Duplicate', 'Delete', 'Revert', 'Save']) assert.ok(!bar.includes(gone), `${gone} is hidden: ${bar}`);
  for (const kept of ['Open in editor', 'Reveal', 'Edit with Claude', 'Try it']) assert.ok(bar.includes(kept), `${kept} stays: ${bar}`);
  assert.ok(!(await labels('.main .dv-card-head button')).some(t => /Edit/.test(t)), 'the document card has no Edit link');
});

test('View with unsaved edits asks like leaving the page; Revert asks before it drops them', T, async () => {
  const rel = 'skills/api-design/SKILL.md';
  const before = read(rel);
  await openRow('Skills', 'api-design');
  await s.mouse('.main button', 'Edit');
  await s.waitFor(D => D.querySelector('.main textarea'));
  await type(' VIEWTEST');
  await s.mouse('.main .cmd-bar button', 'View');
  const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(c.text, /Save changes to api-design\?/);
  assert.deepEqual(c.buttons, ['Cancel', "Don't Save", 'Save']);
  await s.chord('Escape');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.ok(await s.ev(D => D.querySelector('.main textarea').value.includes('VIEWTEST')), 'Cancel keeps the edit and the form');
  await s.mouse('.main .cmd-bar button', 'Revert');
  const r = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(r.text, /Discard your changes\?/);
  assert.deepEqual(r.buttons, ['Cancel', 'Discard']);
  assert.equal(r.focus, 'Cancel', 'the destructive answer does not hold the focus');
  await s.chord('Escape');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.ok(await s.ev(D => D.querySelector('.main textarea').value.includes('VIEWTEST')), 'Escape keeps the edit');
  await s.mouse('.main .cmd-bar button', 'Revert');
  await s.waitFor(D => D.querySelector('.cf'));
  await s.mouse('.cf button', 'Discard');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.ok(!(await s.ev(D => D.querySelector('.main textarea').value.includes('VIEWTEST'))), 'Discard drops the edit');
  await type(' VIEWTEST2');
  await s.mouse('.main .cmd-bar button', 'View');
  await s.waitFor(D => D.querySelector('.cf'));
  await s.mouse('.cf button', "Don't Save");
  await s.waitFor(D => !D.querySelector('.cf') && !D.querySelector('.main textarea'));
  assert.equal(read(rel), before, "Don't Save leaves the file alone");
  assert.doesNotMatch(await text(), /VIEWTEST/);
});

test('opening another element always lands in View, not in the Edit mode of the one before', T, async () => {
  await openRow('Skills', 'api-design');
  await s.mouse('.main button', 'Edit');
  await s.waitFor(D => D.querySelector('.main textarea'));
  await openRow('Skills', 'azure-deploy');
  assert.ok(await s.ev(D => !D.querySelector('.main textarea')), 'no form on the next element');
  assert.deepEqual(await s.ev(D => [...D.querySelectorAll('.main button.view-tab.active')].map(t => t.textContent.trim())).then(a => a.filter(x => ['View', 'Edit'].includes(x))), ['View']);
});

test('a disabled plugin can be enabled from its command bar, and its checkbox names what it sets', T, async () => {
  await openRow('Plugins', 'old-helper');
  const bar = await labels('.main .cmd-bar .view-tab');
  assert.ok(bar.includes('Enable'), `the command bar has Enable: ${bar}`);
  assert.ok(!bar.includes('Disable'));
  const box = await s.ev(D => { const l = D.querySelector('.dv-switch'); return { text: l.textContent.trim(), checked: l.querySelector('input').checked }; });
  assert.deepEqual(box, { text: 'For your user', checked: false });
  await openRow('Plugins', 'team-tools');
  assert.ok((await labels('.main .cmd-bar .view-tab')).includes('Disable'));
  assert.deepEqual(await s.ev(D => { const l = D.querySelector('.dv-switch'); return { text: l.textContent.trim(), checked: l.querySelector('input').checked }; }), { text: 'For your user', checked: true });
});

test('a failed MCP server is an error: red box with the icon inline, no profile path, red status', T, async () => {
  await openRow('MCP Servers', 'filesystem');
  await s.waitFor(D => D.querySelector('.dv-notice'));
  const n = await s.ev(D => {
    const box = D.querySelector('.dv-notice');
    const icon = box.querySelector('.codicon');
    const text = box.querySelector('.dv-notice-text');
    return { cls: box.className, iconLeft: Math.round(icon.getBoundingClientRect().left - box.getBoundingClientRect().left), iconW: Math.round(icon.getBoundingClientRect().width), gap: Math.round(text.getBoundingClientRect().left - icon.getBoundingClientRect().right), text: text.textContent, wraps: getComputedStyle(text).overflowWrap, tile: box.getAttribute('title') || '' };
  });
  assert.match(n.cls, /\bbad\b/);
  assert.ok(n.iconLeft < 20 && n.iconW < 30 && n.gap < 20, `the icon sits inline: ${JSON.stringify(n)}`);
  assert.equal(n.wraps, 'anywhere');
  assert.doesNotMatch(n.text, /Users\\/i);
  assert.match(n.tile, /Failed to connect/);
});

test('two hooks have two header names, the event and matcher, and the command is in the body', T, async () => {
  const names = [];
  for (const name of ['PreToolUse · Edit', 'Stop']) {
    await openRow('Hooks', name);
    names.push(await text('.main-head h1'));
    assert.match(await text('.main-body'), /start\.js/);
  }
  assert.deepEqual(names, ['PreToolUse · Edit|Write', 'Stop']);
});

test('the command bar stays within two rows at a 640 px page, with every group and the draft box', T, async () => {
  await s.resize(1300, 900);
  try {
    await openRow('Skills', 'api-design');
    await s.mouse('.main button', 'Edit');
    await s.waitFor(D => D.querySelector('.main textarea'));
    await type(' ROWS');
    const w = await s.ev(D => D.querySelector('.main').clientWidth);
    assert.ok(w >= 620 && w <= 680, `the page is about 640 px wide, got ${w}`);
    assert.ok((await barRows()) <= 2, 'two rows at most');
    assert.ok(await s.ev(D => D.querySelector('.main .cmd-bar').classList.contains('icons')), 'a bar that would take more than two rows with its labels shows icons');
    assert.deepEqual(await labels('.main .cmd-bar .dg-modes').then(l => l.length), 5, 'Page, File, Claude, Item and Draft boxes');
    assert.ok(await s.ev(D => [...D.querySelectorAll('.cmd-bar .view-tab')].every(b => b.getAttribute('aria-label'))), 'icon-only buttons keep a name');
    await s.mouse('.main .cmd-bar button', 'Revert');
    await s.waitFor(D => D.querySelector('.cf'));
    await s.mouse('.cf button', 'Discard');
    await s.mouse('.main .cmd-bar button', 'View');
  } finally {
    await dropDraft();
    await s.resize();
  }
});

// The command bar's groups as the names of their buttons, whether its labels show, and the Claude mark of the Claude group.
const barGroups = () =>
  s.ev(D => {
    const bar = D.querySelector('.main .cmd-bar');
    return {
      groups: [...bar.children].map(g => [...g.querySelectorAll('.view-tab')].map(b => b.getAttribute('aria-label'))),
      labels: [...bar.querySelectorAll('.view-tab > span:last-child')].filter(l => getComputedStyle(l).display !== 'none').length,
      buttons: bar.querySelectorAll('.view-tab').length,
      icons: bar.classList.contains('icons'),
      claude: [...(bar.querySelector('.ai-group')?.querySelectorAll('.view-tab') || [])].map(b => b.getAttribute('aria-label')),
      mark: !!bar.querySelector('.ai-group > .ai-mark'),
    };
  });

test('a plugin page has the labelled command bar in the skill page groups, wide and at a 640 px page', T, async () => {
  try {
    for (const width of [undefined, 1300]) {
      await s.resize(width);
      await openRow('Plugins', 'team-tools');
      await notBlank('plugin page');
      const bar = await barGroups();
      assert.deepEqual(bar.groups, [['Back'], ['Open in editor', 'Reveal'], ['Edit with Claude', 'Draw with Claude'], ['Disable', 'Uninstall']], `${width || 'wide'}: Page, File, Claude and Item boxes`);
      assert.ok(!bar.icons && bar.labels === bar.buttons, `${width || 'wide'}: every button shows its label: ${JSON.stringify(bar)}`);
      assert.ok(bar.mark, 'the Claude actions sit in the Claude group');
    }
  } finally {
    await s.resize();
  }
});

// A drawing stored in the extension's storage the way Draw with Claude stores it, keyed by the element's source.
const storeDrawing = (a, svg, pluginDir) => {
  const { contentHash, drawSource, writeDrawing } = createRequire(import.meta.url)(path.join(repoRoot, 'out', 'src', 'drawing.js'));
  writeDrawing(path.join(s.ud, 'User', 'globalStorage', 'integrations-at.claude-harness', 'drawings'), a.id, contentHash(drawSource(a, pluginDir).text), svg);
};
const SVG = name => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 240"><rect x="20" y="20" width="240" height="60" fill="none" stroke="currentColor"/><text x="36" y="56" fill="currentColor">${name}</text></svg>`;

test('agents, commands, workflows, mods, plugins, hooks and MCP servers have Draw with Claude in their Claude group, and a stored drawing of an agent or a plugin shows above its details', T, async () => {
  const both = ['Edit with Claude', 'Draw with Claude'];
  for (const [kind, name, claudeActions] of [['Agents', 'code-reviewer', [...both, 'Try it']], ['Commands', 'review', [...both, 'Try it']], ['Workflows', 'fan-out', both], ['Mods', 'delegation-mod', both], ['Plugins', 'old-helper', both], ['Hooks', 'Stop', ['Draw with Claude']], ['MCP Servers', 'filesystem', ['Draw with Claude']]]) {
    await openRow(kind, name);
    const bar = await barGroups();
    assert.deepEqual(bar.claude, claudeActions, `${kind} ${name}: the Claude group`);
    assert.ok(bar.mark, `${kind} ${name}: the Claude mark leads the group`);
  }
  // Where a drawing does not help there is no Draw, and no Claude group where it would have been the only action.
  for (const [kind, name, claudeActions] of [['Memory', 'CLAUDE.md', []], ['Rules', 'style', ['Edit with Claude']], ['Output Styles', 'terse', ['Edit with Claude']], ['Settings', 'settings.json', []]]) {
    await openRow(kind, name);
    const bar = await barGroups();
    assert.deepEqual(bar.claude, claudeActions, `${kind} ${name}: the Claude actions it had before`);
    assert.equal(bar.mark, claudeActions.length > 0, `${kind} ${name}: a Claude group only with an action in it`);
    assert.ok(await s.ev(D => !D.querySelector('.main .dv-draw')), `${kind} ${name}: no drawing`);
  }
  const team = path.join(claude(), 'plugins', 'cache', 'acme-market', 'team-tools', '1.2.0');
  storeDrawing({ id: 'global|agent:code-reviewer', kind: 'agent', name: 'code-reviewer', file: path.join(claude(), 'agents', 'code-reviewer.md') }, SVG('code-reviewer'));
  storeDrawing({ id: 'global|plugin:team-tools@acme-market', kind: 'plugin', name: 'team-tools@acme-market', file: path.join(claude(), 'settings.json') }, SVG('team-tools'), team);
  for (const [kind, name] of [['Agents', 'code-reviewer'], ['Plugins', 'team-tools']]) {
    await openRow(kind, name);
    const fig = await s.waitFor(D => {
      const f = D.querySelector('.main .dv > figure.dv-draw');
      // Every frame also holds the Harness | Process toggle, so the drawing's text is the svg's.
      return f && { first: f === f.parentElement.firstElementChild, text: f.querySelector('svg').textContent, label: f.querySelector('svg').getAttribute('aria-label'), modes: [...f.querySelectorAll('.dv-persp button')].map(b => b.textContent.trim()), maxWidth: f.querySelector('svg').style.maxWidth };
    });
    assert.ok(fig.first, `${name}: the drawing sits above the details`);
    assert.equal(fig.text, name);
    assert.match(fig.label, new RegExp(name));
    assert.deepEqual(fig.modes, ['Harness', 'Process'], `${name}: both perspectives`);
    assert.equal(fig.maxWidth, '800px', `${name}: never drawn larger than its viewBox`);
    assert.ok((await barGroups()).claude.includes('Redraw with Claude'), `${name}: the button says Redraw`);
  }
  // The card names what Claude gets for a plugin and that it draws twice; Cancel starts nothing.
  await s.mouse('.main .cmd-bar button', 'Redraw with Claude');
  const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(c.text, /Draw team-tools@acme-market with Claude/);
  assert.match(c.text, /manifest/);
  assert.match(c.text, /twice/);
  await closeCard();
  // Edit with Claude reads the plugin's folder, the parts the drawing is made of, not the settings file that enables it.
  await s.mouse('.main .cmd-bar button', 'Edit with Claude');
  const r = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(r.text, /Edit team-tools@acme-market with Claude/);
  assert.match(r.text, /team-tools[\\/]1\.2\.0/);
  assert.doesNotMatch(r.text, /settings\.json/);
  await closeCard();
});

test('hovering or focusing a drawing opens it large in the house hover card, and leaving closes it', T, async () => {
  const team = path.join(claude(), 'plugins', 'cache', 'acme-market', 'team-tools', '1.2.0');
  storeDrawing({ id: 'global|plugin:team-tools@acme-market', kind: 'plugin', name: 'team-tools@acme-market', file: path.join(claude(), 'settings.json') }, SVG('team-tools'), team);
  await openRow('Plugins', 'team-tools');
  await s.waitFor(D => D.querySelector('.main .dv-draw svg'));
  // The page repaints once more when the usage counts arrive; the pointer comes from the title, the way a hand reaches it.
  await sleep(1500);
  await s.move('.main-head h1');
  await s.move('.main .dv-draw');
  const big = await s.waitFor(D => {
    const card = D.querySelector('.tl-hover.show .hc.hc-draw');
    if (!card) return false;
    const small = D.querySelector('.main .dv-draw svg').getBoundingClientRect();
    const large = card.querySelector('svg').getBoundingClientRect();
    const box = D.querySelector('.tl-hover').getBoundingClientRect();
    const fig = D.querySelector('.main .dv-draw').getBoundingClientRect();
    // The figure's svg is drawn at most at its viewBox's size, the card's as wide as the panel allows, so the height says how large it is drawn.
    return { head: card.querySelector('.hc-head').textContent.trim(), text: card.querySelector('svg').textContent, ratio: large.height / small.height, under: box.top >= fig.bottom, inside: box.left >= 0 && box.right <= D.defaultView.innerWidth && box.top >= 0 && box.bottom <= D.defaultView.innerHeight };
  });
  assert.equal(big.head, 'What team-tools@acme-market does');
  assert.equal(big.text, 'team-tools', 'the card shows the same drawing');
  assert.ok(big.ratio > 1.4, `the drawing is larger in the card: ${JSON.stringify(big)}`);
  assert.ok(big.under, `the card opens under the figure: ${JSON.stringify(big)}`);
  assert.ok(big.inside, 'the card stays inside the panel');
  await s.move('.main-head h1');
  await s.waitFor(D => !D.querySelector('.tl-hover.show'));
  // The keyboard reaches it too: focus opens the card, Escape closes it.
  await s.ev(D => (D.defaultView.focus(), D.querySelector('.main .dv-draw').focus()));
  await s.waitFor(D => D.querySelector('.tl-hover.show .hc-draw'));
  await s.chord('Escape');
  await s.waitFor(D => !D.querySelector('.tl-hover.show'));
});

test('a detail page runs its text the full width: the description in paragraphs, the document up to the outline', T, async () => {
  const rel = 'agents/release-manager.md';
  const before = read(rel);
  const long = 'Prepares tags, notes and the publish run for every release of the product. It reads the merged pull requests since the last tag and groups them by area. Then it writes the changelog entry in the house voice and asks before it pushes anything. When a pipeline fails after the tag it rolls the tag back and says which step broke and why.';
  const body = '# Release manager\n\nYou prepare releases from the first version bump to the published notes, one step at a time, and report what you did after each step so the owner can stop you.\n\n## Tags\n\nTag only a green build.\n\n## Notes\n\nWrite the notes in the house voice.\n';
  fs.writeFileSync(path.join(claude(), rel), `${before.split(/\n---\n/)[0].replace(/^description: .*$/m, `description: ${long}`)}\n---\n\n${body}`);
  // Wide enough that the document column passes the old 100ch cap.
  await s.resize(2400, 1000);
  try {
    await openRow('Agents', 'release-manager');
    await s.mouse('.main .view-tab', 'System prompt');
    const r = await s.waitFor(D => {
      const desc = D.querySelector('.main .dv-hero .dv-desc');
      const cols = D.querySelector('.main .dv-hero .dv-cols');
      const p = D.querySelector('.main .dv-main .md-p');
      const side = D.querySelector('.main .dv-side');
      if (!desc || !cols || !p || !side || !/^Prepares tags/.test(desc.textContent)) return false;
      const box = e => e.getBoundingClientRect();
      const card = p.closest('.dv-doc');
      return { paras: desc.querySelectorAll(':scope > p').length, descW: Math.round(box(desc).width), descGap: Math.round(box(cols).right - box(desc).right), pW: Math.round(box(p).width), pGap: Math.round(box(card).right - box(p).right), beforeSide: box(p).right <= box(side).left };
    });
    assert.ok(r.paras >= 2, `the long description reads in paragraphs: ${JSON.stringify(r)}`);
    assert.ok(r.descW > 1200 && Math.abs(r.descGap) <= 2, `the description runs to the right edge of the info card: ${JSON.stringify(r)}`);
    assert.ok(r.pW > 1000 && r.pGap <= 20 && r.beforeSide, `the document's paragraphs run to the card's edge, up to the outline: ${JSON.stringify(r)}`);
  } finally {
    fs.writeFileSync(path.join(claude(), rel), before);
    await s.resize();
  }
});

test('a long path in the page body keeps its file name: the folders take the ellipsis', T, async () => {
  await s.resize(1000, 900);
  try {
    await openRow('Skills', 'release-playbook');
    await s.mouse('.view-tab', 'References');
    await s.waitFor(D => D.querySelector('.path-name'));
    const cut = await s.ev(D => [...D.querySelectorAll('.main-body .path-name')].filter(n => n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > n.closest('.sl-bar-row, .dv-file').getBoundingClientRect().right + 1).map(n => n.textContent));
    assert.deepEqual(cut, []);
    assert.deepEqual(await s.ev(D => [...D.querySelectorAll('.main-body .sl-name')].filter(n => n.scrollWidth > n.clientWidth + 1 && !n.querySelector('.path-dir')).map(n => n.textContent)), []);
  } finally {
    await s.resize();
  }
});

test('the Consolidate card says it in plain words: one story from the button to the action', T, async () => {
  await home();
  await s.ev(D => { const i = D.querySelector('.overview-search input'); i.value = 'commit-helper'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await go('.recent .row', 'shop-api · ', D => /^commit-helper/.test(D.querySelector('.main-head h1')?.textContent) && D.querySelector('.main-head').textContent.includes('shop-api'));
  await s.mouse('.main button', 'Consolidate');
  const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(c.text, /Consolidate commit-helper into Global/);
  assert.match(c.text, /shop-api has the same copy as Global \(1 file\)\./);
  assert.match(c.text, /Retiring it removes the copy in shop-api\. A backup is kept\./);
  assert.ok(c.buttons.includes('Retire repo copy'));
  assert.doesNotMatch(c.text, /holds|source folder on disk|up to where it comes from/);
  await closeCard();
});

test('errors are red and warnings amber: a failed hook run and a failed hook list read as errors', T, async () => {
  await openRow('Hooks', 'PreToolUse · Bash');
  await s.mouse('.view-tab', 'Fired in');
  await s.waitFor(D => [...D.querySelectorAll('.main [role=row]')].some(r => /exit 2/.test(r.textContent)));
  const failed = await s.ev(D => { const c = [...D.querySelectorAll('.main [role=row] .bad')].find(x => /exit 2/.test(x.textContent)); return c ? getComputedStyle(c).color : ''; });
  const err = await s.ev(D => { const p = D.createElement('span'); p.style.color = 'var(--err-text)'; D.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
  assert.ok(failed && failed === err, `the Failed cell uses the error color: ${failed} vs ${err}`);
});

// ---- Bugs found in the walk-through (see the report): each states what the page should do. ----

test('the sidebar rows can be reached and opened with the keyboard', T, async () => {
  await home();
  const bad = await s.ev(unfocusable).then(l => l.filter(x => x.where === 'sidebar'));
  assert.deepEqual(bad, []);
  const shape = await s.ev(D => {
    const items = [...D.querySelectorAll('.sidebar .list [role=treeitem]')];
    const plain = [...D.querySelectorAll('.sidebar .list .section-head, .sidebar .list .repo-head, .sidebar .list .row, .sidebar .list .origin-head')].filter(n => n.getAttribute('role') !== 'treeitem');
    return { tree: D.querySelector('.sidebar .list').getAttribute('role'), items: items.length, plain: plain.length, stops: items.filter(n => n.tabIndex >= 0).length, buttons: items.flatMap(n => [...n.querySelectorAll('button')]).filter(b => b.tabIndex >= 0).length };
  });
  assert.equal(shape.tree, 'tree');
  assert.ok(shape.items >= 10 && shape.plain === 0, `every head and row is a tree item: ${JSON.stringify(shape)}`);
  assert.equal(shape.stops, 1, 'one Tab stop into the tree');
  assert.equal(shape.buttons, 0, 'the buttons of a row are not Tab stops of their own');
  const state = () => s.ev(D => { const a = D.activeElement; return { nav: a.dataset.nav || '', open: a.getAttribute('aria-expanded'), level: a.getAttribute('aria-level'), ring: a.matches(':focus-visible'), outline: getComputedStyle(a).outlineStyle }; });
  const head = 's|global|skill';
  const focusHead = () => s.ev((D, head) => { D.defaultView.focus(); D.querySelector(`[data-nav="${head}"]`).focus(); }, head);
  await focusHead();
  if ((await state()).open === 'true') {
    await s.chord('ArrowLeft');
    await s.waitFor((D, head) => D.activeElement.dataset.nav === head && D.activeElement.getAttribute('aria-expanded') === 'false', head);
  }
  await s.chord('ArrowRight');
  await s.waitFor((D, head) => D.activeElement.dataset.nav === head && D.activeElement.getAttribute('aria-expanded') === 'true', head);
  await s.chord('ArrowRight');
  const first = await state();
  assert.equal(first.level, '2', `Right on an open head moves to its first row: ${JSON.stringify(first)}`);
  assert.ok(first.ring && first.outline !== 'none', 'the focus ring is visible');
  await s.chord('ArrowDown');
  const second = await state();
  assert.ok(second.nav && second.nav !== first.nav && Number(second.level) > Number(first.level), 'Down moves to the next row');
  await s.chord('ArrowUp');
  assert.equal((await state()).nav, first.nav, 'Up moves back');
  await s.chord('ArrowDown');
  await s.chord('ArrowLeft');
  assert.equal((await state()).nav, first.nav, 'Left on a row moves to the head above it');
  await s.chord('ArrowLeft');
  await s.waitFor((D, nav) => D.activeElement.dataset.nav === nav && D.activeElement.getAttribute('aria-expanded') === 'false', first.nav);
  await s.chord('ArrowLeft');
  assert.equal((await state()).nav, head, 'Left on a folded group moves to the section head');
  await s.chord(' ');
  await s.waitFor((D, head) => D.activeElement.dataset.nav === head && D.activeElement.getAttribute('aria-expanded') === 'false', head);
  await s.chord(' ');
  await s.waitFor((D, head) => D.activeElement.dataset.nav === head && D.activeElement.getAttribute('aria-expanded') === 'true', head);
  assert.equal(await s.ev(D => D.querySelectorAll('.main .overview-tabs').length), 1, 'Space only folds: the page stays on the overview');
  await s.chord('ArrowRight');
  await s.chord('ArrowRight');
  await s.waitFor((D, nav) => D.activeElement.dataset.nav === nav && D.activeElement.getAttribute('aria-expanded') === 'true', first.nav);
  await s.chord('ArrowRight');
  const row = await s.ev(D => D.activeElement.querySelector('.name').textContent.trim());
  await s.chord('Enter');
  await s.waitFor((D, row) => D.querySelector('.main-head h1')?.textContent.startsWith(row), row);
  await s.waitFor(D => D.activeElement.classList.contains('row') && D.activeElement.classList.contains('selected'));
  await focusHead();
  await s.chord('Enter');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Skills');
});

test('the sidebar scrolls the opened element into view, unfolding its section', T, async () => {
  await s.resize(1400, 560);
  try {
    for (const name of ['release-playbook', 'webhook-debug']) {
      await home();
      await s.ev(D => D.querySelector('[data-nav="s|global|skill"]').fold());
      await openRow('Skills', name);
      const seen = await s.waitFor(D => {
        const l = D.querySelector('.sidebar .list');
        const row = l.querySelector('.row.selected');
        if (!row) return false;
        const a = row.getBoundingClientRect();
        const b = l.getBoundingClientRect();
        return a.top >= b.top + 30 && a.bottom <= b.bottom ? 'ok' : false;
      });
      assert.equal(seen, 'ok', `${name}: the selected row is visible below the sticky head`);
    }
  } finally {
    await s.resize();
  }
});

test('every row of a type table suppresses the browser menu', T, async () => {
  for (const kind of ['Skills', 'Agents', 'Rules', 'Commands']) {
    await tile(kind);
    const bad = await s.ev(D => [...D.querySelectorAll('.at-row')].filter(r => !JSON.parse(r.getAttribute('data-vscode-context') || '{}').preventDefaultContextMenuItems).length);
    assert.equal(bad, 0, `${kind}: every row carries preventDefaultContextMenuItems`);
  }
});

test('a preset beside the Scope chip says that two filters apply', T, async () => {
  await tile('Skills');
  await s.mouse('.main button.preset', 'Changed this week');
  const label = await s.ev(D => D.querySelector('.filter-bar .filter-on')?.textContent);
  assert.match(label || '', /^2 filters on$/);
  await s.mouse('.main button.preset', 'Changed this week');
});

test('right-clicking a repo row opens the harness menu, never Cut, Copy and Paste', T, async () => {
  await home();
  const ctx = await s.ev(D => JSON.parse(D.querySelector('.sidebar .repo-head').getAttribute('data-vscode-context')));
  assert.equal(ctx.webviewSection, 'repo');
  assert.equal(ctx.preventDefaultContextMenuItems, true);
  const menu = () => s.pageEv(() => [...document.querySelectorAll('.monaco-menu .action-label')].map(e => e.textContent.trim()).filter(Boolean));
  await s.mouse('.sidebar .repo-head', 'shop-api', { button: 'right' });
  let items = [];
  for (let i = 0; i < 20 && !items.length; i++) {
    items = await menu();
    if (!items.length) await sleep(250);
  }
  try {
    assert.ok(items.some(t => /Open Repo/.test(t)), `the repo menu offers Open Repo: ${items}`);
    for (const want of [/Open Claude/, /New/, /Reveal/, /Remove Repo/]) assert.ok(items.some(t => want.test(t)), `the repo menu offers ${want}: ${items}`);
    assert.deepEqual(items.filter(t => /^(Cut|Copy|Paste)$/.test(t)), [], 'no native edit items');
    // Open Repo opens the repo page
    const at = await s.pageEv(() => { const e = [...document.querySelectorAll('.monaco-menu .action-label')].find(x => /Open Repo/.test(x.textContent)); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await s.page.send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
    await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'shop-api');
  } finally {
    if ((await menu()).length) await s.chord('Escape');
  }
});

test('a type page opened from a repo is filtered to that repo only', T, async () => {
  for (const [kind, count] of [['Skills', 4], ['Agents', 2]]) {
    await tile(kind);
    await home();
    await s.mouse('.sidebar .repo-head', 'shop-api');
    await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'shop-api');
    await s.mouse('.main .view-tab', 'Overview');
    await s.mouse('.main .tile', `${count}${kind}`);
    await s.waitFor((D, kind) => D.querySelector('.main-head h1')?.textContent === kind, kind);
    const chips = await s.ev(D => [...D.querySelectorAll('.main button')].map(b => b.textContent.trim()).filter(t => /^Scope:/.test(t)));
    assert.deepEqual(chips, ['Scope: shop-api']);
    const heads = await labels('.main .origin-label');
    assert.ok(heads.every(h => /shop-api/.test(h)), `only the repo's group is listed: ${heads}`);
    const n = Number((/^(\d+) in shop-api/.exec(await text('.main-head .path')) || [])[1]);
    const rows = (await labels('.main [role=row]')).length - (await labels('.main .asset-table')).length;
    assert.equal(rows, n, 'the header counts what is listed');
  }
});

test('Scope: Global hides the plugin group, and the header counts equal the groups', T, async () => {
  await tile('Skills');
  const path = await text('.main-head .path');
  const m = /^(\d+) in Global · (\d+) from plugins · (\d+) in (\d+) scopes?/.exec(path);
  assert.ok(m, `header reads "N in Global · M from plugins · K in S scopes": ${path}`);
  assert.equal((await labels('.main .origin-label')).filter(h => /plugins/i.test(h)).length, 0, 'no plugin group under Scope: Global');
  assert.equal((await labels('.main [role=row]')).length - (await labels('.main .asset-table')).length, Number(m[1]), 'the rows are the Global ones the header counts');
  await s.mouse('.main button', 'Scope: Global');
  await s.waitFor(D => ![...D.querySelectorAll('.main button')].some(b => /^Scope: Global/.test(b.textContent)));
  const plugin = await s.ev(D => [...D.querySelectorAll('.main .origin-label')].find(g => /plugins/i.test(g.textContent))?.textContent.match(/(\d+)$/)[1]);
  assert.equal(Number(plugin), Number(m[2]), 'the plugin group counts what the header says');
});

test('the Repositories table keeps its last column inside the panel at every width', T, async () => {
  await home();
  await s.mouse('.overview-tabs .view-tab', 'Repositories');
  try {
    for (const width of [0, 1200, 1000, 900, 800, 700, 560, 440]) {
      await s.resize(width);
      await sleep(300);
      const r = await s.ev(D => {
        const body = D.querySelector('.main-body').getBoundingClientRect();
        const clipped = [...D.querySelectorAll('.main [role=row]')].filter(r => r.getClientRects().length).flatMap(r => [...r.children]).filter(c => c.getClientRects().length && (c.getBoundingClientRect().right > body.right + 1 || c.scrollWidth > c.clientWidth + 1)).map(c => c.textContent.trim());
        const heads = [...D.querySelectorAll('.main .at-head [role=columnheader]')].filter(c => c.getClientRects().length).map(c => c.textContent.trim());
        return { clipped, heads };
      });
      assert.deepEqual(r.clipped, [], `width ${width || 'default'}: nothing is cut off (${r.heads})`);
      // Cost is a low-priority column: it drops when the panel is too narrow for it, Last session stays.
      assert.ok(r.heads.includes('Last session') && (width && width < 1200 ? true : r.heads.includes('Cost 7d')), `width ${width || 'default'}: Last session stays, Cost at wide widths (${r.heads})`);
    }
  } finally {
    await s.resize();
    await s.mouse('.overview-tabs .view-tab', 'Last sessions');
  }
});

test('Fired in shows the repository name, wide and narrow', T, async () => {
  await openRow('Hooks', 'PreToolUse · Bash');
  await s.mouse('.view-tab', 'Fired in');
  await s.waitFor(D => [...D.querySelectorAll('.main [role=row]')].some(r => /shop-api/.test(r.textContent)));
  const clipped = () => s.ev(D => [...D.querySelectorAll('.main [role=row]')].filter(r => r.getClientRects().length).flatMap(r => [...r.children]).filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent.trim()));
  assert.deepEqual(await clipped(), []);
  const width = await s.ev(D => [...D.querySelectorAll('.main [role=row] .at-cell')].find(c => c.textContent.trim() === 'shop-api').getBoundingClientRect().width);
  assert.ok(width >= 60, `the Repo column is ${width}px`);
  await s.resize(760);
  try {
    assert.deepEqual(await clipped(), [], 'narrow panel');
  } finally {
    await s.resize();
  }
});

test('Description takes the free width in the Agents and Skills tables', T, async () => {
  await s.resize(1900);
  try {
  for (const kind of ['Agents', 'Skills']) {
    await tile(kind);
    const w = await s.ev(D => {
      const head = D.querySelector('.main .at-head');
      const cells = [...head.children];
      const desc = cells.find(c => /Description/i.test(c.textContent));
      const others = cells.filter(c => c !== desc).reduce((n, c) => n + c.getBoundingClientRect().width, 0);
      return { desc: desc.getBoundingClientRect().width, name: cells[0].getBoundingClientRect().width, others, row: head.getBoundingClientRect().width };
    });
    assert.ok(w.desc >= 240 && w.desc >= 1.5 * w.name, `${kind}: Description is ${w.desc}px, Name ${w.name}px, of ${w.row}px`);
  }
  } finally {
    await s.resize();
  }
});

test('light theme: the "708 lines" note and the weekday labels reach 4.5:1', T, async () => {
  await s.theme('light');
  try {
    await openRow('Skills', 'release-playbook');
    await s.mouse('.view-tab', 'Used in');
    await s.waitFor(D => D.querySelector('.us-strip'));
    await sleep(800);
    assert.deepEqual(await s.ev(contrast, 4.5), []);
  } finally {
    await s.theme('dark');
  }
});

test('a path rule in a repo without sessions says so instead of claiming "Never matched"', T, async () => {
  await home();
  await s.mouse('.sidebar .repo-head', 'empty-repo');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('empty-repo'));
  await s.mouse('.main .view-tab', 'Overview');
  await s.mouse('.main .tile', 'Rules');
  await go('.main [role=row]', 'api-only', D => D.querySelector('.main-head h1')?.textContent.startsWith('api-only'));
  await s.mouse('.view-tab', 'Loaded in');
  const body = await s.waitFor(D => { const t = D.querySelector('.main-body').innerText; return /No session has run in/.test(t) && t; });
  assert.doesNotMatch(body, /Never matched/);
  assert.doesNotMatch(body, /Claude never read a file/);
});

test('a path rule in a repo with sessions keeps the "Never matched" marker', T, async () => {
  await tile('Rules');
  await go('.main [role=row]', 'style', D => D.querySelector('.main-head h1')?.textContent.startsWith('style'));
  await s.mouse('.view-tab', 'Loaded in');
  const body = await s.waitFor(D => { const t = D.querySelector('.main-body').innerText; return /Never matched|LOADED IN/i.test(t) && t; });
  assert.ok(body.length > 40);
});

test('the Marketplace page counts one marketplace in the singular', T, async () => {
  await home();
  await s.mouse('.sidebar-head [aria-label="Marketplace health"]');
  const sub = await s.waitFor(D => D.querySelector('.main-head .path')?.textContent);
  assert.doesNotMatch(sub, /^1 marketplaces/);
});

test('the Marketplace page lists the marketplaces on disk first, under their own heading', T, async () => {
  const file = path.join(claude(), 'plugins', 'known_marketplaces.json');
  const before = fs.readFileSync(file, 'utf8');
  const dir = path.join(s.root, 'local-kit-market');
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'local-kit', plugins: [{ name: 'kit', source: './kit', version: '0.1.0' }] }));
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(before), 'local-kit': { source: { source: 'directory', path: dir }, installLocation: dir } }));
  try {
    await home();
    await s.mouse('.sidebar-head [aria-label="Marketplace health"]');
    await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Marketplace health');
    await s.mouse('.main-head [aria-label="Reload"]');
    const order = await s.waitFor(D => {
      const seq = [...D.querySelectorAll('.main-body .market-group, .main-body .market-head .label')].map(e => (e.classList.contains('market-group') ? `#${e.textContent.replace(/\d+$/, '').trim()}` : e.textContent.trim()));
      return seq.includes('local-kit') && seq;
    });
    assert.deepEqual(order.slice(0, 2), ['#Local, on disk', 'local-kit']);
    assert.ok(order.indexOf('acme-market') > order.indexOf('local-kit'), `the GitHub marketplace comes after the local one: ${order}`);
    assert.equal(await s.ev(D => D.querySelector('.main-head .path')?.textContent), '2 marketplaces · 4 plugins not in Cowork');
  } finally {
    fs.writeFileSync(file, before);
  }
});

const unfoldMarkets = () => s.ev(D => { const h = D.querySelector('[data-nav="s|markets"]'); if (h.getAttribute('aria-expanded') !== 'true') h.fold(); return true; });

test('the nav lists its sections in reading order with Marketplaces last above Repositories, and its head has the pages first, then the actions', T, async () => {
  await home();
  assert.deepEqual(await labels('.sidebar .scope-block > .section-head .label'), ['Memory', 'Rules', 'Settings', 'Output Styles', 'Agents', 'Skills', 'Commands', 'Workflows', 'MCP Servers', 'Hooks', 'Mods', 'Plugins', 'Marketplaces']);
  // Cowork is a region of its own after the Code tree, before Repositories.
  assert.deepEqual(await s.ev(D => [...D.querySelectorAll('.sidebar .list [data-region]')].map(h => `${h.dataset.region}:${h.querySelector('.label').textContent}`)), ['code:Claude Code', 'cowork:Cowork', 'repos:Repositories']);
  assert.deepEqual(await s.ev(D => [...D.querySelectorAll('.sidebar-head button')].map(b => b.getAttribute('aria-label'))), ['Overview', 'Marketplace health', 'Collapse all', 'New...', 'Refresh']);
  // The Marketplaces head counts the marketplaces and opens Marketplace health, the way a global head opens its type page.
  await s.waitFor(D => D.querySelector('[data-nav="s|markets"] .count')?.textContent === '1');
  await go('.sidebar [data-nav="s|markets"]', '', D => D.querySelector('.main-head h1')?.textContent === 'Marketplace health');
  await unfoldMarkets();
  assert.deepEqual(await labels('.sidebar .scope-block .row[data-nav^="k|"] .name'), ['acme-market']);
});

test('a marketplace row opens its page: the head counts its plugins, Draw with Claude asks in a card, a stored drawing shows with both perspectives, and a plugin row comes back to it', T, async () => {
  await home();
  await unfoldMarkets();
  await go('.sidebar [data-nav="k|acme-market"]', '', D => D.querySelector('.main-head h1')?.textContent === 'acme-market');
  const head = await s.waitFor(D => D.querySelector('.main-head .toolbar > .ai-group') && {
    sub: D.querySelector('.main-head .path').textContent,
    glyph: !!D.querySelector('.main-head .big .codicon-package'),
    ai: [...D.querySelectorAll('.main-head .toolbar > .ai-group button')].map(b => b.textContent.trim()),
    mark: !!D.querySelector('.main-head .toolbar > .ai-group > .ai-mark'),
    selected: D.querySelector('.sidebar .row.selected')?.dataset.nav,
  });
  assert.deepEqual(head, { sub: '3 plugins · 3 installed · 2 enabled · 3 plugins not in Cowork', glyph: true, ai: ['Draw with Claude'], mark: true, selected: 'k|acme-market' });
  assert.deepEqual(await labels('.main-body .at-row:not(.at-head) .at-label'), ['delegation-mod', 'Code', 'old-helper', 'Code', 'team-tools', 'Code']);
  // Draw asks first and names both drawings; Cancel starts nothing.
  await s.mouse('.main-head .ai-group button', 'Draw with Claude');
  const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
  assert.match(c.text, /Draw acme-market with Claude/);
  assert.match(c.text, /twice/);
  await closeCard();
  // A stored drawing shows above the plugins, with the Harness | Process toggle; an attribute Claude wrote twice does not keep it out.
  const req = createRequire(import.meta.url);
  const { contentHash, marketText, writeDrawing } = req(path.join(repoRoot, 'out', 'src', 'drawing.js'));
  const { marketplaceHealth } = req(path.join(repoRoot, 'out', 'src', 'fleet.js'));
  const market = marketplaceHealth(claude()).find(m => m.name === 'acme-market');
  writeDrawing(path.join(s.ud, 'User', 'globalStorage', 'integrations-at.claude-harness', 'drawings'), 'market:acme-market', contentHash(marketText(market.plugins)), SVG('acme-market').replace('fill="none"', 'fill="none" fill="none"'));
  await s.mouse('.sidebar [data-nav="k|acme-market"]');
  const fig = await s.waitFor(D => {
    const f = D.querySelector('.main .market-page > figure.dv-draw');
    return f && f.querySelector('svg') && { text: f.querySelector('svg').textContent, label: f.querySelector('svg').getAttribute('aria-label'), modes: [...f.querySelectorAll('.dv-persp button')].map(b => b.textContent.trim()) };
  });
  assert.deepEqual(fig, { text: 'acme-market', label: 'What acme-market offers', modes: ['Harness', 'Process'] });
  assert.deepEqual(await s.ev(D => [...D.querySelectorAll('.main-head .ai-group button')].map(b => b.textContent.trim())), ['Redraw with Claude']);
  // A plugin row opens the plugin's page, whose Back returns to the marketplace.
  await go('.main-body .at-row', 'team-tools', D => D.querySelector('.main-head h1')?.textContent.startsWith('team-tools'));
  await go('.main .cmd-bar button', 'Back', D => D.querySelector('.main-head h1')?.textContent === 'acme-market');
});

test('a marketplace heading on the Plugins page opens that marketplace, and its Back returns to the Plugins page', T, async () => {
  // A second marketplace with an enabled plugin, so the Plugins page has a heading per marketplace.
  const file = path.join(claude(), 'plugins', 'known_marketplaces.json');
  const settings = path.join(claude(), 'settings.json');
  const before = [fs.readFileSync(file, 'utf8'), fs.readFileSync(settings, 'utf8')];
  const dir = path.join(s.root, 'local-kit-market');
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'local-kit', plugins: [{ name: 'kit', source: './kit', version: '0.1.0', description: 'The local kit' }] }));
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(before[0]), 'local-kit': { source: { source: 'directory', path: dir }, installLocation: dir } }));
  const old = JSON.parse(before[1]);
  fs.writeFileSync(settings, JSON.stringify({ ...old, enabledPlugins: { ...old.enabledPlugins, 'kit@local-kit': true } }, null, 2));
  try {
    await tile('Plugins');
    const heads = await s.waitFor(D => { const l = [...D.querySelectorAll('.main .origin-label .group-open')].map(b => b.textContent); return l.includes('local-kit') && l; });
    assert.deepEqual(heads, ['acme-market', 'local-kit']);
    await go('.main .origin-label .group-open', 'local-kit', D => D.querySelector('.main-head h1')?.textContent === 'local-kit');
    assert.equal(await s.waitFor(D => D.querySelector('.main-body .at-row:not(.at-head)') && D.querySelector('.main-head .path').textContent), '1 plugin · 1 enabled · 1 plugin not in Cowork');
    await go('.main-head .toolbar button', 'Back to Plugins', D => D.querySelector('.main-head h1')?.textContent === 'Plugins');
  } finally {
    fs.writeFileSync(file, before[0]);
    fs.writeFileSync(settings, before[1]);
  }
});

test('a marketplace page shows each plugin with its Harness state, and a Code only plugin offers Add to Cowork', T, async () => {
  await home();
  await unfoldMarkets();
  await go('.sidebar [data-nav="k|acme-market"]', '', D => D.querySelector('.main-head h1')?.textContent === 'acme-market');
  const heads = await s.waitFor(D => { const h = [...D.querySelectorAll('.main-body .at-head > *')].map(e => e.textContent.trim()); return h.includes('Harness') && h; });
  assert.ok(heads.includes('Harness'), `the Harness column: ${heads}`);
  const rows = await s.ev(D => [...D.querySelectorAll('.main-body .at-row:not(.at-head)')].map(r => ({ add: [...r.querySelectorAll('button')].some(b => b.textContent.trim() === 'Add to Cowork'), text: r.textContent })));
  assert.equal(rows.length, 3);
  for (const r of rows) assert.ok(r.add && /Code/.test(r.text), `a Code only plugin carries Add to Cowork: ${r.text}`);
});

test('a marketplace with plugins ahead offers one Sync button whose card lists them, the AI group stays last, and Cancel runs nothing', T, async () => {
  const file = path.join(claude(), 'plugins', 'marketplaces', 'acme-market', '.claude-plugin', 'marketplace.json');
  const before = fs.readFileSync(file, 'utf8');
  const catalog = JSON.parse(before);
  fs.writeFileSync(file, JSON.stringify({ ...catalog, plugins: catalog.plugins.map(p => (p.name === 'old-helper' ? p : { ...p, version: '9.0.0' })) }));
  try {
    await home();
    await unfoldMarkets();
    await go('.sidebar [data-nav="k|acme-market"]', '', D => D.querySelector('.main-head h1')?.textContent === 'acme-market');
    await s.mouse('.main-head [aria-label="Reload"]');
    const label = await s.waitFor(D => [...D.querySelectorAll('.main-head .toolbar > button')].map(b => b.textContent.trim()).find(t => t.startsWith('Sync')));
    assert.equal(label, 'Sync 2 plugins');
    assert.ok(await s.ev(D => D.querySelector('.main-head .toolbar').lastElementChild.classList.contains('ai-group')), 'the AI group stays last');
    await s.mouse('.main-head .toolbar > button', 'Sync 2 plugins');
    const c = await s.waitFor(D => !!D.querySelector('.cf')).then(card);
    assert.match(c.text, /Sync 2 plugins from acme-market/);
    assert.match(c.text, /delegation-mod: 0\.4\.0 to 9\.0\.0/);
    assert.match(c.text, /team-tools: 1\.2\.0 to 9\.0\.0/);
    assert.ok(c.buttons.includes('Sync 2 plugins'), `the card's action: ${c.buttons}`);
    await closeCard();
    // One Sync column: Sync all in its header, Sync plugin on a plugin that is ahead, where it stands on the others.
    const table = await s.ev(D => {
      const heads = [...D.querySelectorAll('.market-page .at-head > span')];
      const at = heads.findIndex(h => h.querySelector('button'));
      return { heads: heads.map(h => h.textContent.trim()), at, cells: [...D.querySelectorAll('.market-page .at-row:not(.at-head)')].map(r => `${r.querySelector('.at-label').textContent}:${r.children[at]?.textContent.trim()}`) };
    });
    assert.deepEqual(table.heads.slice(-1), ['Sync all'], `the last column is Sync, headed by Sync all: ${table.heads}`);
    assert.deepEqual(table.cells.sort(), ['delegation-mod:Sync plugin', 'old-helper:current', 'team-tools:Sync plugin']);
    await s.mouse('.market-page .at-head button', 'Sync all');
    assert.match((await s.waitFor(D => !!D.querySelector('.cf')).then(card)).text, /Sync 2 plugins from acme-market/);
    await closeCard();
    assert.match(read('plugins/installed_plugins.json'), /"version": ?"1\.2\.0"/, 'Cancel updated nothing');
  } finally {
    fs.writeFileSync(file, before);
    await s.mouse('.main-head [aria-label="Reload"]').catch(() => {});
  }
});

// Every bar that holds an AI group, with where the group sits: last means every other item of the bar is on an earlier line or to
// its left, flush means its right edge is the bar's.
const aiBars = () =>
  s.ev(D =>
    [...D.querySelectorAll('.toolbar > .ai-group, .cmd-bar > .ai-group, .cmd-row > .ai-group, .dg-bar > .ai-group, .style-draft > .ai-group, .cp-actions > .ai-group, .std-actions > .ai-group, .hunt-ask-actions > .ai-group, .overview-tabs > .ai-group')]
      .filter(g => g.getClientRects().length)
      .map(g => {
        const r = g.getBoundingClientRect();
        const bar = g.parentElement;
        const cs = getComputedStyle(bar);
        const b = bar.getBoundingClientRect();
        const others = [...bar.children].filter(c => c !== g && c.getClientRects().length);
        return {
          bar: bar.className,
          last: others.every(c => { const o = c.getBoundingClientRect(); return o.bottom <= r.top + 1 || o.right <= r.left + 1; }),
          flush: Math.abs(b.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) - r.right) <= 2,
        };
      })
  );

test('every bar keeps its AI group last and at its right end: overview, Plugins, a plugin, a repo and a session', T, async () => {
  const check = async (where, need) => {
    const bars = await aiBars();
    if (need) assert.ok(bars.length, `${where}: a bar with an AI group`);
    for (const b of bars) assert.ok(b.last && b.flush, `${where}: ${JSON.stringify(b)}`);
  };
  await home();
  await check('overview');
  await tile('Plugins');
  await s.waitFor(D => D.querySelector('.main-head .toolbar > .ai-group'));
  await check('Plugins', true);
  await openRow('Plugins', 'team-tools');
  await check('team-tools', true);
  for (const width of [760, 0]) {
    await s.resize(width);
    await check(`team-tools at ${width || 'full'} width`, true);
  }
  await home();
  await go('.sidebar .repo-head', 'shop-api', D => D.querySelector('.main-head h1')?.textContent === 'shop-api');
  await check('shop-api');
  await openSession();
  await check('session');
});

test('the GitHub Repo overview shows 0 or a dash in every cell, never a blank one', T, async () => {
  await home();
  // The nav has no button for this page now (the head's GitHub button became Collapse all); the Show Fleet command reaches it with this message.
  await s.resize(1500);
  await s.ev(D => D.defaultView.postMessage({ type: 'page', page: 'fleet' }, '*'));
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'GitHub Repo overview');
  const cells = await s.waitFor(D => {
    const rows = [...D.querySelectorAll('.main [role=row]:not(.at-head)')].filter(r => r.getClientRects().length);
    return rows.length > 1 && rows.map(r => [...r.children].filter(c => c.getClientRects().length).map(c => c.textContent.trim()));
  });
  for (const row of cells) for (const c of row) assert.notEqual(c, '', `a blank cell in ${JSON.stringify(row)}`);
  const heads = await labels('.main .at-head [role=columnheader]');
  const at = heads.indexOf('Hook copies');
  assert.ok(at > 0, `the Hook copies column exists: ${heads}`);
  for (const row of cells) assert.match(row[at], /^(\d+|-)$/);
  assert.deepEqual(heads.slice(0, 2), ['Repo', 'Lines'], `the first columns of the table: ${heads}`);
});

test('a switched-off MCP server says so and offers neither Sign in nor Retry', T, async () => {
  await openRow('MCP Servers', 'filesystem');
  await s.waitFor(D => D.querySelector('.dv-notice'));
  assert.match(await s.ev(D => D.querySelector('.main .cmd-bar').textContent), /Retry/, 'a failed server that is on offers Retry');
  const off = () => s.mouse('.dv-switch input');
  await off();
  try {
    const body = await s.waitFor(D => { const t = D.querySelector('.main').innerText; return /Switched off/.test(t) && t; });
    assert.doesNotMatch(await s.ev(D => D.querySelector('.main .cmd-bar').textContent), /Sign in|Retry/);
    assert.doesNotMatch(body, /Needs sign-in/);
    assert.equal(await s.ev(D => D.querySelectorAll('.dv-notice.bad').length), 0, 'no error box for a server that is off');
  } finally {
    await off();
    await s.waitFor(D => !/Switched off/.test(D.querySelector('.main').innerText));
  }
});

test('a server that needs a sign-in reads "Needs sign-in" and "Unknown", and Retry says it checked again', T, async () => {
  const http = await import('node:http');
  const server = http.createServer((q, r) => { r.statusCode = 401; r.end('unauthorized'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const file = path.join(s.fixture.home, '.claude.json');
  const before = fs.readFileSync(file, 'utf8');
  const j = JSON.parse(before);
  j.mcpServers.docs.url = `http://127.0.0.1:${server.address().port}/mcp`;
  fs.writeFileSync(file, JSON.stringify(j));
  try {
    await s.mouse('.sidebar-head [aria-label="Refresh"]');
    await openRow('MCP Servers', 'docs');
    const body = await s.waitFor(D => { const t = D.querySelector('.main').textContent; return /Sign in/.test(t) && t; });
    assert.match(body, /Needs sign-in/);
    assert.equal(await s.ev(D => { const g = D.querySelector('.main .cmd-bar > .ai-group'); const st = D.querySelector('.main .cmd-bar > .cmd-status'); if (!g || !st || !/Sign in/.test(g.textContent) || D.querySelector('.main-body .dv-notice')) return false; const b = D.querySelector('.main .cmd-bar').getBoundingClientRect(), gr = g.getBoundingClientRect(), sr = st.getBoundingClientRect(); /* the AI group ends the bar; the status is left of it on the same row, or on a row above it when the bar wraps */ return Math.abs(gr.right - b.right) <= 2 && (sr.right <= gr.left + 1 || sr.bottom <= gr.top + 1 || sr.top >= gr.bottom - 1); }), true, 'the status sits in the header bar, Sign in in its AI group at the right end');
    assert.match(body, /Unknown/);
    assert.match(body, /until you sign in/);
    assert.doesNotMatch(await s.ev(D => [...D.querySelectorAll('.dv-stats .tile .n')].map(n => n.textContent).join('|')), /^-|\|-\||\.\.\./);
    await s.mouse('.cmd-status button', 'Retry');
    await s.waitFor(D => /Checked again/.test(D.querySelector('.dv-notice-text')?.textContent || ''));
  } finally {
    fs.writeFileSync(file, before);
    server.close();
  }
});

test('plurals: one key, one marketplace, one word', T, async () => {
  await home();
  const all = await s.ev(D => D.querySelector('.sidebar').innerText + D.querySelector('.main').innerText);
  assert.doesNotMatch(all, /\b1 (keys|marketplaces|words|folders|agents|tools|prompts)\b/);
});

test('the Models tab names the scope of each group', T, async () => {
  await home();
  await s.mouse('.sidebar .repo-head', 'shop-api');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'shop-api');
  await s.mouse('.main .view-tab', 'Models');
  const body = await s.waitFor(D => { const t = D.querySelector('.main-body').innerText; return /BY MODEL/i.test(t) && t; });
  assert.match(body, /\bREPO\b[\s\S]*shop-api/i, 'a Repo table with this repo');
  assert.match(body, /BY AGENT TYPE/i);
  // The scope of each group is in its hover card.
  const tips = await s.ev(D => [...D.querySelectorAll('.main-body .group-label')].map(g => `${g.textContent.trim()}|${g.getAttribute('title') || ''}`));
  assert.ok(tips.some(t => /^By model\|Every repo on this account/.test(t)), `By model names its scope: ${tips}`);
  assert.ok(tips.some(t => /^By agent type\|.*every repo on this account/.test(t)), `By agent type names its scope: ${tips}`);
});

// The last test: it opens a file in the editor, which puts the panel behind the editor tab.
test('Configure Tools appears on an agent file although VS Code calls its language Agent', T, async () => {
  await s.chord('p', { ctrl: true });
  await s.page.send('Input.insertText', { text: path.join(claude(), 'agents', 'code-reviewer.md') });
  await sleep(1200);
  for (const type of ['rawKeyDown', 'keyUp']) await s.page.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  let lenses = [];
  for (let i = 0; i < 30 && !lenses.includes('Configure Tools...'); i++) {
    await sleep(500);
    lenses = await s.pageEv(() => [...document.querySelectorAll('.codelens-decoration')].map(e => e.innerText.trim()));
  }
  const language = await s.pageEv(() => (document.querySelector('.statusbar-item[id*="editor.language"], .editor-status-mode')?.textContent || '').trim());
  try {
    assert.ok(lenses.includes('Configure Tools...'), `the lens shows on the agent file (language "${language}"): ${JSON.stringify(lenses)}`);
  } finally {
    // Close the editor so the panel is the visible tab again for whatever test follows.
    await s.chord('Escape');
    await s.chord('w', { ctrl: true });
  }
});

// ---- Hover cards, the left nav at narrow widths, the home search ----

const shown = () => s.ev(D => [...D.querySelectorAll('.tl-hover.show')].map(h => { const r = h.getBoundingClientRect(); return { text: h.innerText.slice(0, 40), left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }));

test('a hover card goes on Escape, on leaving, on scrolling and on a click, and does not come back over what was clicked', T, async () => {
  await home();
  const focusPanel = () => s.ev(D => D.defaultView.focus());
  const card = async () => s.waitFor(D => D.querySelector('.tl-hover.show') && 'shown');
  const gone = async what => {
    for (let i = 0; i < 8; i++) {
      await sleep(150);
      assert.deepEqual(await shown(), [], `${what}: no card`);
    }
  };
  // Escape
  await s.move('.overview-tabs .view-tab', 'Repositories');
  await card();
  await focusPanel();
  await s.chord('Escape');
  await gone('Escape');
  // leaving the tab
  await s.move('.main-head h1');
  await s.move('.overview-tabs .view-tab', 'Repositories');
  await card();
  await s.move('.main-head h1');
  await gone('leaving');
  // scrolling
  await s.move('.overview-tabs .view-tab', 'Repositories');
  await card();
  const at = await s.where('.overview-tabs .view-tab', 'Repositories');
  await s.page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: 120 });
  await gone('scrolling');
  // a click on a home tab: the card is gone and does not reopen over the search box
  await s.move('.main-head h1');
  await s.move('.overview-tabs .view-tab', 'Repositories');
  await card();
  await s.mouse('.overview-tabs .view-tab', 'Repositories');
  await gone('after a click on a home tab');
  assert.equal(await s.ev(D => D.querySelector('.overview-tabs .view-tab.active').textContent.includes('Repositories')), true, 'the click switched the tab');
  // leaving and coming back opens the card again, and it does not sit on its own tab
  await s.move('.main-head h1');
  await s.move('.overview-tabs .view-tab', 'Last sessions');
  await card();
  const c = (await shown())[0];
  const t2 = await s.ev(D => { const r = [...D.querySelectorAll('.overview-tabs .view-tab')].find(x => x.textContent.includes('Last sessions')).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  assert.ok(c.top >= t2.bottom - 8 || c.bottom <= t2.top + 8, `the card does not sit on its own tab: ${JSON.stringify([c, t2])}`);
  await s.mouse('.overview-tabs .view-tab', 'Last sessions');
  await gone('after the click back');
});

test('a tab card on the Fired in tab goes on a click and never covers the tab', T, async () => {
  await openRow('Hooks', 'PreToolUse · Bash');
  await s.move('.main-head h1');
  await s.move('.view-tab', 'Fired in');
  await s.waitFor(D => D.querySelector('.tl-hover.show') && 'shown');
  const tab = await s.ev(D => { const r = [...D.querySelectorAll('.view-tab')].find(x => x.textContent.includes('Fired in')).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  const c = (await shown())[0];
  assert.ok(c.top >= tab.bottom - 8 || c.bottom <= tab.top + 8, `the card stays off its tab: ${JSON.stringify([c, tab])}`);
  await s.mouse('.view-tab', 'Fired in');
  await s.waitFor(D => [...D.querySelectorAll('.main [role=row]')].some(r => /shop-api/.test(r.textContent)));
  for (let i = 0; i < 6; i++) {
    assert.deepEqual(await shown(), [], 'no card after the click');
    await sleep(150);
  }
});

test('every section head of the nav stays on one line, the MCP one included', T, async () => {
  await home();
  await s.ev(D => { const h = D.querySelector('[data-nav="s|global|mcp"]'); if (h.getAttribute('aria-expanded') !== 'true') h.fold(); });
  await s.waitFor(D => D.querySelector('[data-nav="s|global|mcp"]').getAttribute('aria-expanded') === 'true');
  try {
    for (const width of [0, 760]) {
      await s.resize(width);
      const heads = await s.ev(D => [...D.querySelectorAll('.sidebar .section-head')].filter(h => h.getClientRects().length).map(h => { const l = h.querySelector('.label'); const b = h.getBoundingClientRect(); return { label: l.textContent, h: Math.round(b.height), lh: Math.round(l.getBoundingClientRect().height), over: h.scrollWidth > h.clientWidth + 1 }; }));
      assert.ok(heads.some(h => /MCP/.test(h.label)), 'the MCP head is listed');
      for (const h of heads) assert.ok(h.lh <= 20 && h.h <= 31 && !h.over, `${h.label} is one line at width ${width || 'default'}: ${JSON.stringify(h)}`);
    }
    // the many view modes of the MCP head sit in a menu that works; the nav scrolls to the top first, so the head is not stuck
    // under the sticky head of an open section below it (Hooks)
    await s.ev(D => { D.querySelector('.sidebar .list').scrollTop = 0; return true; });
    await s.mouse('[data-nav="s|global|mcp"] button', 'View');
    await s.waitFor(D => D.querySelector('.nav-menu [role=menuitemradio]') && 'open');
    const modes = await labels('.nav-menu button');
    assert.ok(modes.length >= 4, `the menu lists the modes: ${modes}`);
    await s.chord('Escape');
  } finally {
    await s.resize();
    await s.ev(D => { D.querySelector('.nav-menu')?.remove(); });
  }
});

test('a narrow or zoomed panel keeps the nav tall enough to use, with its own scroll, and the page below it', T, async () => {
  await home();
  await s.ev(D => { const h = D.querySelector('[data-nav="s|global|skill"]'); if (h.getAttribute('aria-expanded') !== 'true') h.fold(); });
  try {
    for (const [w, h] of [[600, 640], [520, 480], [440, 420]]) {
      await s.resize(w, h);
      const r = await s.ev(D => {
        const sb = D.querySelector('.sidebar').getBoundingClientRect();
        const l = D.querySelector('.sidebar .list');
        const m = D.querySelector('.main').getBoundingClientRect();
        return { sidebar: Math.round(sb.height), list: l.clientHeight, scrolls: getComputedStyle(l).overflowY, mainTop: Math.round(m.top), mainH: Math.round(m.height) };
      });
      assert.ok(r.sidebar >= 180, `${w}x${h}: the sidebar keeps a minimum height ${JSON.stringify(r)}`);
      assert.ok(r.list >= 80, `${w}x${h}: the list shows more than one row ${JSON.stringify(r)}`);
      assert.equal(r.scrolls, 'auto', 'the list scrolls on its own');
      assert.ok(r.mainH >= 100 && r.mainTop >= r.sidebar - 2, `${w}x${h}: the page gets the rest below the nav ${JSON.stringify(r)}`);
    }
  } finally {
    await s.resize();
  }
});

test('Home opens the overview with the search cleared; Back from a result keeps the search', T, async () => {
  await home();
  const search = q => s.ev((D, q) => { const i = D.querySelector('.overview-search input'); i.focus(); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); }, q);
  await search('checkout');
  await s.waitFor(D => D.querySelector('.recent .row') && 'rows');
  await s.mouse('.recent .row', 'shop-checkout');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.startsWith('shop-checkout'));
  await s.mouse('.cmd-bar button', 'Back');
  await s.waitFor(D => D.querySelector('.overview-search input')?.value === 'checkout');
  assert.ok(await s.ev(D => D.querySelector('.recent .row')?.getClientRects().length > 0), 'the results are still listed');
  await s.mouse('.sidebar-head [aria-label="Overview"]');
  await s.waitFor(D => D.querySelector('.overview-search input')?.value === '' && D.querySelector('.overview-tabs')?.getClientRects().length > 0);
});

// The owner, 2026-10-28: "a click on here ... does not get me to details ... fix this defect for all harness items". A row
// pressed while the host's answer to a refresh came in opened nothing: the repaint replaced the row between press and release,
// and the browser sends no click then. The row is pressed, Refresh runs, and the button is released only once the new state
// has arrived, `hold` ms later: a slow hand, or a host slow to answer (a 2 s limit on holding back the repaint made this test
// fail once in a loaded run); no retry.
const pressAcrossRefresh = async (selector, name, hold = 0) => {
  const at = await s.where(selector, name);
  // What lies under the pointer, for the failure message: the row itself, or something drawn over it.
  const under = await s.ev(
    (D, selector, name) => {
      const row = [...D.querySelectorAll(selector)].find(e => e.getClientRects().length && e.textContent.includes(name));
      const r = row.getBoundingClientRect();
      const hit = D.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return row.contains(hit) ? 'the row' : `${hit?.tagName}.${String(hit?.className).slice(0, 40)}`;
    },
    selector,
    name
  );
  await s.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await s.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await s.ev(D => {
    const w = D.defaultView;
    w.__statesSeen = 0;
    w.__afterPress = [];
    w.__events = [];
    if (!w.__countsStates) {
      w.__countsStates = true;
      w.addEventListener('message', e => {
        if (e.data?.type === 'state') w.__statesSeen++;
        w.__afterPress?.push(e.data?.type === 'detail' ? `detail:${e.data.detail ? e.data.detail.asset.name : 'none'}${e.data.external ? ':external' : ''}` : e.data?.type);
      });
      for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'])
        w.addEventListener(t, e => w.__events?.push(`${t}@${e.target?.tagName}.${String(e.target?.className).slice(0, 20)}${e.target?.isConnected ? '' : '(detached)'}`), true);
    }
    D.querySelector('.sidebar-head [aria-label="Refresh"]').click();
    return true;
  });
  await s.waitFor(D => D.defaultView.__statesSeen > 0);
  await sleep(hold);
  await s.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  return under;
};
const opensDetail = async (what, name, under) => {
  const keep = s.waitMs;
  s.waitMs = 5000;
  try {
    await s.waitFor((D, name) => D.querySelector('.detail-head .dh-name')?.textContent.startsWith(name), name);
  } catch {
    const seen = await s.ev(D => ({
      page: D.querySelector('.main-head')?.textContent.trim().slice(0, 40),
      card: !!D.querySelector('.cf'),
      hover: !!D.querySelector('.tl-hover.show'),
      messages: (D.defaultView.__afterPress || []).join(','),
      events: (D.defaultView.__events || []).join(' '),
    }));
    assert.fail(`${what}: pressing ${name} while the panel repainted opened no detail page; under the pointer: ${under}; ${JSON.stringify(seen)}`);
  } finally {
    s.waitMs = keep;
  }
};

test('a row pressed while the panel repaints opens its detail page, on the type page of every kind and in the sidebar', T, async () => {
  const kinds = ['Memory', 'Rules', 'Agents', 'Skills', 'Commands', 'Output Styles', 'Workflows', 'Hooks', 'Mods', 'MCP Servers', 'Plugins', 'Settings'];
  const row = '.kind-results [role=row]:not(.at-head)';
  for (const kind of kinds) {
    await tile(kind);
    // A kind with nothing in Global lists every scope: Escape in the empty search clears the Scope filter.
    if (!(await s.ev((D, row) => !!D.querySelector(row), row)))
      await s.ev(D => {
        const input = D.querySelector('#kind-search');
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      });
    const name = await s.waitFor((D, row) => D.querySelector(`${row} .at-label`)?.textContent, row);
    // The first kind keeps the button down 2.5 s after the repaint came in.
    await opensDetail(`${kind} type page`, name, await pressAcrossRefresh(row, name, kind === kinds[0] ? 2500 : 0));
  }
  // The sidebar: the global Skills section unfolded (its head also opens the type page), then its first row.
  await home();
  await s.ev(D => {
    const head = [...D.querySelectorAll('.sidebar .scope-block .section-head')].find(h => h.querySelector('.label')?.textContent === 'Skills');
    if (head.getAttribute('aria-expanded') === 'false') head.click();
    return true;
  });
  const nav = await s.waitFor(D => D.querySelector('.sidebar .scope-block .row[data-nav*="|skill:"] .name')?.textContent);
  await opensDetail('sidebar', nav, await pressAcrossRefresh('.sidebar .scope-block .row[data-nav*="|skill:"]', nav));
});

// The owner, 2026-10-29: "when clicking in left nav for example on plugins sometimes the webview details do not respond ... if
// users load this extension and then a details click does not work they dont wait". The overview asks for the sessions of every
// repo the moment the panel opens, and the host read them one after the other on the thread that also answers a click: a click
// right after the panel opened waited behind all of them (seconds on a harness with many transcripts). The repos get a few
// hundred transcripts each, the panel is closed and opened again (a cold read), and a nav row is pressed at once.
test('a nav row pressed right after the panel opens shows its details promptly while the host reads every repo\'s sessions', T, async t => {
  const projects = path.join(claude(), 'projects');
  const { projectSlug } = createRequire(import.meta.url)(path.join(repoRoot, 'out', 'src', 'fleet.js'));
  const filler = JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(900) }] } });
  const made = [];
  for (const dir of s.fixture.repos) {
    const folder = path.join(projects, projectSlug(dir));
    fs.mkdirSync(folder, { recursive: true });
    for (let i = 0; i < 150; i++) {
      const id = `99999999-0000-4000-8000-${String(made.length).padStart(12, '0')}`;
      const first = JSON.stringify({ type: 'user', uuid: id, timestamp: new Date(Date.now() - 3600000 - i * 1000).toISOString(), cwd: dir, sessionId: id, message: { role: 'user', content: `Heavy transcript ${i}` } });
      const file = path.join(folder, `${id}.jsonl`);
      fs.writeFileSync(file, `${first}\n${Array(300).fill(filler).join('\n')}\n`);
      made.push(file);
    }
  }
  try {
    await s.pageEv(() => {
      const tab = [...document.querySelectorAll('.tab')].find(t => (t.getAttribute('aria-label') || '').includes('Claude Harness'));
      tab?.querySelector('.codicon-close, .action-label')?.click();
    });
    await sleep(800);
    await s.openPanel();
    // Unfold Skills, which is local to the panel, then press a row the way a hand does and time the details.
    await s.waitFor(D => [...D.querySelectorAll('.sidebar .scope-block .section-head')].find(h => h.querySelector('.label')?.textContent === 'Skills'));
    await s.mouse('.sidebar .scope-block .section-head', 'Skills');
    const waits = [];
    for (let i = 0; i < 3; i++) {
      const name = await s.waitFor((D, i) => [...D.querySelectorAll('.sidebar .scope-block .row[data-nav*="|skill:"] .name')][i]?.textContent, i);
      const at = await s.where('.sidebar .scope-block .row[data-nav*="|skill:"]', name);
      const t = Date.now();
      await s.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
      await s.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      await s.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      // Polled every 20 ms, so the figure is the wait and not the poll.
      while (!(await s.ev((D, name) => D.querySelector('.detail-head .dh-name')?.textContent.startsWith(name), name))) {
        assert.ok(Date.now() - t < 30000, `${name} never showed its details`);
        await sleep(20);
      }
      waits.push(Date.now() - t);
    }
    t.diagnostic(`details after the press: ${waits.join(', ')} ms`);
    assert.ok(Math.max(...waits) < 1200, `the details of a row pressed after the panel opened took ${waits.join(', ')} ms`);
  } finally {
    s.waitMs = 20000;
    for (const file of made) fs.rmSync(file, { force: true });
  }
});

// The owner, 2026-10-29: the panel is switched to and a row clicked at once. Coming back into view read the whole harness
// again in one block (about 0.5 s with the owner's 36 repos), the watched files do the same whenever they change, and each
// pass posted 1.6 MB of unchanged state that rebuilt the sidebar. Thousands of transcripts make a pass take a good
// fraction of a second here too (each repo's last use is read from them); the panel is left and entered through its tab, and a row is pressed right after.
test('a nav row pressed right after the panel comes back into view shows its details promptly while the harness is read again', T, async t => {
  const projects = path.join(claude(), 'projects');
  const { projectSlug } = createRequire(import.meta.url)(path.join(repoRoot, 'out', 'src', 'fleet.js'));
  const made = [];
  for (const dir of s.fixture.repos) {
    const folder = path.join(projects, projectSlug(dir));
    fs.mkdirSync(folder, { recursive: true });
    for (let i = 0; i < 6000; i++) {
      const id = `88888888-0000-4000-8000-${String(made.length).padStart(12, '0')}`;
      const file = path.join(folder, `${id}.jsonl`);
      fs.writeFileSync(file, `{"type":"user","timestamp":"${new Date(Date.now() - 3600000 - i * 1000).toISOString()}","sessionId":"${id}","message":{"role":"user","content":"Load ${i}"}}
`);
      made.push(file);
    }
  }
  const tab = () =>
    s.pageEv(() => {
      const t = [...document.querySelectorAll('.tab')].find(x => (x.getAttribute('aria-label') || '').includes('Claude Harness'));
      const r = t.getBoundingClientRect();
      return { x: r.left + 30, y: r.top + r.height / 2 };
    });
  try {
    await sleep(2500);
    // Agents, not the long Skills list: the cost under test is the host's, not the panel drawing 1500 rows.
    await s.ev(D => {
      const head = [...D.querySelectorAll('.sidebar .scope-block .section-head')].find(h => h.querySelector('.label')?.textContent === 'Agents');
      if (head.getAttribute('aria-expanded') === 'false') head.click();
      return true;
    });
    const waits = [];
    for (let i = 0; i < 4; i++) {
      await s.chord('n', { ctrl: true });
      await sleep(400);
      const at = await tab();
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await s.page.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
      await sleep(30);
      const nav = await s.waitFor((D, i) => { const rows = [...D.querySelectorAll('.sidebar .scope-block .row[data-nav*="|agent:"]')]; return rows.length ? rows[i % rows.length].dataset.nav : undefined; }, i);
      const row = `.sidebar .scope-block .row[data-nav="${nav}"]`;
      const name = await s.ev((D, row) => D.querySelector(`${row} .name`)?.textContent, row);
      const to = await s.where(row);
      const started = Date.now();
      await s.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y });
      await s.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: to.x, y: to.y, button: 'left', clickCount: 1 });
      await s.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
      while (!(await s.ev((D, name) => D.querySelector('.detail-head .dh-name')?.textContent.startsWith(name), name))) {
        assert.ok(Date.now() - started < 30000, `${name} never showed its details`);
        await sleep(20);
      }
      waits.push(Date.now() - started);
    }
    t.diagnostic(`details after the press: ${waits.join(', ')} ms`);
    assert.ok(Math.max(...waits) < 450, `the details of a row pressed right after the panel came back took ${waits.join(', ')} ms`);
  } finally {
    for (const file of made) fs.rmSync(file, { force: true });
  }
});
