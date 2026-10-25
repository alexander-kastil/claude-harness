import * as fs from 'fs';
import * as path from 'path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { SKIP, filesIn } from './consolidate';
import { Asset, Copy, retireAsset } from './harness';
import { CliResult, runClaude } from './hunt-create';

// Sync keeps copies of one thing in step: a repo skill or agent from its Global version, a plugin from the marketplace
// that is ahead of it, one MCP server entry across the files that configure it.

// ---- A repo skill or agent from Global --------------------------------------------------------------------------

export interface SyncFiles {
  /** Relative paths: in both and different / only in Global / only in the repo copy, which the sync deletes. */
  replaced: string[];
  added: string[];
  deleted: string[];
}

const bytes = (file: string) => fs.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n');

/** The Global copy a repo copy is synced from: the one that differs, or why there is none. */
export function syncSource(asset: Asset, repoDir: string | undefined): { source?: Copy; block?: string } {
  if (asset.kind !== 'skill' && asset.kind !== 'agent') return { block: 'Only skills and agents are synced from Global.' };
  if (!repoDir || asset.scope === 'global' || asset.scope.startsWith('plugin:')) return { block: 'Only a repo copy is synced from Global.' };
  if (asset.link) return { block: 'It is linked to Global, so it already is the Global version.' };
  const global = (asset.copies ?? []).find(c => c.scope === 'global');
  if (!global) return { block: 'It has no Global copy.' };
  if (global.same) return { block: 'It is identical to the Global copy.' };
  return { source: global };
}

/** What the sync would do to the repo copy's files. */
export function syncFiles(asset: Asset, source: Asset): SyncFiles {
  if (!asset.dir || !source.dir) return { replaced: bytes(asset.file) === bytes(source.file) ? [] : [path.basename(asset.file)], added: [], deleted: [] };
  const repo = filesIn(asset.dir);
  const global = filesIn(source.dir);
  const inGlobal = new Set(global);
  const inRepo = new Set(repo);
  const at = (dir: string, rel: string) => path.join(dir, ...rel.split('/'));
  return {
    replaced: repo.filter(f => inGlobal.has(f) && bytes(at(asset.dir!, f)) !== bytes(at(source.dir!, f))),
    added: global.filter(f => !inRepo.has(f)),
    deleted: repo.filter(f => !inGlobal.has(f)),
  };
}

/** Backs the repo copy up with the existing retire, then puts the Global version in its place. Returns the backup folder. */
export function syncApply(asset: Asset, source: Asset, repoDir: string, backupRoot: string, stamp: string): string {
  const target = asset.dir ?? asset.file;
  const backup = retireAsset(asset, repoDir, backupRoot, stamp);
  try {
    if (asset.dir && source.dir) fs.cpSync(source.dir, target, { recursive: true, dereference: true, filter: s => !SKIP.has(path.basename(s)) });
    else fs.copyFileSync(source.file, target);
  } catch (e) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(backup, target, { recursive: true });
    throw new Error(`${(e as Error).message} The repo copy was put back.`);
  }
  return backup;
}

// ---- A plugin from its marketplace ------------------------------------------------------------------------------

const readJson = (file: string): Record<string, unknown> => {
  try {
    const v = parseJsonc(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

export const installedVersion = (root: string, key: string): string | undefined => {
  const list = ((readJson(path.join(root, 'plugins', 'installed_plugins.json')).plugins ?? {}) as Record<string, Array<{ scope?: string; version?: string }>>)[key] ?? [];
  return (list.find(e => e.scope === 'user') ?? list[0])?.version;
};

/** Refreshes the marketplace, then updates the plugin from it. Throws with the CLI's last line when it does not end on `want`. */
export async function updatePluginFromMarket(key: string, market: string, want: string | undefined, root: string, run: (args: string[], root: string) => Promise<CliResult> = runClaude): Promise<void> {
  const refreshed = await run(['plugin', 'marketplace', 'update', market], root);
  if (refreshed.code !== 0) throw new Error(`claude plugin marketplace update ${market} failed: ${lastLine(refreshed)}`);
  const updated = await run(['plugin', 'update', key], root);
  const now = installedVersion(root, key);
  if (updated.code !== 0 || (want && now !== want)) throw new Error(`claude plugin update ${key} failed: ${lastLine(updated)}${now ? ` (installed ${now})` : ''}`);
}

const lastLine = (r: CliResult) => r.out.split('\n').filter(Boolean).slice(-1)[0] ?? `exit ${r.code}`;

// ---- An MCP server across the files that configure it -----------------------------------------------------------

export interface McpVersion {
  /** The assets that hold this exact configuration. */
  assets: Asset[];
  config: Record<string, unknown>;
}

const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;

const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** The entry an MCP asset stands for, read from its file. */
export function mcpConfig(asset: Asset): Record<string, unknown> | undefined {
  if (!asset.file || !asset.jsonPath) return undefined;
  let at: unknown = readJson(asset.file);
  for (const part of asset.jsonPath) at = at && typeof at === 'object' ? (at as Record<string | number, unknown>)[part] : undefined;
  return at && typeof at === 'object' ? (at as Record<string, unknown>) : undefined;
}

/** The configurations of one server name across the files that hold it, grouped by what they say. Fewer than two means nothing to sync. */
export function mcpVersions(assets: Asset[]): McpVersion[] {
  const out: McpVersion[] = [];
  for (const asset of assets) {
    const config = mcpConfig(asset);
    if (!config) continue;
    const hit = out.find(v => same(v.config, config));
    if (hit) hit.assets.push(asset);
    else out.push({ assets: [asset], config });
  }
  return out;
}

/** The keys that change when `config` replaces `other`, as `key (changed)`, `key (added)` or `key (removed)`. */
export function keyChanges(config: Record<string, unknown>, other: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(config), ...Object.keys(other)])].sort();
  return keys.flatMap(k => (!(k in other) ? [`${k} (added)`] : !(k in config) ? [`${k} (removed)`] : same(config[k], other[k]) ? [] : [`${k} (changed)`]));
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

/** The file's text with the one entry replaced; every other entry and the file's formatting stay. */
export function withEntry(text: string, jsonPath: (string | number)[], config: Record<string, unknown>): string {
  return applyEdits(text, modify(text, jsonPath, config, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: eolOf(text) } }));
}

export interface McpWrite {
  asset: Asset;
  label: string;
  keys: string[];
}

/** Writes `config` into each target's file, backing every file up first (once per file). Returns the backup folder. */
export function mcpApply(config: Record<string, unknown>, writes: McpWrite[], backupRoot: string, stamp: string): string {
  const folder = path.join(backupRoot, stamp, 'mcp');
  const done = new Map<string, string>();
  const original = new Map<string, string>();
  try {
    for (const w of writes) {
      const file = w.asset.file;
      if (!original.has(file)) {
        original.set(file, fs.readFileSync(file, 'utf8'));
        const dest = path.join(folder, `${original.size}-${path.basename(file)}`);
        fs.mkdirSync(folder, { recursive: true });
        fs.copyFileSync(file, dest);
      }
      const next = withEntry(done.get(file) ?? original.get(file)!, w.asset.jsonPath!, config);
      done.set(file, next);
    }
    for (const [file, text] of done) fs.writeFileSync(file, text, 'utf8');
  } catch (e) {
    for (const [file, text] of original) fs.writeFileSync(file, text, 'utf8');
    throw e;
  }
  return folder;
}
