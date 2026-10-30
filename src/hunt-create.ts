import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { SKIP, filesIn } from './consolidate';
import { Asset, KeepCopies, ScopeView, keepsCopies, retireAsset } from './harness';
import { assetAt, keyOf, pathOf, samePath } from './hunt-catalog';
import { Entry, catalogFileOf, catalogOf, layoutOf, readJson, sourceFor, sourcesOf } from './hunt-market';
import { compareVersions } from './fleet';
import { rewriteSkillPaths } from './skill-paths';
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
  extra?: { from: string; to: string; drop: boolean; content?: string }[];
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
  /** Elements that move out of another plugin of the marketplace (removed there, backed up first), and those plugins' version bumps. */
  moves?: { asset: HuntAsset; path: string }[];
  sources?: Bump[];
  /** Lines of the copied skills with an absolute path into another global skill folder, or into their own from a script; `check` rows. */
  pathChecks?: MentionRow[];
}

/** A plugin of the marketplace whose patch version moves: its folder, catalog index, and version before and after. */
export interface Bump {
  name: string;
  dir: string;
  entry: number;
  from: string | null;
  version: string | null;
  /** The marketplace repo's package.json, when its version moves with the plugin's (the harness plugin and the claude-harness extension). */
  pkg?: string;
}

/**
 * An element of another plugin of the same marketplace, named `<plugin>:<name>` on the command line, as a card element that moves
 * out of it; a string says why it cannot.
 */
export function pluginElement(market: HuntMarket, kind: 'skill' | 'agent', plugin: string, name: string): HuntAsset | string {
  const entry = market.owned ? catalogOf(market.location).find(e => e.name === plugin) : undefined;
  if (!entry || typeof entry.source !== 'string' || !entry.source.startsWith('./')) return `${market.name} has no plugin folder called ${plugin}.`;
  if (!NAME.test(name)) return `${name} is not a valid ${kind} name.`;
  const dir = path.resolve(market.location, entry.source);
  const at = kind === 'skill' ? path.join(dir, 'skills', name) : path.join(dir, 'agents', `${name}.md`);
  if (!fs.existsSync(kind === 'skill' ? path.join(at, 'SKILL.md') : at)) return `The plugin ${plugin} has no ${kind} named ${name}.`;
  return { kind, name, include: true, why: '', repos: [], plugin: { name: plugin, path: at } };
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
  const rel = relIn(plan);
  plan.files.push(rel('.claude-plugin', 'plugin.json'));
  planElements(included, ctx, plan);
  planSources(plan, ctx);
  plan.extra = [];
  for (const f of ctx.files ?? []) {
    const from = path.resolve(f.from);
    const to = f.to.replace(/\\/g, '/');
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) problems.push(`The file ${f.from} is gone from disk.`);
    else if (!to || to.startsWith('/') || to.split('/').includes('..')) problems.push(`${f.to} is not a path inside the plugin.`);
    else {
      plan.extra.push({ from, to, drop: !!f.drop });
      if (f.drop) plan.retired.push(`file ${from}`);
    }
  }
  plan.extra = modLayout(plan.extra);
  for (const f of plan.extra) plan.files.push(rel(...f.to.split('/')));
  plan.files.push(`${path.basename(ctx.market.location)}/.claude-plugin/marketplace.json (adds ${p.name})`);
  return plan;
}

/** A file of the plugin, relative to the marketplace folder. */
const relIn = (plan: CreatePlan) => (...parts: string[]) => [plan.source.replace(/^\.\//, ''), ...parts].join('/');

/**
 * The elements of a plan, shared by a new plugin and an addition to one: the copy each is taken from, the files it writes,
 * the copies retired or kept. `held` says why the plugin cannot take an element it already has.
 */
function planElements(included: HuntAsset[], ctx: CreateCtx, plan: CreatePlan, held?: (kind: 'skill' | 'agent', to: string) => string | undefined): void {
  const { problems } = plan;
  const rel = relIn(plan);
  const names = new Set<string>();
  for (const a of included) {
    if (names.has(keyOf(a))) continue;
    names.add(keyOf(a));
    if (a.name.includes('..') || a.name.startsWith('/')) {
      problems.push(`${a.name} is not a valid name.`);
      continue;
    }
    const to = a.as ?? a.name;
    if (a.as && !NAME.test(a.as)) {
      problems.push(`${a.as} is not a valid name for ${a.name}.`);
      continue;
    }
    if (included.some(o => o !== a && o.kind === a.kind && (o.as ?? o.name) === to)) {
      problems.push(`Two ${a.kind}s would be called ${to} in the plugin.`);
      continue;
    }
    const has = held?.(a.kind, to);
    if (has) {
      problems.push(has);
      continue;
    }
    // Another plugin's element is taken from there; else the global copy is the plugin's version, a repo copy only when there is no global one.
    const from = a.plugin ? pluginAsset(a) : a.global ? assetAt(ctx.views, a.kind, a.global.path) : a.repos[0] ? assetAt(ctx.views, a.kind, a.repos[0].path) : undefined;
    if (!from) {
      problems.push(`The ${a.kind} ${a.name} is gone from disk. Remove it from the card.`);
      continue;
    }
    plan.chosen.push({ asset: a, from: from.asset, kind: a.kind });
    if (a.plugin) {
      (plan.moves ??= []).push({ asset: a, path: a.plugin.path });
      plan.retired.push(`${a.kind} ${a.name} in plugin ${a.plugin.name}`);
    }
    if (a.kind === 'skill') {
      const files = filesIn(pathOf(from.asset));
      plan.files.push(...(files.length > 12 ? [rel('skills', to, `... ${files.length} files`)] : files.map(f => rel('skills', to, f))));
      // The copy's Markdown names its own folder as <this skill>/, never ~/.claude/skills/<name>/; other skills' folders are checked.
      for (const f of files) {
        const text = readText(path.join(pathOf(from.asset), f));
        if (text === undefined) continue;
        const md = /\.md$/i.test(f);
        const r = rewriteSkillPaths(text, n => (md && n === a.name ? '<this skill>' : undefined));
        if (r.hits) plan.files.push(`${rel('skills', to, f)} (${r.hits} absolute ${r.hits === 1 ? 'path' : 'paths'} to <this skill>/)`);
        for (const l of r.left) (plan.pathChecks ??= []).push({ file: path.join(plan.dir, 'skills', to, ...f.split('/')), line: l.line, text: clip(l.text) });
      }
    } else plan.files.push(rel('agents', `${to}.md`));
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
}

/** Another plugin's element as the asset its copy is made from. */
function pluginAsset(a: HuntAsset): { asset: Asset } | undefined {
  const at = a.plugin!.path;
  const file = a.kind === 'skill' ? path.join(at, 'SKILL.md') : at;
  if (!fs.existsSync(file)) return undefined;
  return { asset: { id: `plugin:${a.plugin!.name}|${a.kind}:${a.name}`, scope: `plugin:${a.plugin!.name}`, kind: a.kind, name: a.name, description: '', file, dir: a.kind === 'skill' ? at : undefined, mtime: 0 } };
}

/** The version bumps of the plugins elements move out of, each listed with the files it changes. */
function planSources(plan: CreatePlan, ctx: CreateCtx): void {
  const entries = catalogOf(ctx.market.location);
  for (const name of new Set((plan.moves ?? []).map(m => m.asset.plugin!.name))) (plan.sources ??= []).push(planBump(name, entries, ctx, plan));
}

const bumpPatch = (v: string) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : undefined;
};

/**
 * A plugin's patch bump: from plugin.json's version or the catalog entry's, the higher; written where either carries one, and in the
 * marketplace repo's package.json and lock file when they were in step with it. Each file changed is a row of `plan.files`.
 */
export function planBump(name: string, entries: Entry[], ctx: CreateCtx, plan: CreatePlan): Bump {
  const entry = entries.findIndex(e => e.name === name);
  const source = String(entries[entry]?.source ?? '');
  const bump: Bump = { name, dir: path.resolve(ctx.market.location, source), entry, from: null, version: null };
  const own = readJson(path.join(bump.dir, '.claude-plugin', 'plugin.json')).version;
  const listed = entries[entry]?.version;
  bump.from = [own, listed].filter((v): v is string => typeof v === 'string').sort(compareVersions).pop() ?? null;
  if (!bump.from) return bump;
  bump.version = bumpPatch(bump.from) ?? null;
  if (!bump.version) {
    plan.problems.push(`The version ${bump.from} of ${name} is not major.minor.patch, so it cannot be bumped.`);
    return bump;
  }
  const market = path.basename(ctx.market.location);
  if (typeof own === 'string') plan.files.push(`${source.replace(/^\.\//, '')}/.claude-plugin/plugin.json (version ${own} to ${bump.version})`);
  if (typeof listed === 'string') plan.files.push(`${market}/.claude-plugin/marketplace.json (${name} version ${listed} to ${bump.version})`);
  // A repo that ships the plugin and keeps its package.json at the plugin's version keeps both in step, the lock file too.
  const pkg = path.join(ctx.market.location, 'package.json');
  if (readJson(pkg).version === bump.from) {
    bump.pkg = pkg;
    for (const f of ['package.json', 'package-lock.json'])
      if (fs.existsSync(path.join(ctx.market.location, f))) plan.files.push(`${market}/${f} (version ${bump.from} to ${bump.version})`);
  }
  return bump;
}

/** Writes the version bumps into plugin.json, the catalog entries and a package.json in step; returns the files as they were, for an undo. */
export function writeVersions(bumps: Bump[], market: HuntMarket): { file: string; text: string }[] {
  const places = new Map<string, { at: (string | number)[]; value: string }[]>();
  const put = (file: string, at: (string | number)[], value: string) => places.set(file, [...(places.get(file) ?? []), { at, value }]);
  for (const b of bumps) {
    if (!b.version) continue;
    put(path.join(b.dir, '.claude-plugin', 'plugin.json'), ['version'], b.version);
    put(catalogFileOf(market.location), ['plugins', b.entry, 'version'], b.version);
    if (!b.pkg) continue;
    put(b.pkg, ['version'], b.version);
    const lock = path.join(path.dirname(b.pkg), 'package-lock.json');
    put(lock, ['version'], b.version);
    put(lock, ['packages', '', 'version'], b.version);
  }
  // Every new text first, so a file that cannot be read writes nothing.
  const out: { file: string; text: string; next: string }[] = [];
  for (const [file, edits] of places) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const data = (parseJsonc(text) ?? {}) as Record<string, any>;
    let next = text;
    for (const e of edits) {
      // A place the file does not carry is left alone.
      const has = e.at.reduce<any>((v, k) => (v && typeof v === 'object' ? v[k] : undefined), data);
      if (typeof has === 'string') next = applyEdits(next, modify(next, e.at, e.value, { formattingOptions: format(next) }));
    }
    if (next !== text) out.push({ file, text, next });
  }
  for (const o of out) fs.writeFileSync(o.file, o.next);
  return out.map(({ file, text }) => ({ file, text }));
}

/**
 * Takes the moved elements out of their plugins, each backed up first, and bumps those plugins' versions. Returns the undo, which puts
 * the elements and the version files back; a failure undoes itself.
 */
export function writeMoves(plan: CreatePlan, market: HuntMarket, backupRoot: string, stamp: string): () => void {
  const done: { path: string; backup: string }[] = [];
  let saved: { file: string; text: string }[] = [];
  const undo = () => {
    for (const s of saved) fs.writeFileSync(s.file, s.text);
    for (const d of done) {
      fs.rmSync(d.path, { recursive: true, force: true });
      fs.cpSync(d.backup, d.path, { recursive: true });
    }
  };
  try {
    for (const m of plan.moves ?? []) {
      const skill = m.asset.kind === 'skill';
      const asset = { kind: m.asset.kind, file: skill ? path.join(m.path, 'SKILL.md') : m.path, dir: skill ? m.path : undefined } as Asset;
      done.push({ path: m.path, backup: retireAsset(asset, market.location, backupRoot, stamp) });
    }
    saved = writeVersions(plan.sources ?? [], market);
  } catch (e) {
    undo();
    throw e;
  }
  return undo;
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');
const format = (text: string) => ({ insertSpaces: true, tabSize: 2, eol: eolOf(text) });

/** A renamed element's copy in the plugin: the `name` line of its front matter says the new name, the rest of the file stays. */
function renameIn(file: string, name: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const head = /^---\r?\n[\s\S]*?\r?\n---/.exec(text);
  if (!head) return;
  fs.writeFileSync(file, text.replace(head[0], () => head[0].replace(/^name:.*$/m, () => `name: ${name}`)));
}

/** Where a chosen element lands in the plugin folder. */
const destOf = (plan: CreatePlan, c: CreatePlan['chosen'][number]) => {
  const to = c.asset.as ?? c.asset.name;
  return c.kind === 'skill' ? path.join(plan.dir, 'skills', to) : path.join(plan.dir, 'agents', `${to}.md`);
};

/** A text file's content, or undefined for one that is not text or too big to be a skill's text. */
function readText(file: string): string | undefined {
  try {
    return TEXT_FILE.test(file) && fs.statSync(file).size <= 512 * 1024 ? fs.readFileSync(file, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

const clip = (t: string) => (t.length > 200 ? `${t.slice(0, 197)}...` : t);

/** The chosen elements copied into the plugin folder: a skill's folder without the skipped files, an agent's file; a renamed one gets its new name. */
async function copyElements(plan: CreatePlan): Promise<void> {
  for (const c of plan.chosen) {
    const to = c.asset.as ?? c.asset.name;
    const dest = destOf(plan, c);
    if (c.kind === 'skill') {
      await fs.promises.cp(pathOf(c.from), dest, { recursive: true, dereference: true, filter: src => !SKIP.has(path.basename(src)) });
      for (const f of filesIn(dest).filter(x => /\.md$/i.test(x))) {
        const file = path.join(dest, ...f.split('/'));
        const text = readText(file);
        const r = text === undefined ? undefined : rewriteSkillPaths(text, n => (n === c.asset.name ? '<this skill>' : null));
        if (r?.hits) await fs.promises.writeFile(file, r.text);
      }
      if (c.asset.as) renameIn(path.join(dest, 'SKILL.md'), to);
    } else {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(c.from.file, dest);
      if (c.asset.as) renameIn(dest, to);
    }
  }
}

/** Steps 2 and 3: the plugin folder and the marketplace entry. A failure removes the folder it made. */
export async function writePlugin(p: HuntProposal, plan: CreatePlan, market: HuntMarket): Promise<void> {
  const catalogFile = catalogFileOf(market.location);
  const catalogText = fs.readFileSync(catalogFile, 'utf8');
  const catalog = (parseJsonc(catalogText) ?? {}) as Record<string, any>;
  const entries = (Array.isArray(catalog.plugins) ? catalog.plugins : []) as { source?: unknown }[];
  const firstDir = sourcesOf(entries).map(s => path.resolve(market.location, s)).find(d => fs.existsSync(path.join(d, '.claude-plugin', 'plugin.json')));
  const schema = (firstDir && readJson(path.join(firstDir, '.claude-plugin', 'plugin.json')).$schema) || SCHEMA;
  const manifest: Record<string, unknown> = { $schema: schema, name: p.name, version: '0.1.0', description: p.description };
  // The author of the marketplace's existing plugins, else the marketplace owner.
  const author = (firstDir && readJson(path.join(firstDir, '.claude-plugin', 'plugin.json')).author) || catalog.owner;
  if (author && typeof author === 'object') manifest.author = author;
  try {
    await fs.promises.mkdir(path.join(plan.dir, '.claude-plugin'), { recursive: true });
    await fs.promises.writeFile(path.join(plan.dir, '.claude-plugin', 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await copyElements(plan);
    for (const f of plan.extra ?? []) {
      await fs.promises.mkdir(path.dirname(path.join(plan.dir, f.to)), { recursive: true });
      if (f.content !== undefined) await fs.promises.writeFile(path.join(plan.dir, f.to), f.content);
      else await fs.promises.copyFile(f.from, path.join(plan.dir, f.to));
    }
    const edits = modify(catalogText, ['plugins', entries.length], { name: p.name, source: plan.source, description: p.description }, { isArrayInsertion: true, formattingOptions: format(catalogText) });
    await fs.promises.writeFile(catalogFile, applyEdits(catalogText, edits));
  } catch (e) {
    await fs.promises.rm(plan.dir, { recursive: true, force: true });
    throw e;
  }
}

const MOD_EXT = /\.(mjs|cjs|js|ts|mts)$/i;
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g;

/** The file a relative import specifier names, trying the spelled name, a .ts source for a .js import, and an extension. */
function importedFile(fromFile: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, base.replace(/\.m?js$/i, '.ts'), base.replace(/\.mjs$/i, '.mts'), ...['.mjs', '.js', '.ts'].map(e => base + e)];
  return candidates.find(c => fs.existsSync(c) && fs.statSync(c).isFile());
}

/**
 * The mods layout: a ride-along that is a hook module (listed under "modules" by a ride-along hooks.json, or a script that
 * targets hooks/<name>.<ext> beside such a hooks.json) lands at mods/<name>/<file>, the files it imports by relative path
 * go into the same folder, and hooks/hooks.json is written with "modules": ["../mods/<name>/<file>"]. A command-hook
 * hooks.json and an .mcp.json stay where they were placed.
 */
export function modLayout(extra: NonNullable<CreatePlan['extra']>): NonNullable<CreatePlan['extra']> {
  const isHooksJson = (e: { to: string }) => /(^|\/)hooks\/hooks\.json$/.test(e.to) || e.to === 'hooks.json';
  const manifest = extra.find(e => {
    if (!isHooksJson(e)) return false;
    try {
      return Array.isArray((parseJsonc(fs.readFileSync(e.from, 'utf8')) as { modules?: unknown })?.modules);
    } catch {
      return false;
    }
  });
  if (!manifest) return extra;
  const json = parseJsonc(fs.readFileSync(manifest.from, 'utf8')) as { modules: unknown[] } & Record<string, unknown>;
  const listed = json.modules.map(String);
  const sourceOf = (m: string) => path.resolve(path.dirname(manifest.from), m);
  const out = extra.filter(e => e !== manifest);
  const modules: { entry: string; file: typeof extra[number] | undefined }[] = listed.map(entry => ({ entry, file: out.find(e => path.resolve(e.from).toLowerCase() === sourceOf(entry).toLowerCase() && MOD_EXT.test(e.to)) }));
  // A script placed at hooks/<name>.<ext> beside the manifest is a module too, listed if the manifest does not name it.
  for (const e of out)
    if (/^hooks\/[^/]+$/.test(e.to) && MOD_EXT.test(e.to) && !modules.some(m => m.file === e)) modules.push({ entry: '', file: e });
  const laid: NonNullable<CreatePlan['extra']> = [];
  const taken = new Set<typeof extra[number]>();
  const entries: string[] = [];
  for (const m of modules) {
    if (!m.file) {
      entries.push(m.entry);
      continue;
    }
    const file = m.file;
    const name = path.posix.basename(file.to).replace(MOD_EXT, '');
    const dir = `mods/${name}`;
    taken.add(file);
    laid.push({ ...file, to: `${dir}/${path.posix.basename(file.to)}` });
    entries.push(`../${dir}/${path.posix.basename(file.to)}`);
    const seen = new Set([path.resolve(file.from).toLowerCase()]);
    const queue = [path.resolve(file.from)];
    while (queue.length) {
      const at = queue.shift()!;
      for (const spec of [...fs.readFileSync(at, 'utf8').matchAll(IMPORT_RE)].map(x => x[2])) {
        const dep = importedFile(at, spec);
        if (!dep || seen.has(dep.toLowerCase())) continue;
        seen.add(dep.toLowerCase());
        queue.push(dep);
        const inside = path.relative(path.dirname(file.from), dep).split(path.sep).join('/');
        const to = `${dir}/${inside.startsWith('..') ? path.basename(dep) : inside}`;
        const placed = out.find(e => path.resolve(e.from).toLowerCase() === dep.toLowerCase());
        if (placed) taken.add(placed);
        if (!laid.some(l => l.to === to)) laid.push({ from: dep, to, drop: placed?.drop ?? false });
      }
    }
  }
  const hooksTo = isHooksJson(manifest) ? manifest.to : 'hooks/hooks.json';
  const written = { ...json, modules: entries };
  return [{ from: manifest.from, to: hooksTo, drop: manifest.drop, content: `${JSON.stringify(written, null, 2)}
` }, ...out.filter(e => !taken.has(e)), ...laid];
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

// Adding to a plugin the marketplace already lists: the same elements, copies and retire rules as a new one.

export interface AddPlan extends CreatePlan {
  /** The plugin's index in the marketplace catalog. */
  entry: number;
  /** The version before the patch bump (plugin.json's or the catalog entry's, the higher) and after it; null when neither carries one. */
  from: string | null;
  version: string | null;
  /** The marketplace repo's package.json, when its version moves with the plugin's (the harness plugin and the claude-harness extension). */
  pkg?: string;
}

export function planAdd(p: HuntProposal, ctx: CreateCtx): AddPlan {
  const problems: string[] = [];
  const plan: AddPlan = { problems, files: [], retired: [], kept: [], source: '', dir: '', chosen: [], retires: [], extra: [], entry: -1, from: null, version: null };
  if (!ctx.market.owned) {
    problems.push(`${ctx.market.name} is not a marketplace folder of yours on disk.`);
    return plan;
  }
  const entries = catalogOf(ctx.market.location);
  plan.entry = entries.findIndex(e => e.name === p.name);
  const entry = entries[plan.entry];
  if (!entry) {
    problems.push(`${ctx.market.name} has no plugin called ${p.name}.`);
    return plan;
  }
  if (typeof entry.source !== 'string' || !entry.source.startsWith('./')) {
    problems.push(`${p.name} is not a folder of ${ctx.market.name}, so nothing can be added to it.`);
    return plan;
  }
  plan.source = entry.source;
  plan.dir = path.resolve(ctx.market.location, plan.source);
  if (!plan.dir.toLowerCase().startsWith(path.resolve(ctx.market.location).toLowerCase() + path.sep)) problems.push('The plugin folder is outside the marketplace.');
  else if (!fs.existsSync(plan.dir)) problems.push(`The folder ${plan.source} is gone from disk.`);
  const included = p.assets.filter(a => a.include);
  if (!included.length) problems.push('Name at least one skill or agent with --skills or --agents.');
  planElements(included, ctx, plan, (kind, to) =>
    fs.existsSync(kind === 'skill' ? path.join(plan.dir, 'skills', to) : path.join(plan.dir, 'agents', `${to}.md`)) ? `${p.name} already has the ${kind} ${to}.` : undefined
  );
  const bump = planBump(p.name, entries, ctx, plan);
  plan.from = bump.from;
  plan.version = bump.version;
  plan.pkg = bump.pkg;
  planSources(plan, ctx);
  return plan;
}

/** Writes an addition: the elements copied in, the version moved in plugin.json and the catalog entry. A failure puts everything back; the returned undo does the same later. */
export async function writeAddition(plan: AddPlan, market: HuntMarket): Promise<() => void> {
  // A skills or agents folder the plugin did not have holds only what this addition copied.
  const made = ['skills', 'agents'].map(d => path.join(plan.dir, d)).filter(d => !fs.existsSync(d));
  let saved: { file: string; text: string }[] = [];
  const undo = () => {
    for (const c of plan.chosen) fs.rmSync(destOf(plan, c), { recursive: true, force: true });
    for (const d of made) fs.rmSync(d, { recursive: true, force: true });
    for (const s of saved) fs.writeFileSync(s.file, s.text);
  };
  try {
    await copyElements(plan);
    saved = writeVersions([{ name: '', dir: plan.dir, entry: plan.entry, from: plan.from, version: plan.version, pkg: plan.pkg }], market);
  } catch (e) {
    undo();
    throw e;
  }
  return undo;
}

// The text that still names a retired element, for the owner to repoint.

export interface MentionRow {
  file: string;
  line: number;
  text: string;
}

const TEXT_FILE = /\.(md|mdx|txt|json|jsonc|ya?ml|toml|py|ps1|psm1|sh|mjs|cjs|js|ts)$/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function textFilesUnder(dir: string, out: string[]): void {
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) textFilesUnder(f, out);
    else if (e.isFile() && TEXT_FILE.test(e.name)) out.push(f);
  }
}

/**
 * Every line in CLAUDE.md, the rules, skills and agents of Global and the repos, and in the marketplace's plugins, that names a
 * retired element by its old place or its bare name. A `plugin:name` mention already points at the plugin and is left out, and so are
 * the element's own files, its copies and its copy in the plugin, and the synced skills. Only reported; nothing is rewritten.
 */
export function staleMentions(plan: CreatePlan, ctx: Pick<CreateCtx, 'root' | 'views' | 'market'>): MentionRow[] {
  const retired = plan.chosen.filter(c => plan.retires.some(r => r.asset.kind === c.kind && r.asset.name === c.asset.name));
  // An element moved out of another plugin is stale only as `<plugin>:<name>`.
  const moved = plan.chosen.filter(c => c.asset.plugin);
  if (!retired.length && !moved.length) return [...(plan.pathChecks ?? [])];
  const own = [...retired, ...moved].flatMap(c =>
    [...(c.asset.global ? [c.asset.global.path] : []), ...c.asset.repos.map(r => r.path), ...(c.asset.plugin ? [c.asset.plugin.path] : []), destOf(plan, c)].map(p => path.resolve(p).toLowerCase())
  );
  // Claude.ai manages and overwrites the synced skills, so nothing there is the owner's to repoint.
  own.push(path.resolve(ctx.root, 'skills', 'synced').toLowerCase());
  const mine = (f: string) => own.some(o => f.toLowerCase() === o || f.toLowerCase().startsWith(o + path.sep));
  const files: string[] = [];
  for (const v of ctx.views) {
    const claude = v.id === 'global' ? ctx.root : path.join(v.path, '.claude');
    const memory = v.id === 'global' ? [path.join(ctx.root, 'CLAUDE.md')] : [path.join(v.path, 'CLAUDE.md'), path.join(claude, 'CLAUDE.md')];
    files.push(...memory.filter(f => fs.existsSync(f)));
    for (const sub of ['rules', 'skills', 'agents']) textFilesUnder(path.join(claude, sub), files);
  }
  if (ctx.market.owned) for (const s of sourcesOf(catalogOf(ctx.market.location))) textFilesUnder(path.resolve(ctx.market.location, s), files);
  const names = [...new Set(retired.map(c => c.asset.name))].map(escapeRe).join('|');
  const ids = moved.map(c => escapeRe(`${c.asset.plugin!.name}:${c.asset.name}`)).join('|');
  const ref = new RegExp(
    [...(names ? [`(?<![\\w.:-])(?:${names})(?![\\w-])(?!:[\\w])`] : []), ...(ids ? [`(?<![\\w.-])(?:${ids})(?![\\w-])`] : [])].join('|')
  );
  const rows: MentionRow[] = [];
  const seen = new Set<string>();
  for (const f of files.map(x => path.resolve(x))) {
    if (seen.has(f.toLowerCase()) || mine(f)) continue;
    seen.add(f.toLowerCase());
    let text: string;
    try {
      if (fs.statSync(f).size > 512 * 1024) continue;
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (!ref.test(text)) continue;
    text.split(/\r?\n/).forEach((l, i) => {
      if (ref.test(l)) rows.push({ file: f, line: i + 1, text: clip(l.trim()) });
    });
  }
  return [...rows, ...(plan.pathChecks ?? [])];
}
