import * as fs from 'fs';
import * as path from 'path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { SKIP, filesIn } from './consolidate';
import { Asset, HarnessScope, Kind, McpConfig, MCP_NAME, jsonAt, parseMarkdown, validateName } from './harness';
import { catalogFileOf, catalogOf, layoutOf, readJson, sourceFor } from './hunt-market';
import type { HuntMarket } from './shared/hunt';
import { ZipEntry, readZip, writeZip } from './zip';

// Share and Import: each kind leaves as its own native file, so a package works without Claude Harness, and comes back
// through the same checks. Nothing here talks to VS Code; src/share-host.ts asks and reports.

/** The kinds that can be shared and imported. Settings, workflows and hook scripts are not offered. */
export type ShareKind = 'skill' | 'plugin' | 'agent' | 'command' | 'outputStyle' | 'rule' | 'memory' | 'mcp' | 'hook';

export const SHARE_KINDS: ShareKind[] = ['skill', 'plugin', 'agent', 'command', 'outputStyle', 'rule', 'memory', 'mcp', 'hook'];

export const shareLabel: Record<ShareKind, string> = {
  skill: 'Skill',
  plugin: 'Plugin',
  agent: 'Agent',
  command: 'Command',
  outputStyle: 'Output Style',
  rule: 'Rule',
  memory: 'CLAUDE.md',
  mcp: 'MCP Server',
  hook: 'Hook',
};

export const isShareKind = (kind: string): kind is ShareKind => (SHARE_KINDS as string[]).includes(kind);

/** Why an element cannot be shared, or nothing when it can. */
export function notShareable(asset: Asset): string | undefined {
  if (!isShareKind(asset.kind)) return `${asset.name} is a ${asset.kind} and has no share format.`;
  if (asset.kind === 'mcp' && (!asset.file || !asset.jsonPath)) return `${asset.name} is not stored in a file of yours: ${asset.source === 'claude.ai' ? 'it is a claude.ai connector' : 'a plugin or the CLI provides it'}.`;
  if (asset.kind !== 'plugin' && asset.kind !== 'mcp' && !fs.existsSync(asset.file)) return `${asset.name} is gone from disk.`;
  return undefined;
}

export interface Pack {
  /** The name of the file written to Downloads. */
  file: string;
  data: Buffer;
  /** In words: what the file is. */
  what: string;
  /** What is inside, for the card: relative names, capped by the caller. */
  files: string[];
  /** Key names that look like secrets; the values are in the package as they are. */
  secrets: string[];
}

const slug = (text: string) => text.replace(/[:/\\]+/g, '-').replace(/[^A-Za-z0-9._@ -]/g, '_');

const read = (file: string) => fs.readFileSync(file);

const isText = (data: Buffer) => !data.subarray(0, 4096).includes(0);

// Keys whose value is likely a credential, and token shapes that are one wherever they stand.
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|apikey|auth|credential|bearer|private[_-]?key|access[_-]?key)/i;
const SECRET_SHAPE = /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
const ASSIGN = /["']?([A-Za-z0-9_.-]*(?:token|secret|password|passwd|api[_-]?key|apikey|auth|credential|bearer|private[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*["']?([^\s"',}]{8,})/gi;
const PLACEHOLDER = /^(\$|<|\{\{|your[-_]|xxx|changeme|example|\*+$|\.\.\.)/i;

/** Names (never values) of what a package carries that looks like a token, key or password, with the file it stands in. */
export function scanSecrets(entries: ZipEntry[]): string[] {
  const found = new Set<string>();
  for (const e of entries) {
    if (!isText(e.data) || e.data.length > 1024 * 1024) continue;
    const text = e.data.toString('utf8');
    const where = ` in ${e.name}`;
    for (const m of text.matchAll(ASSIGN)) if (!PLACEHOLDER.test(m[2])) found.add(`${m[1]}${where}`);
    const shaped = SECRET_SHAPE.exec(text);
    if (shaped) found.add(`a token starting ${shaped[1].slice(0, 4)}${where}`);
  }
  return [...found].slice(0, 12);
}

/** The env values and headers of an MCP server, by key: whatever they hold, the package carries it. */
export function mcpSecrets(config: McpConfig): string[] {
  const keep = (v: string) => !/^\$\{?[A-Za-z_]+\}?$/.test(v) && !PLACEHOLDER.test(v);
  return [
    ...Object.entries(config.env ?? {}).filter(([, v]) => keep(String(v))).map(([k]) => `env ${k}`),
    ...Object.entries(config.headers ?? {}).filter(([, v]) => keep(String(v))).map(([k]) => `header ${k}`),
  ];
}

const folderEntries = (dir: string, root: string): ZipEntry[] => filesIn(dir).map(rel => ({ name: `${root}/${rel}`, data: read(path.join(dir, ...rel.split('/'))) }));

/** Scripts a hook group runs that live under the scope's `.claude` folder, relative to it, with `/`. */
export function hookScripts(group: unknown, scope: HarnessScope): string[] {
  const out = new Set<string>();
  const commands = JSON.stringify(group).match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)"/g) ?? [];
  for (const raw of commands) {
    const command = (JSON.parse(`{${raw}}`) as { command: string }).command;
    for (const m of command.matchAll(/\.claude[\\/]([^\s"'|;&<>)]+)/g)) {
      const rel = m[1].replace(/\\/g, '/');
      const file = path.join(scope.root, ...rel.split('/'));
      if (!rel.includes('..') && fs.existsSync(file) && fs.statSync(file).isFile()) out.add(rel);
    }
  }
  return [...out];
}

/** The package of one element in its native format. `scope` is where the element lives (a repo or the global folder). */
export function packAsset(asset: Asset, scope: HarnessScope): Pack {
  const why = notShareable(asset);
  if (why) throw new Error(why);
  switch (asset.kind) {
    case 'skill': {
      const dir = asset.dir ?? path.dirname(asset.file);
      const entries = folderEntries(dir, asset.name);
      return { file: `${slug(asset.name)}.zip`, data: writeZip(entries), what: 'a skill folder as a zip', files: entries.map(e => e.name), secrets: scanSecrets(entries) };
    }
    case 'mcp': {
      const config = (jsonAt(asset.file, asset.jsonPath!) ?? {}) as McpConfig;
      const text = `${JSON.stringify({ mcpServers: { [asset.name]: config } }, null, 2)}\n`;
      const entries = [{ name: `${asset.name}.json`, data: Buffer.from(text) }];
      const named = mcpSecrets(config);
      const secrets = [...named, ...scanSecrets(entries).filter(s => !named.some(n => n.endsWith(` ${s.split(' ')[0]}`)))];
      return { file: `${slug(asset.name)}.json`, data: entries[0].data, what: 'an MCP server entry as JSON', files: [`${asset.name}.json`], secrets };
    }
    case 'hook': {
      const [, event] = asset.jsonPath!;
      const group = jsonAt(asset.file, asset.jsonPath!);
      const json = Buffer.from(`${JSON.stringify({ hooks: { [String(event)]: [group] } }, null, 2)}\n`);
      const scripts = hookScripts(group, scope);
      const name = slug(`hook-${asset.name.replace(/ · /g, '-')}`);
      if (!scripts.length) return { file: `${name}.json`, data: json, what: 'a hook entry as JSON in the settings shape', files: ['hooks.json'], secrets: scanSecrets([{ name: 'hooks.json', data: json }]) };
      const entries: ZipEntry[] = [{ name: 'hooks.json', data: json }, ...scripts.map(rel => ({ name: `.claude/${rel}`, data: read(path.join(scope.root, ...rel.split('/'))) }))];
      return { file: `${name}.zip`, data: writeZip(entries), what: 'a hook entry with its script as a zip', files: entries.map(e => e.name), secrets: scanSecrets(entries) };
    }
    case 'plugin':
      throw new Error('A plugin is packed from its folder.');
    default: {
      const data = read(asset.file);
      return { file: asset.kind === 'memory' ? path.basename(asset.file) : `${slug(asset.name)}.md`, data, what: `${shareLabel[asset.kind as ShareKind].toLowerCase()} as a Markdown file`, files: [path.basename(asset.file)], secrets: scanSecrets([{ name: path.basename(asset.file), data }]) };
    }
  }
}

export interface PluginInventory {
  skills: number;
  agents: number;
  commands: number;
  hooks: number;
  mcp: number;
  styles: number;
  files: number;
  bytes: number;
}

/** What a plugin folder holds, counted from the disk. */
export function pluginInventory(dir: string): PluginInventory {
  const files = filesIn(dir);
  const count = (re: RegExp) => files.filter(f => re.test(f)).length;
  const hooksFile = readJson(path.join(dir, 'hooks', 'hooks.json')).hooks ?? readJson(path.join(dir, '.claude-plugin', 'hooks.json')).hooks ?? {};
  const mcp = readJson(path.join(dir, '.mcp.json'));
  return {
    skills: count(/^skills\/[^/]+\/SKILL\.md$/),
    agents: count(/^agents\/.+\.md$/),
    commands: count(/^commands\/.+\.md$/),
    hooks: Object.values(hooksFile as Record<string, unknown[]>).reduce((n, groups) => n + (Array.isArray(groups) ? groups.length : 0), 0),
    mcp: Object.keys(mcp.mcpServers ?? mcp ?? {}).filter(k => k !== 'mcpServers').length,
    styles: count(/^output-styles\/.+\.md$/),
    files: files.length,
    bytes: files.reduce((n, f) => n + fs.statSync(path.join(dir, ...f.split('/'))).size, 0),
  };
}

/** The inventory in words: `3 skills, 2 agents, 1 hook`. */
export function inventoryWords(inv: PluginInventory): string {
  const part = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : '');
  return [part(inv.skills, 'skill'), part(inv.agents, 'agent'), part(inv.commands, 'command'), part(inv.styles, 'output style'), part(inv.hooks, 'hook'), part(inv.mcp, 'MCP server')].filter(Boolean).join(', ') || `${inv.files} files`;
}

export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A whole plugin as a zip with its folder at the root. */
export function packPlugin(dir: string, key: string): Pack {
  const name = key.split('@')[0];
  if (!fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) throw new Error(`${key} has no .claude-plugin/plugin.json to package.`);
  const entries = folderEntries(dir, name);
  return { file: `${slug(name)}.zip`, data: writeZip(entries), what: 'a plugin folder as a zip', files: entries.map(e => e.name), secrets: scanSecrets(entries) };
}

/** The first free file name in a folder: `name.zip`, then `name (2).zip`, `name (3).zip`. */
export function freeName(dir: string, file: string): string {
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  let name = file;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${stem} (${n})${ext}`;
  return name;
}

// ---------------------------------------------------------------------------------------------------------------------
// Import

export type Pkg =
  | { kind: 'skill'; name: string; description: string; entries: ZipEntry[] }
  | { kind: 'plugin'; name: string; description: string; entries: ZipEntry[] }
  | { kind: 'agent' | 'command' | 'outputStyle' | 'rule' | 'memory'; name: string; description: string; text: string }
  | { kind: 'mcp'; name: string; description: string; servers: Record<string, McpConfig> }
  | { kind: 'hook'; name: string; description: string; hooks: Record<string, unknown[]>; scripts: ZipEntry[] };

export type Read = { pkg: Pkg } | { problem: string };

const FIELDS: Record<'agent' | 'command' | 'outputStyle' | 'rule', string[]> = {
  agent: ['name', 'description', 'tools', 'disallowedTools', 'model', 'effort', 'permissionMode', 'skills', 'mcpServers', 'memory', 'isolation', 'color', 'maxTurns', 'hooks'],
  command: ['description', 'argument-hint', 'allowed-tools', 'model', 'disable-model-invocation'],
  outputStyle: ['name', 'description', 'keep-coding-instructions'],
  rule: ['paths'],
};
// Frontmatter keys that only an agent has: a file with one is not an output style.
const AGENT_ONLY = ['tools', 'disallowedTools', 'model', 'effort', 'permissionMode', 'skills', 'mcpServers', 'memory', 'isolation', 'color', 'maxTurns', 'hooks'];

const oneLine = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Entries of a zip without the one folder they all sit in, and that folder's name. A zip with files at its root has no folder. */
function unroot(entries: ZipEntry[]): { folder: string | undefined; entries: ZipEntry[] } {
  const clean = entries.filter(e => !e.name.startsWith('__MACOSX/') && !e.name.endsWith('.DS_Store'));
  for (const e of clean) if (e.name.startsWith('/') || e.name.split('/').includes('..') || /^[A-Za-z]:/.test(e.name)) throw new Error(`The zip holds a path that leaves its folder (${e.name}).`);
  const tops = new Set(clean.map(e => e.name.split('/')[0]));
  const rooted = tops.size === 1 && clean.every(e => e.name.includes('/'));
  if (!rooted) return { folder: undefined, entries: clean };
  const folder = [...tops][0];
  return { folder, entries: clean.map(e => ({ name: e.name.slice(folder.length + 1), data: e.data })) };
}

function readMd(kind: 'agent' | 'command' | 'outputStyle' | 'rule' | 'memory', file: string): Read {
  const text = fs.readFileSync(file, 'utf8');
  const base = path.basename(file).replace(/\.md$/i, '');
  if (!/\.md$/i.test(file)) return { problem: `${path.basename(file)} is not a Markdown file.` };
  if (kind === 'memory') return { pkg: { kind, name: 'CLAUDE.md', description: '', text } };
  const doc = parseMarkdown(text);
  const keys = Object.keys(doc.data);
  const name = oneLine(doc.data.name) || base;
  const description = oneLine(doc.data.description);
  if (kind === 'agent') {
    if (!doc.hasFrontmatter || !oneLine(doc.data.name) || !description) return { problem: 'An agent file starts with frontmatter that has a name and a description. This file does not.' };
    if ('keep-coding-instructions' in doc.data) return { problem: 'This file has an output style field (keep-coding-instructions), not an agent.' };
    return { pkg: { kind, name, description, text } };
  }
  if (kind === 'outputStyle') {
    if (!doc.hasFrontmatter || !oneLine(doc.data.name) || !description) return { problem: 'An output style file starts with frontmatter that has a name and a description. This file does not.' };
    const agentKey = keys.find(k => AGENT_ONLY.includes(k));
    if (agentKey) return { problem: `This file has an agent field (${agentKey}), not an output style.` };
    return { pkg: { kind, name, description, text } };
  }
  if (kind === 'command') {
    if (!doc.hasFrontmatter || !keys.length) return { problem: 'A command file starts with frontmatter such as description or argument-hint. This file has none.' };
    const odd = keys.filter(k => !FIELDS.command.includes(k));
    if (odd.length) return { problem: `This file has fields a command does not (${odd.join(', ')}). It looks like an agent or an output style.` };
    return { pkg: { kind, name: base, description, text } };
  }
  const odd = keys.filter(k => !FIELDS.rule.includes(k));
  if (doc.hasFrontmatter && odd.length) return { problem: `This file has fields a rule does not (${odd.join(', ')}). It looks like an agent, a command or an output style.` };
  return { pkg: { kind, name: base, description: oneLine(doc.body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '')) , text } };
}

function readSettingsHooks(json: unknown): Record<string, unknown[]> | undefined {
  const hooks = (json as { hooks?: unknown })?.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return undefined;
  const out: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups) || !groups.every(g => g && typeof g === 'object' && Array.isArray((g as { hooks?: unknown }).hooks))) return undefined;
    out[event] = groups;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Reads a file in the kind's share format and checks that it is that kind. */
export function readPackage(kind: ShareKind, file: string): Read {
  try {
    if (!fs.existsSync(file)) return { problem: `${file} is not on disk.` };
    switch (kind) {
      case 'skill':
      case 'plugin': {
        if (!/\.zip$/i.test(file)) return { problem: `A ${kind} is a .zip file. ${path.basename(file)} is not.` };
        const { folder, entries } = unroot(readZip(fs.readFileSync(file)));
        const has = (rel: string) => entries.find(e => e.name === rel);
        if (kind === 'skill') {
          const skill = has('SKILL.md');
          if (!skill) return { problem: 'This zip has no SKILL.md at the top of the skill folder, so it is not a skill.' };
          const doc = parseMarkdown(skill.data.toString('utf8'));
          const name = oneLine(doc.data.name) || folder || path.basename(file, path.extname(file));
          if (!doc.hasFrontmatter || !oneLine(doc.data.description)) return { problem: 'SKILL.md starts with frontmatter that has a description. This one does not.' };
          return { pkg: { kind, name: folder ?? name, description: oneLine(doc.data.description), entries } };
        }
        const manifest = has('.claude-plugin/plugin.json');
        if (!manifest) return { problem: 'This zip has no .claude-plugin/plugin.json at the top of the plugin folder, so it is not a plugin.' };
        let json: Record<string, unknown>;
        try {
          json = parseJsonc(manifest.data.toString('utf8')) ?? {};
        } catch {
          return { problem: 'plugin.json is not valid JSON.' };
        }
        const name = oneLine(json.name) || folder || '';
        if (!name) return { problem: 'plugin.json has no name.' };
        return { pkg: { kind, name, description: oneLine(json.description), entries } };
      }
      case 'mcp': {
        let json: { mcpServers?: unknown };
        try {
          json = parseJsonc(fs.readFileSync(file, 'utf8')) ?? {};
        } catch {
          return { problem: `${path.basename(file)} is not valid JSON.` };
        }
        const servers = json.mcpServers;
        if (!servers || typeof servers !== 'object' || Array.isArray(servers) || !Object.keys(servers).length) return { problem: 'An MCP server file is JSON shaped {"mcpServers": {"name": {...}}}. This one is not.' };
        for (const [name, config] of Object.entries(servers as Record<string, McpConfig>)) {
          if (!MCP_NAME.test(name)) return { problem: `${name} is not a valid MCP server name.` };
          if (!config || typeof config !== 'object' || (!config.url && !config.command)) return { problem: `${name} names neither a URL nor a command.` };
        }
        const names = Object.keys(servers);
        return { pkg: { kind, name: names.join(', '), description: names.length === 1 ? 'one server' : `${names.length} servers`, servers: servers as Record<string, McpConfig> } };
      }
      case 'hook': {
        let text: string;
        let scripts: ZipEntry[] = [];
        if (/\.zip$/i.test(file)) {
          const { entries } = unroot(readZip(fs.readFileSync(file)));
          const json = entries.find(e => e.name === 'hooks.json');
          if (!json) return { problem: 'This zip has no hooks.json, so it is not a hook package.' };
          text = json.data.toString('utf8');
          scripts = entries.filter(e => e.name.startsWith('.claude/')).map(e => ({ name: e.name.slice('.claude/'.length), data: e.data }));
        } else text = fs.readFileSync(file, 'utf8');
        let json: unknown;
        try {
          json = parseJsonc(text);
        } catch {
          return { problem: `${path.basename(file)} is not valid JSON.` };
        }
        const hooks = readSettingsHooks(json);
        if (!hooks) return { problem: 'A hook file is JSON shaped {"hooks": {"Event": [{"hooks": [...]}]}}. This one is not.' };
        const events = Object.keys(hooks);
        return { pkg: { kind, name: events.join(', '), description: `${events.length} ${events.length === 1 ? 'event' : 'events'}`, hooks, scripts } };
      }
      default:
        return readMd(kind, file);
    }
  } catch (e) {
    return { problem: (e as Error).message };
  }
}

export interface ImportPlan {
  name: string;
  /** Absolute paths written; a merge names the file it merges into. */
  files: string[];
  /** What already stands in the way: the path, or for a merge the entry. */
  exists?: string;
  /** Lines for the card: entries merged, entries skipped. */
  notes: string[];
  problem?: string;
}

const target = (scope: HarnessScope, kind: ShareKind, name: string): string => {
  switch (kind) {
    case 'skill':
      return path.join(scope.root, 'skills', name);
    case 'agent':
      return path.join(scope.root, 'agents', `${name}.md`);
    case 'command':
      return path.join(scope.root, 'commands', ...name.split(':')) + '.md';
    case 'outputStyle':
      return path.join(scope.root, 'output-styles', `${name}.md`);
    case 'rule':
      return path.join(scope.root, 'rules', `${name}.md`);
    case 'memory':
      return path.join(scope.base, 'CLAUDE.md');
    default:
      throw new Error(`${shareLabel[kind]} has no file of its own.`);
  }
};

const forward = (p: string) => p.replace(/\\/g, '/');

/** The command of a hook group with every script it runs pointed at the target's `.claude` folder. */
export function repointHooks(hooks: Record<string, unknown[]>, scripts: string[], scope: HarnessScope): Record<string, unknown[]> {
  if (!scripts.length) return hooks;
  const base = scope.id === 'global' ? forward(scope.root) : '$CLAUDE_PROJECT_DIR/.claude';
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const swap = (command: string) =>
    scripts.reduce((t, rel) => t.replace(new RegExp(`(?:[A-Za-z]:)?[^\\s"']*?\\.claude[\\\\/]${rel.split('/').map(escape).join('[\\\\/]')}`, 'g'), () => `${base}/${rel}`), command);
  const walk = (node: unknown): unknown =>
    Array.isArray(node)
      ? node.map(walk)
      : node && typeof node === 'object'
        ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === 'command' && typeof v === 'string' ? swap(v) : walk(v)]))
        : node;
  return walk(hooks) as Record<string, unknown[]>;
}

const sameGroup = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Where an import would write, and what stands in the way. For a plugin use `planPluginImport`. */
export function planImport(pkg: Pkg, scope: HarnessScope, name = pkg.name): ImportPlan {
  const plan: ImportPlan = { name, files: [], notes: [] };
  switch (pkg.kind) {
    case 'plugin':
      throw new Error('A plugin goes into a marketplace.');
    case 'skill': {
      const dir = target(scope, 'skill', name);
      if (validateName(name)) plan.problem = `${name} is not a valid skill name. ${validateName(name)}`;
      plan.files = pkg.entries.length > 12 ? [`${dir} (${pkg.entries.length} files)`] : pkg.entries.map(e => path.join(dir, ...e.name.split('/')));
      if (fs.existsSync(dir)) plan.exists = dir;
      return plan;
    }
    case 'mcp': {
      const names = Object.keys(pkg.servers);
      const have = (readJson(scope.mcpFile).mcpServers ?? {}) as Record<string, unknown>;
      plan.files = [scope.mcpFile];
      const clash = names.filter(n => have[n]);
      if (clash.length) plan.exists = `${clash.join(', ')} in ${scope.mcpFile}`;
      plan.notes.push(...names.map(n => `${clash.includes(n) ? 'Replaces' : 'Adds'} the server ${n}; the other servers in the file stay.`));
      return plan;
    }
    case 'hook': {
      const file = path.join(scope.root, 'settings.json');
      const hooks = repointHooks(pkg.hooks, pkg.scripts.map(s => s.name), scope);
      const have = (readJson(file).hooks ?? {}) as Record<string, unknown[]>;
      plan.files = [file, ...pkg.scripts.map(s => path.join(scope.root, ...s.name.split('/')))];
      for (const [event, groups] of Object.entries(hooks))
        for (const group of groups) plan.notes.push((have[event] ?? []).some(g => sameGroup(g, group)) ? `${event}: an identical entry is already there, so it is skipped.` : `${event}: adds an entry; the other hooks stay.`);
      const scriptClash = pkg.scripts.map(s => path.join(scope.root, ...s.name.split('/'))).filter(f => fs.existsSync(f));
      if (scriptClash.length) plan.exists = scriptClash.join(', ');
      return plan;
    }
    default: {
      const file = target(scope, pkg.kind, name);
      if (pkg.kind !== 'memory' && validateName(name.replace(/:/g, '-'))) plan.problem = `${name} is not a valid name. ${validateName(name.replace(/:/g, '-'))}`;
      plan.files = [file];
      if (fs.existsSync(file)) plan.exists = file;
      return plan;
    }
  }
}

/** Copies what stands in the way to `<backupRoot>/<stamp>/<base>/...` first. Returns the backup folder. */
export function backupPath(file: string, base: string, backupRoot: string, stamp: string): string {
  const dest = path.join(backupRoot, stamp, path.basename(base), path.relative(base, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(file, dest, { recursive: true });
  return path.join(backupRoot, stamp);
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');
const fmt = (text: string) => ({ insertSpaces: true, tabSize: 2, eol: eolOf(text) });

const writeInside = (dir: string, entries: ZipEntry[]) => {
  for (const e of entries) {
    const file = path.join(dir, ...e.name.split('/'));
    if (path.relative(dir, file).startsWith('..')) throw new Error(`${e.name} leaves the folder.`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, e.data);
  }
};

/**
 * Writes the package. `replace` first copies what is in the way to the backup folder; without it a clash is an error.
 * Returns the backup folder when something was backed up.
 */
export function applyImport(pkg: Pkg, scope: HarnessScope, plan: ImportPlan, replace: boolean, backupRoot: string, stamp: string): string | undefined {
  if (plan.problem) throw new Error(plan.problem);
  if (plan.exists && !replace && pkg.kind !== 'mcp' && pkg.kind !== 'hook') throw new Error(`${plan.exists} already exists.`);
  let backup: string | undefined;
  switch (pkg.kind) {
    case 'plugin':
      throw new Error('A plugin goes into a marketplace.');
    case 'skill': {
      const dir = target(scope, 'skill', plan.name);
      if (fs.existsSync(dir)) {
        backup = backupPath(dir, scope.base, backupRoot, stamp);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      writeInside(dir, pkg.entries.filter(e => !e.name.split('/').some(s => SKIP.has(s))));
      const skill = path.join(dir, 'SKILL.md');
      if (plan.name !== pkg.name && fs.existsSync(skill)) fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace(/^(name\s*:\s*).*$/m, `$1${plan.name}`));
      return backup;
    }
    case 'mcp': {
      const file = scope.mcpFile;
      let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
      const have = (readJson(file).mcpServers ?? {}) as Record<string, unknown>;
      if (Object.keys(pkg.servers).some(n => have[n]) && fs.existsSync(file)) backup = backupPath(file, scope.base, backupRoot, stamp);
      for (const [name, config] of Object.entries(pkg.servers)) text = applyEdits(text, modify(text, ['mcpServers', name], config, { formattingOptions: fmt(text) }));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, 'utf8');
      return backup;
    }
    case 'hook': {
      const file = path.join(scope.root, 'settings.json');
      const hooks = repointHooks(pkg.hooks, pkg.scripts.map(s => s.name), scope);
      for (const s of pkg.scripts) {
        const dest = path.join(scope.root, ...s.name.split('/'));
        if (fs.existsSync(dest)) backup = backupPath(dest, scope.base, backupRoot, stamp);
      }
      writeInside(scope.root, pkg.scripts);
      let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
      for (const [event, groups] of Object.entries(hooks))
        for (const group of groups) {
          const have = ((parseJsonc(text) ?? {}).hooks?.[event] ?? []) as unknown[];
          if (have.some(g => sameGroup(g, group))) continue;
          text = applyEdits(text, Array.isArray(have) && have.length ? modify(text, ['hooks', event, have.length], group, { isArrayInsertion: true, formattingOptions: fmt(text) }) : modify(text, ['hooks', event], [group], { formattingOptions: fmt(text) }));
        }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, 'utf8');
      return backup;
    }
    default: {
      const file = target(scope, pkg.kind, plan.name);
      if (fs.existsSync(file)) backup = backupPath(file, scope.base, backupRoot, stamp);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let text = pkg.text;
      // A new name goes into the frontmatter too, where the file has one.
      if (plan.name !== pkg.name && (pkg.kind === 'agent' || pkg.kind === 'outputStyle')) text = text.replace(/^(name\s*:\s*).*$/m, `$1${plan.name}`);
      fs.writeFileSync(file, text, 'utf8');
      return backup;
    }
  }
}

// --- A plugin goes into a directory marketplace. -----------------------------------------------------------------------

export interface PluginImportPlan {
  name: string;
  /** The `./` source the catalog entry gets. */
  source: string;
  dir: string;
  /** Files written, relative to the marketplace folder. */
  files: string[];
  exists: boolean;
  problem?: string;
}

const PLUGIN_NAME = /^[a-z0-9][a-z0-9._-]*$/;

export function planPluginImport(pkg: Pkg & { kind: 'plugin' }, market: HuntMarket, name = pkg.name, category = ''): PluginImportPlan {
  const plan: PluginImportPlan = { name, source: '', dir: '', files: [], exists: false };
  if (!market.owned) return { ...plan, problem: `${market.name} is not a marketplace folder of yours on disk.` };
  if (!PLUGIN_NAME.test(name)) return { ...plan, problem: 'Lowercase letters, digits, dots, dashes and underscores; starts with a letter or digit.' };
  const entries = catalogOf(market.location);
  const layout = layoutOf(entries);
  if (layout.categorized && !PLUGIN_NAME.test(category)) return { ...plan, problem: `${market.name} keeps plugins in category folders: give a category.` };
  plan.exists = entries.some(e => e.name === name);
  plan.source = plan.exists ? String(entries.find(e => e.name === name)?.source ?? sourceFor(entries, name, category)) : sourceFor(entries, name, category);
  plan.dir = path.resolve(market.location, plan.source);
  if (!plan.dir.toLowerCase().startsWith(path.resolve(market.location).toLowerCase() + path.sep)) return { ...plan, problem: 'The plugin folder would be outside the marketplace.' };
  const rel = plan.source.replace(/^\.\//, '');
  plan.files = pkg.entries.length > 12 ? [`${rel}/ (${pkg.entries.length} files)`] : pkg.entries.map(e => `${rel}/${e.name}`);
  plan.files.push(`${path.basename(market.location)}/.claude-plugin/marketplace.json (${plan.exists ? `keeps the entry for ${name}` : `adds ${name}`})`);
  return plan;
}

/** Writes the plugin folder and its catalog entry. `replace` moves the old folder to the backup first. A failure puts back what it removed. */
export function writePluginImport(pkg: Pkg & { kind: 'plugin' }, plan: PluginImportPlan, market: HuntMarket, backupRoot: string, stamp: string): string | undefined {
  if (plan.problem) throw new Error(plan.problem);
  let backup: string | undefined;
  const catalogFile = catalogFileOf(market.location);
  const catalogText = fs.readFileSync(catalogFile, 'utf8');
  if (fs.existsSync(plan.dir)) {
    backup = backupPath(plan.dir, market.location, backupRoot, stamp);
    fs.rmSync(plan.dir, { recursive: true, force: true });
  }
  try {
    const entries = pkg.entries.filter(e => !e.name.split('/').some(s => SKIP.has(s)));
    writeInside(plan.dir, entries);
    // A new name goes into the manifest, so the install key matches the catalog.
    const manifest = path.join(plan.dir, '.claude-plugin', 'plugin.json');
    const json = readJson(manifest);
    if (json.name !== plan.name) fs.writeFileSync(manifest, `${JSON.stringify({ ...json, name: plan.name }, null, 2)}\n`);
    if (!plan.exists) {
      const catalog = (parseJsonc(catalogText) ?? {}) as { plugins?: unknown[] };
      const index = Array.isArray(catalog.plugins) ? catalog.plugins.length : 0;
      fs.writeFileSync(catalogFile, applyEdits(catalogText, modify(catalogText, ['plugins', index], { name: plan.name, source: plan.source, description: pkg.description }, { isArrayInsertion: true, formattingOptions: fmt(catalogText) })));
    }
  } catch (e) {
    fs.rmSync(plan.dir, { recursive: true, force: true });
    fs.writeFileSync(catalogFile, catalogText);
    if (backup) fs.cpSync(path.join(backup, path.basename(market.location), path.relative(market.location, plan.dir)), plan.dir, { recursive: true });
    throw e;
  }
  return backup;
}
