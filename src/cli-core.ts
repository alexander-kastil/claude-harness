import * as os from 'os';
import * as path from 'path';
import { ScopeView, KeepCopies, applyMcpState, globalScope, knownRepos, linkCopies, pluginDirs, pluginViews, repoScope, scan } from './harness';
import { findProvider } from './standard';

// The argument parsing, the output and the loaded harness that every CLI command shares.

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface Args {
  words: string[];
  flags: Map<string, string[]>;
}

const BOOLEAN = new Set(['json', 'help', 'retire', 'dry-run', 'apply', 'yes', 'week', 'drop-files']);
const VALUED = new Set(['root', 'repo', 'repos', 'user-config', 'from', 'name', 'kind', 'category', 'skills', 'agents', 'market', 'description', 'session', 'week-used', 'line', 'position', 'leaf', 'leaves', 'to', 'file', 'files', 'scope', 'model', 'tools', 'url', 'command', 'args', 'transport', 'paths', 'matcher', 'summary', 'area', 'rule']);

export class Stop extends Error {
  constructor(message: string, readonly code = 1) {
    super(message);
  }
}

const PATH_FLAGS = new Set(['root', 'repo', 'user-config', 'from', 'market', 'file']);

/** Git Bash writes C:/Users as /c/Users; Node on Windows opens only the drive form. */
export function winPath(p: string): string {
  return process.platform === 'win32' ? p.replace(/^\/([a-zA-Z])\/(.*)/, '$1:/$2') : p;
}

/** The path flags are read as Windows paths; `--repos` holds several and `--files` holds <file>=<path in the plugin>. */
function pathValue(key: string, value: string): string {
  if (key === 'repos') return value.split(',').map(winPath).join(',');
  if (key === 'files') {
    const i = value.lastIndexOf('=');
    return i < 1 ? winPath(value) : winPath(value.slice(0, i)) + value.slice(i);
  }
  return PATH_FLAGS.has(key) ? winPath(value) : value;
}

export function parse(argv: string[]): Args {
  const words: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      words.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split(/=(.*)/s);
    if (BOOLEAN.has(key)) flags.set(key, ['true']);
    else if (!VALUED.has(key)) throw new Stop(`unknown flag: --${key}`, 2);
    else {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Stop(`--${key} needs a value.`, 2);
      flags.set(key, [...(flags.get(key) ?? []), pathValue(key, value)]);
    }
  }
  return { words, flags };
}

export const one = (a: Args, key: string) => a.flags.get(key)?.[a.flags.get(key)!.length - 1];
export const list = (a: Args, key: string) => (one(a, key) ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** Every JSON result carries `applied`; a dry run and a real run have the same shape. */
export function emit(io: Io, a: Args, json: object, text: string[], applied = false): void {
  io.out(one(a, 'json') ? JSON.stringify({ ...json, applied }, null, 2) : text.join('\n'));
}

export interface World {
  root: string;
  views: ScopeView[];
  plugins: ScopeView[];
  keep?: KeepCopies;
  repos: string[];
}

/** The views the extension builds in `refresh`: Global, each known repo, the plugins, the copies linked across them. */
export function load(a: Args): World {
  const root = path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));
  const userConfig = one(a, 'user-config') ?? path.join(os.homedir(), '.claude.json');
  const extra = [...(a.flags.get('repo') ?? []), ...list(a, 'repos'), ...(one(a, 'from') && one(a, 'from') !== 'global' ? [one(a, 'from')!] : [])];
  const repos = knownRepos(extra, userConfig);
  const global = { ...globalScope(root), userConfig, mcpFile: userConfig };
  const scopes = [global, ...repos.map(dir => repoScope(dir, userConfig))];
  const views = scopes.map(s => ({ id: s.id, label: s.label, path: s.base, categories: scan(s) }));
  applyMcpState(views, userConfig);
  const plugins = pluginViews(root);
  linkCopies(views, plugins);
  return { root, views, plugins, keep: findProvider(pluginDirs(root, true))?.keepCopies, repos };
}

// ---- text output ----

/** A bold line that opens a section of text output. */
export function headline(text: string): string {
  return `**${text}**`;
}

/** A Markdown table whose cells are padded to their column's width, so it reads as a table in plain text too. */
export function table(head: string[], rows: (string | number)[][], right: boolean[] = []): string[] {
  const cell = (v: string | number) => String(v).replace(/\|/g, '\\|');
  const grid = [head, ...rows].map(r => head.map((_, i) => cell(r[i] ?? '')));
  const widths = head.map((_, i) => Math.max(right[i] ? 4 : 3, ...grid.map(r => r[i].length)));
  const line = (r: string[]) => `| ${r.map((s, i) => (right[i] ? s.padStart(widths[i]) : s.padEnd(widths[i]))).join(' | ')} |`;
  const separator = head.map((_, i) => (right[i] ? `${'-'.repeat(widths[i] - 1)}:` : '-'.repeat(widths[i])));
  return [line(grid[0]), `| ${separator.join(' | ')} |`, ...grid.slice(1).map(line)];
}

/** Counts as 436, 436K, 8.8M below ten million, 12M above. */
export function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${Math.round(n / 1000)}K`;
  if (n < 1e7) return `${Number((n / 1e6).toFixed(1))}M`;
  return `${Math.round(n / 1e6)}M`;
}

/** Dollars with two decimals: $0.42, $12.30. */
export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** A share as a percentage: 0.123 is 12%, and 12.300% with three digits. */
export function fmtPct(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}
