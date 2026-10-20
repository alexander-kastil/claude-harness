import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse as parseJsonc } from 'jsonc-parser';

export type Level = 'FAIL' | 'REVIEW' | 'INFO';

export interface Location {
  file: string;
  line: number | null;
  token?: string;
}

export interface Finding {
  level: Level;
  text: string;
  locations: Location[];
}

export interface CheckResult {
  repo: string;
  kind: 'class' | 'product';
  fail: number;
  review: number;
  findings: Finding[];
}

export interface HarnessPlugin {
  market: string;
  dir: string;
  check: string;
  fix: string;
  init: string;
}

export const PLUGIN_INSTALL = 'claude plugin install harness-plugin@integrations-marketplace';

const readJson = (file: string): Record<string, unknown> => {
  try {
    const value = parseJsonc(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

const pluginAt = (market: string, dir: string): HarnessPlugin | undefined => {
  const plugin = {
    market,
    dir,
    check: path.join(dir, 'skills', 'fix-constitution', 'scripts', 'check-constitution.py'),
    fix: path.join(dir, 'skills', 'fix-constitution', 'scripts', 'fix-settings.py'),
    init: path.join(dir, 'skills', 'init-product-repo', 'scripts', 'init-product-repo.py'),
  };
  return fs.existsSync(plugin.check) ? plugin : undefined;
};

export function findHarnessPlugin(root: string): HarnessPlugin | undefined {
  type Market = { source?: { source?: string; path?: string }; installLocation?: string };
  const markets = Object.entries(readJson(path.join(root, 'plugins', 'known_marketplaces.json')) as Record<string, Market>);
  markets.sort(([, a], [, b]) => Number(b.source?.source === 'directory') - Number(a.source?.source === 'directory'));
  for (const [market, m] of markets) {
    const location = m.installLocation ?? m.source?.path;
    if (!location) continue;
    const entry = ((readJson(path.join(location, '.claude-plugin', 'marketplace.json')).plugins ?? []) as { name?: string; source?: unknown }[]).find(p => p.name === 'harness-plugin');
    const dirs = [typeof entry?.source === 'string' ? path.resolve(location, entry.source) : '', path.join(location, 'harness-plugin')].filter(Boolean);
    for (const dir of dirs) {
      const found = pluginAt(market, dir);
      if (found) return found;
    }
  }
  const installed = (readJson(path.join(root, 'plugins', 'installed_plugins.json')).plugins ?? {}) as Record<string, { installPath?: string }[]>;
  for (const [key, entries] of Object.entries(installed))
    if (key.startsWith('harness-plugin@'))
      for (const e of entries) {
        const found = e.installPath ? pluginAt(key.split('@')[1], e.installPath) : undefined;
        if (found) return found;
      }
  return undefined;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const env = () => ({ ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });

export function run(command: string, args: string[], cwd?: string, timeout = 60000): Promise<RunResult> {
  return new Promise(resolve =>
    execFile(command, args, { cwd, env: env(), windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : -1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? err?.message ?? '') })
    )
  );
}

let python: Promise<string[] | undefined> | undefined;

export function findPython(): Promise<string[] | undefined> {
  python ??= (async () => {
    for (const candidate of [['python'], ['py', '-3'], ['python3']]) {
      const r = await run(candidate[0], [...candidate.slice(1), '--version'], undefined, 15000);
      if (r.code === 0 && /^Python 3\./m.test(`${r.stdout}${r.stderr}`)) return candidate;
    }
    return undefined;
  })();
  return python;
}

export const runScript = (py: string[], script: string, args: string[], cwd?: string) => run(py[0], [...py.slice(1), script, ...args], cwd);

export function parseCheckJson(stdout: string): CheckResult | undefined {
  const line = stdout.split(/\r?\n/).find(l => l.trim().startsWith('{'));
  if (!line) return undefined;
  try {
    const data = JSON.parse(line) as CheckResult;
    return Array.isArray(data.findings) ? data : undefined;
  } catch {
    return undefined;
  }
}

const textLocation = (text: string): Location[] => {
  const review = /^REVIEW line (\d+)/.exec(text);
  if (review) return [{ file: 'CLAUDE.md', line: Number(review[1]) }];
  const settings = /^FAIL (\.claude\/settings(?:\.local)?\.json)/.exec(text);
  if (settings) return [{ file: settings[1], line: null }];
  const hook = /still present: (\.claude\/hooks\/\S+)/.exec(text);
  if (hook) return [{ file: hook[1], line: null }];
  const pointer = /^FAIL pointer not found: (\S+)/.exec(text);
  if (pointer) return [{ file: 'CLAUDE.md', line: null, token: pointer[1] }];
  return /^INFO/.test(text) ? [] : [{ file: 'CLAUDE.md', line: null }];
};

export function parseCheckText(stdout: string): CheckResult {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const summary = lines.map(l => /^repo=(\S*) kind=(\S+) fail=(\d+) review=(\d+)/.exec(l)).find(Boolean);
  const findings = lines
    .filter(l => /^(FAIL|REVIEW|INFO) /.test(l))
    .map(text => ({ level: text.split(' ')[0] as Level, text, locations: textLocation(text) }));
  return {
    repo: summary?.[1] ?? '',
    kind: summary?.[2] === 'class' ? 'class' : 'product',
    fail: summary ? Number(summary[3]) : findings.filter(f => f.level === 'FAIL').length,
    review: summary ? Number(summary[4]) : findings.filter(f => f.level === 'REVIEW').length,
    findings,
  };
}

export async function checkRepo(plugin: HarnessPlugin, py: string[], dir: string): Promise<CheckResult> {
  const json = await runScript(py, plugin.check, [dir, '--json']);
  const parsed = parseCheckJson(json.stdout);
  if (parsed) return parsed;
  if (!/unrecognized arguments/.test(json.stderr) && !json.stdout.trim()) throw new Error(json.stderr.trim() || `check-constitution.py exited with ${json.code}`);
  return parseCheckText((await runScript(py, plugin.check, [dir])).stdout);
}

export interface Problem {
  file: string;
  line: number;
  token?: string;
  level: Level;
  message: string;
  code: string;
}

export const findingCode = (text: string): string =>
  /restates house rule/.test(text) ? 'restated' : /boilerplate section/.test(text) ? 'boilerplate' : /pointer not found/.test(text) ? 'pointer' : /em dashes/.test(text) ? 'em-dash' : /^FAIL lines=/.test(text) ? 'lines' : /section/.test(text) ? 'sections' : /hook/.test(text) ? 'hook' : /\.claude\/settings/.test(text) ? 'settings' : 'standard';

export function problemsOf(result: CheckResult, repoDir: string, lineOf: (file: string, token: string) => number | undefined = () => undefined): Problem[] {
  const out: Problem[] = [];
  for (const f of result.findings) {
    const message = f.text.replace(/^(FAIL|REVIEW|INFO) /, '');
    for (const loc of f.locations) {
      const file = path.join(repoDir, ...loc.file.split('/'));
      const line = loc.line ?? (loc.token ? lineOf(file, loc.token) : undefined) ?? 1;
      out.push({ file, line: Math.max(0, line - 1), token: loc.token, level: f.level, message, code: findingCode(f.text) });
    }
  }
  return out;
}

export function parseFixOutput(stdout: string): { changes: string[]; count: number } {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const summary = lines.map(l => /^repo=\S* changes=(\d+)/.exec(l)).find(Boolean);
  return { changes: lines.filter(l => !/^repo=/.test(l)), count: summary ? Number(summary[1]) : 0 };
}

export interface InitForm {
  summary: string;
  areas: { name: string; globs: string; owner: string }[];
  rules: string[];
}

export function initArgs(dir: string, form: InitForm, apply: boolean): string[] {
  const args = ['--root', dir, '--summary', form.summary.trim()];
  for (const a of form.areas.filter(a => a.name.trim() && a.globs.trim() && a.owner.trim()))
    args.push('--area', `${a.name.trim()}=${a.globs.split(/[,\n]/).map(g => g.trim()).filter(Boolean).join(',')}:${a.owner.trim()}`);
  for (const r of form.rules.map(r => r.trim()).filter(Boolean)) args.push('--rule', r);
  if (apply) args.push('--apply');
  return args;
}

export function parseInitOutput(stdout: string): { files: { action: 'create' | 'skip'; rel: string }[]; summary: string } {
  const lines = stdout.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
  return {
    files: lines.map(l => /^(create|skip)\s+(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map(m => ({ action: m[1] as 'create' | 'skip', rel: m[2].trim() })),
    summary: lines.find(l => /^created=/.test(l)) ?? '',
  };
}

const SETTINGS = ['settings.json', 'settings.local.json'];

export interface FixPreview {
  changes: string[];
  files: { rel: string; before: string; after?: string }[];
  temp: string;
}

export async function previewFix(plugin: HarnessPlugin, py: string[], dir: string, keepPlugins: boolean, globalSettings: string): Promise<FixPreview> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fix-'));
  const src = path.join(dir, '.claude');
  const dst = path.join(temp, '.claude');
  fs.mkdirSync(dst, { recursive: true });
  for (const name of SETTINGS) if (fs.existsSync(path.join(src, name))) fs.copyFileSync(path.join(src, name), path.join(dst, name));
  if (fs.existsSync(path.join(src, 'hooks'))) fs.cpSync(path.join(src, 'hooks'), path.join(dst, 'hooks'), { recursive: true });
  const dry = await runScript(py, plugin.fix, [dir, '--global-settings', globalSettings, ...(keepPlugins ? ['--keep-plugins'] : [])]);
  if (dry.code !== 0) throw new Error(dry.stderr.trim() || `fix-settings.py exited with ${dry.code}`);
  const applied = await runScript(py, plugin.fix, [temp, '--global-settings', globalSettings, '--apply', ...(keepPlugins ? ['--keep-plugins'] : [])]);
  if (applied.code !== 0) throw new Error(applied.stderr.trim() || `fix-settings.py exited with ${applied.code}`);
  const files: FixPreview['files'] = [];
  for (const name of SETTINGS) {
    const before = path.join(src, name);
    if (!fs.existsSync(before)) continue;
    const after = path.join(dst, name);
    const a = fs.readFileSync(before, 'utf8');
    const b = fs.existsSync(after) ? fs.readFileSync(after, 'utf8') : undefined;
    if (b === undefined || b.replace(/\r\n/g, '\n') !== a.replace(/\r\n/g, '\n')) files.push({ rel: `.claude/${name}`, before, after: b === undefined ? undefined : after });
  }
  for (const f of fs.existsSync(path.join(src, 'hooks')) ? fs.readdirSync(path.join(src, 'hooks')) : [])
    if (!fs.existsSync(path.join(dst, 'hooks', f))) files.push({ rel: `.claude/hooks/${f}`, before: path.join(src, 'hooks', f) });
  return { changes: parseFixOutput(dry.stdout).changes, files, temp };
}

export async function applyFix(plugin: HarnessPlugin, py: string[], dir: string, keepPlugins: boolean, globalSettings: string): Promise<string[]> {
  const r = await runScript(py, plugin.fix, [dir, '--global-settings', globalSettings, '--apply', ...(keepPlugins ? ['--keep-plugins'] : [])]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `fix-settings.py exited with ${r.code}`);
  return parseFixOutput(r.stdout).changes;
}
