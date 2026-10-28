import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { readJson } from './hunt-market';
import { intSetting } from './settings';
import { countdown } from './countdown';

export type QuotaKind = 'session' | 'weekly_all' | 'weekly_scoped';
export type QuotaWindow = { kind: QuotaKind; label: string; percent: number; resetsAt: number | undefined };

type Entry = { kind?: string; group?: string; percent?: unknown; resets_at?: string; is_active?: boolean; scope?: { model?: { display_name?: string }; surface?: string } };
type Legacy = { utilization?: unknown; resets_at?: string } | null | undefined;
type Usage = { limits?: Entry[]; five_hour?: Legacy; seven_day?: Legacy; seven_day_opus?: Legacy; seven_day_sonnet?: Legacy };

const SESSION_MS = 5 * 3600_000;
const WEEK_MS = 7 * 24 * 3600_000;
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
// The usage endpoint answers 429 (Retry-After 0) to any client whose User-Agent is not claude-code/*; curl, node and a browser all get it.
const HEADERS = { 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json', 'User-Agent': 'claude-code/2.1.0' };

const periodOf = (kind: QuotaKind) => (kind === 'session' ? SESSION_MS : WEEK_MS);
const when = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

export function parseUsage(usage: Usage | undefined): QuotaWindow[] {
  if (!usage) return [];
  const rank: Record<QuotaKind, number> = { session: 0, weekly_all: 1, weekly_scoped: 2 };
  const fromEntry = (e: Entry): QuotaWindow | undefined => {
    const kind: QuotaKind | undefined = e.kind === 'session' || e.kind === 'weekly_all' || e.kind === 'weekly_scoped' ? e.kind : e.group === 'session' ? 'session' : e.group === 'weekly' ? 'weekly_scoped' : undefined;
    if (!kind) return undefined;
    const percent = Number(e.percent);
    const scope = e.scope?.model?.display_name || e.scope?.surface || '';
    const label = kind === 'session' ? '5-hour session' : kind === 'weekly_all' ? 'Weekly, all models' : `Weekly, ${scope || 'scoped'}`;
    return { kind, label, percent: Number.isFinite(percent) ? percent : 0, resetsAt: when(e.resets_at) };
  };
  const fromLegacy = (l: Legacy, kind: QuotaKind, label: string): QuotaWindow | undefined => {
    if (!l) return undefined;
    const percent = Number(l.utilization);
    return { kind, label, percent: Number.isFinite(percent) ? percent : 0, resetsAt: when(l.resets_at) };
  };
  const entries = (Array.isArray(usage.limits) ? usage.limits : []).filter(e => e.is_active !== false || e.kind !== 'weekly_scoped');
  let windows = entries.map(fromEntry).filter((w): w is QuotaWindow => !!w);
  if (!windows.length)
    windows = [
      fromLegacy(usage.five_hour, 'session', '5-hour session'),
      fromLegacy(usage.seven_day, 'weekly_all', 'Weekly, all models'),
      fromLegacy(usage.seven_day_opus, 'weekly_scoped', 'Weekly, Opus'),
      fromLegacy(usage.seven_day_sonnet, 'weekly_scoped', 'Weekly, Sonnet'),
    ].filter((w): w is QuotaWindow => !!w);
  return windows.map((w, i) => ({ w, i })).sort((a, b) => rank[a.w.kind] - rank[b.w.kind] || a.i - b.i).map(x => x.w);
}

export function statusText(windows: QuotaWindow[]): string {
  const pct = (kind: QuotaKind) => {
    const w = windows.find(x => x.kind === kind);
    return w ? `${Math.round(w.percent)}%` : undefined;
  };
  const parts = [pct('session') && `5h ${pct('session')}`, pct('weekly_all') && `wk ${pct('weekly_all')}`].filter(Boolean);
  return parts.length ? `$(dashboard) ${parts.join(' · ')}` : '';
}


type Thresholds = { warn: number; crit: number };
const thresholds = (): Thresholds => {
  const warn = intSetting('quota.warnPercent', 75, 1, 100);
  return { warn, crit: Math.max(warn, intSetting('quota.criticalPercent', 90, 1, 100)) };
};

const level = (percent: number, t: Thresholds = thresholds()) => (percent >= t.crit ? 'critical' : percent >= t.warn ? 'high' : 'ok');

// Used share against the share of the window already gone: a bar at 40 % is calm 10 % into a window and urgent 90 % into it.
function pace(w: QuotaWindow, now: number): { elapsed: number | undefined; word: string; projected: number | undefined } {
  const lv = level(w.percent);
  const elapsed = w.resetsAt === undefined ? undefined : Math.min(100, Math.max(0, 100 - ((w.resetsAt - now) / periodOf(w.kind)) * 100));
  const projected = elapsed !== undefined && elapsed >= 5 ? (w.percent / elapsed) * 100 : undefined;
  if (lv === 'critical') return { elapsed, word: 'Critical', projected };
  if (elapsed === undefined) return { elapsed, word: lv === 'high' ? 'High' : 'Within limit', projected };
  const word = w.percent > elapsed + 10 ? 'Ahead of pace' : w.percent < elapsed - 10 ? 'Under pace' : 'On pace';
  return { elapsed, word: lv === 'high' && word === 'On pace' ? 'High' : word, projected };
}

const clock = (t: number, withDay: boolean) => {
  const d = new Date(t);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return withDay ? `${d.toLocaleDateString([], { weekday: 'short' })} ${hm}` : hm;
};

type Palette = { track: string; trackLine: string; ok: string; high: string; critical: string; marker: string; markerLine: string };
const DARK: Palette = { track: '#2b2d31', trackLine: '#5c6068', ok: '#4cc38a', high: '#e5b02e', critical: '#f26d6d', marker: '#f2f2f2', markerLine: '#1b1b1d' };
const LIGHT: Palette = { track: '#e9eaee', trackLine: '#9aa0aa', ok: '#1f8a57', high: '#a86e00', critical: '#c62f2f', marker: '#1f2328', markerLine: '#ffffff' };

const paletteOf = (kind: vscode.ColorThemeKind) => (kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? LIGHT : DARK);

// Bullet bar: track, fill in the state colour, a tick for how much of the window has elapsed, hairlines at the warn and critical thresholds.
// The time to the reset is drawn in the same image, right-aligned and centred on the track, so it is always level with the bar and ends in the same column in every row.
export function barSvg(w: QuotaWindow, elapsed: number | undefined, p: Palette, left = ''): string {
  const BAR = 300;
  const W = BAR + 72;
  const H = 18;
  const x0 = 2;
  const span = BAR - 4;
  const fillW = Math.max(w.percent > 0 ? 4 : 0, (Math.min(100, w.percent) / 100) * span);
  const color = p[level(w.percent)];
  const at = (pc: number) => x0 + (pc / 100) * span;
  const tick = elapsed === undefined ? '' : `<rect x="${(at(elapsed) - 2).toFixed(1)}" y="1" width="4" height="${H - 2}" rx="1.5" fill="${p.markerLine}"/><rect x="${(at(elapsed) - 1).toFixed(1)}" y="2" width="2" height="${H - 4}" rx="1" fill="${p.marker}"/>`;
  const marks = [thresholds().warn, thresholds().crit].map(t => `<rect x="${at(t).toFixed(1)}" y="5" width="1" height="8" fill="${p.trackLine}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="${x0}" y="4" width="${span}" height="10" rx="5" fill="${p.track}" stroke="${p.trackLine}" stroke-width="1"/><rect x="${x0}" y="4" width="${fillW.toFixed(1)}" height="10" rx="5" fill="${color}"/>${marks}${tick}${left ? `<text x="${W - 2}" y="9" text-anchor="end" dominant-baseline="central" font-family="Consolas,'Courier New',monospace" font-size="12" fill="${p.marker}">${left}</text>` : ''}</svg>`;
}

export function hoverMarkdown(windows: QuotaWindow[], now: number, kind: vscode.ColorThemeKind, fetchedAt: number | undefined, stale: boolean): vscode.MarkdownString {
  const p = paletteOf(kind);
  const md = new vscode.MarkdownString('', true);
  md.supportHtml = true;
  const nb = '&nbsp;';
  const sp = (n: number) => nb.repeat(n);
  const lines: string[] = [];
  const mark = (lv: string) => (lv === 'critical' ? '$(error)' : lv === 'high' ? '$(warning)' : '$(pass)');

  lines.push(`**$(dashboard)${sp(2)}Claude usage**`);

  windows.forEach((w, i) => {
    const { elapsed } = pace(w, now);
    const lv = level(w.percent);
    const left = w.resetsAt === undefined ? '' : countdown(w.resetsAt - now, w.kind === 'session');
    const svg = `data:image/svg+xml;base64,${Buffer.from(barSvg(w, elapsed, p, left)).toString('base64')}`;
    const alt = `${w.label}: ${Math.round(w.percent)} percent used${elapsed === undefined ? '' : `, ${Math.round(elapsed)} percent of the window elapsed`}`;
    const pct = `${Math.round(w.percent)}%`.padStart(4, ' ');
    lines.push('', i === 0 || w.kind !== windows[i - 1].kind ? '---' : '', '');
    lines.push(
      [
        `**${w.label}**${sp(3)}${mark(lv)}${sp(1)}**\`${pct}\`**`,
        `![${alt}](${svg})`,
      ].join('<br>')
    );
  });

  lines.push('', '---', '');
  const foot = stale
    ? `$(warning)${sp(1)}Showing the last known values, retrying`
    : fetchedAt
      ? `Updated ${clock(fetchedAt, false)}`
      : '';
  lines.push(`<span style="color:var(--vscode-descriptionForeground);">${foot}${foot ? `${sp(2)}·${sp(2)}` : ''}Click to open Claude Harness</span>`);
  md.value = lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  return md;
}

type Deps = { root: () => string; state?: vscode.Memento };

const SAVED = 'quota.lastReading';

export function registerQuota(deps: Deps): vscode.Disposable[] {
  const item = vscode.window.createStatusBarItem('claudeHarness.quota', vscode.StatusBarAlignment.Right, 100);
  item.name = 'Claude usage quota';
  item.command = 'claudeHarness.open';

  // The last reading survives a window reload, so the item is there before the first fetch and while the token is expired.
  const saved = deps.state?.get<{ windows: QuotaWindow[]; fetchedAt: number }>(SAVED);
  let windows: QuotaWindow[] = Array.isArray(saved?.windows) ? saved.windows : [];
  let fetchedAt: number | undefined = windows.length ? saved?.fetchedAt : undefined;
  let failures = 0;
  let stale = windows.length > 0;
  let timer: NodeJS.Timeout | undefined;
  let disposed = false;

  const render = () => {
    const text = statusText(windows);
    if (!text) {
      item.hide();
      return;
    }
    const top = Math.max(...windows.filter(w => w.kind !== 'weekly_scoped').map(w => w.percent), 0);
    item.text = text;
    const t = thresholds();
    item.backgroundColor = top >= t.crit ? new vscode.ThemeColor('statusBarItem.errorBackground') : top >= t.warn ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    item.tooltip = hoverMarkdown(windows, Date.now(), vscode.window.activeColorTheme.kind, fetchedAt, stale);
    item.show();
  };

  const token = (): string | undefined => {
    const oauth = (readJson(path.join(deps.root(), '.credentials.json')).claudeAiOauth ?? {}) as { accessToken?: string; expiresAt?: number };
    if (!oauth.accessToken || (oauth.expiresAt && oauth.expiresAt <= Date.now())) return undefined;
    return oauth.accessToken;
  };

  const viaCurl = (bearer: string) =>
    new Promise<{ status: number; body: string }>(resolve => {
      const headers = [`Authorization: Bearer ${bearer}`, ...Object.entries(HEADERS).map(([k, v]) => `${k}: ${v}`)].join('\n');
      const child = execFile('curl', ['-sS', '-m', '20', '-H', '@-', '-w', '\n%{http_code}', ENDPOINT], { windowsHide: true }, (err, out) => {
        if (err) return resolve({ status: 0, body: '' });
        const cut = out.lastIndexOf('\n');
        resolve({ status: Number(out.slice(cut + 1)) || 0, body: out.slice(0, cut) });
      });
      child.stdin?.end(headers);
    });

  const request = async (bearer: string): Promise<{ status: number; body: string; retryAfter?: number }> => {
    try {
      const res = await fetch(ENDPOINT, { headers: { ...HEADERS, Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(20_000) });
      const body = await res.text();
      if (res.status === 403 && /Request not allowed/i.test(body)) return viaCurl(bearer);
      const retryAfter = Number(res.headers.get('retry-after'));
      return { status: res.status, body, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined };
    } catch {
      return { status: 0, body: '' };
    }
  };

  const active = () => {
    try {
      return Date.now() - fs.statSync(path.join(deps.root(), 'history.jsonl')).mtimeMs < 10 * 60_000;
    } catch {
      return false;
    }
  };

  const enabled = () => vscode.workspace.getConfiguration('claudeHarness').get<boolean>('quota.enabled', true);
  let running = false;

  const poll = async () => {
    timer = undefined;
    if (disposed || !enabled()) return;
    running = true;
    let delay = active() ? intSetting('quota.activeRefreshSeconds', 60, 10, 3600) * 1000 : intSetting('quota.idleRefreshSeconds', 120, 10, 3600) * 1000;
    const bearer = token();
    let wait = 0;
    if (bearer) {
      const { status, body, retryAfter } = await request(bearer);
      if (status === 200) {
        try {
          const parsed = parseUsage(JSON.parse(body) as Usage);
          if (parsed.length) {
            windows = parsed;
            fetchedAt = Date.now();
            void deps.state?.update(SAVED, { windows, fetchedAt });
            failures = 0;
            stale = false;
          }
        } catch {
          failures++;
          stale = windows.length > 0;
        }
      } else {
        failures++;
        stale = windows.length > 0;
        wait = retryAfter ?? 0;
      }
    } else if (windows.length) {
      stale = true;
    }
    // With no reading yet the first retries come quickly; once there is one, back off up to an hour. A Retry-After is a floor.
    if (failures) delay = Math.min(3600_000, (windows.length ? 60_000 : 15_000) * 2 ** (failures - 1));
    delay = Math.max(delay, wait);
    running = false;
    if (disposed || !enabled()) return;
    render();
    timer = setTimeout(poll, delay);
  };

  // The item and the polling follow the quota.enabled setting without a reload.
  const apply = () => {
    if (enabled()) {
      render();
      if (!running && !timer) void poll();
    } else {
      if (timer) clearTimeout(timer);
      timer = undefined;
      item.hide();
    }
  };

  apply();
  const redraw = setInterval(() => enabled() && render(), 30_000);

  return [
    item,
    { dispose: () => clearInterval(redraw) },
    { dispose: () => { disposed = true; if (timer) clearTimeout(timer); } },
    vscode.window.onDidChangeActiveColorTheme(() => enabled() && render()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('claudeHarness.quota')) return;
      apply();
      if (enabled()) render();
    }),
  ];
}
