// The Permissions page's host side: the `permissions` block of the settings files of each scope, edits that keep the rest of the
// file as it was, and the tools that asked for permission in the sessions of a period, read from the transcripts. No vscode import.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';

/** The values of `permissions.defaultMode` Claude Code accepts, read from its binary (`default` also answers to `manual`). */
export const PERMISSION_MODES: { id: string; label: string; about: string }[] = [
  { id: 'default', label: 'Default', about: 'Standard behaviour: asks before anything that is not allowed by a rule.' },
  { id: 'acceptEdits', label: 'Accept edits', about: 'File edits are accepted without asking.' },
  { id: 'plan', label: 'Plan', about: 'Planning mode: Claude reads and plans, nothing is run or changed.' },
  { id: 'auto', label: 'Auto', about: 'A classifier approves or denies each permission prompt.' },
  { id: 'dontAsk', label: "Don't ask", about: 'Never asks: what a rule does not allow is denied.' },
  { id: 'bypassPermissions', label: 'Bypass', about: 'Skips every permission check.' },
];

export type PermissionScope = 'user' | 'project' | 'local' | 'managed';
export type RuleList = 'allow' | 'ask' | 'deny' | 'additionalDirectories';

/** One settings file as the page shows it. */
export interface PermissionsFile {
  scope: PermissionScope;
  path: string;
  exists: boolean;
  readOnly: boolean;
  allow: string[];
  ask: string[];
  deny: string[];
  additionalDirectories: string[];
  defaultMode?: string;
  /** Set when the file could not be read as JSON. */
  error?: string;
}

export interface PermissionsData {
  /** The repo the project and local scopes belong to. */
  dir?: string;
  files: PermissionsFile[];
  modes: { id: string; label: string; about: string }[];
  /** Why the last write was refused, shown as one muted line. */
  note?: string;
}

export type PermissionsChange = { op: 'add' | 'remove'; list: RuleList; value: string } | { op: 'mode'; value: string };

export interface PermissionsWrite {
  dir?: string;
  scope: Exclude<PermissionScope, 'managed'>;
  change: PermissionsChange;
}

/** The managed settings file of this machine; `CLAUDE_HARNESS_MANAGED_SETTINGS` points tests at their own. */
export function managedPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (env.CLAUDE_HARNESS_MANAGED_SETTINGS) return env.CLAUDE_HARNESS_MANAGED_SETTINGS;
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json';
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

export function settingsFile(root: string, scope: PermissionScope, dir?: string): string | undefined {
  if (scope === 'user') return path.join(root, 'settings.json');
  if (scope === 'managed') return managedPath();
  if (!dir) return undefined;
  return path.join(dir, '.claude', scope === 'project' ? 'settings.json' : 'settings.local.json');
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function readPermissionsFile(file: string, scope: PermissionScope): PermissionsFile {
  const out: PermissionsFile = { scope, path: file, exists: false, readOnly: scope === 'managed', allow: [], ask: [], deny: [], additionalDirectories: [] };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  out.exists = true;
  const errors: ParseError[] = [];
  const json = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length && (json === undefined || json === null || typeof json !== 'object')) return { ...out, error: 'Not valid JSON' };
  const p = json && typeof json === 'object' ? (json as { permissions?: Record<string, unknown> }).permissions : undefined;
  if (p && typeof p === 'object') {
    out.allow = strings(p.allow);
    out.ask = strings(p.ask);
    out.deny = strings(p.deny);
    out.additionalDirectories = strings(p.additionalDirectories);
    if (typeof p.defaultMode === 'string') out.defaultMode = p.defaultMode;
  }
  return out;
}

/** The files of every scope; project and local only when a repo is named, managed only when the file exists. */
export function readPermissions(root: string, dir?: string): PermissionsData {
  const files: PermissionsFile[] = [readPermissionsFile(settingsFile(root, 'user')!, 'user')];
  if (dir) {
    files.push(readPermissionsFile(settingsFile(root, 'project', dir)!, 'project'));
    files.push(readPermissionsFile(settingsFile(root, 'local', dir)!, 'local'));
  }
  const managed = readPermissionsFile(managedPath(), 'managed');
  if (managed.exists) files.push(managed);
  return { dir, files, modes: PERMISSION_MODES };
}

/** The text of a settings file with one change applied; every other key, comment and the layout stay. Throws when the text is not JSON. */
export function applyPermissionsChange(text: string, change: PermissionsChange): string {
  const source = text.trim() ? text : '{}';
  const errors: ParseError[] = [];
  const json = parseJsonc(source, errors, { allowTrailingComma: true });
  if (errors.length && (json === undefined || json === null || typeof json !== 'object')) throw new Error('The settings file is not valid JSON.');
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('The settings file is not a JSON object.');
  const options = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: /\r\n/.test(source) ? '\r\n' : '\n' } };
  const perms = (json as { permissions?: Record<string, unknown> }).permissions;
  if (change.op === 'mode') {
    const edits = modify(source, ['permissions', 'defaultMode'], change.value || undefined, options);
    return applyEdits(source, edits);
  }
  const current = strings(perms && typeof perms === 'object' ? perms[change.list] : undefined);
  const next = change.op === 'add' ? (current.includes(change.value) ? current : [...current, change.value]) : current.filter(v => v !== change.value);
  return applyEdits(source, modify(source, ['permissions', change.list], next, options));
}

/** Writes one change into a scope's file, creating the file (and its folder) when it does not exist. */
export function writePermissionsChange(file: string, change: PermissionsChange): void {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {}
  const next = applyPermissionsChange(text, change);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.trim() ? next : next.endsWith('\n') ? next : `${next}\n`, 'utf8');
}

/** The house confirm card of one change: what is written where, and that the rest of the file stays. */
export function permissionsCard(m: PermissionsWrite, file: string) {
  const c = m.change;
  const where = `${m.scope === 'user' ? 'user' : m.scope} settings`;
  const lead =
    c.op === 'mode'
      ? c.value
        ? `Sets permissions.defaultMode to ${c.value}.`
        : 'Removes permissions.defaultMode, so Claude Code uses its default.'
      : c.op === 'add'
        ? `Adds ${c.value} to permissions.${c.list}.`
        : `Removes ${c.value} from permissions.${c.list}.`;
  return {
    title: c.op === 'remove' ? 'Remove this entry?' : c.op === 'mode' ? 'Change the default mode?' : 'Add this entry?',
    sub: `in the ${where}`,
    facts: [lead, `File: ${file}`, 'Every other key and the layout of the file stay as they are.'],
    action: c.op === 'remove' ? 'Remove' : c.op === 'mode' ? 'Change' : 'Add',
    glyph: 'shield',
    danger: c.op === 'remove',
  };
}

type Ask = (card: ReturnType<typeof permissionsCard>) => Promise<'ok' | 'alt' | 'cancel'> | undefined;

/** One change after the owner confirmed it; the data to show next, with a note when nothing was written. */
export async function permissionsWrite(root: string, m: PermissionsWrite, ask: Ask): Promise<PermissionsData> {
  const refused = (note: string): PermissionsData => ({ ...readPermissions(root, m.dir), note });
  const file = settingsFile(root, m.scope, m.dir);
  if (!file) return refused('Pick a repository first.');
  const change = m.change;
  if (change.op !== 'mode' && !change.value.trim()) return refused('An empty entry is not added.');
  const answer = await ask(permissionsCard(m, file));
  if (answer !== 'ok') return readPermissions(root, m.dir);
  try {
    writePermissionsChange(file, change);
  } catch (e) {
    return refused(e instanceof Error ? e.message : 'The file could not be written.');
  }
  return readPermissions(root, m.dir);
}

// ---- Prompted in ----

export interface PromptedRow {
  /** The rule Allow adds: a tool name, or `Bash(git push *)`. */
  pattern: string;
  tool: string;
  count: number;
  /** How the prompts ended: allowed for this once or for good, or denied. */
  once: number;
  always: number;
  denied: number;
  /** The newest prompt, epoch ms. */
  last: number;
  /** One command or path that asked, for the hover. */
  sample: string;
}

export interface PromptedResult {
  rows: PromptedRow[];
  sessions: number;
}

/** Words that name a command with a verb after it: `git push`, `npm run`. The rule covers the verb, not every use of the program. */
const VERBED = new Set(['git', 'npm', 'npx', 'pnpm', 'yarn', 'docker', 'dotnet', 'gh', 'az', 'kubectl', 'cargo', 'go', 'pip', 'systemctl', 'code', 'claude']);

/** The rule that would have allowed one tool use. */
export function rulePattern(tool: string, input: unknown): string {
  const inp = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = typeof inp.command === 'string' ? inp.command : '';
    const parts = command
      .split(/&&|\|\||;|\|/)
      .map(s => s.trim())
      .filter(s => s && !/^cd(\s|$)/.test(s));
    const words = (parts[0] || '').split(/\s+/).filter(Boolean);
    if (!words.length) return tool;
    const head = VERBED.has(words[0]) && words[1] && !words[1].startsWith('-') ? `${words[0]} ${words[1]}` : words[0];
    return `${tool}(${head} *)`;
  }
  if (tool === 'WebFetch') {
    try {
      return `WebFetch(domain:${new URL(String(inp.url)).hostname})`;
    } catch {
      return tool;
    }
  }
  return tool;
}

const sampleOf = (tool: string, input: unknown): string => {
  const inp = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const v = inp.command ?? inp.file_path ?? inp.path ?? inp.url ?? inp.pattern ?? '';
  return String(v).replace(/\s+/g, ' ').slice(0, 160);
};

const lines = (file: string) => readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });

/** The user was asked, or the run could not ask: the decision's source says so. */
const OUTCOME: Record<string, 'once' | 'always' | 'denied'> = { user_temporary: 'once', user_permanent: 'always', user_reject: 'denied' };

/**
 * The tool uses of one transcript that raised a permission prompt since `since`. Claude Code records the answer on the tool result
 * (`permissionDecision.source`: `user_temporary`, `user_permanent` or `user_reject`); a run that cannot ask writes "requested
 * permissions ... but you haven't granted it yet" or "requires approval" instead, counted as denied.
 */
export async function promptedInFile(file: string, since: number): Promise<{ id: string; at: number; outcome: 'once' | 'always' | 'denied' }[]> {
  const found: { id: string; at: number; outcome: 'once' | 'always' | 'denied' }[] = [];
  for await (const line of lines(file)) {
    if (!line.includes('"tool_result"')) continue;
    const viaDecision = line.includes('"permissionDecision"');
    if (!viaDecision && !line.includes("haven't granted it yet") && !line.includes('requires approval')) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec?.type !== 'user') continue;
    const block = Array.isArray(rec?.message?.content) ? rec.message.content.find((b: any) => b?.type === 'tool_result' && b.tool_use_id) : undefined;
    if (!block) continue;
    const at = Date.parse(rec.timestamp) || 0;
    if (at < since) continue;
    const source = rec.permissionDecision?.source as string | undefined;
    let outcome = source ? OUTCOME[source] : undefined;
    if (!outcome && !source && block.is_error && typeof block.content === 'string' && /haven't granted it yet|requires approval/.test(block.content)) outcome = 'denied';
    if (outcome) found.push({ id: block.tool_use_id, at, outcome });
  }
  return found;
}

async function toolUses(file: string, ids: Set<string>): Promise<Map<string, { tool: string; input: unknown }>> {
  const out = new Map<string, { tool: string; input: unknown }>();
  for await (const line of lines(file)) {
    if (!line.includes('"tool_use"')) continue;
    const hit = [...line.matchAll(/"id":"(toolu_[A-Za-z0-9_]+)"/g)].some(m => ids.has(m[1]));
    if (!hit) continue;
    try {
      const rec = JSON.parse(line);
      for (const b of Array.isArray(rec?.message?.content) ? rec.message.content : []) if (b?.type === 'tool_use' && ids.has(b.id)) out.set(b.id, { tool: String(b.name), input: b.input });
    } catch {}
  }
  return out;
}

/** The tools that asked for permission in the sessions of the last `days` days (every transcript under `<root>/projects`), counted per rule pattern. */
export async function scanPrompted(root: string, days: number, now = Date.now()): Promise<PromptedResult> {
  const since = days > 0 ? now - days * 86400_000 : 0;
  const rows = new Map<string, PromptedRow>();
  let sessions = 0;
  const projects = path.join(root, 'projects');
  let folders: string[] = [];
  try {
    folders = fs.readdirSync(projects);
  } catch {}
  for (const folder of folders) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(projects, folder)).filter(n => n.endsWith('.jsonl'));
    } catch {}
    for (const name of names) {
      const file = path.join(projects, folder, name);
      try {
        if (fs.statSync(file).mtimeMs < since) continue;
        const asked = await promptedInFile(file, since);
        if (!asked.length) continue;
        const uses = await toolUses(file, new Set(asked.map(a => a.id)));
        let any = false;
        for (const a of asked) {
          const use = uses.get(a.id);
          // These tools ask the person a question, not for permission: no rule makes them silent.
          if (!use || use.tool === 'AskUserQuestion' || use.tool === 'ExitPlanMode') continue;
          any = true;
          const pattern = rulePattern(use.tool, use.input);
          const row = rows.get(pattern) ?? { pattern, tool: use.tool, count: 0, once: 0, always: 0, denied: 0, last: 0, sample: sampleOf(use.tool, use.input) };
          row.count++;
          row[a.outcome]++;
          row.last = Math.max(row.last, a.at);
          rows.set(pattern, row);
        }
        if (any) sessions++;
      } catch {}
    }
  }
  return { rows: [...rows.values()].sort((a, b) => b.count - a.count || b.last - a.last), sessions };
}

/** The home folder of Claude Code's user settings, for a caller without a root of its own. */
export const defaultRoot = () => path.join(os.homedir(), '.claude');
