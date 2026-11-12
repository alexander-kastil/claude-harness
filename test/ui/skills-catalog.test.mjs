// UI test of the Browse page of the Skills page, run in a real, isolated VS Code (see harness.mjs). The registry is a server on this PC
// (SKILLS_API_URL, loopback only) that answers a synthetic body and counts its requests; the install click reaches GitHub for the one
// skill it names, and the confirm card is cancelled, so nothing is written.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const PORT = Number(process.env.CATALOG_API_PORT || 9619);
const requests = [];
const body = {
  skills: [
    { id: 'anthropics/skills/pdf', source: 'anthropics/skills', skillId: 'pdf', name: 'pdf', installs: 227931 },
    { id: 'acme/tools/changelog', source: 'acme/tools', skillId: 'changelog', name: 'changelog', installs: 2376 },
    { id: 'acme/tools/react-pdf', source: 'acme/tools', skillId: 'react-pdf', name: 'react-pdf' },
  ],
};
const server = http.createServer((req, res) => {
  requests.push(req.url);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(req.url.includes('q=zzzz') ? { skills: [] } : body));
});
process.env.SKILLS_API_URL = `http://127.0.0.1:${PORT}`;

const s = new Session({ livePid: process.pid });
s.waitMs = 30000;
const T = { timeout: 240000 };
const SHOTS = process.env.CATALOG_SHOTS;
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()), sel);
const type = async text => {
  await s.ev((D, text) => {
    const i = D.querySelector('#catalog-search');
    i.focus();
    i.value = text;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await s.chord('Enter');
};

before(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  // The Explorer never shows: the side bar is closed right after the load.
  await s.chord('b', { ctrl: true }).catch(() => {});
});

after(async () => {
  await s.stop();
  server.close();
});

test('Browse in the Skills command bar opens the page and asks the network nothing', T, async () => {
  await s.click('.main .overview .tile', 'Skills');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Skills');
  await s.click('.main-head button', 'Browse');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Browse skills');
  assert.match((await labels('.main-body'))[0], /network is asked only when you search/);
  assert.equal(requests.length, 0, 'opening the page makes no request');
});

test('a search lists name, source, install count and an installed tag, with one request', T, async () => {
  await type('pdf');
  await s.waitFor(D => D.querySelectorAll('.asset-table .at-row:not(.at-head)').length === 3);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/api\/search\?q=pdf$/);
  const rows = await s.ev(D => [...D.querySelectorAll('.asset-table .at-row:not(.at-head)')].map(r => [...r.querySelectorAll('[role=cell]')].map(c => c.textContent.trim())));
  assert.equal(rows[0][0], 'pdf');
  assert.equal(rows[0][1], 'anthropics/skills');
  assert.equal(rows[0][2], '228K');
  assert.equal(rows[0][3], '', 'pdf is not installed');
  assert.equal(rows[1][2], '2.4K');
  assert.equal(rows[1][3], 'installed', 'the fixture has a skill named changelog');
  assert.equal(rows[2][2], '-', 'no count, no number');
  assert.ok(await s.ev(D => D.querySelector('.asset-table .tag')), 'the tag is the house tag');
  const fit = await s.ev(D => {
    const t = D.querySelector('.asset-table').getBoundingClientRect();
    return [...D.querySelectorAll('.asset-table .at-row:not(.at-head) [role=cell]')].filter(c => c.getClientRects().length).slice(0, 6).map(c => { const r = c.getBoundingClientRect(); return { text: c.textContent.trim(), inside: r.right <= t.right + 1 && r.left >= t.left - 1, left: Math.round(r.left), right: Math.round(r.right), table: [Math.round(t.left), Math.round(t.right)] }; });
  });
  assert.ok(fit.length >= 5 && fit.every(c => c.inside), `the installed tag and the install button stay inside the table: ${JSON.stringify(fit)}`);
  if (SHOTS) await s.screenshot(path.join(SHOTS, 'skills-catalog.png'));
});

test('the filter chips split installed from not installed', T, async () => {
  await s.click('.view-tabs [role=tab]', 'Installed');
  assert.deepEqual(await labels('.asset-table .at-row:not(.at-head) .at-label'), ['changelog']);
  await s.click('.view-tabs [role=tab]', 'Not installed');
  assert.deepEqual(await labels('.asset-table .at-row:not(.at-head) .at-label'), ['pdf', 'react-pdf']);
  await s.click('.view-tabs [role=tab]', 'All');
  assert.equal((await labels('.asset-table .at-row:not(.at-head) .at-label')).length, 3);
});

test('a search with no match says so in one line', T, async () => {
  await type('zzzz');
  await s.waitFor(D => /Nothing on skills.sh matches "zzzz"/.test(D.querySelector('.main-body')?.innerText || ''));
  assert.equal(requests.length, 2);
});

test('Install opens the confirm card under its button and writes nothing until it is confirmed', T, async () => {
  await type('pdf');
  await s.waitFor(D => D.querySelectorAll('.asset-table .at-row:not(.at-head)').length === 3);
  await s.click('.asset-table button[aria-label="Install pdf"]');
  await s.waitFor(D => D.querySelector('.cf'));
  const card = await s.ev(D => D.querySelector('.cf').innerText);
  assert.match(card, /Install pdf/);
  assert.match(card, /~\/\.claude\/skills\/pdf/);
  if (SHOTS) await s.screenshot(path.join(SHOTS, 'skills-catalog-card.png'));
  await s.chord('Escape');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.equal(await s.ev(D => [...D.querySelectorAll('.asset-table .tag')].length), 1, 'cancelling installs nothing');
});
