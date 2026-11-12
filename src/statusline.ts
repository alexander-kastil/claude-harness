import * as fs from 'fs';
import * as path from 'path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { STATUSLINE_FIELDS } from './shared/statusline-fields';
import type { StatuslineScope, StatuslineState, ToHost } from './shared/messages';

export const SCRIPT_NAME = 'harness-statusline.cjs';
const PREVIOUS_NAME = 'harness-statusline.previous.json';
const MARK = '// harness-statusline-fields:';

/** Where the builder reads and writes: the Claude folder for the user scope, the first workspace folder for the project scope. */
export interface StatuslineRoots {
  userRoot: string;
  projectDir?: string;
}

/**
 * The Node script Claude Code runs as the status line command. It reads the JSON Claude Code passes on stdin
 * (model.display_name, context_window.used_percentage, rate_limits.five_hour and seven_day, cost.total_cost_usd,
 * workspace.current_dir, worktree.branch) and prints one line. When no rate_limits come, it reads the usage endpoint the way
 * quota.ts does (the oauth token of `.credentials.json`, a claude-code User-Agent) and keeps the answer for five minutes beside itself.
 */
export function buildScript(fields: string[]): string {
  const ids = fields.filter(f => STATUSLINE_FIELDS.some(x => x.id === f));
  return String.raw`// Written by Claude Harness: the status line builder. Saving again rewrites this file.
${MARK} ${ids.join(',')}
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const FIELDS = ${JSON.stringify(ids)};
const ENDPOINT = process.env.HARNESS_STATUSLINE_USAGE_URL || 'https://api.anthropic.com/api/oauth/usage';
const CACHE = path.join(__dirname, 'harness-statusline.usage.json');
const FRESH_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;

const pct = v => (typeof v === 'number' && isFinite(v) ? Math.round(v) + '%' : undefined);

// The windows of the usage endpoint, read like quota.ts parseUsage: the limits list first, the older five_hour and seven_day after.
function windows(usage) {
  const out = {};
  for (const e of Array.isArray(usage && usage.limits) ? usage.limits : []) {
    const percent = Number(e.percent);
    if (!isFinite(percent)) continue;
    if ((e.kind === 'session' || e.group === 'session') && out.five === undefined) out.five = percent;
    if (e.kind === 'weekly_all' && out.week === undefined) out.week = percent;
  }
  const legacy = l => (l && isFinite(Number(l.utilization)) ? Number(l.utilization) : undefined);
  if (out.five === undefined) out.five = legacy(usage && usage.five_hour);
  if (out.week === undefined) out.week = legacy(usage && usage.seven_day);
  return out;
}

async function fetchUsage() {
  const root = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  let oauth = {};
  try {
    oauth = JSON.parse(fs.readFileSync(path.join(root, '.credentials.json'), 'utf8')).claudeAiOauth || {};
  } catch (e) {}
  if (!oauth.accessToken || (oauth.expiresAt && oauth.expiresAt <= Date.now())) return undefined;
  const headers = { Authorization: 'Bearer ' + oauth.accessToken, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json', 'User-Agent': 'claude-code/2.1.0' };
  const res = await fetch(ENDPOINT, { headers, signal: AbortSignal.timeout(3000) });
  return res.ok ? windows(await res.json()) : undefined;
}

async function limits() {
  let cached = {};
  try {
    cached = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch (e) {}
  const age = Date.now() - (cached.at || 0);
  if (age < (cached.ok ? FRESH_MS : RETRY_MS)) return cached;
  let got;
  try {
    got = await fetchUsage();
  } catch (e) {}
  const next = got ? { at: Date.now(), ok: true, five: got.five, week: got.week } : { at: Date.now(), ok: false, five: cached.five, week: cached.week };
  try {
    fs.writeFileSync(CACHE, JSON.stringify(next));
  } catch (e) {}
  return next;
}

function branchOf(input, dir) {
  if (input.worktree && input.worktree.branch) return input.worktree.branch;
  if (!dir) return '';
  const git = args => cp.execFileSync('git', ['-C', dir].concat(args), { encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return git(['symbolic-ref', '--short', '-q', 'HEAD']);
  } catch (e) {}
  // A detached HEAD has no branch: the short commit stands in.
  try {
    return git(['rev-parse', '--short', 'HEAD']);
  } catch (e) {
    return '';
  }
}

async function main(raw) {
  let input = {};
  try {
    input = JSON.parse(raw) || {};
  } catch (e) {}
  const dir = String((input.workspace && input.workspace.current_dir) || input.cwd || '').replace(/[\\/]+$/, '');
  const rate = input.rate_limits || {};
  let five = rate.five_hour && rate.five_hour.used_percentage;
  let week = rate.seven_day && rate.seven_day.used_percentage;
  if ((FIELDS.includes('fiveHour') && five === undefined) || (FIELDS.includes('weekly') && week === undefined)) {
    const got = await limits();
    if (five === undefined) five = got.five;
    if (week === undefined) week = got.week;
  }
  const part = {
    model: input.model && input.model.display_name,
    context: pct(input.context_window && input.context_window.used_percentage) && 'ctx ' + pct(input.context_window.used_percentage),
    fiveHour: pct(five) && '5h ' + pct(five),
    weekly: pct(week) && 'wk ' + pct(week),
    cost: input.cost && typeof input.cost.total_cost_usd === 'number' ? '$' + input.cost.total_cost_usd.toFixed(2) : undefined,
    branch: FIELDS.includes('branch') ? branchOf(input, dir) : '',
    folder: dir ? dir.split(/[\\/]/).pop() : undefined,
  };
  process.stdout.write(FIELDS.map(f => part[f]).filter(Boolean).join(' | '));
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => main(raw).catch(() => {}));
`;
}

/** The fields a written script was built with, in order; empty when the file is missing or not ours. */
export function fieldsOfScript(text: string): string[] {
  const line = text.split(/\r?\n/).find(l => l.startsWith(MARK));
  return line ? line.slice(MARK.length).split(',').map(s => s.trim()).filter(f => STATUSLINE_FIELDS.some(x => x.id === f)) : [];
}

const slash = (p: string) => p.replace(/\\/g, '/');

function files(scope: StatuslineScope, roots: StatuslineRoots) {
  const dir = scope === 'user' ? roots.userRoot : roots.projectDir ? path.join(roots.projectDir, '.claude') : undefined;
  if (!dir) return undefined;
  return { dir, settings: path.join(dir, 'settings.json'), script: path.join(dir, SCRIPT_NAME), previous: path.join(dir, PREVIOUS_NAME) };
}

const readText = (file: string): string => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const statusLineOf = (text: string): unknown => (parseJsonc(text, [], { allowTrailingComma: true }) as { statusLine?: unknown } | undefined)?.statusLine;
const isOurs = (value: unknown): boolean => typeof value === 'object' && value !== null && String((value as { command?: unknown }).command ?? '').includes(SCRIPT_NAME);

// Settings edits touch the statusLine key alone: the comments, order and line endings of the rest stay as they are.
function writeStatusLine(file: string, value: unknown): void {
  const text = readText(file) || '{}';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const edits = modify(text, ['statusLine'], value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol } });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, applyEdits(text, edits));
}

/** What the page shows for one scope: the file it would write, the fields of the script already there, and the value Remove would put back. */
export function readStatusline(scope: StatuslineScope, roots: StatuslineRoots): StatuslineState {
  const f = files(scope, roots);
  if (!f) return { scope, available: false, settingsFile: '', scriptFile: '', fields: [], installed: false, current: undefined, hasPrevious: false };
  const current = statusLineOf(readText(f.settings));
  const script = readText(f.script);
  const prev = readText(f.previous);
  return {
    scope,
    available: true,
    settingsFile: slash(f.settings),
    scriptFile: slash(f.script),
    fields: fieldsOfScript(script),
    installed: isOurs(current) && !!script,
    current,
    hasPrevious: !!prev && 'previous' in (JSON.parse(prev) as object),
  };
}

/** Writes the script and points `statusLine` at it, keeping the value that was there before for Remove. */
export function saveStatusline(scope: StatuslineScope, fields: string[], roots: StatuslineRoots): StatuslineState {
  const f = files(scope, roots);
  if (!f) throw new Error('No folder is open for the project scope.');
  const before = statusLineOf(readText(f.settings));
  fs.mkdirSync(f.dir, { recursive: true });
  // Saving again keeps the first record: the value before the builder ever wrote is the one worth putting back.
  if (!isOurs(before) || !fs.existsSync(f.previous)) fs.writeFileSync(f.previous, JSON.stringify(before === undefined ? {} : { previous: before }));
  fs.writeFileSync(f.script, buildScript(fields));
  writeStatusLine(f.settings, { type: 'command', command: `node "${slash(f.script)}"` });
  return readStatusline(scope, roots);
}

/** The panel's three requests; a failed write answers with the unchanged state and the reason as the note. */
export async function runStatusline(m: Extract<ToHost, { type: 'statuslineRead' | 'statuslineSave' | 'statuslineRemove' }>,roots: StatuslineRoots, changed: () => void): Promise<{ state: StatuslineState; note?: string }> {
  if (m.type === 'statuslineRead') return { state: readStatusline(m.scope, roots) };
  try {
    const state = m.type === 'statuslineSave' ? saveStatusline(m.scope, m.fields, roots) : removeStatusline(m.scope, roots);
    changed();
    return { state, note: m.type === 'statuslineSave' ? 'Saved' : 'Removed' };
  } catch (e) {
    return { state: readStatusline(m.scope, roots), note: `Not written: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Puts back the `statusLine` value from before the first Save (or removes the key when there was none) and deletes the script. */
export function removeStatusline(scope: StatuslineScope, roots: StatuslineRoots): StatuslineState {
  const f = files(scope, roots);
  if (!f) throw new Error('No folder is open for the project scope.');
  const current = statusLineOf(readText(f.settings));
  // A status line the owner set since is theirs; only our own files go.
  if (isOurs(current)) {
    const prev = readText(f.previous);
    const record = prev ? (JSON.parse(prev) as { previous?: unknown }) : {};
    writeStatusLine(f.settings, record.previous);
  }
  for (const file of [f.script, f.previous, path.join(f.dir, 'harness-statusline.usage.json')]) fs.rmSync(file, { force: true });
  return readStatusline(scope, roots);
}
