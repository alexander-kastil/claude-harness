import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { knownRepos } from './harness';
import { marketplaceHealth } from './repos-overview';
import { Args, Io, Stop, emit, headline, list, one, table } from './cli-core';
import { Session, SkillChange, escape, isHistory } from './cli-skills';

// `plugins rename`: rename a plugin of a directory marketplace in its folder, its plugin.json, the catalog, the dependents, the settings and the text that names it.

const NAME = /^[a-z0-9][a-z0-9-]*$/;

export interface PluginRenameOut {
  from: string;
  to: string;
  market: string;
  changes: { action: SkillChange['action']; file: string; detail: string }[];
  /** The claude commands that re-register the plugin; they are listed, never run. */
  commands: string[];
  backup: string | null;
}

const rootOf = (a: Args) => path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));

export async function pluginsCommand(a: Args, io: Io): Promise<number> {
  const [, sub] = a.words;
  if (sub === 'rename') return pluginsRename(a, io);
  throw new Stop('plugins takes rename. Run with --help.', 2);
}

type Json = Record<string, unknown>;

function readJson(file: string): Json {
  try {
    return (parseJsonc(fs.readFileSync(file, 'utf8')) ?? {}) as Json;
  } catch {
    return {};
  }
}

const fmt = (text: string) => ({ formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' } });

/** The Markdown files under a folder; backups, worktrees and dependencies are not the owner's text. */
function mdUnder(dir: string): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      if (['node_modules', '.git', 'worktrees', 'repo-sync-backups', '.skill-sync-backups'].includes(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.md$/i.test(e.name)) files.push(f);
    }
  };
  walk(dir);
  return files;
}

/** The plugin's own code and data files: its config, hooks, scripts and tests name it too. */
function codeUnder(dir: string): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      if (['node_modules', '.git', '__pycache__'].includes(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(json|mjs|ts|js|py)$/i.test(e.name)) files.push(f);
    }
  };
  walk(dir);
  return files;
}

/**
 * `old:`, `old@market` and `plugins/old` become the new name; with `links` (a Markdown file beside the plugin folders, the marketplace's
 * plugin list) so do `[old](old)` and a link target `](old/...)`. hits counts the rewrites.
 */
function rewriteMentions(text: string, old: string, to: string, market: string, links = false, quoted = false, shipped: string[] = []): { text: string; hits: number } {
  let hits = 0;
  const sub = (re: RegExp, r: string) => {
    text = text.replace(re, () => (hits++, r));
  };
  const o = escape(old);
  // In the plugin's own code the name is an identifier: a quoted literal ("old", 'old', `old`) and the MCP tool prefix mcp__old__.
  if (quoted) {
    text = text.replace(new RegExp(`(["'\`])${o}\\1`, 'g'), (_m, q: string) => (hits++, `${q}${to}${q}`));
    sub(new RegExp(`mcp__${o}__`, 'g'), `mcp__${to}__`);
  }
  if (links) sub(new RegExp(`\\[${o}\\](?=\\((?:\\./)?(?:plugins/)?${o}[/)#])`, 'g'), `[${to}]`);
  // `old:name` is this plugin's only when name is a skill, agent or command it ships; another plugin of the same name keeps its own.
  if (shipped.length) sub(new RegExp(`(?<![\\w.-])${o}:(?=(?:${shipped.map(escape).join('|')})(?![\\w-]))`, 'g'), `${to}:`);
  sub(new RegExp(`(?<![\\w.-])${o}@${escape(market)}(?![\\w-])`, 'g'), `${to}@${market}`);
  sub(new RegExp(`(?<![\\w.-])plugins/${o}(?![\\w.-])`, 'g'), `plugins/${to}`);
  if (links) {
    text = text.replace(new RegExp(`\\]\\((\\./)?${o}(?=[/)#])`, 'g'), (_m, dot: string | undefined) => (hits++, `](${dot ?? ''}${to}`));
  }
  return { text, hits };
}

/** `dependencies` of a plugin.json or a catalog entry: an array of names, name@market ids or objects with a name, or a map keyed by name. */
function renameDependency(text: string, base: (string | number)[], deps: unknown, old: string, to: string, market: string): string {
  const swap = (s: string) => (s === old ? to : s === `${old}@${market}` ? `${to}@${market}` : undefined);
  if (Array.isArray(deps)) {
    deps.forEach((d, i) => {
      if (typeof d === 'string' && swap(d)) text = applyEdits(text, modify(text, [...base, 'dependencies', i], swap(d), fmt(text)));
      else if (d && typeof d === 'object' && typeof (d as Json).name === 'string' && swap((d as Json).name as string))
        text = applyEdits(text, modify(text, [...base, 'dependencies', i, 'name'], swap((d as Json).name as string), fmt(text)));
    });
  } else if (deps && typeof deps === 'object') {
    for (const [k, v] of Object.entries(deps as Json)) {
      if (!swap(k)) continue;
      text = applyEdits(text, modify(text, [...base, 'dependencies', k], undefined, fmt(text)));
      text = applyEdits(text, modify(text, [...base, 'dependencies', swap(k)!], v, fmt(text)));
    }
  }
  return text;
}

/** The enabledPlugins key renamed in a settings file; the file is left alone when it has no such key. */
function renameEnabled(file: string, old: string, to: string, market: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const before = fs.readFileSync(file, 'utf8');
  const plugins = (readJson(file).enabledPlugins ?? {}) as Json;
  const key = `${old}@${market}`;
  if (!(key in plugins)) return undefined;
  let text = applyEdits(before, modify(before, ['enabledPlugins', key], undefined, fmt(before)));
  text = applyEdits(text, modify(text, ['enabledPlugins', `${to}@${market}`], plugins[key], fmt(text)));
  return text;
}

const renameLines = (o: PluginRenameOut, dry: boolean): string[] => [
  headline(`Rename ${o.from} to ${o.to}: ${o.changes.filter(c => c.action !== 'check').length} change${o.changes.filter(c => c.action !== 'check').length === 1 ? '' : 's'}${o.backup ? `, backup in ${o.backup}` : ''}`),
  '',
  ...table(['Action', 'File', 'Detail'], o.changes.length ? o.changes.map(c => [c.action, c.file, c.detail]) : [['(none)', '', '']]),
  ...(dry ? o.changes.filter(c => c.action !== 'check').map(c => `[dry-run] ${c.action} ${c.file}: ${c.detail}`) : []),
  '',
  headline('Re-register in a terminal'),
  '',
  ...table(['Step', 'Command'], o.commands.map((c, i) => [i + 1, c]), [true, false]),
];

function pluginsRename(a: Args, io: Io): number {
  const fromId = one(a, 'from') ?? '';
  const to = one(a, 'to') ?? '';
  const at = fromId.lastIndexOf('@');
  if (at < 1 || at === fromId.length - 1) throw new Stop('plugins rename needs --from <plugin>@<marketplace>.', 2);
  if (!NAME.test(to)) throw new Stop(`--to takes lowercase letters, digits and dashes, got "${to}".`, 2);
  const old = fromId.slice(0, at);
  const marketName = fromId.slice(at + 1);
  const root = rootOf(a);
  const market = marketplaceHealth(root).find(m => m.name === marketName);
  if (!market) throw new Stop(`There is no marketplace named ${marketName}.`);
  if (market.kind !== 'directory') throw new Stop(`${marketName} is a ${market.kind} marketplace: its plugins can only be renamed at its source.`);
  const catalogFile = path.join(market.location, '.claude-plugin', 'marketplace.json');
  const catalog = (readJson(catalogFile).plugins ?? []) as Json[];
  const index = catalog.findIndex(p => p.name === old);
  const renamed = catalog.findIndex(p => p.name === to);
  // A second run after the catalog already names the plugin `to` finishes the text the first run left; nothing else moves.
  const again = index < 0 && renamed >= 0;
  if (index < 0 && !again) throw new Stop(`${marketName} has no plugin named ${old}.`);
  if (index >= 0 && renamed >= 0) throw new Stop(`${marketName} has a plugin named ${to} already.`);
  const source = catalog[again ? renamed : index].source;
  if (typeof source !== 'string') throw new Stop(`${old} comes from a ${typeof source === 'object' ? 'remote source' : 'source'} that is not a folder of ${marketName}.`);
  const dir = path.resolve(market.location, source);
  if (!fs.existsSync(dir)) throw new Stop(`${again ? to : old}'s folder ${dir} does not exist.`);
  const moves = !again && path.basename(dir) === old;
  const target = path.join(path.dirname(dir), to);
  if (moves && fs.existsSync(target)) throw new Stop(`${target} exists already.`);

  const s = new Session(a, root, 'rename');
  const edits: { file: string; text: string; detail: string }[] = [];

  // The plugin's own manifest.
  const manifest = path.join(dir, '.claude-plugin', 'plugin.json');
  if (fs.existsSync(manifest)) {
    const before = fs.readFileSync(manifest, 'utf8');
    if (readJson(manifest).name === old) edits.push({ file: manifest, text: applyEdits(before, modify(before, ['name'], to, fmt(before))), detail: `name ${old} to ${to}` });
  }

  // The catalog: the entry's name and source, and every dependency that names the plugin.
  const catalogBefore = fs.readFileSync(catalogFile, 'utf8');
  let catalogText = catalogBefore;
  if (!again) catalogText = applyEdits(catalogText, modify(catalogText, ['plugins', index, 'name'], to, fmt(catalogText)));
  if (moves) catalogText = applyEdits(catalogText, modify(catalogText, ['plugins', index, 'source'], source.replace(new RegExp(`${escape(old)}(/?)$`), `${to}$1`), fmt(catalogText)));
  catalog.forEach((p, i) => (catalogText = renameDependency(catalogText, ['plugins', i], p.dependencies, old, to, marketName)));
  if (catalogText !== catalogBefore) edits.push({ file: catalogFile, text: catalogText, detail: again ? `dependencies ${old} to ${to}` : `entry ${old} to ${to}${moves ? ', source' : ''}` });

  // The other plugins that depend on it.
  for (const p of catalog) {
    if (p.name === old || p.name === to || typeof p.source !== 'string') continue;
    const file = path.join(path.resolve(market.location, p.source), '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, 'utf8');
    const text = renameDependency(before, [], readJson(file).dependencies, old, to, marketName);
    if (text !== before) edits.push({ file, text, detail: `dependency ${old} to ${to}` });
  }

  // The settings that enable it.
  const userConfig = one(a, 'user-config') ?? path.join(os.homedir(), '.claude.json');
  const repos = knownRepos([...(a.flags.get('repo') ?? []), ...list(a, 'repos')], userConfig);
  for (const file of [path.join(root, 'settings.json'), ...repos.flatMap(r => ['settings.json', 'settings.local.json'].map(f => path.join(r, '.claude', f)))]) {
    const text = renameEnabled(file, old, to, marketName);
    if (text !== undefined) edits.push({ file, text, detail: `enabledPlugins ${old}@${marketName} to ${to}@${marketName}` });
  }

  // The text that names it: the namespace, the id, the path and the plugin list's link are rewritten, in the Markdown of Global, the
  // repos and the marketplace and in the plugin's own code and data files; bare mentions are listed with their lines.
  const texts = new Set<string>([
    ...['skills', 'agents', 'rules', 'commands'].flatMap(d => mdUnder(path.join(root, d))),
    path.join(root, 'CLAUDE.md'),
    ...repos.flatMap(r => [path.join(r, 'CLAUDE.md'), ...mdUnder(path.join(r, '.claude'))]),
    ...mdUnder(market.location),
    ...codeUnder(dir).filter(f => f !== manifest),
    ...catalog.flatMap(p => {
      if (p.name === old || p.name === to || typeof p.source !== 'string') return [];
      const d = path.resolve(market.location, p.source);
      return d === dir || d.startsWith(dir + path.sep) ? [] : codeUnder(d).filter(f => path.basename(f) !== 'plugin.json' || path.basename(path.dirname(f)) !== '.claude-plugin');
    }),
  ]);
  const own = (file: string) => file.startsWith(dir + path.sep);
  const names = (sub: string, dirs: boolean) =>
    (fs.existsSync(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub), { withFileTypes: true }) : []).filter(e => (dirs ? e.isDirectory() : /\.md$/i.test(e.name))).map(e => e.name.replace(/\.md$/i, ''));
  const shipped = [...new Set([...names('skills', true), ...names('agents', false), ...names('commands', false)])];
  const bare = new RegExp(`(?<![\\w.-])${escape(old)}(?![\\w-])`, 'g');
  const plugins = path.dirname(dir).toLowerCase();
  const checks: SkillChange[] = [];
  for (const file of texts) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const folder = path.dirname(file).toLowerCase();
    const links = /\.md$/i.test(file) && (folder === plugins || folder === path.resolve(market.location).toLowerCase());
    const original = fs.readFileSync(file, 'utf8');
    const { text, hits } = isHistory(file) ? { text: original, hits: 0 } : rewriteMentions(original, old, to, marketName, links, own(file) && !/\.md$/i.test(file), shipped);
    if (hits) edits.push({ file, text, detail: `${hits} mention${hits > 1 ? 's' : ''} of ${old}` });
    const at = text.split(/\r?\n/).flatMap((l, i) => (l.match(bare) ?? []).map(() => i + 1));
    if (at.length) checks.push({ action: 'check', file, detail: `still mentions ${old} ${at.length} time${at.length > 1 ? 's' : ''}, line${at.length > 1 ? 's' : ''} ${[...new Set(at)].join(', ')}` });
  }

  // Every backup first: a failure there writes nothing.
  for (const e of edits) s.save(e.file);
  for (const e of edits) {
    s.record('rewrite', e.file, e.detail);
    s.write(e.file, e.text);
  }
  if (moves) {
    s.record('rename', dir, `to ${to}`);
    if (!s.dry) fs.renameSync(dir, target);
  } else if (path.basename(dir) !== to) {
    s.record('check', dir, `keeps its folder name ${path.basename(dir)}`);
  }
  for (const c of checks) s.record('check', c.file, c.detail);

  const out: PluginRenameOut = {
    from: fromId,
    to,
    market: marketName,
    changes: s.changes,
    commands: [
      `claude plugin validate "${market.location}"`,
      `claude plugin marketplace update ${marketName}`,
      `claude plugin uninstall ${old}@${marketName}`,
      `claude plugin install ${to}@${marketName}`,
    ],
    backup: s.backup,
  };
  emit(io, a, out, renameLines(out, s.dry), !s.dry);
  return 0;
}
