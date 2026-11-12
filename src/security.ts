// The harness security check: what in the Claude Code configuration on this PC could run foreign code, leak a secret or
// switch the permission prompts off. Read only; `applyFix` is the one write, for a finding whose fix is mechanical, and the
// panel calls it only after the confirm card. A secret value never leaves this file unmasked: findings carry `mask`ed text.
import * as fs from 'fs';
import * as path from 'path';
import { applyEdits, findNodeAtLocation, modify, parse, parseTree, type JSONPath } from 'jsonc-parser';
import type { Confirm } from './shared/messages';

export type Severity = 'high' | 'medium' | 'low';
export type SecurityCheck = 'hook' | 'mcp' | 'permission' | 'source';

/** The one edit a finding can be resolved with: set (`to`) or remove (no `to`) the JSON value at `path` in `file`. */
export interface SecurityFix {
  file: string;
  path: JSONPath;
  /** The new string value; absent removes the key or array item. */
  to?: string;
  /** What Resolve does, in a sentence. */
  does: string;
}

export interface SecurityFinding {
  /** Stable for the same place and rule, so the panel can name a finding to resolve after a new scan. */
  id: string;
  severity: Severity;
  check: SecurityCheck;
  title: string;
  /** Where it lives: Global, a repo's name or a plugin. */
  where: string;
  file: string;
  line: number;
  /** The offending text with every secret masked. */
  evidence?: string;
  why: string;
  /** Present only when the fix is safe and mechanical. */
  fix?: SecurityFix;
}

export interface SecurityReport {
  findings: SecurityFinding[];
  /** Files read. */
  scanned: number;
  at: number;
}

export interface SecurityRoots {
  /** The Claude folder, `~/.claude`. */
  root: string;
  /** The home folder, where `~/.claude.json` lives. */
  home: string;
  /** Repo folders to check. */
  repos: string[];
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);

/** A secret as it may be shown: the first characters and its length, never the rest. */
export function mask(value: string): string {
  return value.length <= 8 ? '••••' : `${value.slice(0, 3)}••••(${value.length})`;
}

const TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|glpat-[A-Za-z0-9_-]{15,}|npm_[A-Za-z0-9]{30,})/;
const SECRET_NAME = /key|token|secret|passw|pwd|auth|bearer|credential|cookie|signature/i;
const HAS_VARIABLE = /\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%/;
const PLAIN_WORD = /^(true|false|yes|no|none|null|on|off|\d{1,5})$/i;

/** Hides every secret-looking part of a line: known token shapes, `NAME=value` for a secret-like name, bearer values, URL credentials. */
export function maskText(text: string): string {
  return text
    .replace(new RegExp(TOKEN.source, 'g'), m => mask(m))
    .replace(/(\b[A-Za-z_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH)[A-Za-z_]*=)(["']?)([^\s"']+)/gi, (_m, k, q, v) => (HAS_VARIABLE.test(v) ? _m : `${k}${q}${mask(v)}`))
    .replace(/\b(Bearer|Basic|Token)\s+([^\s"'$]{6,})/g, (_m, k, v) => `${k} ${mask(v)}`)
    .replace(/\/\/([^/@\s:]+):([^@\s/]+)@/g, (_m, u, p) => `//${u}:${mask(p)}@`);
}

/** The secret inside a string, if it holds a literal one: a known token shape, or any value when the name says secret. */
function secretIn(value: string, name: string): string | undefined {
  if (!value || HAS_VARIABLE.test(value) && !TOKEN.test(value)) return undefined;
  const token = TOKEN.exec(value)?.[0];
  if (token) return token;
  const bearer = /^(?:Bearer|Basic|Token)\s+(\S{6,})$/i.exec(value)?.[1];
  if (bearer && !HAS_VARIABLE.test(bearer)) return bearer;
  if (SECRET_NAME.test(name) && value.length >= 6 && !PLAIN_WORD.test(value) && !HAS_VARIABLE.test(value)) return value;
  return undefined;
}

const variableName = (...parts: string[]) => {
  const v = parts.join('_').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  return /^\d/.test(v) ? `_${v}` : v || 'SECRET';
};

const readText = (file: string): string | undefined => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A JSON file with the places of its nodes, so a finding names the line of the value and a fix edits that value. */
class Doc {
  readonly tree;
  readonly data: any;
  constructor(readonly file: string, readonly text: string) {
    this.tree = parseTree(text);
    this.data = parse(text, [], { allowTrailingComma: true });
  }
  line(p: JSONPath): number {
    const node = this.tree && findNodeAtLocation(this.tree, p);
    const offset = node ? node.offset : 0;
    let n = 1;
    for (let i = 0; i < offset; i++) if (this.text.charCodeAt(i) === 10) n++;
    return n;
  }
}

class Scan {
  readonly findings: SecurityFinding[] = [];
  scanned = 0;
  private seen = new Set<string>();

  doc(file: string): Doc | undefined {
    const text = readText(file);
    if (text === undefined) return undefined;
    this.scanned++;
    const d = new Doc(file, text);
    return isObject(d.data) ? d : undefined;
  }

  add(f: Omit<SecurityFinding, 'id'>, key: string) {
    const id = `${f.check}:${path.resolve(f.file).replace(/\\/g, '/').toLowerCase()}:${key}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.findings.push({ id, ...f });
  }
}

// ---------------------------------------------------------------------------------------------------------------- hooks

const NET = String.raw`(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|Net\.WebClient|DownloadString)`;
const RUNNER = String.raw`(?:sudo\s+)?(?:sh|bash|zsh|dash|pwsh|powershell|iex|Invoke-Expression|python3?|node|perl|ruby)`;
const REMOTE_EXEC = [
  new RegExp(String.raw`\b${NET}\b[^\n]*?\|\s*${RUNNER}\b`, 'i'),
  new RegExp(String.raw`\b(?:iex|Invoke-Expression)\b[^\n]*\b${NET}\b`, 'i'),
  new RegExp(String.raw`\b(?:sh|bash|zsh|source)\s+<\(\s*(?:curl|wget)\b`, 'i'),
  new RegExp(String.raw`\b(?:eval|source|bash|sh)\b[^\n]*\$\(\s*(?:curl|wget)\b`, 'i'),
];
const SECRET_FILES = /(?:\.env\b|\.ssh[\\/]|\bid_rsa\b|\bid_ed25519\b|\.aws[\\/]credentials|\.npmrc|\.netrc|\.credentials\.json|\.kube[\\/]config|\.git-credentials|\.docker[\\/]config\.json|\bprintenv\b|\benv\s*\|)/i;
const SECRET_VARIABLE = /\$\{?[A-Za-z_]*(?:TOKEN|SECRET|API_KEY|PASSWORD)[A-Za-z_]*/;
const SENDS = /\b(?:curl|wget|nc|ncat|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|scp)\b/i;

const remoteExec = (text: string) => REMOTE_EXEC.some(r => r.test(text));

function scanHookCommand(scan: Scan, doc: Doc, p: JSONPath, command: string, where: string) {
  const key = p.join('/');
  if (remoteExec(command)) {
    scan.add(
      {
        severity: 'high',
        check: 'hook',
        title: 'A hook downloads code and runs it',
        where,
        file: doc.file,
        line: doc.line(p),
        evidence: maskText(clip(command.replace(/\s+/g, ' '), 160)),
        why: 'Whoever controls that address decides what runs on this PC, with your rights, on every matching tool call.',
      },
      key
    );
    return;
  }
  const reads = SECRET_FILES.test(command) || SECRET_VARIABLE.test(command);
  if (reads) {
    const sends = SENDS.test(command);
    scan.add(
      {
        severity: sends ? 'high' : 'medium',
        check: 'hook',
        title: sends ? 'A hook reads a secret and sends it over the network' : 'A hook reads a secret',
        where,
        file: doc.file,
        line: doc.line(p),
        evidence: maskText(clip(command.replace(/\s+/g, ' '), 160)),
        why: sends ? 'The secret leaves this PC each time the hook fires.' : 'A hook runs on every matching tool call; if it ever prints or logs what it reads, the secret ends up in the transcript.',
      },
      key
    );
  }
}

/** Every command of a `hooks` object, as found in settings files and in a plugin's hooks.json. */
function scanHooks(scan: Scan, doc: Doc, where: string) {
  const hooks = doc.data.hooks;
  if (!isObject(hooks)) return;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, i) => {
      if (!isObject(group) || !Array.isArray(group.hooks)) return;
      group.hooks.forEach((h: any, j: number) => {
        if (isObject(h) && typeof h.command === 'string') scanHookCommand(scan, doc, ['hooks', event, i, 'hooks', j, 'command'], h.command, where);
      });
    });
  }
}

// ------------------------------------------------------------------------------------------------------------ permissions

const ALLOW_ALL = new Set(['bash', 'bash(*)', 'bash(**)', 'bash(:*)', '*', 'powershell', 'powershell(*)', 'powershell(**)']);

function scanPermissions(scan: Scan, doc: Doc, where: string) {
  const perms = doc.data.permissions;
  if (isObject(perms) && Array.isArray(perms.allow)) {
    perms.allow.forEach((rule: unknown, i: number) => {
      if (typeof rule !== 'string' || !ALLOW_ALL.has(rule.trim().toLowerCase())) return;
      scan.add(
        {
          severity: 'high',
          check: 'permission',
          title: `The rule ${rule} allows every command`,
          where,
          file: doc.file,
          line: doc.line(['permissions', 'allow', i]),
          why: 'Claude runs any shell command without asking, so a prompt injected into a file or a web page can run one too.',
          fix: { file: doc.file, path: ['permissions', 'allow', i], does: `Removes "${rule}" from permissions.allow; Claude asks for commands again.` },
        },
        `allow/${rule.trim().toLowerCase()}`
      );
    });
  }
  if (isObject(perms) && perms.defaultMode === 'bypassPermissions')
    scan.add(
      {
        severity: 'high',
        check: 'permission',
        title: 'The default mode skips every permission prompt',
        where,
        file: doc.file,
        line: doc.line(['permissions', 'defaultMode']),
        evidence: 'defaultMode: bypassPermissions',
        why: 'Every session in this scope starts with no prompts at all, for commands, edits and network calls.',
        fix: { file: doc.file, path: ['permissions', 'defaultMode'], does: 'Removes permissions.defaultMode; sessions start in the normal mode again.' },
      },
      'defaultMode'
    );
  if (doc.data.skipDangerousModePermissionPrompt === true)
    scan.add(
      {
        severity: 'medium',
        check: 'permission',
        title: 'The bypass-mode warning is switched off',
        where,
        file: doc.file,
        line: doc.line(['skipDangerousModePermissionPrompt']),
        evidence: 'skipDangerousModePermissionPrompt: true',
        why: 'Starting a session that skips all permission prompts no longer shows the dialog that says so.',
        fix: { file: doc.file, path: ['skipDangerousModePermissionPrompt'], does: 'Removes skipDangerousModePermissionPrompt; the warning shows again.' },
      },
      'skipDangerousModePermissionPrompt'
    );
}

// ------------------------------------------------------------------------------------------------------------------- MCP

const SECRET_FLAG = /^--?[\w-]*(?:key|token|secret|password|auth)[\w-]*$/i;

/** `resolvable` is true where Claude Code expands `${VAR}`: a project's .mcp.json, which the file's owner edits. */
function scanMcpServers(scan: Scan, doc: Doc, base: JSONPath, servers: unknown, where: string, resolvable: boolean) {
  if (!isObject(servers)) return;
  for (const [name, server] of Object.entries(servers)) {
    if (!isObject(server)) continue;
    const found = (p: JSONPath, value: string, secret: string, variable: string, what: string) => {
      const to = value.replace(secret, `\${${variable}}`);
      scan.add(
        {
          severity: 'high',
          check: 'mcp',
          title: `MCP server ${name} holds a secret in ${what}`,
          where,
          file: doc.file,
          line: doc.line(p),
          evidence: maskText(`${p[p.length - 1] === undefined ? '' : String(p[p.length - 1])}: ${clip(value.replace(secret, mask(secret)), 100)}`),
          why: 'The value sits in a file that is read by every tool and often committed; anyone who can read the file has the credential.',
          fix: resolvable ? { file: doc.file, path: p, to, does: `Replaces the value with \${${variable}}; set ${variable} in your environment before Claude starts.` } : undefined,
        },
        p.join('/')
      );
    };
    for (const [section, label] of [['env', 'env'], ['headers', 'headers']] as const) {
      const map = server[section];
      if (!isObject(map)) continue;
      for (const [k, v] of Object.entries(map)) {
        if (typeof v !== 'string') continue;
        const secret = secretIn(v, k);
        if (secret) found([...base, name, section, k], v, secret, section === 'env' ? variableName(k) : variableName(name, k), label);
      }
    }
    if (typeof server.url === 'string') {
      const m = /[?&](?:api[_-]?key|key|token|access_token|auth)=([^&#\s]+)/i.exec(server.url) ?? /\/\/[^/@\s:]+:([^@\s/]+)@/.exec(server.url);
      if (m && !HAS_VARIABLE.test(m[1])) found([...base, name, 'url'], server.url, m[1], variableName(name, 'token'), 'its URL');
    }
    if (Array.isArray(server.args))
      server.args.forEach((arg: unknown, i: number) => {
        if (typeof arg !== 'string') return;
        const prev = typeof server.args[i - 1] === 'string' ? (server.args[i - 1] as string) : '';
        const inline = /^(--?[\w-]*(?:key|token|secret|password|auth)[\w-]*)=(.+)$/i.exec(arg);
        const secret = inline ? secretIn(inline[2], inline[1]) : SECRET_FLAG.test(prev) && !arg.startsWith('-') ? secretIn(arg, prev) : secretIn(arg, '');
        if (secret) found([...base, name, 'args', i], arg, secret, variableName(name, inline ? inline[1] : SECRET_FLAG.test(prev) ? prev : 'secret'), 'its arguments');
      });
  }
}

// ------------------------------------------------------------------------------------------------------------ plugin files

const SCRIPT_EXT = new Set(['.sh', '.bash', '.ps1', '.psm1', '.py', '.js', '.mjs', '.cjs', '.ts', '.bat', '.cmd', '.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'tests', 'test']);

function* walk(dir: string, depth = 0, budget = { files: 600 }): Generator<string> {
  if (depth > 5 || budget.files <= 0) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (budget.files <= 0) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full, depth + 1, budget);
    } else if (e.isFile() && SCRIPT_EXT.has(path.extname(e.name).toLowerCase())) {
      budget.files--;
      yield full;
    }
  }
}

/** Skill and plugin files that fetch and run remote code. One finding per file, the first line that does. */
function scanRemoteCode(scan: Scan, dir: string, where: string, what: 'skill' | 'plugin') {
  for (const file of walk(dir)) {
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {}
    if (size > 256 * 1024) continue;
    const text = readText(file);
    if (text === undefined) continue;
    scan.scanned++;
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex(l => remoteExec(l));
    if (at < 0) continue;
    const doc = path.extname(file).toLowerCase() === '.md';
    scan.add(
      {
        severity: doc ? 'low' : 'medium',
        check: 'source',
        title: doc ? `A ${what} tells Claude to download and run code` : `A ${what} script downloads code and runs it`,
        where,
        file,
        line: at + 1,
        evidence: maskText(clip(lines[at].trim().replace(/\s+/g, ' '), 160)),
        why: doc ? 'Claude follows the instruction when the skill is used, so the remote code runs with your rights.' : 'What the address serves today may differ from what it serves tomorrow, and the script runs it unseen.',
      },
      'remote'
    );
  }
}

// ----------------------------------------------------------------------------------------------------- plugin sources

function scanSources(scan: Scan, roots: SecurityRoots) {
  const installed = scan.doc(path.join(roots.root, 'plugins', 'installed_plugins.json'));
  const known = scan.doc(path.join(roots.root, 'plugins', 'known_marketplaces.json'));
  const markets: Record<string, any> = known && isObject(known.data) ? known.data : {};
  const plugins: Record<string, unknown> = installed && isObject(installed.data.plugins) ? installed.data.plugins : {};
  for (const key of Object.keys(plugins)) {
    const market = key.split('@')[1] ?? '';
    if (market && !(market in markets) && installed)
      scan.add(
        {
          severity: 'medium',
          check: 'source',
          title: `Plugin ${key.split('@')[0]} comes from an unregistered marketplace`,
          where: 'Global',
          file: installed.file,
          line: installed.line(['plugins', key]),
          evidence: key,
          why: `The marketplace "${market}" is not in your list of marketplaces, so nothing says where this plugin's code was fetched from.`,
        },
        `plugin/${key}`
      );
  }
  if (!known) return;
  for (const [market, m] of Object.entries(markets)) {
    const src = isObject(m) && isObject(m.source) ? m.source : {};
    const github = src.source === 'github' && typeof src.repo === 'string' ? src.repo : '';
    if (github.split('/')[0].toLowerCase() === 'anthropics') continue;
    const from = github || (typeof src.url === 'string' ? src.url : typeof src.path === 'string' ? src.path : String(src.source ?? 'unknown source'));
    const count = Object.keys(plugins).filter(k => k.endsWith(`@${market}`)).length;
    scan.add(
      {
        severity: 'low',
        check: 'source',
        title: `Marketplace ${market} is not from Anthropic`,
        where: 'Global',
        file: known.file,
        line: known.line([market]),
        evidence: maskText(`${src.source === 'github' ? 'github' : String(src.source ?? '')}: ${from}`),
        why: `${count ? `${count} installed ${count === 1 ? 'plugin' : 'plugins'} come` : 'Plugins you install would come'} from it, and a plugin can add hooks, MCP servers and scripts that run with your rights. Fine when you trust its owner.`,
      },
      `market/${market}`
    );
  }
}

function scanSkillSources(scan: Scan, roots: SecurityRoots) {
  const files: [string, string][] = [
    [path.join(roots.root, '.skill-sources.json'), 'Global'],
    [path.join(roots.home, '.agents', '.skill-lock.json'), 'Global'],
  ];
  for (const [file, where] of files) {
    const doc = scan.doc(file);
    if (!doc || !isObject(doc.data.skills)) continue;
    for (const [name, e] of Object.entries<any>(doc.data.skills)) {
      if (!isObject(e) || typeof e.source !== 'string' || e.source.split('/')[0].toLowerCase() === 'anthropics') continue;
      scan.add(
        {
          severity: 'low',
          check: 'source',
          title: `Skill ${name} was installed from ${maskText(e.source)}, outside a marketplace`,
          where,
          file,
          line: doc.line(['skills', name]),
          evidence: maskText(`${String(e.sourceType ?? 'github')}: ${e.source}`),
          why: 'A skill is instructions plus scripts that Claude runs; nothing has vetted this one beyond its owner.',
        },
        `skill/${name}`
      );
    }
  }
}

// -------------------------------------------------------------------------------------------------------------- the scan

const label = (dir: string) => path.basename(dir);

/** Reads every configuration place of Claude Code under `roots` and returns the findings, worst first. */
export function scanSecurity(roots: SecurityRoots): SecurityReport {
  const scan = new Scan();
  const places: { dir: string; where: string }[] = [{ dir: roots.root, where: 'Global' }, ...roots.repos.map(r => ({ dir: path.join(r, '.claude'), where: label(r) }))];
  for (const { dir, where } of places)
    for (const name of ['settings.json', 'settings.local.json']) {
      const doc = scan.doc(path.join(dir, name));
      if (!doc) continue;
      scanHooks(scan, doc, where);
      scanPermissions(scan, doc, where);
    }
  for (const repo of roots.repos) {
    const doc = scan.doc(path.join(repo, '.mcp.json'));
    if (doc) scanMcpServers(scan, doc, doc.data.mcpServers ? ['mcpServers'] : [], doc.data.mcpServers ?? doc.data, label(repo), true);
    scanRemoteCode(scan, path.join(repo, '.claude', 'skills'), label(repo), 'skill');
  }
  const config = scan.doc(path.join(roots.home, '.claude.json'));
  if (config) {
    scanMcpServers(scan, config, ['mcpServers'], config.data.mcpServers, 'Global', false);
    if (isObject(config.data.projects))
      for (const [project, p] of Object.entries<any>(config.data.projects)) if (isObject(p)) scanMcpServers(scan, config, ['projects', project, 'mcpServers'], p.mcpServers, label(project), false);
  }
  scanRemoteCode(scan, path.join(roots.root, 'skills'), 'Global', 'skill');
  const installed = scan.doc(path.join(roots.root, 'plugins', 'installed_plugins.json'));
  if (installed && isObject(installed.data.plugins))
    for (const [key, entries] of Object.entries<any>(installed.data.plugins)) {
      const dirs = (Array.isArray(entries) ? entries : []).map((e: any) => e?.installPath).filter((d: unknown): d is string => typeof d === 'string' && fs.existsSync(d));
      const dir = dirs[dirs.length - 1];
      if (!dir) continue;
      const where = key.split('@')[0];
      const hooks = scan.doc(path.join(dir, 'hooks', 'hooks.json'));
      if (hooks) scanHooks(scan, hooks, where);
      const mcp = scan.doc(path.join(dir, '.mcp.json'));
      if (mcp) scanMcpServers(scan, mcp, mcp.data.mcpServers ? ['mcpServers'] : [], mcp.data.mcpServers ?? mcp.data, where, false);
      scanRemoteCode(scan, dir, where, 'plugin');
    }
  scanSources(scan, roots);
  scanSkillSources(scan, roots);
  const findings = scan.findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.where.localeCompare(b.where) || a.file.localeCompare(b.file) || a.line - b.line);
  return { findings, scanned: scan.scanned, at: Date.now() };
}

/** Writes a finding's fix into its file with the file's own formatting and line endings. Returns false when the place no longer holds what the scan saw. */
export function applyFix(fix: SecurityFix): boolean {
  const text = readText(fix.file);
  if (text === undefined) return false;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const tree = parseTree(text);
  const node = tree && findNodeAtLocation(tree, fix.path);
  if (!node) return false;
  if (fix.to === undefined) {
    // A removal cuts the item with one neighbouring comma, so the rest of the file stays as written; jsonc-parser's own removal of a last array item corrupts the brackets.
    const item = node.parent?.type === 'property' ? node.parent : node;
    const siblings = item.parent?.children ?? [];
    const at = siblings.indexOf(item);
    const end = item.offset + item.length;
    const [from, to] = at > 0 ? [siblings[at - 1].offset + siblings[at - 1].length, end] : at >= 0 && at < siblings.length - 1 ? [item.offset, siblings[at + 1].offset] : [item.offset, end];
    fs.writeFileSync(fix.file, text.slice(0, from) + text.slice(to));
    return true;
  }
  const edits = modify(text, fix.path, fix.to, { formattingOptions: { insertSpaces: true, tabSize: 2, eol } });
  if (!edits.length) return false;
  fs.writeFileSync(fix.file, applyEdits(text, edits));
  return true;
}

/**
 * Resolve for one finding: the scan is made again and the fix is the one the host finds, never what the webview sent. Without a
 * confirmed answer it only asks, through `ask`, and returns nothing; confirmed it writes and returns the new report.
 */
export function resolveSecurity(roots: SecurityRoots, id: string, confirmed: boolean | undefined, ask: (card: Confirm) => void): SecurityReport | undefined {
  const finding = scanSecurity(roots).findings.find(f => f.id === id);
  if (!finding?.fix) return undefined;
  if (!confirmed) {
    ask({ kind: 'securityResolve', id, key: id, title: finding.title, file: finding.file, line: finding.line, does: finding.fix.does });
    return undefined;
  }
  applyFix(finding.fix);
  return scanSecurity(roots);
}
