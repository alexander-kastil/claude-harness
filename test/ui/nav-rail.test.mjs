// The collapsible left nav, in a real, isolated VS Code: the rail, its persistence across a webview reload, expanding from a rail
// icon, the keyboard and reduced motion. The window loads the working tree's media and the build in NAVRAIL_OUT (default: out/).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session, sleep } from './harness.mjs';
import { repoRoot } from './fixture.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };

before(async () => {
  const dir = path.join(s.root, 'ext-navrail');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'node_modules', '@vscode'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  manifest.main = './extension.js';
  const out = process.env.NAVRAIL_OUT || path.join(repoRoot, 'out');
  // A build outside the repo finds the repo's packages through NODE_PATH.
  const modules = path.join(repoRoot, 'node_modules').replace(/\\/g, '/');
  fs.writeFileSync(path.join(dir, 'extension.js'), `process.env.NODE_PATH = ${JSON.stringify(modules)}; require('module')._initPaths();\nmodule.exports = require(${JSON.stringify(path.join(out, 'src', 'extension.js').replace(/\\/g, '/'))});\n`);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  fs.cpSync(path.join(repoRoot, 'media'), path.join(dir, 'media'), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'node_modules', '@vscode', 'codicons'), path.join(dir, 'node_modules', '@vscode', 'codicons'), { recursive: true });
  s.extensionPath = dir;
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.sidebar .list [data-nav="s|global|skill"]'));
});

after(() => s.stop());

const palette = async text => {
  await s.chord('F1');
  await sleep(400);
  await s.page.send('Input.insertText', { text });
  await sleep(600);
  await s.chord('Enter');
};
const width = () => s.ev(D => Math.round(D.querySelector('.sidebar').getBoundingClientRect().width));
const settled = want => s.waitFor((D, want) => Math.round(D.querySelector('.sidebar').getBoundingClientRect().width) === want, want);
// A key that activates a focused button needs its character, which a bare key chord does not send.
const press = async (key, text) => {
  const vk = key === 'Enter' ? 13 : 32;
  await s.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === 'Enter' ? 'Enter' : 'Space', text, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await s.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === 'Enter' ? 'Enter' : 'Space', windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(500);
};
const focusPanel = () => s.ev(D => D.defaultView.focus());

test('the nav collapses to a 72px rail from the top bar, with its state in the toggle', T, async () => {
  assert.ok((await width()) >= 240, 'expanded by default');
  const bar = await s.ev(D => [...D.querySelectorAll('.sidebar-head button')].map(b => b.getAttribute('aria-label')));
  assert.equal(bar[bar.length - 1], 'Collapse navigation', 'the collapse button ends the top bar, after Refresh');
  assert.equal(bar[bar.length - 2], 'Refresh');
  const btn = await s.ev(D => { const b = D.querySelector('.sidebar-head .nav-toggle'); return { expanded: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls'), exists: !!D.getElementById(b.getAttribute('aria-controls')), glyph: b.firstChild.className }; });
  assert.deepEqual(btn, { expanded: 'true', controls: 'nav-pane', exists: true, glyph: 'codicon codicon-layout-sidebar-left-off' });
  await s.mouse('.sidebar-head .nav-toggle');
  await settled(72);
  await s.waitFor(D => getComputedStyle(D.querySelector('.rail')).opacity === '1');
  const rail = await s.ev(D => {
    const r = D.querySelector('.rail');
    const full = D.querySelector('.sidebar-full');
    const t = r.querySelector('.nav-toggle');
    return { railOn: getComputedStyle(r).visibility, railOpacity: getComputedStyle(r).opacity, fullHidden: getComputedStyle(full).visibility, fullInert: full.hasAttribute('inert'), railInert: r.hasAttribute('inert'), expanded: t.getAttribute('aria-expanded'), mainLeft: Math.round(D.querySelector('.main').getBoundingClientRect().left) };
  });
  assert.deepEqual(rail, { railOn: 'visible', railOpacity: '1', fullHidden: 'hidden', fullInert: true, railInert: false, expanded: 'false', mainLeft: 72 });
});

test('the rail holds the logo, the top-bar actions, every region and top-level group with its count', T, async () => {
  const seen = await s.ev(D => ({
    top: [...D.querySelectorAll('.rail-top button')].map(b => b.getAttribute('aria-label')),
    ids: [...D.querySelectorAll('.rail-list .rail-btn')].map(b => b.dataset.rail),
    regions: [...D.querySelectorAll('.rail-btn.region')].map(b => b.dataset.rail),
    mismatched: [...D.querySelectorAll('.rail-list .rail-btn')].filter(b => !b.querySelector('.codicon') || !b.querySelector('.rail-count')).length,
    size: [...D.querySelectorAll('.rail-btn')].every(b => { const r = b.getBoundingClientRect(); const g = b.querySelector('.codicon').getBoundingClientRect(); const c = b.querySelector('.rail-count').getBoundingClientRect(); return Math.round(r.width) === 56 && Math.round(r.height) === 40 && c.left >= g.right; }) && [...D.querySelectorAll('.rail-top button')].every(b => Math.round(b.getBoundingClientRect().width) === 32 && Math.round(b.getBoundingClientRect().height) === 32),
  }));
  assert.deepEqual(seen.top, ['Expand navigation', 'Overview', 'Marketplace health', 'Collapse all', 'New...', 'Refresh', 'Expand navigation']);
  assert.ok(seen.regions.includes('region:code') && seen.regions.includes('region:repos'), `regions: ${seen.regions}`);
  assert.ok(seen.ids.includes('global|skill') && seen.ids.includes('markets'), `groups: ${seen.ids}`);
  assert.equal(seen.mismatched, 0);
  assert.ok(seen.size, 'rail buttons are 56x40, the top-bar buttons 32x32, and no count covers a glyph');
  // The count is the nav's own count: the full nav's Skills head says the same number.
  const pair = await s.ev(D => ({ rail: D.querySelector('.rail-btn[data-rail="global|skill"] .rail-count').textContent, nav: D.querySelector('[data-nav="s|global|skill"] .count').textContent }));
  assert.equal(pair.rail, pair.nav);
});

test('the collapsed state survives a webview reload', T, async () => {
  await palette('Developer: Reload Webviews');
  await s.waitFor(D => D.querySelector('.sidebar .list [data-nav="s|global|skill"]'));
  assert.equal(await s.ev(D => D.getElementById('app').classList.contains('rail-on')), true, 'still collapsed');
  await settled(72);
});

test('every rail button is a Tab stop and works with Enter and Space', T, async () => {
  await focusPanel();
  const n = await s.ev(D => D.querySelectorAll('.rail button').length);
  await s.ev(D => D.querySelector('.rail button').focus());
  const order = [];
  for (let i = 0; i < n; i++) {
    order.push(await s.ev(D => D.activeElement.closest('.rail') ? D.activeElement.dataset.rail : 'outside'));
    await s.chord('Tab');
  }
  assert.equal(new Set(order).size, n, `Tab visited ${n} distinct rail buttons: ${order.join(', ')}`);
  assert.ok(!order.includes('outside'));
  await focusPanel();
  await s.ev(D => D.querySelector('.rail-btn[data-rail="global|agent"]').focus());
  await press('Enter', '\r');
  await s.waitFor(D => !D.getElementById('app').classList.contains('rail-on') && D.activeElement.dataset.nav === 's|global|agent' && D.activeElement.getAttribute('aria-expanded') === 'true');
  await s.waitFor(D => Math.round(D.querySelector('.sidebar').getBoundingClientRect().width) >= 240);
  await s.ev(D => D.querySelector('.sidebar-full .nav-toggle').focus());
  await press(' ', ' ');
  await s.waitFor(D => D.getElementById('app').classList.contains('rail-on') && D.activeElement.matches('.rail .nav-toggle'));
  await settled(72);
});

test('a rail icon expands the nav, scrolls to its group and opens it; the groups keep their own state', T, async () => {
  const before = await s.ev(D => D.querySelector('[data-nav="s|global|memory"]').getAttribute('aria-expanded'));
  await s.mouse('.rail-btn[data-rail="global|skill"]');
  await s.waitFor(D => !D.getElementById('app').classList.contains('rail-on') && D.querySelector('[data-nav="s|global|skill"]')?.getAttribute('aria-expanded') === 'true');
  const view = await s.ev(D => {
    const l = D.querySelector('.sidebar .list');
    const h = D.querySelector('[data-nav="s|global|skill"]').getBoundingClientRect();
    const b = l.getBoundingClientRect();
    return { visible: h.top >= b.top && h.bottom <= b.bottom, memory: D.querySelector('[data-nav="s|global|memory"]').getAttribute('aria-expanded') };
  });
  assert.equal(view.visible, true, 'the group head is in view');
  assert.equal(view.memory, before, 'another group keeps its state');
  await s.waitFor(D => Math.round(D.querySelector('.sidebar').getBoundingClientRect().width) >= 240);
});

test('the open page marks its group on the rail', T, async () => {
  await s.mouse('.sidebar [data-nav="s|global|skill"] .label');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Skills');
  await s.mouse('.sidebar-head .nav-toggle');
  await settled(72);
  const active = await s.ev(D => [...D.querySelectorAll('.rail-btn.active')].map(b => `${b.dataset.rail}:${b.getAttribute('aria-current')}`));
  assert.deepEqual(active, ['global|skill:true']);
  await s.mouse('.rail .nav-toggle');
  await s.waitFor(D => Math.round(D.querySelector('.sidebar').getBoundingClientRect().width) >= 240);
});

test('Alt+Shift+B collapses and expands from the panel, and VS Code opens nothing of its own', T, async () => {
  await s.mouse('.main-head');
  await s.chord('b', { alt: true, shift: true });
  await s.waitFor(D => D.getElementById('app').classList.contains('rail-on'));
  await settled(72);
  assert.equal(await s.pageEv(() => document.querySelector('.part.auxiliarybar')?.offsetWidth || 0), 0, 'the Secondary Side Bar stays closed');
  await s.chord('b', { alt: true, shift: true });
  await s.waitFor(D => !D.getElementById('app').classList.contains('rail-on'));
  await s.waitFor(D => Math.round(D.querySelector('.sidebar').getBoundingClientRect().width) >= 240);
});

const media = value => s.frame.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });

test('the width eases over about 180ms; with reduced motion it changes at once', T, async () => {
  await media('no-preference');
  try {
    await s.mouse('.sidebar-head .nav-toggle');
    await s.mouse('.rail .nav-toggle');
    await s.waitFor(D => Math.round(D.querySelector('.sidebar').getBoundingClientRect().width) >= 240);
    const css = await s.ev(D => { const a = getComputedStyle(D.getElementById('app')); return a.transitionDuration + '|' + a.transitionTimingFunction; });
    assert.equal(css, '0.18s|cubic-bezier(0.2, 0.8, 0.2, 1)');
    await media('reduce');
    await sleep(200);
    assert.equal(await s.ev(D => getComputedStyle(D.getElementById('app')).transitionDuration), '0s');
    await s.mouse('.sidebar-head .nav-toggle');
    assert.equal(await s.ev(D => Math.round(D.querySelector('.sidebar').getBoundingClientRect().width)), 72, 'the column is at the rail width in the same frame');
    await s.mouse('.rail .nav-toggle');
    await s.waitFor(D => Math.round(D.querySelector('.sidebar').getBoundingClientRect().width) >= 240);
  } finally {
    await media('no-preference');
  }
});
