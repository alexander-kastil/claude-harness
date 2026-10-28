import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { SKIP, filesIn } from './consolidate';
import { Asset, KeepCopies, ScopeView, keepsCopies, retireAsset } from './harness';
import { assetAt, keyOf, pathOf, samePath } from './hunt-catalog';
import { catalogFileOf, catalogOf, layoutOf, readJson, sourceFor, sourcesOf } from './hunt-market';
import type { HuntAsset, HuntMarket, HuntProposal } from './shared/hunt';

// Creating a plugin from a card: the plan shown before anything happens, the folder and catalog entry written, the install, the retired copies.

const NAME = /^[a-z0-9][a-z0-9._-]*$/;
const SCHEMA = 'https://anthropic.com/claude-code/plugin.schema.json';

export interface CreateCtx {
  /** Claude's own root, where plugins/known_marketplaces.json lives. */
  root: string;
  views: ScopeView[];
  market: HuntMarket;
  backupRoot: string;
  keep?: KeepCopies;
  /** Files that ride along into the plugin (a hooks.json, a hook script, an .mcp.json), `to` relative to the plugin folder; `drop` deletes the source after the install, backed up first. */
  files?: { from: string; to: string; drop?: boolean }[];
}

export interface CreatePlan {
  /** The ride-along files, resolved and checked. */
  extra?: { from: string; to: string; drop: boolean }[];
  problems: string[];
  /** Every file written, relative to the marketplace folder. */
  files: string[];
  /** Every copy retired, in words. */
  retired: string[];
  /** Copies the owner ticked that stay, with why. */
  kept: string[];
  source: string;
  dir: string;
  chosen: { asset: HuntAsset; from: Asset; kind: 'skill' | 'agent' }[];
  retires: { asset: Asset; base: string; label: string }[];
}

export function planCreate(p: HuntProposal, ctx: CreateCtx): CreatePlan {
  const problems: string[] = [];
  const plan: CreatePlan = { problems, files: [], retired: [], kept: [], source: '', dir: '', chosen: [], retires: [] };
  const entries = ctx.market.owned ? catalogOf(ctx.market.location) : [];
  if (!ctx.market.owned) problems.push(`${ctx.market.name} is not a marketplace folder of yours on disk.`);
  if (!NAME.test(p.name)) problems.push('Give the plugin a name: lowercase letters, digits, dots, dashes or underscores.');
  if (ctx.market.owned && layoutOf(entries).categorized && !NAME.test(p.category)) problems.push(`${ctx.market.name} keeps plugins in category folders: give the card a category.`);
  if (p.category && !NAME.test(p.category)) problems.push('The category needs lowercase letters, digits, dots, dashes or underscores.');
  if (!/^[\w.@-]+$/.test(ctx.market.name)) problems.push('The marketplace name has characters the install command cannot take.');
  const included = p.assets.filter(a => a.include);
  if (!included.length && !ctx.files?.length) problems.push('Tick at least one skill or agent.');
  if (problems.length && !ctx.market.owned) return plan;
  if (entries.some(e => e.name === p.name)) problems.push(`${ctx.market.name} already has a plugin called ${p.name}. Give this card another name.`);
  plan.source = sourceFor(entries, p.name, p.category);
  plan.dir = path.resolve(ctx.market.location, plan.source);
  if (!plan.dir.toLowerCase().startsWith(path.resolve(ctx.market.location).toLowerCase() + path.sep)) problems.push('The plugin folder would be outside the marketplace.');
  else if (fs.existsSync(plan.dir)) problems.push(`The folder ${plan.source} already exists.`);
  const rel = (...parts: string[]) => [plan.source.replace(/^\.\//, ''), ...parts].join('/');
  plan.files.push(rel('.claude-plugin', 'plugin.json'));
  const names = new Set<string>();
  for (const a of included) {
    if (names.has(keyOf(a))) continue;
    names.add(keyOf(a));
    if (a.name.includes('..') || a.name.startsWith('/')) {
      problems.push(`${a.name} is not a valid name.`);
      continue;
    }
    // The global copy is the plugin's version; a repo copy only when there is no global one.
    const from = a.global ? assetAt(ctx.views, a.kind, a.global.path) : a.repos[0] ? assetAt(ctx.views, a.kind, a.repos[0].path) : undefined;
    if (!from) {
      problems.push(`The ${a.kind} ${a.name} is gone from disk. Remove it from the card.`);
      continue;
    }
    plan.chosen.push({ asset: a, from: from.asset, kind: a.kind });
    if (a.kind === 'skill') {
      const files = filesIn(pathOf(from.asset));
      plan.files.push(...(files.length > 12 ? [rel('skills', a.name, `... ${files.length} files`)] : files.map(f => rel('skills', a.name, f))));
    } else plan.files.push(rel('agents', `${a.name}.md`));
    const retire = (file: string, label: string) => {
      const hit = assetAt(ctx.views, a.kind, file);
      if (!hit) return void problems.push(`The copy of ${a.name} in ${label} is gone from disk. Untick it.`);
      const isGlobal = hit.view.id === 'global';
      const block = isGlobal ? undefined : keepsCopies(hit.view.path, ctx.keep);
      if (block) return void plan.kept.push(`${a.name} in ${label} stays: ${block}`);
      plan.retires.push({ asset: hit.asset, base: isGlobal ? ctx.root : hit.view.path, label });
      plan.retired.push(`${a.kind} ${a.name} in ${label}`);
    };
    if (a.global?.retire) retire(a.global.path, 'Global');
    for (const r of a.repos) if (r.retire) retire(r.path, r.repo);
  }
  plan.extra = [];
  for (const f of ctx.files ?? []) {
    const from = path.resolve(f.from);
    const to = f.to.replace(/\\/g, '/');
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) problems.push(`The file ${f.from} is gone from disk.`);
    else if (!to || to.startsWith('/') || to.split('/').includes('..')) problems.push(`${f.to} is not a path inside the plugin.`);
    else {
      plan.extra.push({ from, to, drop: !!f.drop });
      plan.files.push(rel(...to.split('/')));
      if (f.drop) plan.retired.push(`file ${from}`);
    }
  }
  plan.files.push(`${path.basename(ctx.market.location)}/.claude-plugin/marketplace.json (adds ${p.name})`);
  return plan;
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');
const format = (text: string) => ({ insertSpaces: true, tabSize: 2, eol: eolOf(text) });

/** Steps 2 and 3: the plugin folder and the marketplace entry. A failure removes the folder it made. */
export async function writePlugin(p: HuntProposal, plan: CreatePlan, market: HuntMarket): Promise<void> {
  const catalogFile = catalogFileOf(market.location);
  const catalogText = fs.readFileSync(catalogFile, 'utf8');
  const catalog = (parseJsonc(catalogText) ?? {}) as Record<string, any>;
  const entries = (Array.isArray(catalog.plugins) ? catalog.plugins : []) as { source?: unknown }[];
  const firstDir = sourcesOf(entries).map(s => path.resolve(market.location, s)).find(d => fs.existsSync(path.join(d, '.claude-plugin', 'plugin.json')));
  const schema = (firstDir && readJson(path.join(firstDir, '.claude-plugin', 'plugin.json')).$schema) || SCHEMA;
  const manifest: Record<string, unknown> = { $schema: schema, name: p.name, version: '0.1.0', description: p.description };
  if (catalog.owner && typeof catalog.owner === 'object') manifest.author = catalog.owner;
  try {
    await fs.promises.mkdir(path.join(plan.dir, '.claude-plugin'), { recursive: true });
    await fs.promises.writeFile(path.join(plan.dir, '.claude-plugin', 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const c of plan.chosen) {
      if (c.kind === 'skill') await fs.promises.cp(pathOf(c.from), path.join(plan.dir, 'skills', c.asset.name), { recursive: true, dereference: true, filter: src => !SKIP.has(path.basename(src)) });
      else {
        const dest = path.join(plan.dir, 'agents', `${c.asset.name}.md`);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.copyFile(c.from.file, dest);
      }
    }
    for (const f of plan.extra ?? []) {
      await fs.promises.mkdir(path.dirname(path.join(plan.dir, f.to)), { recursive: true });
      await fs.promises.copyFile(f.from, path.join(plan.dir, f.to));
    }
    const edits = modify(catalogText, ['plugins', entries.length], { name: p.name, source: plan.source, description: p.description }, { isArrayInsertion: true, formattingOptions: format(catalogText) });
    await fs.promises.writeFile(catalogFile, applyEdits(catalogText, edits));
  } catch (e) {
    await fs.promises.rm(plan.dir, { recursive: true, force: true });
    throw e;
  }
}

export interface CliResult {
  code: number;
  out: string;
}

/**
 * The program and leading arguments that start claude, without a shell option: `claude` itself, `claude.exe` from the PATH on
 * Windows, or `claude.cmd` (the npm install) through cmd.exe, which Node cannot start directly.
 */
export function claudeLauncher(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') return ['claude'];
  // Windows variable names are case-insensitive, a copied environment is not.
  const get = (name: string) => env[Object.keys(env).find(k => k.toLowerCase() === name.toLowerCase()) ?? name];
  const dirs = (get('PATH') ?? '').split(path.delimiter).filter(Boolean);
  for (const ext of ['.exe', '.cmd'])
    for (const dir of dirs) {
      const file = path.join(dir, `claude${ext}`);
      if (!fs.existsSync(file)) continue;
      return ext === '.exe' ? [file] : [get('ComSpec') ?? path.join(get('SystemRoot') ?? 'C:\\Windows', 'System32', 'cmd.exe'), '/d', '/s', '/c', file];
    }
  return ['claude'];
}

/** Runs the claude CLI against the root the extension reads, so the install lands where the pages look. */
export function runClaude(args: string[], root: string, timeout = 180000, cwd = os.tmpdir()): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!samePath(root, path.join(os.homedir(), '.claude'))) env.CLAUDE_CONFIG_DIR = root;
  const [file, ...lead] = claudeLauncher(env);
  return new Promise(resolve =>
    execFile(file, [...lead, ...args], { env, windowsHide: true, timeout, cwd, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : -1) : 0, out: `${stdout ?? ''}${stderr ?? ''}`.trim() })
    )
  );
}

export const isInstalled = (root: string, key: string): boolean => Array.isArray(readJson(path.join(root, 'plugins', 'installed_plugins.json')).plugins?.[key]);

/** Step 4: the marketplace is refreshed so the CLI sees the new entry, then the plugin is installed for the user. */
export async function installPlugin(p: HuntProposal, market: HuntMarket, root: string, run = runClaude): Promise<void> {
  await run(['plugin', 'marketplace', 'update', market.name], root);
  const key = `${p.name}@${market.name}`;
  const r = await run(['plugin', 'install', key, '--scope', 'user'], root);
  if (r.code === 0 && !isInstalled(root, key)) throw new Error(`claude plugin install ${key} exited 0 but the plugin is not listed in ${path.join(root, 'plugins', 'installed_plugins.json')}.`);
  if (r.code !== 0) throw new Error(`claude plugin install ${key} failed: ${r.out.split('\n').filter(Boolean).slice(-1)[0] ?? `exit ${r.code}`}`);
}

/** Step 5: the ticked copies, each backed up first. Returns the backup folder. */
export function retireCopies(plan: CreatePlan, backupRoot: string, stamp: string): string {
  for (const r of plan.retires) retireAsset(r.asset, r.base, backupRoot, stamp);
  for (const f of (plan.extra ?? []).filter(x => x.drop)) {
    const target = path.join(backupRoot, stamp, 'files', path.relative(path.parse(f.from).root, f.from));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(f.from, target);
    fs.rmSync(f.from);
  }
  return path.join(backupRoot, stamp);
}

/** Undoes `writePlugin` after a failed install, so Create can be pressed again: the folder and the marketplace entry go. */
export function unwritePlugin(p: HuntProposal, plan: CreatePlan, market: HuntMarket): void {
  fs.rmSync(plan.dir, { recursive: true, force: true });
  const file = catalogFileOf(market.location);
  const text = fs.readFileSync(file, 'utf8');
  const entries = (parseJsonc(text)?.plugins ?? []) as { name?: string }[];
  const index = entries.findIndex(e => e.name === p.name);
  if (index < 0) return;
  fs.writeFileSync(file, applyEdits(text, modify(text, ['plugins', index], undefined, { formattingOptions: format(text) })));
}
