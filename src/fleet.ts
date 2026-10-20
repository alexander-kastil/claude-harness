import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { Asset, Layout, ScopeView, claudeMdText, layoutOf } from './harness';
import { CheckResult, run } from './standard';

const readJson = (file: string): Record<string, unknown> => {
  try {
    const value = parseJsonc(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

export interface GuardInfo {
  dir: string;
  dirty: string[];
  sessionMinutes?: number;
  worktrees: string[];
}

export const projectSlug = (dir: string) => path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');

export function lastSession(dir: string, home = os.homedir()): number | undefined {
  const folder = path.join(home, '.claude', 'projects', projectSlug(dir));
  let newest = 0;
  try {
    for (const f of fs.readdirSync(folder)) if (f.endsWith('.jsonl')) newest = Math.max(newest, fs.statSync(path.join(folder, f)).mtimeMs);
  } catch {
    return undefined;
  }
  return newest ? (Date.now() - newest) / 60000 : undefined;
}

export async function guardInfo(dir: string, busyMinutes = 10): Promise<GuardInfo> {
  const status = await run('git', ['--no-optional-locks', 'status', '--porcelain', '--', 'CLAUDE.md', 'CLAUDE.local.md', '.claude'], dir, 20000);
  const dirty = status.code === 0 ? status.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];
  const minutes = lastSession(dir);
  let worktrees: string[] = [];
  try {
    worktrees = fs.readdirSync(path.join(dir, '.claude', 'worktrees')).filter(n => !n.startsWith('.'));
  } catch {
    worktrees = [];
  }
  return { dir, dirty, sessionMinutes: minutes !== undefined && minutes < busyMinutes ? minutes : undefined, worktrees };
}

export const guardReasons = (g: GuardInfo): string[] =>
  [
    g.dirty.length ? `${g.dirty.length} uncommitted harness ${g.dirty.length === 1 ? 'file' : 'files'}` : '',
    g.sessionMinutes !== undefined ? `Claude session active ${Math.round(g.sessionMinutes)} min ago` : '',
    g.worktrees.length ? `${g.worktrees.length} stale .claude/worktrees ${g.worktrees.length === 1 ? 'copy' : 'copies'}` : '',
  ].filter(Boolean);

export interface FleetRow {
  id: string;
  label: string;
  path: string;
  layout: Layout;
  lines: number;
  emDashes: number;
  check?: { fail: number; review: number; restated: number; kind: string };
  checkState: string;
  plugins: string[];
  hookCopies: number;
  copies: number;
}

export function fleetRow(view: ScopeView, check: { state: string; result?: CheckResult }): FleetRow {
  const text = claudeMdText(view.path, false);
  const items = (kind: string) => view.categories.find(c => c.kind === kind)?.items ?? [];
  const enabled = ['settings.json', 'settings.local.json'].flatMap(f =>
    Object.entries((readJson(path.join(view.path, '.claude', f)).enabledPlugins ?? {}) as Record<string, boolean>)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
  );
  const copied = (a: Asset) => !!a.copies?.length;
  const result = check.result;
  return {
    id: view.id,
    label: view.label,
    path: view.path,
    layout: layoutOf(view.path),
    lines: text === undefined ? 0 : text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0),
    emDashes: text === undefined ? 0 : text.split(/\r?\n/).filter(l => l.includes(String.fromCharCode(0x2014))).length,
    check: result ? { fail: result.fail, review: result.review, restated: result.findings.filter(f => /restates house rule/.test(f.text)).length, kind: result.kind } : undefined,
    checkState: check.state,
    plugins: [...new Set(enabled)].sort(),
    hookCopies: items('hookScript').filter(copied).length,
    copies: [...items('skill'), ...items('agent')].filter(copied).length,
  };
}

export interface MarketPlugin {
  name: string;
  key: string;
  installed?: string;
  source?: string;
  ahead: boolean;
  enabled: boolean;
}

export interface MarketHealth {
  name: string;
  source: string;
  kind: string;
  location: string;
  plugins: MarketPlugin[];
}

export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split(/[.+-]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const [p, q] = [x[i] ?? 0, y[i] ?? 0];
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    return String(p).localeCompare(String(q));
  }
  return 0;
}

export function marketplaceHealth(root: string): MarketHealth[] {
  type Market = { source?: { source?: string; repo?: string; path?: string; url?: string }; installLocation?: string };
  const markets = readJson(path.join(root, 'plugins', 'known_marketplaces.json')) as Record<string, Market>;
  const installed = (readJson(path.join(root, 'plugins', 'installed_plugins.json')).plugins ?? {}) as Record<string, Array<{ scope?: string; version?: string }>>;
  const enabled = (readJson(path.join(root, 'settings.json')).enabledPlugins ?? {}) as Record<string, boolean>;
  return Object.entries(markets)
    .map(([name, m]) => {
      const location = m.installLocation ?? m.source?.path ?? '';
      const kind = m.source?.source ?? 'unknown';
      const source = m.source?.repo ?? m.source?.path ?? m.source?.url ?? location;
      const catalog = (readJson(path.join(location, '.claude-plugin', 'marketplace.json')).plugins ?? []) as { name?: string; source?: unknown; version?: string }[];
      const keys = new Set([...catalog.filter(p => p.name).map(p => `${p.name}@${name}`), ...Object.keys(installed).filter(k => k.endsWith(`@${name}`))]);
      const plugins = [...keys]
        .map(key => {
          const plugin = key.slice(0, key.lastIndexOf('@'));
          const entry = catalog.find(p => p.name === plugin);
          const dir = entry && typeof entry.source === 'string' ? path.resolve(location, entry.source) : path.join(location, plugin);
          const sourceVersion = entry?.version ?? (readJson(path.join(dir, '.claude-plugin', 'plugin.json')).version as string | undefined);
          const list = installed[key] ?? [];
          const installedVersion = (list.find(e => e.scope === 'user') ?? list[0])?.version;
          return {
            name: plugin,
            key,
            installed: installedVersion,
            source: sourceVersion,
            ahead: !!(installedVersion && sourceVersion && compareVersions(sourceVersion, installedVersion) > 0),
            enabled: enabled[key] === true,
          };
        })
        .filter(p => p.installed || p.enabled || kind === 'directory')
        .sort((a, b) => Number(b.ahead) - Number(a.ahead) || a.name.localeCompare(b.name));
      return { name, source, kind, location, plugins };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface FileEdit {
  file: string;
  before: string;
  after: string;
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

export function renameInSettings(file: string, from: string, to: string): FileEdit | undefined {
  if (!fs.existsSync(file)) return undefined;
  const before = fs.readFileSync(file, 'utf8');
  const data = readJson(file);
  const fmt = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: eolOf(before) } };
  let text = before;
  const plugins = (data.enabledPlugins ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(plugins)) {
    if (!key.endsWith(`@${from}`)) continue;
    const next = `${key.slice(0, -from.length)}${to}`;
    text = applyEdits(text, modify(text, ['enabledPlugins', key], undefined, fmt));
    text = applyEdits(text, modify(text, ['enabledPlugins', next], value, fmt));
  }
  const markets = (data.extraKnownMarketplaces ?? {}) as Record<string, unknown>;
  if (from in markets) {
    text = applyEdits(text, modify(text, ['extraKnownMarketplaces', from], undefined, fmt));
    text = applyEdits(text, modify(text, ['extraKnownMarketplaces', to], markets[from], fmt));
  }
  return text === before ? undefined : { file, before, after: text };
}

export function renameCatalog(location: string, to: string): FileEdit | undefined {
  const file = path.join(location, '.claude-plugin', 'marketplace.json');
  if (!fs.existsSync(file)) return undefined;
  const before = fs.readFileSync(file, 'utf8');
  const after = applyEdits(before, modify(before, ['name'], to, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: eolOf(before) } }));
  return after === before ? undefined : { file, before, after };
}

export function renameCommands(market: MarketHealth, to: string): string[] {
  const installed = market.plugins.filter(p => p.installed).map(p => p.name);
  return [`claude plugin marketplace remove ${market.name}`, `claude plugin marketplace add "${market.location}"`, ...installed.map(p => `claude plugin install ${p}@${to} --scope user`)];
}
