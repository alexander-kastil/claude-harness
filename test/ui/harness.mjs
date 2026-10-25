// Starts an isolated VS Code on the working tree (--extensionDevelopmentPath) with a scratch home, and drives its Claude
// Harness webview over the Chrome DevTools Protocol. Node's global WebSocket is the only transport; nothing is installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { repoRoot, buildFixture } from './fixture.mjs';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) pending.get(m.id)?.(m);
  };
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) =>
    new Promise(resolve => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { ws, ready, send, close: () => ws.close() };
}

export class Session {
  constructor(opts = {}) {
    this.root = path.resolve(opts.root || process.env.UI_ROOT || path.join(os.tmpdir(), 'claude-harness-ui'));
    this.port = Number(opts.port || process.env.UI_PORT || 9478);
    this.code = opts.code || process.env.CODE_EXE || 'C:\\Program Files\\Microsoft VS Code\\Code.exe';
    this.ud = path.join(this.root, 'ud');
    this.ext = path.join(this.root, 'ext');
    this.livePid = opts.livePid;
  }

  get base() {
    return `http://127.0.0.1:${this.port}`;
  }

  settings(extra = {}) {
    const file = path.join(this.ud, 'User', 'settings.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          'editor.minimap.enabled': false,
          'workbench.startupEditor': 'none',
          'workbench.secondarySideBar.defaultVisibility': 'hidden',
          'workbench.colorTheme': 'Default Dark Modern',
          'security.workspace.trust.enabled': false,
          'telemetry.telemetryLevel': 'off',
          'update.mode': 'none',
          'extensions.autoUpdate': false,
          'window.dialogStyle': 'custom',
          'claudeHarness.repoFolders': [path.join(this.root, 'repos')],
          ...current,
          ...extra,
        },
        null,
        2
      )
    );
  }

  /** Builds the fixture, then starts VS Code; resolves when the workbench page answers. */
  async start() {
    if (await this.listening()) throw new Error(`Port ${this.port} is busy; set UI_PORT`);
    this.fixture = buildFixture(this.root, { livePid: this.livePid });
    fs.mkdirSync(this.ext, { recursive: true });
    this.settings();
    const env = { ...process.env, USERPROFILE: this.fixture.home, HOME: this.fixture.home };
    const args = [`--user-data-dir=${this.ud}`, `--extensions-dir=${this.ext}`, `--extensionDevelopmentPath=${repoRoot}`, `--remote-debugging-port=${this.port}`, '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', path.join(this.root, 'repos', 'shop-api')];
    spawn(this.code, args, { env, detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      try {
        const pages = (await (await fetch(`${this.base}/json/list`)).json()).filter(t => t.type === 'page');
        if (pages.length) break;
      } catch {}
    }
    this.page = connect((await this.targets()).find(t => t.type === 'page').webSocketDebuggerUrl);
    await this.page.ready;
    await this.page.send('Page.enable');
    for (let i = 0; i < 60; i++) {
      if (await this.pageEv(() => [...document.querySelectorAll('.statusbar-item')].some(e => /Claude|Harness/.test(e.textContent)))) return;
      await sleep(1000);
    }
    throw new Error('The Claude Harness status bar item never appeared: the extension did not activate');
  }

  /** Attaches to an instance that is already running (a manual walk-through that spans several scripts). */
  async connectExisting() {
    this.page = connect((await this.targets()).find(t => t.type === 'page').webSocketDebuggerUrl);
    await this.page.ready;
    await this.page.send('Page.enable');
    await this.attach();
  }

  async listening() {
    try {
      await fetch(`${this.base}/json/version`);
      return true;
    } catch {
      return false;
    }
  }

  async targets() {
    return (await fetch(`${this.base}/json/list`)).json();
  }

  /** Closes only the instance whose command line holds this session's user data folder. */
  stop() {
    this.page?.close();
    this.frame?.close();
    if (process.platform !== 'win32') return;
    const script = `Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -replace '/','\\') -like '*${this.ud.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
  }

  async pageEv(fn, ...args) {
    const expression = `(${fn})(...${JSON.stringify(args)})`;
    const r = await this.page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`page: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  }

  /** Runs the workbench command through the command palette-free route: the status bar item of the extension. */
  async openPanel() {
    await this.pageEv(() => {
      const el = [...document.querySelectorAll('.statusbar-item')].find(e => /Claude|Harness/.test(e.textContent));
      (el.querySelector('a') || el).click();
    });
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (await this.attach()) return;
    }
    throw new Error('The panel webview never appeared');
  }

  async attach() {
    const t = (await this.targets()).find(x => x.type === 'iframe' && x.url.startsWith('vscode-webview://'));
    if (!t) return false;
    if (this.frame && this.frameId === t.id) return true;
    this.frame?.close();
    this.frame = connect(t.webSocketDebuggerUrl);
    await this.frame.ready;
    this.frameId = t.id;
    await this.frame.send('Runtime.enable');
    return true;
  }

  /** Evaluates `fn(D, ...args)` in the webview, D being the panel's document; objects come back by value. */
  async ev(fn, ...args) {
    if (!(await this.attach())) throw new Error('no webview');
    const expression = `(async () => { const f = document.getElementById('active-frame') || document.querySelector('iframe'); const D = f && f.contentDocument; if (!D) return undefined; return await (${fn})(D, ...${JSON.stringify(args)}); })()`;
    const r = await this.frame.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`webview: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  }

  async waitFor(fn, ...args) {
    let last;
    let failure = '';
    for (let t = Date.now(); Date.now() - t < (this.waitMs || 15000); ) {
      try {
        last = await this.ev(fn, ...args);
        if (last) return last;
      } catch (e) {
        failure = e.message;
      }
      await sleep(250);
    }
    throw new Error(`Timed out waiting for ${String(fn).slice(0, 160)} with ${JSON.stringify(args).slice(0, 120)}${failure ? `; the last error: ${failure}` : `; the last value: ${JSON.stringify(last)}`}`);
  }

  /** Clicks the first element matching `selector` whose text contains `text` (any when empty). */
  async click(selector, text = '') {
    const ok = await this.waitFor(
      (D, selector, text) => {
        const el = [...D.querySelectorAll(selector)].filter(e => e.getClientRects().length).find(e => !text ||(e.textContent || '').includes(text) || (e.getAttribute('aria-label') || '').includes(text) || (e.getAttribute('title') || '').includes(text));
        if (!el) return false;
        el.click();
        return true;
      },
      selector,
      text
    );
    await sleep(250);
    return ok;
  }

  /** A real mouse click (move, press, release) at the centre of the first visible match, the way a hand reaches it. */
  async mouse(selector, text = '', { button = 'left', double = false } = {}) {
    const inner = await this.waitFor(
      (D, selector, text) => {
        const el = [...D.querySelectorAll(selector)].filter(e => e.getClientRects().length).find(e => !text || (e.textContent || '').includes(text) || (e.getAttribute('aria-label') || '').includes(text) || (e.getAttribute('title') || '').includes(text));
        if (!el) return false;
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        const f = D.defaultView.frameElement.getBoundingClientRect();
        return { x: r.left + r.width / 2 + f.left, y: r.top + r.height / 2 + f.top };
      },
      selector,
      text
    );
    const outer = await this.pageEv(() => {
      const f = [...document.querySelectorAll('iframe.webview')].find(e => e.getClientRects().length);
      const r = f.getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    const x = inner.x + outer.x;
    const y = inner.y + outer.y;
    await this.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (let i = 0; i < (double ? 2 : 1); i++) {
      await this.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: i + 1 });
      await this.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: i + 1 });
    }
    await sleep(300);
    return { x, y };
  }

  /** The page coordinates of the centre of the first visible match, for the real pointer. */
  async where(selector, text = '') {
    const inner = await this.waitFor(
      (D, selector, text) => {
        const el = [...D.querySelectorAll(selector)].filter(e => e.getClientRects().length).find(e => !text || (e.textContent || '').includes(text) || (e.getAttribute('aria-label') || '').includes(text) || (e.getAttribute('title') || '').includes(text) || (e.dataset.tip || '').includes(text));
        if (!el) return false;
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        const f = D.defaultView.frameElement.getBoundingClientRect();
        return { x: r.left + r.width / 2 + f.left, y: r.top + r.height / 2 + f.top };
      },
      selector,
      text
    );
    const outer = await this.pageEv(() => {
      const f = [...document.querySelectorAll('iframe.webview')].find(e => e.getClientRects().length);
      const r = f.getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    return { x: inner.x + outer.x, y: inner.y + outer.y };
  }

  /** Moves the real pointer onto the first visible match (no press), and to a spot outside the panel when no selector is given. */
  async move(selector, text = '') {
    const at = selector ? await this.where(selector, text) : { x: 4, y: 4 };
    await this.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x - 2, y: at.y });
    await this.page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    await sleep(100);
    return at;
  }

  async screenshot(file) {
    const shot = await this.page.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    return file;
  }

  /** Narrows or widens the window, so the panel lays out at that width; no arguments restores the real size. */
  async resize(width, height = 900) {
    if (!width) await this.page.send('Emulation.clearDeviceMetricsOverride');
    else await this.page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
  }

  /** Dark or light, by the setting; resolves when the webview body carries the class. */
  async theme(mode) {
    this.settings({ 'workbench.colorTheme': mode === 'light' ? 'Default Light Modern' : 'Default Dark Modern' });
    await this.waitFor((D, mode) => D.body.classList.contains(`vscode-${mode}`), mode);
    await sleep(300);
  }

  /** A real key chord through the page target, the way the keyboard reaches the workbench. */
  async chord(key, { ctrl = false, alt = false, shift = false } = {}) {
    const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key;
    const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined;
    for (const type of ['rawKeyDown', 'keyUp']) await this.page.send('Input.dispatchKeyEvent', { type, modifiers, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(500);
  }
}
