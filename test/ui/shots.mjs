// README screenshots from the owner's own harness: a separate VS Code window (scratch user data, the real home) loads the
// working tree and writes the shots straight into docs/images at 2x. Nothing is pressed that writes: only pages, tabs and rows.
//
//   npm run shots                         all shots
//   npm run shots -- session editor       only these (session, editor, plugin-hunter, automation-hunter)
//
// SHOTS_SESSION  a phrase of the session's first prompt (default: the session of the last 30 days with the most agents)
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
const WIDTH = 1280;
const HEIGHT = 800;
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

/** The richest session of the last 30 days: the most Agent launches, and its first real prompt. */
function richestSession() {
  const root = path.join(CLAUDE, 'projects');
  const since = Date.now() - 30 * 86400000;
  let best = null;
  for (const dir of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const folder = path.join(root, dir);
    if (!fs.statSync(folder).isDirectory()) continue;
    for (const f of fs.readdirSync(folder).filter(f => f.endsWith('.jsonl'))) {
      const file = path.join(folder, f);
      if (fs.statSync(file).mtimeMs < since) continue;
      const text = fs.readFileSync(file, 'utf8');
      const agents = (text.match(/"name":"Agent"/g) || []).length;
      if (!best || agents > best.agents) best = { file, agents, text };
    }
  }
  if (!best) return null;
  for (const line of best.text.split('\n')) {
    try {
      const r = JSON.parse(line);
      const c = r.type === 'user' && !r.isMeta && r.message?.content;
      if (typeof c === 'string' && !c.startsWith('<')) return { prompt: c.replace(/\s+/g, ' ').trim().slice(0, 40), agents: best.agents };
    } catch {}
  }
  return null;
}

/** The global agent with the longest instructions. */
function richestAgent() {
  const dir = path.join(CLAUDE, 'agents');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')) : [];
  return files.map(f => ({ name: f.replace(/\.md$/, ''), size: fs.statSync(path.join(dir, f)).size })).sort((a, b) => b.size - a.size)[0]?.name;
}

/** A window on the real home; the scratch user data keeps the owner's own VS Code window and settings untouched. */
class RealSession extends Session {
  async start() {
    if (await this.listening()) throw new Error(`Port ${this.port} is busy; set UI_PORT`);
    fs.rmSync(this.ud, { recursive: true, force: true });
    fs.mkdirSync(this.ext, { recursive: true });
    const repos = repoFolders();
    this.settings({ 'claudeHarness.repoFolders': repos });
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

/** The window at 1280 x 800 CSS pixels and 2x, so every shot has the same frame and stays sharp on a retina screen. */
const frame = () => s.page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false }).then(() => sleep(800));

async function closeSideBar() {
  const open = await s.pageEv(() => !!document.querySelector('.part.sidebar')?.getClientRects().length);
  if (open) await s.chord('b', { ctrl: true });
  await sleep(600);
}

/** One PNG of the union of the visible matches of `selectors`, at most `maxHeight` CSS pixels tall. */
async function shoot(name, selectors, { maxHeight = HEIGHT, pad = 0 } = {}) {
  await closeSideBar();
  const box = await s.ev(
    (D, selectors, pad) => {
      const rects = selectors.flatMap(sel => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).slice(0, 1).map(e => e.getBoundingClientRect()));
      if (!rects.length) return null;
      const f = D.defaultView.frameElement.getBoundingClientRect();
      const x = Math.min(...rects.map(r => r.left)) - pad, y = Math.min(...rects.map(r => r.top)) - pad;
      const right = Math.max(...rects.map(r => r.right)) + pad, bottom = Math.max(...rects.map(r => r.bottom)) + pad;
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
  console.log(`wrote ${path.relative(repoRoot, file)} (${Math.round(clip.width * 2)} x ${Math.round(clip.height * 2)})`);
}

const home = async () => {
  await s.mouse('.sidebar-head [aria-label="Overview"]', '');
  await s.waitFor(D => D.querySelector('.overview-tabs'));
};

async function sessionShots() {
  const pick = process.env.SHOTS_SESSION ? { prompt: process.env.SHOTS_SESSION } : richestSession();
  if (!pick) return console.log('skip session: no session in the last 30 days');
  console.log(`session: "${pick.prompt}"${pick.agents ? ` (${pick.agents} agents)` : ''}`);
  await home();
  await s.mouse('.overview-tabs .view-tab', 'Last sessions');
  await s.ev((D, q) => {
    const i = D.querySelector('.overview-search input');
    i.value = q;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, pick.prompt.slice(0, 24));
  await sleep(800);
  await s.mouse('.main [role=row]', pick.prompt.slice(0, 24));
  await s.waitFor(D => D.querySelector('.cost-card') && D.querySelector('.kpis'));
  await s.mouse('.view-tabs .view-tab', 'Timeline');
  await sleep(800);
  // The hook: what it cost, who spent it, and the four KPIs.
  await shoot('session-overview', ['.main-head', '.cost-card', '.kpis'], { pad: 8 });
  // How the work ran: the Timeline with prompts, parallel agents and checkpoints.
  await s.ev(D => D.querySelector('.recent')?.scrollIntoView({ block: 'start' }));
  await sleep(400);
  await shoot('feature-timeline', ['.recent'], { pad: 8 });
  await s.mouse('.view-tabs .view-tab', 'Delegation map');
  await sleep(800);
  await shoot('session-map', ['.recent'], { pad: 8 });
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
  // The panel's own tree and the editor together: one place for global, repo and plugin items.
  await shoot('feature-editor', ['.sidebar', '.main'], { maxHeight: HEIGHT });
}

async function hunterShot(title, file) {
  await home();
  await s.mouse('.hunt-cta button', title);
  await s.waitFor((D, t) => D.querySelector('.main-head h1')?.textContent.trim() === t, title);
  await sleep(1500);
  const current = await s.ev(D => !!D.querySelector('.hunt-split .hunt-card'));
  if (!current) {
    const history = await s.ev(D => [...D.querySelectorAll('.view-tab')].some(t => /History\s*[1-9]/.test(t.textContent)));
    if (!history) return console.log(`skip ${file}: ${title} has no card yet; run one hunt in your own window, then npm run shots -- ${file}`);
    await s.mouse('.view-tabs .view-tab', 'History');
    await sleep(600);
  }
  await shoot(file, ['.main'], { maxHeight: HEIGHT });
}

try {
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await frame();
  if (want('session')) await sessionShots();
  if (want('editor')) await editorShot();
  if (want('plugin-hunter')) await hunterShot('Plugin Hunter', 'plugin-hunter');
  if (want('automation-hunter')) await hunterShot('Automation Hunter', 'browser-automation-hunter');
} catch (e) {
  console.error(`shots failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  s.stop();
}
