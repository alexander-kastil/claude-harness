import * as fs from 'fs';
import * as path from 'path';
import type { BrowserCard } from './shared/browser-hunt';
import type { HuntMarket } from './shared/hunt';
import { leafText, withRow } from './browser-hunt';
import { ScopeView, backupStamp } from './harness';
import { items } from './hunt-catalog';
import { Bump, CreatePlan, isInstalled, planBump, writeVersions } from './hunt-create';
import { Entry, catalogOf, readMarkets } from './hunt-market';
import { updatePluginFromMarket } from './sync';

// Where the Browser Automation Hunter keeps its procedures and how a card is written into them. The panel (browser-hunt-host.ts) and the
// `browser-hunt` command line share this; nothing here needs VS Code.

/** The skill whose procedure table the hunter starts from. */
export const SKILL = 'browser-automations';

export interface SkillAt {
  file?: string;
  text: string;
  plugin?: { key: string; name: string; market: HuntMarket; entries: Entry[]; dir: string };
  problem?: string;
}

/**
 * The skill file and its text. A Global or repo copy is written directly. An installed plugin's copy is a version copy in the
 * plugin cache that the next update overwrites, so it is written in the plugin's source in a marketplace of the owner's, and
 * `plugin` says where; with no such marketplace `problem` says why nothing can be written.
 */
export function locateSkill(views: ScopeView[], plugins: ScopeView[], root: string): SkillAt {
  const read = (file: string) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  };
  for (const v of views) {
    const a = items(v, 'skill').find(x => x.name === SKILL);
    const text = a && read(a.file);
    if (a && text !== undefined) return { file: a.file, text };
  }
  for (const v of plugins) {
    const a = items(v, 'skill').find(x => x.name === SKILL);
    if (!a) continue;
    const key = v.id.slice('plugin:'.length);
    const [name, marketName] = key.split('@');
    const cached = read(a.file) ?? '';
    const market = readMarkets(root).find(m => m.name === marketName && m.owned);
    if (!market) return { text: cached, problem: `${name} comes from ${marketName}, which is not a marketplace folder of yours on disk. Its installed copy is overwritten on the next update, so nothing is written there.` };
    const entries = catalogOf(market.location);
    const source = entries.find(e => e.name === name)?.source;
    const dir = typeof source === 'string' && source.startsWith('./') ? path.resolve(market.location, source) : '';
    const file = dir && path.join(dir, 'skills', SKILL, 'SKILL.md');
    const text = file ? read(file) : undefined;
    if (!file || text === undefined) return { text: cached, problem: `${marketName} does not hold the ${SKILL} skill of ${name} as a folder, so nothing is written.` };
    return { file, text, plugin: { key, name, market, entries, dir } };
  }
  return { text: '' };
}

export interface CardPlan {
  /** Why nothing can be written; set means the rest is empty. */
  problem?: string;
  dir: string;
  leaf: string;
  /** Where the files go: the skill's folder, or the marketplace for a plugin's source. */
  location: string;
  files: string[];
  backups: string[];
  plugin?: string;
  installed: boolean;
  bump?: Bump;
}

/** What writing the card does; nothing is written. */
export function planCardWrite(s: SkillAt, card: BrowserCard, ctx: { root: string; views: ScopeView[] }): CardPlan {
  const none = (problem: string): CardPlan => ({ problem, dir: '', leaf: '', location: '', files: [], backups: [], installed: false });
  const file = s.file;
  if (s.problem) return none(s.problem);
  if (!file) return none(`No ${SKILL} skill was found in Global, a repo or an installed plugin.`);
  if (!card.name.trim() || !card.steps.length) return none('Give the procedure a name and at least one step.');
  const dir = path.dirname(file);
  const leaf = path.join(dir, 'references', `${card.name}.md`);
  const leafRel = `references/${card.name}.md`;
  const backups = ['SKILL.md', ...(fs.existsSync(leaf) ? [leafRel] : [])];
  // In a plugin's source the plugin's patch version moves too, in plugin.json and the marketplace entry, and the installed plugin is updated.
  let bump: Bump | undefined;
  const files = ['SKILL.md', leafRel];
  if (s.plugin) {
    const plan: CreatePlan = { problems: [], files: [], retired: [], kept: [], source: '', dir: '', chosen: [], retires: [], extra: [] };
    bump = planBump(s.plugin.name, s.plugin.entries, { root: ctx.root, views: ctx.views, market: s.plugin.market, backupRoot: path.join(ctx.root, 'repo-sync-backups') }, plan);
    if (plan.problems.length) return none(plan.problems.join(' '));
    const rel = path.relative(s.plugin.market.location, dir).replace(/\\/g, '/');
    files.splice(0, files.length, `${rel}/SKILL.md`, `${rel}/${leafRel}`, ...plan.files);
  }
  return { dir, leaf, location: s.plugin ? s.plugin.market.location : dir, files, backups, plugin: s.plugin?.key, installed: !!s.plugin && isInstalled(ctx.root, s.plugin.key), bump };
}

/** Writes a planned card: the skill's row and the leaf, backed up first; everything is put back when a step fails. Returns the line that says what was done. */
export async function writeCard(root: string, s: SkillAt, card: BrowserCard, plan: CardPlan): Promise<string> {
  const file = s.file!;
  const { dir, leaf } = plan;
  const before = { skill: fs.readFileSync(file, 'utf8'), leaf: fs.existsSync(leaf) ? fs.readFileSync(leaf, 'utf8') : undefined };
  let saved: { file: string; text: string }[] = [];
  const undo = () => {
    fs.writeFileSync(file, before.skill);
    if (before.leaf === undefined) fs.rmSync(leaf, { force: true });
    else fs.writeFileSync(leaf, before.leaf);
    for (const f of saved) fs.writeFileSync(f.file, f.text);
  };
  try {
    // What changes is backed up first, next to the other backups of the harness.
    const backup = path.join(root, 'repo-sync-backups', `browser-hunt-${backupStamp()}`);
    for (const f of plan.backups) {
      fs.mkdirSync(path.dirname(path.join(backup, f)), { recursive: true });
      fs.copyFileSync(path.join(dir, f), path.join(backup, f));
    }
    fs.writeFileSync(file, withRow(before.skill, card));
    fs.mkdirSync(path.dirname(leaf), { recursive: true });
    fs.writeFileSync(leaf, leafText(card));
    if (s.plugin && plan.bump) {
      saved = writeVersions([plan.bump], s.plugin.market);
      if (plan.installed) await updatePluginFromMarket(s.plugin.key, s.plugin.market.name, plan.bump.version ?? undefined, root);
    }
    return `Written to ${SKILL}${s.plugin ? ` (${s.plugin.name} ${plan.bump?.version ?? 'unchanged'}${plan.installed ? ', installed plugin updated' : ''})` : ''}. Backup: ${path.relative(root, backup)}`;
  } catch (e) {
    undo();
    throw e;
  }
}
