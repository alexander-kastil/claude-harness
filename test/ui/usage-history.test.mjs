// UI tests of the usage history: the History tab of a repo and the Usage history page of all repos, in a real, isolated VS Code
// (see harness.mjs) on the fixture's transcripts. Set HISTORY_SHOTS to a folder to keep screenshots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { repoRoot } from './fixture.mjs';
import { Session } from './harness.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const SHOTS = process.env.HISTORY_SHOTS;
const shot = async name => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await s.screenshot(path.join(SHOTS, `${name}.png`));
};
const body = () => s.ev(D => D.querySelector('.main-body')?.innerText || '');
const chips = () => s.ev(D => [...D.querySelectorAll('.main-body .usage-history-chips .dg-mode')].map(b => [b.textContent.trim(), b.getAttribute('aria-pressed')]));
const bars = () => s.ev(D => D.querySelectorAll('.main-body .usage-history-col').length);
const heads = () => s.ev(D => [...D.querySelectorAll('.main-body .asset-table')].map(t => [...t.querySelectorAll('.at-head > span')].map(c => c.textContent.trim())));

// The fixture's transcripts reuse message ids across sessions, which the history counts once, and span three days. These add
// responses with their own ids over seven months, so the month table has months of every size: a few dollars, a few hundred.
const DAY = 864e5;
const addHistory = () => {
  const { projectSlug } = createRequire(import.meta.url)(path.join(repoRoot, 'out', 'src', 'repos-overview.js'));
  const plan = [
    ['shop-web', 10, 3e6], ['shop-web', 40, 6e6], ['shop-web', 75, 30e6], ['shop-web', 130, 3e6],
    ['docs-site', 20, 1e6], ['docs-site', 100, 20e6],
    ['shop-api', 15, 2e6], ['shop-api', 60, 40e6], ['shop-api', 200, 5e6],
  ];
  plan.forEach(([repo, ago, output], i) => {
    const dir = s.fixture.repoDirs[repo];
    const folder = path.join(s.fixture.claude, 'projects', projectSlug(dir));
    fs.mkdirSync(folder, { recursive: true });
    const at = new Date(Date.now() - ago * DAY).toISOString();
    const record = { type: 'assistant', uuid: `hist-${i}`, timestamp: at, cwd: dir, sessionId: `99999999-0000-4000-8000-00000000000${i}`, message: { id: `msg-hist-${i}`, model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: output }, content: [{ type: 'text', text: 'Done.' }] } };
    fs.writeFileSync(path.join(folder, `hist-${i}.jsonl`), `${JSON.stringify(record)}\n`);
  });
};

before(async () => {
  await s.start();
  addHistory();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.resize(1280);
  // The side bar (Explorer) closes right after the window loads.
  await s.chord('b', { ctrl: true });
});

after(() => s.stop());

// A failing test leaves a screenshot of the workbench beside the scratch data.
afterEach(async t => {
  if (t.passed) return;
  try {
    await s.screenshot(path.join(s.root, 'failures', `${t.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`));
  } catch {}
});

test('the History tab of a repo charts 30 days of its cost and sets each month against the plan prices', T, async () => {
  await s.mouse('.sidebar .repo-head', 'shop-api');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'shop-api');
  await s.mouse('.main .view-tab', 'History');
  await s.waitFor(D => D.querySelectorAll('.main-body .usage-history-col').length > 0);
  assert.deepEqual(await chips(), [['30 days', 'true'], ['90 days', 'false'], ['12 months', 'false']]);
  assert.equal(await bars(), 30, 'one bar per day');
  const text = await body();
  assert.match(text, /at API prices/i);
  assert.match(text, /\$\d+\.\d\d/);
  const head = await heads();
  assert.deepEqual(head[0].slice(0, 3), ['Month', 'Tokens', 'API price']);
  assert.ok(head[0].includes('Pro $20') && head[0].includes('Max $100') && head[0].includes('Ultra $200') && head[0].includes('Best fit'), head[0].join('|'));
  assert.equal(head.length, 1, 'a repo has no project table');
  const row = await s.ev(D => D.querySelector('.main-body .asset-table .at-row:not(.at-head)')?.innerText.replace(/\s+/g, ' '));
  assert.match(row, /\d+(\.\d)?[KM]? \$\d.*\d(\.\d)?x/, row);
  assert.match(row, /API|Pro|Max|Ultra/);
  await shot('repo-30d');
});

test('a bar has the house hover card with the day, the cost and the tokens', T, async () => {
  // A background refresh of the sessions redraws the tab and dismisses a card: the pointer goes back onto the bar until one stays.
  let card = '';
  const keep = s.waitMs;
  s.waitMs = 3000;
  for (let i = 0; i < 5 && !card; i++) {
    await s.move();
    await s.move('.main-body .usage-history-col:nth-last-child(3)');
    // The pointer's own events reach the page's delegated handler; from the third try on the same events are also sent from the page,
    // for the runs where the pointer lands before the page has settled.
    if (i >= 2) await s.ev(D => { const c = D.querySelector('.main-body .usage-history-col:nth-last-child(3)'); D.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 900, clientY: 700 })); c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    try {
      card = await s.waitFor(D => D.querySelector('.tl-hover.show .hc')?.innerText || false);
    } catch {}
  }
  s.waitMs = keep;
  assert.match(card, /API prices|No usage/i);
  await shot('hover');
});

test('the 12 months chip draws one bar per month and the 90 days chip one per day', T, async () => {
  await s.mouse('.main-body .usage-history-chips .dg-mode', '12 months');
  await s.waitFor(D => D.querySelectorAll('.main-body .usage-history-col').length === 12);
  assert.deepEqual((await chips()).map(c => c[1]), ['false', 'false', 'true']);
  const months = await s.ev(D => D.querySelectorAll('.main-body .asset-table .at-row:not(.at-head)').length);
  assert.equal(months, 12);
  // The advisor names a plan for the months with work: the 600 and 800 dollar months fit Max, a month under 20 dollars would stay on API.
  const fits = await s.ev(D => [...D.querySelectorAll('.main-body .asset-table .at-row:not(.at-head) .tag')].map(t => t.textContent.trim()));
  assert.ok(fits.includes('Max') || fits.includes('Pro'), fits.join(','));
  await s.mouse('.main-body .usage-history-chips .dg-mode', '90 days');
  await s.waitFor(D => D.querySelectorAll('.main-body .usage-history-col').length === 90);
  await shot('repo-90d');
});

test('the Usage history page lists every repo with its cost, and the repo tab is the same view narrowed', T, async () => {
  await s.mouse('.sidebar button', 'Usage history');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Usage history' && D.querySelectorAll('.main-body .usage-history-col').length > 0);
  await s.mouse('.main-body .usage-history-chips .dg-mode', '30 days');
  await s.waitFor(D => D.querySelectorAll('.main-body .usage-history-col').length === 30);
  const head = await heads();
  assert.equal(head.length, 2, 'the month table and the project table');
  assert.deepEqual(head[1].slice(0, 2), ['Project', 'Tokens']);
  const rows = await s.ev(D => [...D.querySelectorAll('.main-body .asset-table')[1].querySelectorAll('.at-row:not(.at-head)')].map(r => r.innerText.replace(/\s+/g, ' ')));
  for (const repo of ['shop-api', 'shop-web', 'data-pipeline', 'docs-site']) assert.ok(rows.some(r => r.includes(repo)), `${repo} in ${rows.join(' | ')}`);
  assert.ok(rows.every(r => /\$\d/.test(r) && /%/.test(r)), rows.join(' | '));
  await shot('all-repos');
});
