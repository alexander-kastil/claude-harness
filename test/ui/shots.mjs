// README screenshots from the owner's own harness: a separate VS Code window (scratch user data, the real home) loads the
// working tree in the owner's Dracula Theme Soft and writes the four README shots straight into docs/images at 1x, cropped to
// the page area. Nothing is pressed that writes: only pages, tabs and rows.
//
//   npm run shots                         all shots
//   npm run shots -- session editor       only these (session, editor, plugin-hunter, automation-hunter)
//
// SHOTS_SESSION  a phrase of the title of the listed session to open (default: the listed session with the most agents)
// SHOTS_AGENT    the agent to open in the editor (default: the global agent with the longest instructions)
// SHOTS_REPOS    the repo folders, separated by ';' (default: claudeHarness.repoFolders of your own VS Code settings)
// SHOTS_OUT      where the PNGs go (default: docs/images)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Session, sleep } from './harness.mjs';
import { repoRoot } from './fixture.mjs';

const OUT = path.resolve(process.env.SHOTS_OUT || path.join(repoRoot, 'docs', 'images'));
const HEIGHT = 1000;
const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const wanted = process.argv.slice(2);
const want = name => !wanted.length || wanted.includes(name);

/** The repo folders of the owner's own VS Code, read from settings.json (JSONC: only the one array is parsed). */
function repoFolders() {
  if (process.env.SHOTS_REPOS) return process.env.SHOTS_REPOS.split(';').filter(Boolean);
  const file = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Code', 'User', 'settings.json') : path.join(HOME, '.config', 'Code', 'User', 'settings.json');
  try {
    const m = fs.readFileSync(file, 'utf8').match(/"claudeHarness\.repoFolders"\s*:\s*(\[[^\]]*\])/);
    return m ? JSON.parse(m[1].replace(/,\s*\]/, ']')) : [];
  } catch {
    return [];
  }
}

/** The global agent with the longest instructions. */
function richestAgent() {
  const dir = path.join(CLAUDE, 'agents');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')) : [];
  return files.map(f => ({ name: f.replace(/\.md$/, ''), size: fs.statSync(path.join(dir, f)).size })).sort((a, b) => b.size - a.size)[0]?.name;
}

/** The owner's Dracula Theme copied read-only into the instance's extensions folder and registered there; without it the window
 *  falls back to Default Dark Modern without an error. */
function installDracula(ext) {
  const root = path.join(HOME, '.vscode', 'extensions');
  const dir = fs.readdirSync(root).find(d => d.startsWith('dracula-theme.theme-dracula-'));
  if (!dir) throw new Error('Dracula Theme is not installed in ~/.vscode/extensions');
  fs.cpSync(path.join(root, dir), path.join(ext, dir), { recursive: true });
  const version = dir.replace('dracula-theme.theme-dracula-', '');
  const entry = { identifier: { id: 'dracula-theme.theme-dracula' }, version, location: { $mid: 1, path: '/' + path.join(ext, dir).replaceAll('\\', '/'), scheme: 'file' }, relativeLocation: dir, metadata: { installedTimestamp: Date.now(), source: 'vsix', targetPlatform: 'undefined' } };
  fs.writeFileSync(path.join(ext, 'extensions.json'), JSON.stringify([entry]));
}

/** A window on the real home; the scratch user data keeps the owner's own VS Code window and settings untouched. */
class RealSession extends Session {
  async start() {
    if (await this.listening()) throw new Error(`Port ${this.port} is busy; set UI_PORT`);
    fs.rmSync(this.ud, { recursive: true, force: true });
    fs.mkdirSync(this.ext, { recursive: true });
    const repos = repoFolders();
    installDracula(this.ext);
    this.settings({ 'claudeHarness.repoFolders': repos, 'workbench.colorTheme': 'Dracula Theme Soft' });
    this.windowOnSecondScreen();
    const args = [`--user-data-dir=${this.ud}`, `--extensions-dir=${this.ext}`, `--extensionDevelopmentPath=${repoRoot}`, `--remote-debugging-port=${this.port}`, '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'];
    if (repos[0] && fs.existsSync(repos[0])) args.push(repos[0]);
    spawn(this.code, args, { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      try {
        if ((await this.targets()).some(t => t.type === 'page')) break;
      } catch {}
    }
    await this.connectPage();
    for (let i = 0; i < 60; i++) {
      if (await this.pageEv(() => [...document.querySelectorAll('.statusbar-item')].some(e => /Claude|Harness/.test(e.textContent)))) return;
      await sleep(1000);
    }
    throw new Error('The Claude Harness status bar item never appeared: the extension did not activate');
  }

  async connectPage() {
    const page = (await this.targets()).find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id) pending.get(m.id)?.(m);
    };
    await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
    const send = (method, params = {}) => new Promise(resolve => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    this.page = { ws, send, close: () => ws.close() };
    await send('Page.enable');
  }
}

const s = new RealSession({ root: path.join(os.tmpdir(), 'claude-harness-shots'), port: Number(process.env.UI_PORT || 9512) });
s.waitMs = 30000;

/** The window sized so the page area (the webview right of its own nav column) is `width` CSS pixels wide, at 1x: the width of
 *  the image it replaces. */
async function frame(width, height) {
  let w = width + 320;
  let h = height ? height + 150 : 1400;
  for (let i = 0; i < 4; i++) {
    await s.page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    const main = await s.ev(D => {
      const r = D.querySelector('.main').getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    });
    if (main.width === width && (!height || main.height === height)) return;
    w += width - main.width;
    if (height) h += height - main.height;
  }
}

async function closeSideBar() {
  const open = await s.pageEv(() => !!document.querySelector('.part.sidebar')?.getClientRects().length);
  if (open) await s.chord('b', { ctrl: true });
  await sleep(600);
}

/** One PNG of the union of the visible matches of `selectors`, at most `maxHeight` CSS pixels tall. */
async function shoot(name, selectors, { width, height, maxHeight = HEIGHT, pad = 0 } = {}) {
  await closeSideBar();
  await frame(width, height);
  const box = await s.ev(
    (D, selectors, pad) => {
      const rects = selectors.flatMap(sel => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).slice(0, 1).map(e => e.getBoundingClientRect()));
      if (!rects.length) return null;
      const f = D.defaultView.frameElement.getBoundingClientRect();
      const x = Math.min(...rects.map(r => r.left)), y = Math.min(...rects.map(r => r.top));
      const right = Math.max(...rects.map(r => r.right)), bottom = Math.max(...rects.map(r => r.bottom)) + pad;
      return { x: x + f.left, y: y + f.top, width: right - x, height: bottom - y };
    },
    selectors,
    pad
  );
  if (!box) return console.log(`skip ${name}: nothing matched ${selectors.join(', ')}`);
  const outer = await s.pageEv(() => {
    const f = [...document.querySelectorAll('iframe.webview')].find(e => e.getClientRects().length).getBoundingClientRect();
    return { x: f.left, y: f.top };
  });
  const clip = { x: box.x + outer.x, y: box.y + outer.y, width: box.width, height: Math.min(box.height, maxHeight), scale: 1 };
  const shot = await s.page.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  // The next step clicks with real window coordinates, which an emulated size breaks.
  await s.page.send('Emulation.clearDeviceMetricsOverride');
  await sleep(600);
  console.log(`wrote ${path.relative(repoRoot, file)} (${Math.round(clip.width)} x ${Math.round(clip.height)})`);
}

const home = async () => {
  await s.mouse('.sidebar-head [aria-label="Overview"]', '');
  await s.waitFor(D => D.querySelector('.overview-tabs'));
};

async function sessionShots() {
  await home();
  await s.mouse('.overview-tabs .view-tab', 'Last sessions');
  await sleep(15000); // the window's session index fills in the background: the first list is an older, partial one
  // The listed session with the most agents (the Agents column), unless SHOTS_SESSION names one by a phrase of its title.
  const label = await s.ev((D, phrase) => {
    const rows = [...D.querySelectorAll('.main [role=row]')].filter(e => e.getClientRects().length && e.querySelector('.at-label') && !e.textContent.includes('\\'));
    const agents = r => Number(r.querySelectorAll('.at-fact')[2]?.textContent) || 0;
    const row = phrase ? rows.find(r => r.textContent.includes(phrase)) : rows.sort((a, b) => agents(b) - agents(a))[0];
    return row ? row.querySelector('.at-label').textContent.slice(0, 40) : null;
  }, process.env.SHOTS_SESSION || '');
  if (!label) return console.log('skip session: no session in the list');
  console.log(`session: "${label}"`);
  await s.mouse('.main [role=row]', label);
  await s.waitFor(D => D.querySelector('.cost-card') && D.querySelector('.kpis'));
  await s.mouse('.view-tabs .view-tab', 'Delegation map');
  await sleep(800);
  // What it cost, who spent it, the four KPIs and the start of the Delegation map.
  await shoot('session-overview', ['.main-head', '.cost-card', '.kpis', '.recent'], { width: 1280, maxHeight: 1016, pad: 8 });
}

async function editorShot() {
  const name = process.env.SHOTS_AGENT || richestAgent();
  if (!name) return console.log('skip editor: no global agent');
  console.log(`editor: ${name}`);
  await home();
  await s.mouse('.main .overview .tile', 'Agents');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.trim() === 'Agents');
  await s.mouse('.main [role=row]', name);
  await s.waitFor((D, n) => D.querySelector('.detail-head .dh-name')?.textContent.startsWith(n), name);
  await s.mouse('.detail-head button', 'Edit');
  await sleep(600);
  await shoot('feature-editor', ['.main'], { width: 1280, maxHeight: 812 });
}

// The hunters keep their cards in the owner's own history, so these two pages get the made-up weather and nameserver cards the
// shots always showed, sent to the page as the host would (nothing is read from or written to the owner's hunts).
const now = Date.now();
const weather = (kind, name, why, repoSame) => ({ kind, name, include: true, why, global: { path: `~/.claude/${kind}s/${name}`, replace: true }, repos: [{ repo: 'weather-app', path: `weather-app/.claude/${kind}s/${name}`, same: repoSame, replace: true }] });
const PLUGIN = {
  markets: [{ name: 'local-market', location: 'C:/demo/market', kind: 'directory', owned: true, categorized: false, categories: [] }],
  picked: 'local-market',
  catalog: ['forecast', 'radar', 'alerts', 'units', 'geocode', 'tiles'].map(n => ({ asset: weather('skill', n, '', false), description: n })).concat(['weather-reviewer', 'data-checker', 'map-helper'].map(n => ({ asset: weather('agent', n, '', false), description: n }))),
  proposals: [
    {
      id: 'ph-a', prompt: 'Search all weather related skills and agents of my harness and put them into one plugin.', created: now, name: 'weather-kit', category: '',
      description: 'Search all weather related skills and agents of my harness and put them into one plugin.',
      assets: [weather('skill', 'forecast', 'The forecast skill, with the copy in weather-app.', false), weather('agent', 'weather-reviewer', 'Reviews the data pipelines.', false)],
    },
  ],
  chat: [
    { role: 'owner', text: 'Search all weather related skills and agents of my harness and put them into one plugin.', at: now - 5000, card: 'ph-a' },
    { role: 'claude', text: 'I found the forecast skill and the weather-reviewer agent. Both exist globally and in weather-app, so I put them on the card as one plugin.', at: now - 4000, card: 'ph-a' },
  ],
  created: {},
};
const BROWSER = {
  procedures: ['registrar-records', 'registrar-nameservers', 'dns-check', 'cert-renew', 'invoice-export', 'portal-login', 'report-download', 'form-submit'].map(name => ({ name, keep: 'guided', how: 'a guided browser run with the saved click path' })),
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
  ],
  chat: [
    { role: 'owner', text: 'Develop the nameservers procedure.', at: now - 5000, card: 'bh-a' },
    { role: 'claude', text: 'No API covers nameservers, so it stays a guided browser run. Sign-in is the one manual step.', at: now - 4000, card: 'bh-a' },
  ],
  created: {},
};

async function hunterShot(title, file, message, info, ready, size) {
  await home();
  await s.mouse('.hunt-cta button', title);
  await s.waitFor((D, t) => D.querySelector('.main-head h1')?.textContent.trim() === t, title);
  await sleep(1500);
  await s.ev((D, m) => D.defaultView.dispatchEvent(new MessageEvent('message', { data: m })), { type: message, info });
  await s.waitFor((D, r) => D.querySelector(r), ready);
  const tab = await s.ev(D => D.querySelector('.view-tab.active')?.textContent.trim() || '');
  if (!/^New hunt/.test(tab)) await s.mouse('.view-tabs .view-tab', 'New hunt');
  await sleep(800);
  await shoot(file, ['.main'], { ...size, maxHeight: size.height });
}

try {
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  const bg = await s.ev(D => getComputedStyle(D.documentElement).getPropertyValue('--vscode-editor-background').trim().toLowerCase());
  if (bg !== '#282a36') throw new Error(`The window is not in Dracula Theme Soft (editor background ${bg || 'unset'})`);
  if (want('session')) await sessionShots();
  if (want('editor')) await editorShot();
  if (want('plugin-hunter')) await hunterShot('Plugin Hunter', 'plugin-hunter', 'hunt', PLUGIN, '.hunt-split .hunt-card', { width: 906, height: 712 });
  if (want('automation-hunter')) await hunterShot('Automation Hunter', 'browser-automation-hunter', 'browserHunt', BROWSER, '.bh-page .hunt-card .bh-step', { width: 1342, height: 811 });
} catch (e) {
  console.error(`shots failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  s.stop();
}
