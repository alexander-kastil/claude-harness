import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { isSeq, parse as parseYaml, parseDocument, stringify as stringifyYaml, YAMLSeq } from 'yaml';

export type Kind =
  | 'memory'
  | 'rule'
  | 'agent'
  | 'skill'
  | 'command'
  | 'outputStyle'
  | 'workflow'
  | 'hook'
  | 'hookScript'
  | 'mcp'
  | 'plugin'
  | 'settings';

export interface KindInfo {
  kind: Kind;
  label: string;
  icon: string;
  creatable: boolean;
  markdown: boolean;
  fields: string[];
}

export const KINDS: KindInfo[] = [
  { kind: 'memory', label: 'Memory', icon: 'note', creatable: false, markdown: true, fields: [] },
  { kind: 'rule', label: 'Rules', icon: 'law', creatable: true, markdown: true, fields: ['paths'] },
  {
    kind: 'agent',
    label: 'Agents',
    icon: 'hubot',
    creatable: true,
    markdown: true,
    fields: ['name', 'description', 'tools', 'disallowedTools', 'model', 'effort', 'permissionMode', 'skills', 'mcpServers', 'memory', 'isolation', 'color'],
  },
  {
    kind: 'skill',
    label: 'Skills',
    icon: 'mortar-board',
    creatable: true,
    markdown: true,
    fields: ['name', 'description', 'argument-hint', 'allowed-tools', 'model', 'effort', 'context', 'agent', 'disable-model-invocation', 'user-invocable'],
  },
  {
    kind: 'command',
    label: 'Commands',
    icon: 'terminal',
    creatable: true,
    markdown: true,
    fields: ['description', 'argument-hint', 'allowed-tools', 'model', 'disable-model-invocation'],
  },
  { kind: 'outputStyle', label: 'Output Styles', icon: 'symbol-color', creatable: true, markdown: true, fields: ['name', 'description', 'keep-coding-instructions'] },
  { kind: 'workflow', label: 'Workflows', icon: 'type-hierarchy', creatable: true, markdown: false, fields: [] },
  { kind: 'hook', label: 'Hooks', icon: 'zap', creatable: false, markdown: false, fields: [] },
  { kind: 'hookScript', label: 'Hook Scripts', icon: 'file-code', creatable: false, markdown: false, fields: [] },
  { kind: 'mcp', label: 'MCP Servers', icon: 'server', creatable: false, markdown: false, fields: [] },
  { kind: 'plugin', label: 'Plugins', icon: 'extensions', creatable: false, markdown: false, fields: [] },
  { kind: 'settings', label: 'Settings', icon: 'settings-gear', creatable: false, markdown: false, fields: [] },
];

export const kindInfo = (kind: Kind): KindInfo => KINDS.find(k => k.kind === kind)!;

export interface Asset {
  id: string;
  scope: string;
  kind: Kind;
  name: string;
  description: string;
  file: string;
  dir?: string;
  files?: string[];
  enabled?: boolean;
  jsonPath?: (string | number)[];
  mtime: number;
  source?: McpSource;
  about?: string;
  target?: string;
  status?: string;
  offIn?: number;
  folders?: number;
  version?: string;
  copies?: Copy[];
}

export interface Copy {
  id: string;
  scope: string;
  label: string;
  file: string;
  same: boolean;
  near?: boolean;
}

export type McpSource = 'user' | 'local' | 'project' | 'claude.ai' | 'plugin';

export interface Category extends KindInfo {
  items: Asset[];
}

export interface HarnessScope {
  id: string;
  label: string;
  base: string;
  root: string;
  memory: string[];
  mcpFile: string;
  userConfig: string;
  installedPlugins: boolean;
}

export interface ScopeView {
  id: string;
  label: string;
  path: string;
  local?: boolean;
  categories: Category[];
}

export const globalScope = (root?: string): HarnessScope => {
  const dir = root && root.trim() ? root : path.join(os.homedir(), '.claude');
  const userConfig = path.join(os.homedir(), '.claude.json');
  return { id: 'global', label: 'Global', base: dir, root: dir, memory: ['CLAUDE.md'], mcpFile: userConfig, userConfig, installedPlugins: true };
};

export const repoScope = (dir: string, userConfig = path.join(os.homedir(), '.claude.json')): HarnessScope => ({
  id: `repo:${dir}`,
  label: path.basename(dir),
  base: dir,
  root: path.join(dir, '.claude'),
  memory: ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md'],
  mcpFile: path.join(dir, '.mcp.json'),
  userConfig,
  installedPlugins: false,
});

type ServerConfig = { type?: string; command?: string; url?: string; args?: string[] };
const serverTarget = (server: ServerConfig) => `${server.type ?? 'stdio'} · ${server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')}`;
const samePath = (a: string, b: string) => {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

export const projectKey = (projects: Record<string, unknown>, dir: string): string | undefined => Object.keys(projects).find(k => samePath(k, dir));

type ProjectEntry = { disabledMcpServers?: string[]; disabledMcpjsonServers?: string[]; enabledMcpjsonServers?: string[] };

export function applyMcpState(views: ScopeView[], userConfig: string): void {
  const projects = (readJson(userConfig).projects ?? {}) as Record<string, ProjectEntry>;
  const entries = Object.values(projects);
  for (const view of views) {
    const servers = view.categories.find(c => c.kind === 'mcp')?.items ?? [];
    const entry = view.id === 'global' ? undefined : projects[projectKey(projects, view.path) ?? ''];
    for (const a of servers) {
      if (view.id === 'global') {
        a.offIn = entries.filter(p => (p.disabledMcpServers ?? []).includes(a.name)).length;
        a.folders = entries.length;
        a.enabled = a.offIn === 0;
      } else {
        const list = a.source === 'project' ? entry?.disabledMcpjsonServers : entry?.disabledMcpServers;
        a.enabled = !(list ?? []).includes(a.name);
      }
    }
  }
}

export function setMcpEnabled(userConfig: string, asset: Asset, repoDir: string | undefined, enabled: boolean): void {
  let text = readText(userConfig);
  const projects = (readJson(userConfig).projects ?? {}) as Record<string, ProjectEntry>;
  const set = (key: string, field: keyof ProjectEntry, change: (list: string[]) => string[]) => {
    const current = projects[key]?.[field] ?? [];
    const next = change(current);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    text = applyEdits(text, modify(text, ['projects', key, field], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  };
  const without = (list: string[]) => list.filter(n => n !== asset.name);
  const withName = (list: string[]) => (list.includes(asset.name) ? list : [...list, asset.name]);
  if (!repoDir) {
    for (const key of Object.keys(projects)) set(key, 'disabledMcpServers', enabled ? without : withName);
  } else {
    const key = projectKey(projects, repoDir) ?? repoDir.replace(/\\/g, '/');
    if (asset.source === 'project') {
      set(key, 'disabledMcpjsonServers', enabled ? without : withName);
      if (enabled) set(key, 'enabledMcpjsonServers', withName);
    } else set(key, 'disabledMcpServers', enabled ? without : withName);
  }
  fs.writeFileSync(userConfig, text, 'utf8');
}

export function pluginDescription(root: string, plugin: string): string {
  const candidates: string[] = [];
  const synced = path.join(root, 'plugins', 'synced');
  for (const org of safeDirs(synced)) candidates.push(path.join(synced, org, plugin, '.claude-plugin', 'plugin.json'));
  const cache = path.join(root, 'plugins', 'cache');
  for (const market of safeDirs(cache)) for (const version of safeDirs(path.join(cache, market, plugin))) candidates.push(path.join(cache, market, plugin, version, '.claude-plugin', 'plugin.json'));
  for (const file of candidates) {
    const description = readJson(file).description;
    if (typeof description === 'string' && description) return description;
  }
  return '';
}

export function pluginIsMod(root: string, key: string): boolean {
  const [plugin, market] = key.split('@');
  const installed = (readJson(path.join(root, 'plugins', 'installed_plugins.json')).plugins ?? {}) as Record<string, Array<{ installPath?: string }>>;
  const dirs = (installed[key] ?? []).map(e => e.installPath).filter((d): d is string => !!d);
  const cache = path.join(root, 'plugins', 'cache', market ?? '', plugin);
  if (!dirs.length && market) dirs.push(...safeDirs(cache).map(v => path.join(cache, v)));
  return dirs.some(dir => {
    const hooks = readJson(path.join(dir, '.claude-plugin', 'plugin.json')).hooks;
    const file = path.join(dir, typeof hooks === 'string' ? hooks : path.join('hooks', 'hooks.json'));
    return Array.isArray(readJson(file).modules);
  });
}

function safeDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name);
  } catch {
    return [];
  }
}

const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const realPath = (p: string) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};

export function expandRepoFolders(folders: string[]): string[] {
  return folders.flatMap(folder => {
    try {
      const children = fs.readdirSync(folder, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name));
      return [folder, ...children.map(d => path.join(folder, d.name))];
    } catch {
      return [];
    }
  });
}

export function knownRepos(extra: string[], userConfig = path.join(os.homedir(), '.claude.json')): string[] {
  const projects = Object.keys((readJson(userConfig).projects ?? {}) as Record<string, unknown>);
  const seen = new Map<string, string>();
  const candidates = [...projects.map(p => ({ p, explicit: false })), ...extra.map(p => ({ p, explicit: true }))];
  for (const { p, explicit } of candidates) {
    const dir = path.resolve(p);
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key) || path.relative(os.homedir(), dir) === '') continue;
    if (!explicit && isInside(realPath(dir), realPath(os.tmpdir()))) continue;
    if (!fs.existsSync(path.join(dir, '.claude')) && !fs.existsSync(path.join(dir, 'CLAUDE.md'))) continue;
    seen.set(key, dir.length > 2 && dir[1] === ':' ? dir[0].toUpperCase() + dir.slice(1) : dir);
  }
  return [...seen.values()].sort((a, b) => path.basename(a).localeCompare(path.basename(b)) || a.localeCompare(b));
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;
const NAME = /^[a-z0-9][a-z0-9._-]*$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv']);

export interface MarkdownDoc {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

export function splitFrontmatter(text: string): { yaml: string | undefined; body: string } {
  const m = FRONTMATTER.exec(text);
  return m ? { yaml: m[1], body: text.slice(m[0].length) } : { yaml: undefined, body: text };
}

export function parseMarkdown(text: string): MarkdownDoc {
  const { yaml, body } = splitFrontmatter(text);
  let data: Record<string, unknown> = {};
  if (yaml !== undefined) {
    try {
      const parsed = parseYaml(yaml);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      data = lenientYaml(yaml);
    }
  }
  return { data, body, hasFrontmatter: yaml !== undefined };
}

function lenientYaml(yaml: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let key: string | undefined;
  for (const line of yaml.split(/\r?\n/)) {
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (top) {
      key = top[1];
      data[key] = /^[|>][-+]?$/.test(top[2].trim()) ? '' : top[2].trim();
      continue;
    }
    if (!key) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) {
      const current = data[key];
      data[key] = [...(Array.isArray(current) ? current : []), item[1].trim()];
    } else if (line.trim()) {
      data[key] = `${data[key] ?? ''} ${line.trim()}`.trim();
    }
  }
  return data;
}

export function readMarkdown(file: string): MarkdownDoc {
  return parseMarkdown(readText(file));
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

export function serializeMarkdown(original: string, data: Record<string, unknown>, body: string): string {
  const eol = eolOf(original);
  const { yaml } = splitFrontmatter(original);
  const normalizedBody = body.replace(/\r\n/g, '\n');
  let out: string;
  if (yaml === undefined && Object.keys(data).length === 0) {
    out = normalizedBody;
  } else if (yaml !== undefined && JSON.stringify(parseMarkdown(original).data) === JSON.stringify(data)) {
    out = `---\n${yaml.replace(/\r\n/g, '\n')}\n---\n${normalizedBody}`;
  } else {
    const doc = parseDocument(yaml ?? '');
    let front = '';
    if (Object.keys(data).length && doc.errors.length) {
      front = stringifyYaml(data, { lineWidth: 0 }).replace(/\n$/, '');
    } else if (Object.keys(data).length) {
      const current = (doc.toJS() ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(current)) if (!(key in data)) doc.delete(key);
      for (const [key, value] of Object.entries(data)) {
        if (JSON.stringify(current[key]) !== JSON.stringify(value)) doc.set(key, value);
      }
      front = doc.toString({ lineWidth: 0 }).replace(/\n$/, '');
    }
    out = `---\n${front}${front ? '\n' : ''}---\n${normalizedBody}`;
  }
  return eol === '\n' ? out : out.replace(/\n/g, eol);
}

export function setFrontmatterList(text: string, key: string, items: string[]): string {
  const m = FRONTMATTER.exec(text);
  if (!m) return text;
  const eol = eolOf(text);
  const doc = parseDocument(m[1].replace(/\r\n/g, '\n'));
  const node = doc.get(key, true);
  if (isSeq(node)) {
    const seq = doc.createNode(items) as YAMLSeq;
    seq.flow = node.flow;
    doc.set(key, seq);
  } else doc.set(key, items.join(', '));
  const front = `---\n${doc.toString({ lineWidth: 0 })}---\n`;
  return (eol === '\n' ? front : front.replace(/\n/g, eol)) + text.slice(m[0].length);
}

export function writeMarkdown(file: string, data: Record<string, unknown>, body: string): void {
  const original = fs.existsSync(file) ? readText(file) : '';
  fs.writeFileSync(file, serializeMarkdown(original, data, body), 'utf8');
}

export interface CliServer {
  name: string;
  target: string;
  status: string;
}

export function parseMcpList(output: string): CliServer[] {
  return output
    .split(/\r?\n/)
    .map(line => /^(.+?): (.*?) - \S (.+)$/u.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map(m => ({ name: m[1], target: m[2].trim(), status: m[3].trim() }));
}

export const mcpToolPrefix = (server: string) => `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__`;

export function readText(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

export function writeText(file: string, text: string): void {
  const original = fs.existsSync(file) ? readText(file) : '';
  const eol = eolOf(original);
  const normalized = text.replace(/\r\n/g, '\n');
  fs.writeFileSync(file, eol === '\n' ? normalized : normalized.replace(/\n/g, eol), 'utf8');
}

function readJson(file: string): Record<string, unknown> {
  try {
    const value = parseJsonc(readText(file));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

const oneLine = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const mtimeOf = (file: string) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

function listFiles(dir: string, filter: (name: string) => boolean, recursive: boolean, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (recursive && !SKIP_DIRS.has(entry.name)) out.push(...listFiles(path.join(dir, entry.name), filter, true, base));
    } else if (filter(entry.name)) {
      out.push(path.relative(base, path.join(dir, entry.name)));
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function versionOf(data: Record<string, unknown>): string | undefined {
  const meta = data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {};
  const value = data.version ?? meta.version;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function markdownAssets(scope: HarnessScope, dir: string, kind: Kind, recursive: boolean, nameOf: (rel: string) => string): Asset[] {
  return listFiles(dir, n => n.toLowerCase().endsWith('.md'), recursive).map(rel => {
    const file = path.join(dir, rel);
    const name = nameOf(rel);
    const { data } = readMarkdown(file);
    return { id: `${scope.id}|${kind}:${name}`, scope: scope.id, kind, name, description: oneLine(data.description), version: versionOf(data), file, mtime: mtimeOf(file) };
  });
}

const COPYABLE = new Set<Kind>(['rule', 'agent', 'skill', 'command', 'outputStyle', 'workflow', 'hookScript']);

const loose = (text: string) => text.replace(/^\s*version\s*:.*$/gm, '').replace(/\s+/g, '');

export function contentHash(asset: Asset, near = false): string {
  const hash = crypto.createHash('sha256');
  const add = (file: string) => {
    const text = fs.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n');
    hash.update(near ? loose(text) : text, 'latin1');
  };
  if (asset.dir) {
    for (const rel of [...(asset.files ?? [])].sort()) {
      hash.update(`\0${rel}\0`);
      add(path.join(asset.dir, ...rel.split('/')));
    }
  } else add(asset.file);
  return hash.digest('hex');
}

export function linkCopies(views: ScopeView[], extra: ScopeView[] = []): void {
  const groups = new Map<string, { asset: Asset; label: string; shown: boolean }[]>();
  const shown = new Set(views);
  for (const view of [...views, ...extra])
    for (const category of view.categories)
      for (const asset of category.items) {
        if (!COPYABLE.has(asset.kind)) continue;
        const key = `${asset.kind}:${asset.name}`;
        groups.set(key, [...(groups.get(key) ?? []), { asset, label: view.label, shown: shown.has(view) }]);
      }
  for (const group of groups.values()) {
    if (group.length < 2 || !group.some(g => g.shown)) continue;
    const hashes = new Map(group.map(g => [g.asset.id, contentHash(g.asset)]));
    const nearHashes = new Map<string, string>();
    const nearOf = (a: Asset) => nearHashes.get(a.id) ?? (nearHashes.set(a.id, contentHash(a, true)), nearHashes.get(a.id)!);
    for (const { asset } of group.filter(g => g.shown))
      asset.copies = group
        .filter(g => g.asset !== asset)
        .map(g => {
          const same = hashes.get(g.asset.id) === hashes.get(asset.id);
          return { id: g.asset.id, scope: g.asset.scope, label: g.label, file: g.asset.file, same, near: !same && nearOf(g.asset) === nearOf(asset) };
        });
  }
}

const copyState = (c: Copy) => (c.same ? 'identical' : c.near ? 'nearly identical' : 'differs');
export const copiesText = (asset: Asset): string => (asset.copies?.length ? `also in ${asset.copies.map(c => `${c.label} (${copyState(c)})`).join(', ')}` : '');

const stripMd = (rel: string) => rel.replace(/\.md$/i, '').split(path.sep).join('/');

function workflowDescription(file: string): string {
  const m = /description\s*:\s*(['"`])([\s\S]*?)\1/.exec(readText(file));
  return m ? oneLine(m[2]) : '';
}

function skillAssets(scope: HarnessScope, skillsDir: string): Asset[] {
  if (!fs.existsSync(skillsDir)) return [];
  const out: Asset[] = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    const dir = path.join(skillsDir, entry.name);
    const file = path.join(dir, 'SKILL.md');
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(file)) continue;
    const { data } = readMarkdown(file);
    out.push({
      id: `${scope.id}|skill:${entry.name}`,
      scope: scope.id,
      kind: 'skill',
      name: entry.name,
      description: oneLine(data.description),
      version: versionOf(data),
      file,
      dir,
      files: listFiles(dir, () => true, true).map(f => f.split(path.sep).join('/')),
      mtime: mtimeOf(file),
    });
  }
  return out;
}

export function scan(scope: HarnessScope): Category[] {
  const { root } = scope;
  const items = new Map<Kind, Asset[]>(KINDS.map(k => [k.kind, []]));
  const make = (kind: Kind, key: string, rest: Omit<Asset, 'id' | 'scope' | 'kind'>): Asset => ({ id: `${scope.id}|${kind}:${key}`, scope: scope.id, kind, ...rest });

  for (const rel of scope.memory) {
    const file = path.join(scope.base, rel);
    if (fs.existsSync(file)) items.get('memory')!.push(make('memory', rel, { name: rel, description: '', file, mtime: mtimeOf(file) }));
  }

  items.set('rule', markdownAssets(scope, path.join(root, 'rules'), 'rule', true, stripMd));
  items.set('agent', markdownAssets(scope, path.join(root, 'agents'), 'agent', false, stripMd));
  items.set('command', markdownAssets(scope, path.join(root, 'commands'), 'command', true, rel => stripMd(rel).replace(/\//g, ':')));
  items.set('outputStyle', markdownAssets(scope, path.join(root, 'output-styles'), 'outputStyle', false, stripMd));

  items.set('skill', skillAssets(scope, path.join(root, 'skills')));

  items.set(
    'workflow',
    listFiles(path.join(root, 'workflows'), n => /\.(m?js)$/i.test(n), false).map(rel => {
      const file = path.join(root, 'workflows', rel);
      const name = rel.replace(/\.m?js$/i, '');
      return make('workflow', name, { name, description: workflowDescription(file), file, mtime: mtimeOf(file) });
    })
  );

  items.set(
    'hookScript',
    listFiles(path.join(root, 'hooks'), () => true, true).map(rel => {
      const file = path.join(root, 'hooks', rel);
      const name = rel.split(path.sep).join('/');
      return make('hookScript', name, { name, description: '', file, mtime: mtimeOf(file) });
    })
  );

  const settingsFile = path.join(root, 'settings.json');
  const settings = readJson(settingsFile);

  const hooks = (settings.hooks ?? {}) as Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string; type?: string }> }>>;
  for (const [event, groups] of Object.entries(hooks)) {
    (Array.isArray(groups) ? groups : []).forEach((group, i) => {
      const name = group.matcher ? `${event} · ${group.matcher}` : event;
      items.get('hook')!.push(
        make('hook', `${event}:${i}`, {
          name,
          description: (group.hooks ?? []).map(h => h.command ?? h.type ?? '').join(' | '),
          file: settingsFile,
          jsonPath: ['hooks', event, i],
          mtime: mtimeOf(settingsFile),
        })
      );
    });
  }

  const servers = (readJson(scope.mcpFile).mcpServers ?? {}) as Record<string, ServerConfig>;
  const source: McpSource = scope.id === 'global' ? 'user' : 'project';
  for (const [name, server] of Object.entries(servers)) {
    items.get('mcp')!.push(
      make('mcp', name, {
        name,
        description: serverTarget(server),
        file: scope.mcpFile,
        jsonPath: ['mcpServers', name],
        mtime: mtimeOf(scope.mcpFile),
        source,
        target: server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(' '),
      })
    );
  }
  if (scope.id !== 'global') {
    const projects = (readJson(scope.userConfig).projects ?? {}) as Record<string, { mcpServers?: Record<string, ServerConfig> }>;
    const key = projectKey(projects, scope.base);
    for (const [name, server] of Object.entries((key && projects[key].mcpServers) || {})) {
      if (servers[name]) continue;
      items.get('mcp')!.push(
        make('mcp', `local:${name}`, {
          name,
          description: serverTarget(server),
          file: scope.userConfig,
          jsonPath: ['projects', key!, 'mcpServers', name],
          mtime: mtimeOf(scope.userConfig),
          source: 'local',
          target: server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(' '),
        })
      );
    }
  }

  const enabled = (settings.enabledPlugins ?? {}) as Record<string, boolean>;
  const installedFile = path.join(root, 'plugins', 'installed_plugins.json');
  const installed = (scope.installedPlugins ? readJson(installedFile).plugins ?? {} : {}) as Record<string, Array<{ scope?: string; version?: string }>>;
  const pluginKeys = new Set([...Object.keys(enabled), ...Object.entries(installed).filter(([, e]) => e.some(x => x.scope === 'user')).map(([k]) => k)]);
  for (const key of [...pluginKeys].sort((a, b) => a.localeCompare(b))) {
    const version = (installed[key] ?? []).find(x => x.scope === 'user')?.version ?? (installed[key] ?? [])[0]?.version;
    items.get('plugin')!.push(
      make('plugin', key, {
        name: key,
        description: [enabled[key] === true ? 'enabled' : 'disabled', version].filter(Boolean).join(' · '),
        file: settingsFile,
        enabled: enabled[key] === true,
        mtime: mtimeOf(settingsFile),
      })
    );
  }

  for (const name of ['settings.json', 'settings.local.json']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    items.get('settings')!.push(
      make('settings', name, {
        name,
        description: `${Object.keys(readJson(file)).length} keys`,
        file,
        mtime: mtimeOf(file),
      })
    );
  }

  return KINDS.map(k => ({ ...k, items: items.get(k.kind)!.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export function setPluginEnabled(scope: HarnessScope, key: string, value: boolean): void {
  const file = path.join(scope.root, 'settings.json');
  const text = fs.existsSync(file) ? readText(file) : '{}';
  const edits = modify(text, ['enabledPlugins', key], value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: eolOf(text) } });
  fs.writeFileSync(file, applyEdits(text, edits), 'utf8');
}

export function mcpToken(root: string, name: string, url: string): string | undefined {
  type Entry = { serverName?: string; serverUrl?: string; accessToken?: string; expiresAt?: number };
  const entries = Object.values((readJson(path.join(root, '.credentials.json')).mcpOAuth ?? {}) as Record<string, Entry>);
  const norm = (u = '') => u.replace(/\/+$/, '').toLowerCase();
  const matches = entries.filter(e => e.accessToken && norm(e.serverUrl) === norm(url));
  const fresh = (e: Entry) => !e.expiresAt || e.expiresAt > Date.now();
  return (matches.find(e => e.serverName === name && fresh(e)) ?? matches.find(fresh) ?? matches[0])?.accessToken;
}

export type McpConfig = { type?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };

export const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function jsonAt(file: string, jsonPath: (string | number)[]): unknown {
  return jsonPath.reduce<unknown>((node, key) => (node as Record<string | number, unknown> | undefined)?.[key], readJson(file));
}

export function splitCommandLine(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]);
}

export function addMcpServer(file: string, name: string, server: McpConfig): void {
  const text = fs.existsSync(file) ? readText(file) : '{}';
  if (((readJson(file).mcpServers ?? {}) as Record<string, unknown>)[name]) throw new Error(`An MCP server named ${name} already exists in ${file}.`);
  const edits = modify(text, ['mcpServers', name], server, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: eolOf(text) } });
  fs.writeFileSync(file, applyEdits(text, edits), 'utf8');
}

export function mcpAddCommand(name: string, config: McpConfig, scope: 'user' | 'project' | 'local'): string {
  const q = (s: string) => (/^[\w@%+=:,./\-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`);
  if (config.url) {
    const transport = config.type === 'sse' ? 'sse' : 'http';
    return ['claude', 'mcp', 'add', '--scope', scope, '--transport', transport, q(name), q(config.url), ...Object.entries(config.headers ?? {}).flatMap(([k, v]) => ['--header', q(`${k}: ${v}`)])].join(' ');
  }
  const env = Object.entries(config.env ?? {}).flatMap(([k, v]) => ['-e', q(`${k}=${v}`)]);
  return ['claude', 'mcp', 'add', '--scope', scope, q(name), ...env, '--', ...[config.command ?? '', ...(config.args ?? [])].map(q)].join(' ');
}

export function marketplacePlugins(root: string): { key: string; description: string }[] {
  const markets = readJson(path.join(root, 'plugins', 'known_marketplaces.json')) as Record<string, { installLocation?: string }>;
  return Object.entries(markets).flatMap(([market, m]) => {
    const plugins = (readJson(path.join(m.installLocation ?? path.join(root, 'plugins', 'marketplaces', market), '.claude-plugin', 'marketplace.json')).plugins ?? []) as { name?: string; description?: string }[];
    return plugins.filter(p => p.name).map(p => ({ key: `${p.name}@${market}`, description: p.description ?? '' }));
  });
}

export function removeJsonEntry(file: string, jsonPath: (string | number)[]): void {
  const text = readText(file);
  const edits = modify(text, jsonPath, undefined, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: eolOf(text) } });
  fs.writeFileSync(file, applyEdits(text, edits), 'utf8');
}

export function validateName(name: string): string | undefined {
  return NAME.test(name) ? undefined : 'Lowercase letters, digits, dots, dashes and underscores; starts with a letter or digit.';
}

function assetTarget(scope: HarnessScope, kind: Kind, name: string): { file: string; dir?: string } {
  const { root } = scope;
  switch (kind) {
    case 'rule':
      return { file: path.join(root, 'rules', `${name}.md`) };
    case 'agent':
      return { file: path.join(root, 'agents', `${name}.md`) };
    case 'command':
      return { file: path.join(root, 'commands', ...name.split(':')) + '.md' };
    case 'outputStyle':
      return { file: path.join(root, 'output-styles', `${name}.md`) };
    case 'workflow':
      return { file: path.join(root, 'workflows', `${name}.js`) };
    case 'skill': {
      const dir = path.join(root, 'skills', name);
      return { file: path.join(dir, 'SKILL.md'), dir };
    }
    default:
      throw new Error(`${kindInfo(kind).label} cannot be created here.`);
  }
}

function template(kind: Kind, name: string): string {
  switch (kind) {
    case 'rule':
      return `# ${name}\n\n`;
    case 'agent':
      return `---\nname: ${name}\ndescription: \nmodel: inherit\n---\n\n`;
    case 'skill':
      return `---\nname: ${name}\ndescription: \n---\n\n# ${name}\n\n`;
    case 'command':
      return `---\ndescription: \n---\n\n`;
    case 'outputStyle':
      return `---\nname: ${name}\ndescription: \n---\n\n`;
    case 'workflow':
      return `export const meta = {\n  name: '${name}',\n  description: '',\n}\n`;
    default:
      return '';
  }
}

export function createAsset(scope: HarnessScope, kind: Kind, name: string): string {
  const target = assetTarget(scope, kind, name);
  if (fs.existsSync(target.dir ?? target.file)) throw new Error(`${name} already exists.`);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, template(kind, name), 'utf8');
  return target.file;
}

function renameInContent(file: string, kind: Kind, newName: string): void {
  if (kind === 'workflow') {
    const text = readText(file);
    fs.writeFileSync(file, text.replace(/(\bname\s*:\s*)(['"`])[^'"`]*\2/, `$1$2${newName}$2`), 'utf8');
    return;
  }
  const doc = readMarkdown(file);
  if ('name' in doc.data && kind !== 'outputStyle') writeMarkdown(file, { ...doc.data, name: newName }, doc.body);
}

export function renameAsset(scope: HarnessScope, asset: Asset, newName: string): string {
  const target = assetTarget(scope, asset.kind, newName);
  if (fs.existsSync(target.dir ?? target.file)) throw new Error(`${newName} already exists.`);
  fs.mkdirSync(path.dirname(target.dir ?? target.file), { recursive: true });
  fs.renameSync(asset.dir ?? asset.file, target.dir ?? target.file);
  renameInContent(target.file, asset.kind, newName);
  return target.file;
}

export function duplicateAsset(scope: HarnessScope, asset: Asset, newName: string): string {
  const target = assetTarget(scope, asset.kind, newName);
  if (fs.existsSync(target.dir ?? target.file)) throw new Error(`${newName} already exists.`);
  fs.mkdirSync(path.dirname(target.dir ?? target.file), { recursive: true });
  fs.cpSync(asset.dir ?? asset.file, target.dir ?? target.file, { recursive: true });
  renameInContent(target.file, asset.kind, newName);
  return target.file;
}

export type FieldType = 'string' | 'text' | 'boolean' | 'number' | 'list' | 'yaml';

export interface Field {
  key: string;
  type: FieldType;
  value: string | boolean;
}

export function toFields(data: Record<string, unknown>): Field[] {
  return Object.entries(data).map(([key, value]) => {
    if (typeof value === 'boolean') return { key, type: 'boolean', value };
    if (typeof value === 'number') return { key, type: 'number', value: String(value) };
    if (typeof value === 'string') return { key, type: key === 'description' || value.includes('\n') ? 'text' : 'string', value };
    if (Array.isArray(value) && value.every(v => typeof v !== 'object' || v === null)) return { key, type: 'list', value: value.join(', ') };
    if (value === null || value === undefined) return { key, type: 'string', value: '' };
    return { key, type: 'yaml', value: stringifyYaml(value).replace(/\n$/, '') };
  });
}

export function fromFields(fields: Field[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of fields) {
    const key = f.key.trim();
    if (!key) continue;
    switch (f.type) {
      case 'boolean':
        data[key] = f.value === true;
        break;
      case 'number':
        data[key] = Number(f.value);
        break;
      case 'list':
        data[key] = String(f.value).split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        break;
      case 'yaml':
        data[key] = parseYaml(String(f.value));
        break;
      default:
        data[key] = String(f.value);
    }
  }
  return data;
}

export interface PluginDir {
  key: string;
  plugin: string;
  market: string;
  dir: string;
  installed: boolean;
}

export function pluginDirs(root: string): PluginDir[] {
  const out = new Map<string, PluginDir>();
  type Entry = { installPath?: string; lastUpdated?: string };
  const installed = (readJson(path.join(root, 'plugins', 'installed_plugins.json')).plugins ?? {}) as Record<string, Entry[]>;
  for (const [key, entries] of Object.entries(installed)) {
    const entry = (Array.isArray(entries) ? entries : [])
      .filter(e => e.installPath && fs.existsSync(e.installPath))
      .sort((a, b) => (b.lastUpdated ?? '').localeCompare(a.lastUpdated ?? ''))[0];
    if (!entry) continue;
    const [plugin, market = ''] = key.split('@');
    out.set(key, { key, plugin, market, dir: entry.installPath!, installed: true });
  }
  const markets = readJson(path.join(root, 'plugins', 'known_marketplaces.json')) as Record<string, { source?: { source?: string }; installLocation?: string }>;
  for (const [market, m] of Object.entries(markets)) {
    if (m.source?.source !== 'directory' || !m.installLocation) continue;
    const plugins = (readJson(path.join(m.installLocation, '.claude-plugin', 'marketplace.json')).plugins ?? []) as { name?: string; source?: unknown }[];
    for (const p of plugins) {
      if (!p.name || out.has(`${p.name}@${market}`)) continue;
      const dir = typeof p.source === 'string' ? path.resolve(m.installLocation, p.source) : path.join(m.installLocation, p.name);
      if (fs.existsSync(dir)) out.set(`${p.name}@${market}`, { key: `${p.name}@${market}`, plugin: p.name, market, dir, installed: false });
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function pluginViews(root: string): ScopeView[] {
  return pluginDirs(root).map(p => {
    const scope: HarnessScope = { id: `plugin:${p.key}`, label: `plugin ${p.key}`, base: p.dir, root: p.dir, memory: [], mcpFile: '', userConfig: '', installedPlugins: false };
    return {
      id: scope.id,
      label: scope.label,
      path: p.dir,
      categories: [
        { ...kindInfo('agent'), items: markdownAssets(scope, path.join(p.dir, 'agents'), 'agent', false, stripMd) },
        { ...kindInfo('skill'), items: skillAssets(scope, path.join(p.dir, 'skills')) },
      ],
    };
  });
}

export interface Roster {
  skills: Set<string>;
  agents: Set<string>;
}

const BUILTIN_AGENTS = ['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'claude-code-guide', 'claude'];
const BUILTIN_SKILLS = ['claude-in-chrome', 'init', 'review', 'security-review', 'simplify', 'code-review', 'loop', 'schedule', 'claude-api', 'update-config', 'keybindings-help', 'fewer-permission-prompts', 'run', 'workflow-authoring', 'artifact-design', 'artifact-capabilities', 'artifact-diagramming', 'dataviz', 'plugin-authoring'];

export function rosterOf(views: ScopeView[], plugins: ScopeView[]): Roster {
  const skills = new Set(BUILTIN_SKILLS);
  const agents = new Set(BUILTIN_AGENTS);
  const add = (view: ScopeView, prefix?: string) => {
    for (const c of view.categories) {
      const set = c.kind === 'skill' ? skills : c.kind === 'agent' ? agents : undefined;
      if (!set) continue;
      for (const a of c.items) {
        set.add(a.name);
        if (prefix) set.add(`${prefix}:${a.name}`);
      }
    }
  };
  views.forEach(v => add(v));
  plugins.forEach(v => add(v, v.id.slice('plugin:'.length).split('@')[0]));
  return { skills, agents };
}

export function globToRegExp(glob: string): RegExp {
  const g = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const esc = (s: string) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        const slash = g[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{' && g.indexOf('}', i) > i) {
      const end = g.indexOf('}', i);
      re += `(?:${g.slice(i + 1, end).split(',').map(s => esc(s).replace(/\\\*|\*/g, '[^/]*')).join('|')})`;
      i = end;
    } else re += esc(c);
  }
  return new RegExp(`^${re}$`);
}

const WALK_SKIP = new Set([...SKIP_DIRS, 'bin', 'obj', 'dist', '.angular', 'worktrees']);
const walkCache = new Map<string, { at: number; files: string[]; capped: boolean }>();

export function repoFiles(dir: string, cap = 20000): { files: string[]; capped: boolean } {
  const hit = walkCache.get(dir);
  if (hit && Date.now() - hit.at < 30000) return hit;
  const files: string[] = [];
  let capped = false;
  const walk = (abs: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= cap) {
        capped = true;
        return;
      }
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!WALK_SKIP.has(e.name)) walk(path.join(abs, e.name), r);
      } else files.push(r);
    }
  };
  walk(dir, '');
  const result = { at: Date.now(), files, capped };
  walkCache.set(dir, result);
  return result;
}

export const listOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean) : typeof value === 'string' && value.trim() ? value.split(',').map(s => s.trim()).filter(Boolean) : [];

export interface GlobMatch {
  glob: string;
  matches: number;
  sample: string[];
}

export function matchGlobs(dir: string, globs: string[]): { globs: GlobMatch[]; total: number; capped: boolean } {
  const { files, capped } = repoFiles(dir);
  const all = new Set<string>();
  const out = globs.map(glob => {
    const re = globToRegExp(glob);
    const hits = files.filter(f => re.test(f));
    hits.forEach(h => all.add(h));
    return { glob, matches: hits.length, sample: hits.slice(0, 5) };
  });
  return { globs: out, total: all.size, capped };
}

export const OWNER_LINE = /^\s*-\s*Owner agent:\s*`([^`]+)`/m;

export interface RuleInfo {
  globs: GlobMatch[];
  total: number;
  capped: boolean;
  owner?: string;
  ownerFound?: boolean;
  base: string;
}

export function ruleInfo(asset: Asset, repoDir: string, roster: Roster): RuleInfo {
  const doc = readMarkdown(asset.file);
  const { globs, total, capped } = matchGlobs(repoDir, listOf(doc.data.paths));
  const owner = OWNER_LINE.exec(doc.body)?.[1];
  return { globs, total, capped, owner, ownerFound: owner ? roster.agents.has(owner) : undefined, base: repoDir };
}

export interface MemoryNode {
  file: string;
  label: string;
  exists: boolean;
  imports: MemoryNode[];
}

const IMPORT = /(^|\s)@((?:~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)?[^\s`'"()<>,;]+)/g;

export function importsOf(text: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    for (const m of line.replace(/`[^`]*`/g, ' ').matchAll(IMPORT)) out.push(m[2].replace(/[.:!?]+$/, ''));
  }
  return out;
}

export function memoryTree(file: string, label: string, depth = 0, seen = new Set<string>()): MemoryNode {
  const exists = fs.existsSync(file) && fs.statSync(file).isFile();
  const node: MemoryNode = { file, label, exists, imports: [] };
  const key = path.resolve(file).toLowerCase();
  if (!exists || depth >= 5 || seen.has(key)) return node;
  seen.add(key);
  for (const ref of importsOf(readText(file))) {
    const target = /^~[\\/]/.test(ref) ? path.join(os.homedir(), ref.slice(2)) : path.isAbsolute(ref) ? ref : path.resolve(path.dirname(file), ref);
    if (!fs.existsSync(target) && !/\.md$/i.test(ref)) continue;
    node.imports.push(memoryTree(target, ref, depth + 1, seen));
  }
  return node;
}

export interface EffectiveRule {
  name: string;
  scope: string;
  file: string;
  globs: GlobMatch[];
  always: boolean;
  total: number;
}

export interface EffectivePlugin {
  key: string;
  user?: boolean;
  project?: boolean;
  local?: boolean;
  enabled: boolean;
  duplicate: boolean;
}

export interface EffectiveHook {
  event: string;
  matcher: string;
  command: string;
  source: string;
}

export interface Effective {
  memory: MemoryNode[];
  rules: EffectiveRule[];
  plugins: EffectivePlugin[];
  hooks: EffectiveHook[];
  capped: boolean;
}

type HookGroups = Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string; type?: string }> }>>;

const hookEntries = (hooks: unknown, source: string): EffectiveHook[] =>
  Object.entries((hooks && typeof hooks === 'object' ? hooks : {}) as HookGroups).flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : []).flatMap(g => (g.hooks ?? []).map(h => ({ event, matcher: g.matcher ?? '', command: h.command ?? h.type ?? '', source })))
  );

export function pluginHooks(dir: string, key: string): EffectiveHook[] {
  const declared = readJson(path.join(dir, '.claude-plugin', 'plugin.json')).hooks;
  const json = readJson(path.join(dir, typeof declared === 'string' ? declared : path.join('hooks', 'hooks.json')));
  if (Array.isArray(json.modules)) return (json.modules as unknown[]).map(m => ({ event: 'mod', matcher: '', command: String(m), source: key }));
  return hookEntries(json.hooks ?? (declared && typeof declared === 'object' ? (declared as Record<string, unknown>).hooks ?? declared : {}), key);
}

export function effectiveHarness(global: HarnessScope, repo: HarnessScope): Effective {
  const memory = [memoryTree(path.join(global.root, 'CLAUDE.md'), '~/.claude/CLAUDE.md'), ...repo.memory.map(rel => memoryTree(path.join(repo.base, rel), rel))].filter(n => n.exists);
  let capped = false;
  const rules = [
    ...markdownAssets(global, path.join(global.root, 'rules'), 'rule', true, stripMd).map(a => ({ a, scope: 'Global' })),
    ...markdownAssets(repo, path.join(repo.root, 'rules'), 'rule', true, stripMd).map(a => ({ a, scope: repo.label })),
  ].map(({ a, scope }) => {
    const globs = listOf(readMarkdown(a.file).data.paths);
    const m = matchGlobs(repo.base, globs);
    capped ||= m.capped;
    return { name: a.name, scope, file: a.file, globs: m.globs, always: !globs.length, total: m.total };
  });
  const user = readJson(path.join(global.root, 'settings.json'));
  const project = readJson(path.join(repo.root, 'settings.json'));
  const local = readJson(path.join(repo.root, 'settings.local.json'));
  const enabledOf = (s: Record<string, unknown>) => (s.enabledPlugins ?? {}) as Record<string, boolean>;
  const [u, p, l] = [enabledOf(user), enabledOf(project), enabledOf(local)];
  const plugins = [...new Set([...Object.keys(u), ...Object.keys(p), ...Object.keys(l)])]
    .sort((a, b) => a.localeCompare(b))
    .map(key => ({ key, user: u[key], project: p[key], local: l[key], enabled: (l[key] ?? p[key] ?? u[key]) === true, duplicate: u[key] === true && (p[key] === true || l[key] === true) }));
  const dirs = new Map(pluginDirs(global.root).filter(d => d.installed).map(d => [d.key, d.dir]));
  const hooks = [
    ...hookEntries(user.hooks, '~/.claude/settings.json'),
    ...hookEntries(project.hooks, '.claude/settings.json'),
    ...hookEntries(local.hooks, '.claude/settings.local.json'),
    ...plugins.filter(x => x.enabled && dirs.has(x.key)).flatMap(x => pluginHooks(dirs.get(x.key)!, x.key)),
  ];
  return { memory, rules, plugins, hooks, capped };
}

export const BOILERPLATE_SECTIONS = ['Workflow Orchestration', 'Subagent Strategy', 'Self-Improvement Loop', 'Task Management', 'Core Principles', 'Token Efficiency', 'Delegation', 'Agent Delegation', 'Skill Routing'];

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export const isClassRepo = (dir: string) => isDir(path.join(dir, 'demos')) && isDir(path.join(dir, 'labs'));

export function keepsCopies(dir: string): boolean {
  const file = path.join(dir, 'CLAUDE.md');
  if (!fs.existsSync(file)) return false;
  return /\bcop(?:y|ies)\b[^\n]*\b(?:kept|keeps?)\b|\bkeeps?\b[^\n]*\bcop(?:y|ies)\b/i.test(readText(file));
}

export type Layout = 'router' | 'old template' | 'class boilerplate' | 'other' | 'none';

export function claudeMdText(dir: string, expand = true): string | undefined {
  const file = path.join(dir, 'CLAUDE.md');
  if (!fs.existsSync(file)) return undefined;
  const text = readText(file);
  if (!expand) return text;
  return text
    .split(/\r?\n/)
    .map(l => {
      const m = /^@(\S+)\s*$/.exec(l);
      const inc = m ? path.join(dir, m[1]) : '';
      return inc && fs.existsSync(inc) ? readText(inc) : l;
    })
    .join('\n');
}

export function layoutOf(dir: string): Layout {
  const text = claudeMdText(dir);
  if (text === undefined) return 'none';
  const heads = [...text.matchAll(/^## (.+)$/gm)].map(m => m[1].trim());
  if (heads.includes('Harness')) return 'router';
  if (isClassRepo(dir)) return 'class boilerplate';
  if (heads.some(h => BOILERPLATE_SECTIONS.includes(h))) return 'old template';
  return 'other';
}

export function retireBlock(asset: Asset, repoDir: string | undefined): string | undefined {
  if (asset.kind !== 'skill' && asset.kind !== 'agent') return 'Only skills and agents are retired.';
  if (!repoDir || asset.scope === 'global' || asset.scope.startsWith('plugin:')) return 'Only a repo copy is retired.';
  if (!asset.copies?.some(c => c.same && (c.scope === 'global' || c.scope.startsWith('plugin:')))) return 'It has no identical global or plugin copy.';
  if (isClassRepo(repoDir)) return 'A class repo keeps its copies.';
  if (keepsCopies(repoDir)) return 'Its CLAUDE.md says copies are kept.';
  return undefined;
}

export const backupStamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export function retireAsset(asset: Asset, repoDir: string, backupRoot: string, stamp: string): string {
  const target = asset.dir ?? asset.file;
  const dest = path.join(backupRoot, stamp, path.basename(repoDir), path.relative(repoDir, target));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(target, dest, { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  return dest;
}

export interface PointerToken {
  line: number;
  start: number;
  end: number;
  token: string;
  kind: 'path' | 'skill' | 'agent';
}

const SKIP_POINTERS = new Set(['tasks/todo.md', 'tasks/lessons.md']);

const isPathToken = (p: string) =>
  !SKIP_POINTERS.has(p) &&
  !p.endsWith('-') &&
  !/^(~|https?:|\$|-|@|<|\{|\/)/.test(p) &&
  !/[*<>{}|()"'=,]/.test(p) &&
  !p.replace(/^[A-Za-z]:[\\/]/, '').includes(':') &&
  (/^[A-Za-z]:[\\/]/.test(p) || p.includes('/'));

const wordsIn = (text: string) => text.replace(/`[^`]*`/g, ' ').split(/[^A-Za-z0-9'-]+/).filter(Boolean).length;

const wordAt = (text: string, re: RegExp, fromEnd: boolean) => {
  const hits = [...text.matchAll(re)];
  if (!hits.length) return Infinity;
  const gap = fromEnd ? wordsIn(text.slice(hits[hits.length - 1].index! + hits[hits.length - 1][0].length)) : wordsIn(text.slice(0, hits[0].index!));
  return gap <= 1 ? gap : Infinity;
};

export function pointerTokens(text: string): PointerToken[] {
  const out: PointerToken[] = [];
  let fence = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    for (const m of line.matchAll(/`([^`\s]+)`/g)) {
      const token = m[1].replace(/[.,:;)]+$/, '');
      const start = m.index! + 1;
      const item = (kind: PointerToken['kind']) => out.push({ line: i, start, end: start + token.length, token, kind });
      if (/[\\/]/.test(token)) {
        if (isPathToken(token)) item('path');
        continue;
      }
      if (!/^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)?$/.test(token) && !BUILTIN_AGENTS.includes(token)) continue;
      const before = line.slice(Math.max(0, m.index! - 40), m.index!).toLowerCase();
      const after = line.slice(m.index! + m[0].length, m.index! + m[0].length + 30).toLowerCase();
      if (/\b(?:leaf|leaves|references?|sections?)\b[^a-z]*$/.test(before.replace(/`[^`]*`/g, ' '))) continue;
      const agent = Math.min(wordAt(before, /\b(?:sub)?agents?\b/g, true), wordAt(after, /\b(?:sub)?agents?\b/g, false));
      const skill = Math.min(wordAt(before, /\bskills?\b/g, true), wordAt(after, /\bskills?\b/g, false));
      if (agent === Infinity && skill === Infinity) continue;
      item(agent <= skill ? 'agent' : 'skill');
    }
  });
  return out;
}

const suffixHit = (token: string, dirs: string[]) => {
  const t = token.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  return dirs.some(dir => {
    const { files } = repoFiles(dir);
    return files.some(f => f === t || f.endsWith(`/${t}`) || f.startsWith(`${t}/`) || f.includes(`/${t}/`));
  });
};

export function deadPointers(text: string, baseDir: string, roster: Roster, kinds: PointerToken['kind'][] = ['path', 'skill', 'agent'], also: string[] = []): PointerToken[] {
  return pointerTokens(text).filter(t => {
    if (!kinds.includes(t.kind)) return false;
    if (t.kind === 'path') {
      if (/^[A-Za-z]:[\\/]/.test(t.token)) return !fs.existsSync(t.token);
      return !fs.existsSync(path.join(baseDir, t.token.replace(/^\.\//, ''))) && !suffixHit(t.token, [baseDir, ...also]);
    }
    const set = t.kind === 'skill' ? roster.skills : roster.agents;
    return !set.has(t.token) && !(t.kind === 'agent' && roster.skills.has(t.token)) && !(t.kind === 'skill' && roster.agents.has(t.token));
  });
}

export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

export function closest(name: string, pool: Iterable<string>, n = 3): string[] {
  const limit = Math.max(3, Math.floor(name.length / 3));
  return [...new Set(pool)]
    .map(p => ({ p, d: editDistance(name.toLowerCase(), p.toLowerCase()) }))
    .filter(x => x.d <= limit && x.p !== name)
    .sort((a, b) => a.d - b.d || a.p.localeCompare(b.p))
    .slice(0, n)
    .map(x => x.p);
}

export function pathCandidates(token: string, baseDir: string, n = 3): string[] {
  const base = path.posix.basename(token.replace(/\\/g, '/').replace(/\/$/, ''));
  const { files } = repoFiles(baseDir);
  const dirs = new Set(files.flatMap(f => f.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
  const pool = [...files, ...[...dirs].map(d => `${d}/`)];
  const same = pool.filter(p => path.posix.basename(p.replace(/\/$/, '')) === base);
  return (same.length ? same : closest(token, pool, n)).slice(0, n);
}
