import * as fs from 'fs';
import * as path from 'path';
import { Asset, KeepCopies, keepsCopies, pluginDirs, retireAsset } from './harness';
import type { ConsolidateRoute, ConsolidateState, ConsolidateTarget } from './shared/messages';

// Consolidating a repo skill: the repo copy goes up to the place the skill comes from (the plugin that ships it, else
// global), and the repo copy is retired. The whole skill folder counts, not only SKILL.md.

const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv']);

/** The files under a folder, relative with `/`, sorted. */
function filesIn(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) out.push(...filesIn(full, base));
    } else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// The same two readings the sidebar uses for "identical" and "nearly identical": line endings never count; a loose
// reading also ignores whitespace and version lines.
const text = (file: string) => fs.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n');
const loose = (t: string) => t.replace(/^\s*version\s*:.*$/gm, '').replace(/\s+/g, '');

/** How a repo skill folder stands against the same skill's folder in a target; `new` when the target folder does not exist. */
export function compareSkill(repoDir: string, targetDir: string): Pick<ConsolidateTarget, 'state' | 'files' | 'changed' | 'repoOnly' | 'targetOnly'> {
  const repo = filesIn(repoDir);
  if (!fs.existsSync(targetDir)) return { state: 'new', files: repo.length, changed: [], repoOnly: [], targetOnly: [] };
  const target = filesIn(targetDir);
  const inTarget = new Set(target);
  const inRepo = new Set(repo);
  const repoOnly = repo.filter(f => !inTarget.has(f));
  const targetOnly = target.filter(f => !inRepo.has(f));
  let near = false;
  const changed: string[] = [];
  for (const rel of repo.filter(f => inTarget.has(f))) {
    const [a, b] = [text(path.join(repoDir, ...rel.split('/'))), text(path.join(targetDir, ...rel.split('/')))];
    if (a === b) continue;
    if (loose(a) === loose(b)) near = true;
    else changed.push(rel);
  }
  const state: ConsolidateState = repoOnly.length || changed.length ? 'differs' : targetOnly.length ? 'contained' : near ? 'near' : 'identical';
  return { state, files: repo.length, changed, repoOnly, targetOnly };
}

/** The buttons a state offers: the first is the primary one. A copy that differs is merged first, by hand or with Claude. */
export const routesOf = (state: ConsolidateState): ConsolidateRoute[] => (state === 'differs' ? ['diff', 'claude'] : state === 'new' ? ['move'] : ['retire']);

export interface ConsolidatePlan {
  /** Where the skill can go; the first is the default: the plugin it ships with, otherwise global. */
  targets: ConsolidateTarget[];
  /** Plugins that have the skill and no source folder on disk. */
  notes: string[];
  /** Why the skill cannot be consolidated at all. */
  block?: string;
}

/** `repoDir` is the repo the asset lives in, undefined for a global asset. */
export function consolidatePlan(asset: Asset, repoDir: string | undefined, root: string, keep?: KeepCopies): ConsolidatePlan {
  const none = (block: string): ConsolidatePlan => ({ targets: [], notes: [], block });
  if (asset.kind !== 'skill' || !asset.dir) return none('Only skills are consolidated.');
  if (!repoDir || asset.scope === 'global' || asset.scope.startsWith('plugin:')) return none('Only a repo skill is consolidated.');
  const kept = keepsCopies(repoDir, keep);
  if (kept) return none(kept);
  const repo = asset.dir;
  const targets: ConsolidateTarget[] = [];
  const notes: string[] = [];
  const add = (id: string, label: string, dir: string) => {
    if (path.resolve(dir).toLowerCase() === path.resolve(repo).toLowerCase()) return;
    targets.push({ id, label, dir, ...compareSkill(repo, dir) });
  };
  // Plugins: the source folder of a plugin is its folder inside a directory marketplace, the path the marketplace
  // registration (known_marketplaces.json) points at. `pluginDirs` lists those as the entries that are not installed.
  // The installed copy under plugins/cache is never a target, since an update overwrites it, and a marketplace cloned
  // from GitHub into plugins/marketplaces has no source folder.
  const keys = new Set<string>();
  for (const p of pluginDirs(root, true)) {
    if (p.installed) continue;
    const dir = path.join(p.dir, 'skills', asset.name);
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
      keys.add(p.key);
      add(p.key, `plugin ${p.key}`, dir);
    }
  }
  for (const c of asset.copies ?? [])
    if (c.scope.startsWith('plugin:')) {
      const key = c.scope.slice('plugin:'.length);
      if (!keys.has(key)) notes.push(`${c.label} also has this skill, but its source folder is not on this computer, so it cannot be updated from here.`);
    }
  add('global', 'global', path.join(root, 'skills', asset.name));
  return { targets, notes: [...new Set(notes)] };
}

/**
 * Carries a route out. `retire` needs the repo copy to be covered by the target (identical, nearly identical or
 * contained); `move` needs the target to be free. Both end with the existing retire: backup first, then delete.
 * Returns the backup folder.
 */
export function consolidateApply(asset: Asset, repoDir: string, target: ConsolidateTarget, route: 'retire' | 'move', backupRoot: string, stamp: string): string {
  if (!asset.dir) throw new Error('Only skills are consolidated.');
  if (route === 'move') {
    if (fs.existsSync(target.dir)) throw new Error(`${target.label} already has a skill named ${asset.name}. Nothing was moved.`);
    fs.mkdirSync(path.dirname(target.dir), { recursive: true });
    fs.cpSync(asset.dir, target.dir, { recursive: true, dereference: true, errorOnExist: true, force: false });
    if (compareSkill(asset.dir, target.dir).state !== 'identical') {
      fs.rmSync(target.dir, { recursive: true, force: true });
      throw new Error(`The copy in ${target.label} did not match the repo copy. Nothing was moved.`);
    }
  } else if (!['identical', 'near', 'contained'].includes(compareSkill(asset.dir, target.dir).state)) {
    throw new Error(`The repo copy of ${asset.name} still has changes ${target.label} lacks. Merge them first.`);
  }
  return retireAsset(asset, repoDir, backupRoot, stamp);
}

/** The prompt of the terminal route: Claude merges, the repo copy stays until the owner runs Consolidate again. */
export const mergePrompt = (asset: Asset, target: ConsolidateTarget): string =>
  `Consolidate the skill ${asset.name} into ${target.label}. The repo copy at ${asset.dir} differs from the copy at ${target.dir}. ` +
  `Compare the two folders file by file, SKILL.md and every reference and script. Bring everything worth keeping from the repo copy into ${target.dir}, ` +
  `keep what the target already does better, and leave the repo copy untouched. When you are done, list the files you changed in ${target.dir}.`;
