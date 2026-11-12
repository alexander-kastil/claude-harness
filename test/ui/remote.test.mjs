// UI test of Remote Control: the Remote button in the session page's Claude group, its confirm card, and the Remote tag in the session list.
// Runs in a real, isolated VS Code (see harness.mjs). The marker is the system line Claude Code writes when Remote Control goes live.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const SHOTS = process.env.REMOTE_SHOTS || path.join(s.root, 'shots');
const ID = '11111111-0000-4000-8000-000000000001';

const findTranscript = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findTranscript(p);
      if (r) return r;
    } else if (e.name === `${ID}.jsonl`) return p;
  }
};

before(async () => {
  await s.start();
  // mark one session as having run with Remote Control, before the list is first read
  const file = findTranscript(s.fixture.claude);
  assert.ok(file, 'the fixture holds the session to mark');
  fs.appendFileSync(file, `${JSON.stringify({ type: 'system', subtype: 'bridge_status', content: '/remote-control is active', url: 'https://claude.ai/code/session_fixture', isMeta: false, timestamp: new Date().toISOString(), uuid: 'bridge-1' })}\n`);
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
});

after(() => {
  s.stop();
});

const go = async (selector, label, check) => {
  for (let i = 0; i < 3; i++) {
    await s.mouse(selector, label);
    try {
      const keep = s.waitMs;
      s.waitMs = 5000;
      await s.waitFor(check);
      s.waitMs = keep;
      return;
    } catch (e) {
      s.waitMs = 20000;
      if (i === 2) throw e;
    }
  }
};

const openSession = async () => {
  await s.chord('Escape');
  await go('.sidebar-head [aria-label="Overview"]', '', D => D.querySelector('.overview-tabs'));
  await go('.overview-tabs .view-tab', 'Last sessions', D => D.querySelector('.overview-tabs .view-tab.active')?.textContent.includes('Last sessions'));
  await go('.main [role=row]', 'Add the checkout endpoint', D => D.querySelector('.finding'));
  await s.mouse('.view-tabs .view-tab', 'Delegation map');
  await s.waitFor(D => D.querySelector('.dg-toggle'));
};

test('the Claude group has a Remote button after Continue session, and its card says what it does', T, async () => {
  await openSession();
  const group = await s.ev(D => [...D.querySelectorAll('.ai-group .view-tab')].map(b => b.textContent.trim()));
  assert.deepEqual(group, ['Analyze', 'Continue session', 'Remote'], 'Analyze, Continue session, Remote');
  await s.mouse('.ai-group .view-tab', 'Remote');
  await s.waitFor(D => !!D.querySelector('.cf'));
  const c = await s.ev(D => ({ text: D.querySelector('.cf').innerText, switches: [...D.querySelectorAll('.cf .cf-switch')].map(b => b.getAttribute('aria-checked')), buttons: [...D.querySelectorAll('.cf button')].map(b => b.textContent.trim()) }));
  assert.match(c.text, /Continue this session remotely/);
  assert.match(c.text, /--remote-control/);
  assert.deepEqual(c.switches, ['false'], 'Don\'t ask again starts off');
  assert.ok(c.buttons.includes('Remote') && c.buttons.includes('Cancel'), `card buttons: ${c.buttons}`);
  fs.mkdirSync(SHOTS, { recursive: true });
  await s.screenshot(path.join(SHOTS, 'remote-card.png'));
  await s.mouse('.cf button', 'Cancel');
  await s.waitFor(D => !D.querySelector('.cf'));
  assert.equal(await s.ev(D => !!D.querySelector('.terminal-wrapper, .xterm')), false, 'Cancel starts no terminal');
});

test('the session list tags the session that ran with Remote Control, and only that one', T, async () => {
  await s.chord('Escape');
  await go('.sidebar-head [aria-label="Overview"]', '', D => D.querySelector('.overview-tabs'));
  await go('.overview-tabs .view-tab', 'Last sessions', D => D.querySelector('.overview-tabs .view-tab.active')?.textContent.includes('Last sessions'));
  await s.waitFor(D => [...D.querySelectorAll('.main [role=row] .tag')].some(t => t.textContent.trim() === 'Remote'));
  const rows = await s.ev(D => [...D.querySelectorAll('.main [role=row]')].filter(r => r.getClientRects().length).map(r => ({ text: r.textContent.replace(/\s+/g, ' '), remote: [...r.querySelectorAll('.tag')].some(t => t.textContent.trim() === 'Remote') })));
  const tagged = rows.filter(r => r.remote);
  assert.equal(tagged.length, 1, `one Remote tag, got ${tagged.length}`);
  assert.match(tagged[0].text, /Add the checkout endpoint/, 'on the marked session');
  await s.screenshot(path.join(SHOTS, 'remote-tag.png'));
});
