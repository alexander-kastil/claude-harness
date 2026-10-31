// One UI test for the three hunters on the overview: Plugin Hunter, Automation Hunter and Cowork Handover. The same checks run against each;
// a hunter without the part (Cowork Handover has no chat) gets the check skipped with the reason in its name, never counted as a pass.
// Run in a real, isolated VS Code (see harness.mjs) on a scratch home (fixture.mjs); Claude is never started, the pages get synthetic data.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const s = new Session({ livePid: process.pid, port: Number(process.env.HUNTERS_PORT || process.env.UI_PORT || 9790) });
s.waitMs = 20000;
const T = { timeout: 180000 };

const now = Date.now();
const send = msg => s.ev((D, msg) => D.defaultView.dispatchEvent(new MessageEvent('message', { data: msg })), msg);
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);

const BROWSER = {
  procedures: [
    { name: 'Registrar records', keep: 'api', how: 'a script against the registrar API' },
    { name: 'Registrar nameservers', keep: 'guided', how: 'a guided browser run with the saved click path' },
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
    { id: 'bh-b', prompt: 'Records', created: now - 100000, name: 'registrar-records', goal: 'Set the A and MX records of a domain.', keep: 'api', stage: 'optimized', steps: [{ text: 'Call the records endpoint', manual: false }] },
  ],
  chat: [
    { role: 'owner', text: 'Develop the nameservers procedure.', at: now - 5000, card: 'bh-a' },
    { role: 'claude', text: 'No API covers nameservers, so it stays a guided browser run. Sign-in is the one manual step.', at: now - 4000, card: 'bh-a' },
    { role: 'owner', text: 'Records can go through the API.', at: now - 90000, card: 'bh-b' },
    { role: 'claude', text: 'Done: the records are one endpoint call.', at: now - 89000, card: 'bh-b' },
  ],
};

const asset = (kind, name) => ({ kind, name, include: true, why: 'Belongs with the others.', global: { path: `C:/demo/${kind}s/${name}`, replace: false }, repos: [] });
const PLUGIN = {
  markets: [{ name: 'mine', location: 'C:/demo/market', kind: 'directory', owned: true, categorized: false, categories: [] }],
  picked: 'mine',
  catalog: [{ asset: asset('skill', 'angular-signals'), description: 'Signals.' }, { asset: asset('skill', 'angular-forms'), description: 'Forms.' }, { asset: asset('agent', 'angular-expert'), description: 'Expert.' }],
  proposals: [
    { id: 'ph-a', prompt: 'Group the angular skills', created: now, name: 'angular-kit', description: 'Angular skills and the expert agent.', category: '', assets: [asset('skill', 'angular-signals'), asset('skill', 'angular-forms'), asset('agent', 'angular-expert')] },
    { id: 'ph-b', prompt: 'Docker', created: now - 100000, name: 'docker-kit', description: 'Docker skills.', category: '', assets: [asset('skill', 'docker-images')] },
  ],
  chat: [
    { role: 'owner', text: 'Group the angular skills.', at: now - 5000, card: 'ph-a' },
    { role: 'claude', text: 'Three belong together: two skills and the expert agent.', at: now - 4000, card: 'ph-a' },
    { role: 'owner', text: 'Docker too.', at: now - 90000, card: 'ph-b' },
    { role: 'claude', text: 'One docker skill.', at: now - 89000, card: 'ph-b' },
  ],
  created: {},
};

/** The overview, then the hunter's button; the page's own data is sent once it shows. */
const HUNTERS = {
  'Plugin Hunter': { feed: () => send({ type: 'hunt', info: PLUGIN }), ready: '.hunt-split .hunt-card', steps: false },
  'Automation Hunter': { feed: () => send({ type: 'browserHunt', info: BROWSER }), ready: '.bh-page .hunt-card .bh-step', steps: true },
};

async function go(name) {
  const h = HUNTERS[name];
  const here = async () => (await s.ev(D => D.querySelector('.main-head h1')?.textContent.trim())) === name;
  if (!(await here())) {
    await s.mouse('.sidebar-head [aria-label="Overview"]', '');
    await s.waitFor(D => D.querySelector('.hunt-cta'));
    await s.mouse('.hunt-cta button', name);
    await s.waitFor((D, name) => D.querySelector('.main-head h1')?.textContent.trim() === name, name);
  }
  await h.feed();
  await s.waitFor((D, ready) => D.querySelector(ready), h.ready);
  const tab = await s.ev(D => D.querySelector('.view-tab.active')?.textContent.trim() || '');
  if (!/^New hunt/.test(tab)) await s.mouse('.view-tabs .view-tab', 'New hunt');
  await s.waitFor(D => D.querySelector('.hunt-col-chat .hunt-chat-log'));
}

before(async () => {
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  // Wide enough for the chat and the card to sit side by side.
  await s.resize(1700);
});

after(async () => {
  await s.stop();
});

const geometry = () =>
  s.ev(D => {
    const r = sel => { const e = D.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height }; };
    return { chat: r('.hunt-col-chat'), find: r('.hunt-col-find'), log: r('.hunt-col-chat .hunt-chat-log'), input: r('.hunt-col-chat .chat-input'), body: r('.main-body'), composer: r('.hunt-col-chat .hunt-composer') };
  });

const NO_CHAT = 'skipped: Cowork Handover has no chat';

for (const name of ['Plugin Hunter', 'Automation Hunter']) {
  test(`${name}: the chat fills its column and the input stays pinned at the bottom`, T, async () => {
    await go(name);
    const g = await geometry();
    // The column runs down the page; the log takes the space left and the composer ends on the column's bottom edge.
    assert.ok(g.chat.height > g.input.height + 100, `the chat column is taller than its input: ${JSON.stringify(g.chat)}`);
    assert.ok(g.log.height > 0 && Math.abs(g.log.top - g.chat.top) < 80, `the log starts under the head: ${JSON.stringify(g.log)}`);
    assert.ok(g.chat.bottom - g.input.bottom < 24 && g.chat.bottom >= g.input.bottom - 1, `the input ends at the column's bottom: input ${g.input.bottom}, column ${g.chat.bottom}`);
    assert.ok(g.input.top >= g.log.bottom - 1, 'the input sits under the log');
    // With one short message the input has not moved up under it.
    assert.ok(g.chat.bottom - g.input.bottom < 24);
  });

  test(`${name}: the actions sit inside the input frame, at the bottom right`, T, async () => {
    await go(name);
    const place = await s.ev(D => {
      const f = D.querySelector('.hunt-col-chat .chat-input').getBoundingClientRect();
      const g = D.querySelector('.hunt-col-chat .chat-input .ai-group').getBoundingClientRect();
      const t = D.querySelector('.hunt-col-chat .chat-input-text').getBoundingClientRect();
      return { right: Math.round(f.right - g.right), bottom: Math.round(f.bottom - g.bottom), below: g.top >= t.bottom - 1, insideX: g.left >= f.left && g.right <= f.right, insideY: g.bottom <= f.bottom };
    });
    assert.ok(place.insideX && place.insideY && place.below, JSON.stringify(place));
    assert.ok(place.right < 16 && place.bottom < 16, `bottom right: ${JSON.stringify(place)}`);
  });

  test(`${name}: Start over is in the page header bar, not in the chat card`, T, async () => {
    await go(name);
    const where = await s.ev(D => {
      const all = [...D.querySelectorAll('button')].filter(b => b.getClientRects().length && /Start over/.test(b.getAttribute('aria-label') || b.textContent));
      const head = D.querySelector('.main-head');
      return { count: all.length, inHead: all.filter(b => head.contains(b)).length, inChat: all.filter(b => b.closest('.hunt-col-chat')).length };
    });
    assert.deepEqual(where, { count: 1, inHead: 1, inChat: 0 });
  });

  test(`${name}: New hunt starts a fresh hunt, and a second press does not add another empty card`, T, async () => {
    await go(name);
    const state = () =>
      s.ev(D => ({
        turns: D.querySelectorAll('.hunt-col-chat .hunt-msg').length,
        history: Number((D.querySelector('.view-tabs').querySelectorAll('.view-tab')[1]?.querySelector('.tab-count')?.textContent || '0').trim()),
        title: D.querySelector('.hunt-col-find .hunt-title')?.value ?? '',
      }));
    const before = await state();
    assert.ok(before.turns > 0 && before.title, `a hunt is in progress: ${JSON.stringify(before)}`);
    await s.mouse('.view-tabs .view-tab', 'New hunt');
    await s.waitFor(D => !D.querySelector('.hunt-col-chat .hunt-msg'));
    const first = await state();
    assert.equal(first.turns, 0, 'the chat is empty');
    assert.equal(first.title, '', 'the new card is empty');
    assert.equal(first.history, before.history + 1, 'the hunt that was open moved to History, the new card is the one on show');
    await s.mouse('.view-tabs .view-tab', 'New hunt');
    await new Promise(r => setTimeout(r, 500));
    const second = await state();
    assert.deepEqual(second, first, 'a second press adds no card');
  });

  test(`${name}: the chat card and the card beside it share a top and a bottom`, T, async () => {
    await go(name);
    const g = await geometry();
    assert.ok(Math.abs(g.chat.top - g.find.top) <= 1, `top: chat ${g.chat.top}, card ${g.find.top}`);
    assert.ok(Math.abs(g.chat.bottom - g.find.bottom) <= 1, `bottom: chat ${g.chat.bottom}, card ${g.find.bottom}`);
  });
}

// Cowork Handover is a different page: an inbox beside a handover card. The skips below hold only while it has none of these parts.
test('Cowork Handover has no chat, no New hunt and no Start over', T, async () => {
  await s.mouse('.sidebar-head [aria-label="Overview"]', '');
  await s.waitFor(D => D.querySelector('.hunt-cta'));
  await s.mouse('.hunt-cta button', 'Cowork Handover');
  await s.waitFor(D => D.querySelector('.main-head .dh-kind')?.textContent.trim() === 'Handover');
  const parts = await s.ev(D => ({
    chat: !!D.querySelector('.hunt-col-chat, .chat-input, .hunt-ask-text'),
    newHunt: [...D.querySelectorAll('button, .view-tab')].some(b => /New hunt/.test(b.textContent)),
    startOver: [...D.querySelectorAll('button')].some(b => /Start over/.test(b.getAttribute('aria-label') || b.textContent)),
  }));
  assert.deepEqual(parts, { chat: false, newHunt: false, startOver: false });
});

for (const check of [
  'the chat fills its column and the input stays pinned at the bottom',
  'the actions sit inside the input frame, at the bottom right',
  'Start over is in the page header bar, not in the chat card',
  'New hunt starts a fresh hunt, and a second press does not add another empty card',
  'the chat card and the card beside it share a top and a bottom',
]) test(`Cowork Handover: ${check} (${NO_CHAT})`, { skip: NO_CHAT }, () => {});

// 6. A step that needs a person shows its icon. Only the Automation Hunter has steps.
for (const name of ['Plugin Hunter', 'Cowork Handover']) {
  const reason = `skipped: ${name} has no steps`;
  test(`${name}: a step that needs user interaction shows its icon (${reason})`, { skip: reason }, () => {});
}
test('Automation Hunter: a step that needs user interaction shows its icon', T, async () => {
  await go('Automation Hunter');
  // Steps view: only the manual row (the first) has the person icon, at the far left of its row.
  const rows = await s.ev(D => [...D.querySelectorAll('.bh-page .bh-step')].map(r => {
    const w = r.querySelector('.bh-step-who .codicon-person');
    return { icon: !!w, left: !!w && w.getBoundingClientRect().left <= r.querySelector('.bh-step-n').getBoundingClientRect().left };
  }));
  assert.deepEqual(rows.map(r => r.icon), [true, false, false, false, false]);
  assert.ok(rows[0].left, 'the icon is left of the step number');
  // The hover of the card name marks it once, with the icon and not a word.
  await s.move('.bh-page .hunt-card .hunt-title');
  await s.waitFor(D => D.querySelector('.tl-hover.show .hc-tip'));
  assert.equal(await s.ev(D => D.querySelectorAll('.tl-hover.show .hc-tip .tip-lines .codicon-person').length), 1);
  assert.ok(!/\{person\}|\(manual\)/.test(await s.ev(D => D.querySelector('.tl-hover.show .hc-tip').innerText)));
  await s.move('', '');
  // Simple view: the diagram marks it on the card.
  await s.mouse('.bh-page .hunt-card .view-tab', 'Simple');
  await s.waitFor(D => D.querySelector('.bh-page .bh-simple-svg'));
  assert.equal(await s.ev(D => D.querySelectorAll('.bh-page .bh-simple-svg .bh-who').length), 1);
});
