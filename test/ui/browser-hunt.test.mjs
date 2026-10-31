// UI tests of the Automation Hunter (browser and desktop), run in a real, isolated VS Code (see harness.mjs) on a scratch home (fixture.mjs).
// The page's data is a synthetic procedure list, cards and chat sent to the page the way the host sends them; Claude is never started:
// the first Hunt press only shows the plan question. BROWSER_HUNT_SHOTS=<dir> also writes the screenshots, the VS Code side bar closed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const SHOTS = process.env.BROWSER_HUNT_SHOTS;
const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };

const now = Date.now();
const INFO = {
  procedures: [
    { name: 'Registrar records', keep: 'api', how: 'a script against the registrar API, only on the pro plan; otherwise a guided browser run' },
    { name: 'Registrar nameservers', keep: 'guided', how: 'a guided browser run with the saved click path' },
    { name: 'Admin center settings', keep: 'guided', how: 'the existing setup skill, with the recorded click path added' },
    { name: 'Guest access and roles', keep: 'cli', how: 'stay command line (az, Graph)' },
    { name: 'Slides', keep: 'tool', how: 'the slide tools instead of the browser' },
    { name: 'Desktop app signature', keep: 'guided', how: 'a guided run with the saved click path' },
    { name: 'google-analytics-oauth-client', keep: 'api', how: 'a script against the Google API' },
  ],
  source: 'C:/demo/skills/browser-automations/SKILL.md',
  cards: [
    {
      id: 'bh-a', prompt: 'Develop the nameservers procedure', created: now, name: 'registrar-nameservers', goal: 'Point a domain at the hosting provider nameservers.', keep: 'guided', stage: 'prototype',
      steps: [
        { text: 'Sign in to the registrar admin page', manual: true },
        { text: 'Open the domain list and pick example.test', manual: false },
        { text: 'Open the nameserver settings', manual: false },
        { text: 'Replace both nameservers with the provider values', manual: false },
        { text: 'Confirm the change and wait for the success banner', manual: false },
      ],
    },
    { id: 'bh-b', prompt: 'Records', created: now - 100000, name: 'registrar-records', goal: 'Set the A and MX records of a domain.', keep: 'api', stage: 'optimized', steps: [{ text: 'Call the records endpoint', manual: false }, { text: 'Accept the invite', manual: true }] },
  ],
  chat: [
    { role: 'owner', text: 'Develop the nameservers procedure: prototype it on the desktop, then optimize it in code.', at: now - 5000, card: 'bh-a' },
    { role: 'claude', text: 'No API covers nameservers, so it stays a guided browser run with a saved click path. Sign-in is the one manual step.', at: now - 4000, card: 'bh-a' },
    { role: 'owner', text: 'Records can go through the API: make it a script.', at: now - 90000, card: 'bh-b' },
    { role: 'claude', text: 'Done: the records are one endpoint call; accepting the invite stays manual.', at: now - 89000, card: 'bh-b' },
  ],
};

// Create writes only here: the synthetic copy of the skill in the scratch Global, never the live one.
const SKILL_MD = () => path.join(s.fixture.claude, 'skills', 'browser-automations', 'SKILL.md');

/** Sends the host's message to the page. */
const send = msg => s.ev((D, msg) => D.defaultView.dispatchEvent(new MessageEvent('message', { data: msg })), msg);
const text = (sel = '.bh-page') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);

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

before(async () => {
  await s.start();
  // A synthetic skill with a procedure table in the scratch Global, for the host to read.
  fs.mkdirSync(path.dirname(SKILL_MD()), { recursive: true });
  // The same seven procedures the page header counts, so the header and the plan question read one source.
  const table = INFO.procedures.map(p => `| ${p.name} | ${p.how} |`).join('\n');
  fs.writeFileSync(SKILL_MD(), `---\nname: browser-automations\ndescription: Demo procedures. Triggers on "registrar records".\n---\n\n# demo\n\n| Procedure | Keep as |\n|---|---|\n${table}\n`);
  // One procedure has a leaf beside the skill: its goal leads the hover text.
  fs.mkdirSync(path.join(path.dirname(SKILL_MD()), 'references'), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(SKILL_MD()), 'references', 'registrar-records.md'), '# registrar-records\n\nSet the A and MX records of a domain.\n\nStage: Prototype on desktop\n');
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  // Wide enough for the chat and the card to sit side by side.
  await s.resize(1700);
});

after(async () => {
  await s.stop();
});

test('the button beside Plugin Hunter, in the same AI group, opens the page', T, async () => {
  const group = await labels('.overview-tabs .ai-group.hunt-cta button');
  assert.deepEqual(group, ['Plugin Hunter', 'Automation Hunter', 'Cowork Handover']);
  await s.mouse('.overview-tabs .ai-group button', 'Automation Hunter');
  await s.waitFor(D => D.querySelector('.bh-page .main-head h1')?.textContent.includes('Automation Hunter'));
  assert.equal(await s.ev(D => D.querySelector('.bh-page .main-head h1').textContent.trim()), 'Automation Hunter');
  assert.match(await text('.bh-page .main-head'), /Browser and desktop/);
});

// The controls of the page, each with whether it sits in the header bar, and its size.
const controls = () =>
  s.ev(D => {
    const head = D.querySelector('.bh-page .main-head').getBoundingClientRect();
    return [...D.querySelectorAll('.bh-page button, .bh-page select, .bh-page textarea, .bh-page input')].filter(b => b.getClientRects().length).map(b => {
      const r = b.getBoundingClientRect();
      const ai = !!b.closest('.ai-group');
      return { label: (b.getAttribute('aria-label') || b.textContent || b.tagName).replace(/\s+/g, ' ').trim(), header: r.top >= head.top && r.bottom <= head.bottom + 1, ai, w: Math.round(r.width), h: Math.round(r.height), type: b.type };
    });
  });

test('first visit: the commands are in the header bar, the kept procedures are the way in, nothing is at the bottom', T, async () => {
  await s.waitFor(D => D.querySelectorAll('.bh-page .bh-proc').length === 7);
  const all = await controls();
  const bar = all.filter(c => c.header).map(c => c.label);
  assert.deepEqual(bar, ['Back to Plugins', 'New procedure', 'Create', 'Start over']);
  // Hunt is the AI group at the right end of the chat's input, inside its frame, like every chat.
  assert.deepEqual(all.filter(c => !c.header && c.ai).map(c => c.label), ['Hunt'], 'Hunt is the only Claude command below the header');
  for (const name of ['New procedure', 'Create', 'Start over', 'Hunt']) assert.equal(all.filter(c => c.label === name).length, 1, `${name} is on the page once`);
  const place = await s.ev(D => {
    const f = D.querySelector('.bh-page .hunt-composer .chat-input').getBoundingClientRect();
    const g = D.querySelector('.bh-page .hunt-composer .chat-input .ai-group').getBoundingClientRect();
    const t = D.querySelector('.bh-page .hunt-composer .chat-input-text').getBoundingClientRect();
    return { right: Math.round(f.right - g.right), below: g.top >= t.bottom - 1, inside: g.bottom <= f.bottom };
  });
  assert.ok(place.right < 16 && place.below && place.inside, JSON.stringify(place));
  // Hunt waits for a message and says so.
  assert.equal(await s.ev(D => D.querySelector('.bh-page [data-confirm="browserHunt"]').disabled), true);
  assert.equal(await s.ev(D => D.querySelector('.bh-page [data-confirm="browserHuntCreate"]').disabled), true);
  // The first visit shows the procedures in the column where the card will be, all rows, no list of its own to scroll.
  const list = await s.ev(D => {
    const rows = [...D.querySelectorAll('.bh-page .hunt-col-find .bh-proc')];
    const col = D.querySelector('.bh-page .hunt-col-find');
    return { rows: rows.length, nested: [...col.querySelectorAll('*')].some(e => e !== col && e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)), text: col.innerText.replace(/\s+/g, ' ') };
  });
  assert.equal(list.rows, 7);
  assert.equal(list.nested, false, 'the list does not scroll inside the column');
  assert.ok(!/ready to edit|once you send/.test(list.text), 'no prose in the empty state');
  assert.match(await text('.bh-page .hunt-chat-log'), /^Describe a browser procedure\.$/);
  // The hover text: the goal of the leaf where there is one, then the how as a sentence; without a leaf the how alone.
  const tips = await s.ev(D => Object.fromEntries([...D.querySelectorAll('.bh-page .bh-proc')].map(r => [r.querySelector('.bh-proc-name').textContent, r.getAttribute('title') || r.dataset.tip])));
  assert.equal(tips['Registrar records'], 'Registrar records\nSet the A and MX records of a domain.\nA script against the registrar API, only on the pro plan; otherwise a guided browser run.');
  assert.equal(tips['Registrar nameservers'], 'Registrar nameservers\nA guided browser run with the saved click path.');
  // The History tab shows no count while it is empty.
  assert.equal(await s.ev(D => D.querySelector('.bh-page .view-tab:last-child .tab-count')), null);
});

test('every control is at least 24 px', T, async () => {
  await send({ type: 'browserHunt', info: INFO });
  await s.waitFor(D => D.querySelector('.bh-page .bh-step'));
  const small = (await controls()).filter(c => c.type !== 'checkbox' && (c.w < 24 || c.h < 24)).map(c => `${c.label} ${c.w}x${c.h}`);
  assert.deepEqual(small, []);
  // The manual tick is named once in a column head, not on every row.
  assert.equal(await s.ev(D => [...D.querySelectorAll('.bh-page .bh-step label')].filter(l => l.textContent.trim()).length), 0);
  assert.equal(await s.ev(D => D.querySelector('.bh-page .bh-manual-head')?.textContent), 'Manual');
  assert.equal(await s.ev(D => D.querySelector('.bh-page .hunt-card-head .tag')), null, 'the stage is shown once, by its toggle');
});

test('procedures, the card with its steps and the chat show from the host data', T, async () => {
  await send({ type: 'browserHunt', info: INFO });
  await s.waitFor(D => D.querySelector('.bh-page .hunt-card .bh-step'));
  assert.equal(await s.ev(D => D.querySelectorAll('.bh-page .bh-step').length), 5);
  assert.equal(await s.ev(D => D.querySelector('.bh-page .hunt-title').value), 'registrar-nameservers');
  assert.equal(await s.ev(D => D.querySelectorAll('.bh-page .bh-step input[type=checkbox]:checked').length), 1);
  assert.equal(await s.ev(D => D.querySelector('.bh-page .bh-stage.on').textContent.trim()), 'Prototype on desktop');
  assert.equal(await s.ev(D => D.querySelector('.bh-page .bh-keep').selectedOptions[0].textContent), 'Guided run');
  assert.match(await text('.bh-page .hunt-chat-log'), /guided browser run with a saved click path/);
  assert.match(await text('.bh-page .hunt-col-find'), /5 steps/);
  assert.equal(await s.ev(D => D.querySelectorAll('.bh-page .hunt-col-find .bh-proc').length), 0, 'a card with content does not offer the list again');
  // Create is in the header now and ready: the card has a name and steps.
  assert.equal(await s.ev(D => D.querySelector('.bh-page .main-head [data-confirm="browserHuntCreate"]').disabled), false);
});

test('a desktop procedure shows in Start from as a guided run and its card has a manual step that grants app access', T, async () => {
  const desk = { id: 'bh-d', prompt: 'Develop the signature procedure', created: now + 1000, name: 'desktop-app-signature', goal: 'Set the Outlook signature through the desktop app.', keep: 'guided', stage: 'prototype', steps: [{ text: 'Grant the app access to Outlook', manual: true }, { text: 'Open the signature settings', manual: false }] };
  await send({ type: 'browserHunt', info: { ...INFO, cards: [], chat: [] } });
  await s.waitFor(D => D.querySelectorAll('.bh-page .bh-proc').length === 7);
  const row = await s.ev(D => [...D.querySelectorAll('.bh-page .bh-proc')].find(r => r.textContent.includes('Desktop app signature'))?.querySelector('.tag')?.textContent.trim());
  assert.equal(row, 'Guided run');
  await send({ type: 'browserHunt', info: { ...INFO, cards: [desk], chat: [] } });
  await s.waitFor(D => D.querySelector('.bh-page .hunt-title')?.value === 'desktop-app-signature');
  const manual = await s.ev(D => [...D.querySelectorAll('.bh-page .bh-step')].filter(r => r.querySelector('input[type=checkbox]').checked).map(r => r.querySelector('.bh-step-text').value));
  assert.deepEqual(manual, ['Grant the app access to Outlook']);
  await send({ type: 'browserHunt', info: INFO });
  await s.waitFor(D => D.querySelector('.bh-page .hunt-title')?.value === 'registrar-nameservers');
});

test('Enter in a step adds the next one under it and moves there', T, async () => {
  await s.ev(D => {
    const i = D.querySelectorAll('.bh-page .bh-step-text')[1];
    i.focus();
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await s.waitFor(D => D.querySelectorAll('.bh-page .bh-step').length === 6);
  assert.equal(await s.ev(D => [...D.querySelectorAll('.bh-page .bh-step-text')].indexOf(D.activeElement)), 2, 'the new step has the focus');
  assert.equal(await s.ev(D => D.querySelectorAll('.bh-page .bh-step-text')[2].value), '');
  await s.mouse('.bh-page .bh-step .icon-btn[aria-label="Remove step 3"]', '');
  await s.waitFor(D => D.querySelectorAll('.bh-page .bh-step').length === 5);
});

test('picking a kept procedure makes its card and readies the message; Hunt asks about the plan first', T, async () => {
  // A blank card offers the procedures; picking one fills it, with how it is kept, and focuses the message for Claude.
  await send({ type: 'browserHunt', info: { ...INFO, cards: [], chat: [] } });
  await s.waitFor(D => D.querySelectorAll('.bh-page .bh-proc').length === 7);
  // A desktop procedure sits among them with its tag, and a slug written by Create reads like the other names.
  assert.deepEqual((await labels('.bh-page .bh-proc')).map(t => t.replace(/\s+/g, ' ')).slice(1), ['Registrar nameserversGuided run', 'Admin center settingsGuided run', 'Guest access and rolesCommand line', 'SlidesA tool', 'Desktop app signatureGuided run', 'Google analytics oauth clientAPI script']);
  await s.mouse('.bh-page .bh-proc', 'Registrar records');
  await s.waitFor(D => D.querySelector('.bh-page .hunt-title')?.value === 'registrar-records');
  assert.equal(await s.ev(D => D.querySelector('.bh-page .bh-keep').selectedOptions[0].textContent), 'API script');
  assert.equal(await s.ev(D => D.querySelector('.bh-page .hunt-ask-text').value), 'Write the steps for Registrar records.');
  assert.equal(await s.ev(D => D.activeElement === D.querySelector('.bh-page .hunt-ask-text')), true, 'the message has the focus');
  assert.equal(await s.ev(D => D.querySelectorAll('.bh-page .bh-proc').length), 0, 'the list is gone once the card has content');
  await s.mouse('.bh-page [data-confirm="browserHunt"]', '');
  await s.waitFor(D => D.querySelector('.cf'));
  const card = await s.ev(D => (D.querySelector('.cf') || {}).innerText || '');
  assert.match(card, /Hunt a browser automation with Claude/);
  assert.match(card, /the 7 procedures your browser automation skill keeps/);
  assert.match(await text('.bh-page .main-head'), /Browser and desktop · 7 procedures kept/);
  if (SHOTS) await shoot(path.join(SHOTS, '20-browser-hunt-confirm.png'), '.bh-page');
  await s.ev(D => [...D.querySelectorAll('.cf button')].find(b => b.textContent.trim() === 'Cancel').click());
  // The picked card goes again, so the host holds only the fixture cards.
  await s.mouse('.bh-page .icon-btn[aria-label="Discard this card"]', '');
  await new Promise(r => setTimeout(r, 500));
  await send({ type: 'browserHunt', info: INFO });
  await s.waitFor(D => D.querySelector('.bh-page .hunt-card .bh-step'));
});

test('edits to the card are saved by the host and come back after leaving the page', T, async () => {
  await s.mouse('.bh-page .bh-stage', 'Optimized in code');
  await s.ev(D => {
    const i = D.querySelectorAll('.bh-page .bh-step-text')[1];
    i.value = 'Open the domain list and pick demo.test';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await s.mouse('.bh-page button', 'Add step');
  await new Promise(r => setTimeout(r, 800));
  // Away to the overview and back: the host sends what it stored.
  await s.mouse('.bh-page .main-head .icon-btn', '');
  await s.waitFor(D => !D.querySelector('.bh-page'));
  await s.mouse('.ai-group.hunt-cta button', 'Automation Hunter').catch(() => {});
  await s.waitFor(D => D.querySelector('.bh-page .hunt-card'));
  const back = await s.ev(D => ({ stage: D.querySelector('.bh-page .bh-stage.on').textContent.trim(), steps: D.querySelectorAll('.bh-page .bh-step').length, second: D.querySelectorAll('.bh-page .bh-step-text')[1].value }));
  assert.equal(back.stage, 'Optimized in code');
  assert.equal(back.steps, 6);
  assert.equal(back.second, 'Open the domain list and pick demo.test');
});

test('Create lists the files first, then writes the table row and the leaf into the skill, backed up', T, async () => {
  const before = fs.readFileSync(SKILL_MD(), 'utf8');
  await s.mouse('.bh-page [data-confirm="browserHuntCreate"]', '');
  await s.waitFor(D => D.querySelector('.cf'));
  const card = await s.ev(D => D.querySelector('.cf').innerText);
  assert.match(card, /Create registrar-nameservers/);
  assert.match(card, /SKILL\.md/);
  assert.match(card, /references\/registrar-nameservers\.md/);
  assert.match(card, /Backs up SKILL\.md first/);
  assert.equal(fs.readFileSync(SKILL_MD(), 'utf8'), before, 'nothing is written before the answer');
  await s.ev(D => [...D.querySelectorAll('.cf button')].find(b => b.textContent.trim() === 'Create').click());
  await s.waitFor(D => D.querySelector('.bh-page .notice.done'));
  const skill = fs.readFileSync(SKILL_MD(), 'utf8');
  assert.equal(skill.split('| registrar-nameservers |').length - 1, 1);
  assert.match(skill, /\| registrar-nameservers \| a guided run with the saved click path; steps in \[references\/registrar-nameservers\.md\]/);
  assert.match(skill, /\ndescription: Demo procedures\. Triggers on "registrar records", "registrar nameservers"\.\n/, 'the skill loads on the new procedure\'s name');
  const leaf = fs.readFileSync(path.join(path.dirname(SKILL_MD()), 'references', 'registrar-nameservers.md'), 'utf8');
  assert.match(leaf, /Stage: Optimized in code/);
  assert.match(leaf, /Kept as: Guided run/);
  assert.match(leaf, /1\. Sign in to the registrar admin page \(manual\)/);
  assert.match(leaf, /2\. Open the domain list and pick demo\.test\n/);
  const backups = path.join(s.fixture.claude, 'repo-sync-backups');
  const saved = fs.readdirSync(backups).filter(n => n.startsWith('browser-hunt-'));
  assert.equal(saved.length, 1);
  assert.equal(fs.readFileSync(path.join(backups, saved[0], 'SKILL.md'), 'utf8'), before, 'the backup is the skill as it was');
  // The header counts the skill again: the new row is the eighth procedure.
  await s.waitFor(D => /8 procedures kept/.test(D.querySelector('.bh-page .main-head')?.innerText || ''));
});

test('the History keeps the other card with its chat, collapsed', T, async () => {
  await send({ type: 'browserHunt', info: INFO });
  await s.mouse('.bh-page .view-tab', 'History');
  await s.waitFor(D => D.querySelector('.bh-page .hunt-history .hunt-card'));
  assert.equal(await s.ev(D => D.querySelectorAll('.bh-page .hunt-history .hunt-card.collapsed').length), 1);
  await s.mouse('.bh-page .hunt-chev', '');
  await s.waitFor(D => D.querySelector('.bh-page .hunt-history .bh-step'));
  if (SHOTS) await shoot(path.join(SHOTS, '21-browser-hunt-history.png'), '.bh-page');
  await s.mouse('.bh-page .view-tab', 'New hunt');
  await s.waitFor(D => D.querySelector('.bh-page .hunt-split'));
  if (SHOTS) await shoot(path.join(SHOTS, '19-browser-hunt-new.png'), '.bh-page');
});

test('a narrow window keeps every command reachable and the card in the first screen', T, async () => {
  await send({ type: 'browserHunt', info: INFO });
  await s.mouse('.bh-page .view-tab', 'New hunt');
  await s.waitFor(D => D.querySelector('.bh-page .hunt-split'));
  await s.resize(640, 900);
  const n = await s.ev(D => {
    const width = D.documentElement.clientWidth;
    const find = D.querySelector('.bh-page .hunt-col-find').getBoundingClientRect();
    const bar = [...D.querySelectorAll('.bh-page .main-head .toolbar > *')].map(e => e.getBoundingClientRect());
    const chat = D.querySelector('.bh-page .hunt-col-chat').getBoundingClientRect();
    const tabs = D.querySelector('.bh-page .view-tabs').getBoundingClientRect();
    const page = D.querySelector('.bh-page').getBoundingClientRect();
    const head = D.querySelector('.bh-page .main-head').getBoundingClientRect();
    return { pageTop: page.top, pageW: page.width, headBottom: head.bottom, cardTop: find.top, chatTop: chat.top, chatH: chat.height, tabsBottom: tabs.bottom, view: D.defaultView.innerHeight, hScroll: D.documentElement.scrollWidth > width, barInside: bar.every(r => r.left >= 0 && r.right <= width + 1) };
  });
  // Measured from the top of the page: at this width the panel's own navigation stacks above it.
  assert.ok(n.cardTop - n.pageTop < n.view * 0.7, `the card starts at ${n.cardTop} of ${n.view}: ${JSON.stringify(n)}`);
  assert.equal(n.hScroll, false);
  assert.equal(n.barInside, true, 'the header commands stay inside the page');
  await s.resize(1700);
});

test('a skill only an installed plugin ships is written in the owned marketplace source, never the cache, and the version moves', T, async () => {
  const claude = s.fixture.claude;
  const json = (file, value) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`));
  const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  // The Global copy goes; a fixture marketplace of the scratch owner holds the plugin that ships the skill, installed from the cache.
  fs.rmSync(path.join(claude, 'skills', 'browser-automations'), { recursive: true, force: true });
  const market = path.join(s.root, 'demo-market');
  const source = path.join(market, 'plugins', 'browser-tools');
  const cache = path.join(claude, 'plugins', 'cache', 'demo-market', 'browser-tools', '1.0.0');
  const table = '| Procedure | Keep as |\n|---|---|\n| Demo records | a script against the demo API |\n';
  const skillText = `---\nname: browser-automations\ndescription: Demo procedures.\n---\n\n# demo\n\n${table}`;
  json(path.join(market, '.claude-plugin', 'marketplace.json'), { name: 'demo-market', owner: { name: 'Demo' }, plugins: [{ name: 'browser-tools', source: './plugins/browser-tools', version: '1.0.0', description: 'Demo' }] });
  for (const root of [source, cache]) {
    json(path.join(root, '.claude-plugin', 'plugin.json'), { name: 'browser-tools', version: '1.0.0', description: 'Demo' });
    fs.mkdirSync(path.join(root, 'skills', 'browser-automations'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'browser-automations', 'SKILL.md'), skillText);
  }
  const known = readJson(path.join(claude, 'plugins', 'known_marketplaces.json'));
  // The CLI rejects a marketplace record without lastUpdated, so every record carries one.
  const stamped = Object.fromEntries(Object.entries({ ...known, 'demo-market': { source: { source: 'directory', path: market }, installLocation: market } }).map(([k, v]) => [k, { lastUpdated: '2026-10-01T10:00:00.000Z', ...v }]));
  json(path.join(claude, 'plugins', 'known_marketplaces.json'), stamped);
  const installed = readJson(path.join(claude, 'plugins', 'installed_plugins.json'));
  installed.plugins['browser-tools@demo-market'] = [{ scope: 'user', installPath: cache, version: '1.0.0', lastUpdated: '2026-10-01T10:00:00Z' }];
  json(path.join(claude, 'plugins', 'installed_plugins.json'), installed);
  const cacheBefore = fs.readFileSync(path.join(cache, 'skills', 'browser-automations', 'SKILL.md'), 'utf8');
  // Back to the page so the host reads the new layout.
  await s.mouse('.bh-page .main-head .icon-btn', '');
  await s.waitFor(D => !D.querySelector('.bh-page'));
  await new Promise(r => setTimeout(r, 1500));
  await s.mouse('.ai-group.hunt-cta button', 'Automation Hunter');
  await s.waitFor(D => /1 procedure kept/.test(D.querySelector('.bh-page .main-head')?.innerText || ''));
  await s.waitFor(D => D.querySelector('.bh-page .hunt-card'));
  await s.mouse('.bh-page [data-confirm="browserHuntCreate"]', '');
  await s.waitFor(D => D.querySelector('.cf'));
  const card = await s.ev(D => D.querySelector('.cf').innerText);
  assert.match(card, /plugins\/browser-tools\/skills\/browser-automations\/SKILL\.md/);
  assert.match(card, /plugin\.json \(version 1\.0\.0 to 1\.0\.1\)/);
  assert.match(card, /marketplace\.json \(browser-tools version 1\.0\.0 to 1\.0\.1\)/);
  assert.match(card, /browser-tools@demo-market, so its patch version moves and the installed plugin is updated; the plugin cache is never written/);
  assert.ok(!card.includes('plugins\\cache') && !card.includes('plugins/cache'), 'the cache is not among the files');
  if (SHOTS) await shoot(path.join(SHOTS, '22-browser-hunt-create.png'), '.bh-page');
  await s.ev(D => [...D.querySelectorAll('.cf button')].find(b => b.textContent.trim() === 'Create').click());
  await s.waitFor(D => /browser-tools 1\.0\.1|Nothing was kept/.test(D.querySelector('.bh-page .hunt-col-find')?.innerText || ''));
  const notice = await text('.bh-page .hunt-col-find');
  assert.match(notice, /browser-tools 1\.0\.1, installed plugin updated/, notice);
  assert.match(fs.readFileSync(path.join(source, 'skills', 'browser-automations', 'SKILL.md'), 'utf8'), /\| registrar-nameservers \|/);
  assert.ok(fs.existsSync(path.join(source, 'skills', 'browser-automations', 'references', 'registrar-nameservers.md')));
  assert.equal(readJson(path.join(source, '.claude-plugin', 'plugin.json')).version, '1.0.1');
  assert.equal(readJson(path.join(market, '.claude-plugin', 'marketplace.json')).plugins[0].version, '1.0.1');
  assert.equal(fs.readFileSync(path.join(cache, 'skills', 'browser-automations', 'SKILL.md'), 'utf8'), cacheBefore, 'the installed version copy is never written');
  assert.ok(!fs.existsSync(path.join(cache, 'skills', 'browser-automations', 'references')));
  assert.equal(readJson(path.join(claude, 'plugins', 'installed_plugins.json')).plugins['browser-tools@demo-market'][0].version, '1.0.1');
});
