import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Args, Io, Stop, emit, headline, list, one, table } from './cli-core';
import { Latest, discard, install, latest, latestTag, linkState, parseSource, resolve, resolveOrigin, stage, diffFolders } from './distributor';
import { compareVersions } from './repos-overview';
import { backupStamp, knownRepos, parseMarkdown, versionOf } from './harness';
import { samePath } from './hunt-catalog';
import { CreateCtx, CreatePlan, isInstalled, planBump, writeVersions } from './hunt-create';
import { catalogOf, readMarkets } from './hunt-market';
import type { HuntMarket } from './shared/hunt';
import { rewriteSkillPaths } from './skill-paths';
import { PluginLink, SkillOrigin, linksOf, originsOf, recordFile, recordLink } from './skill-lock';
import { updatePluginFromMarket } from './sync';

// `sources`: the skills installed from a source, with their ref, version, install date and linked repos; `sources check` asks each
// source for a newer version; `sources update --name <skill>` installs the newer version, backed up first. Skill sources install into
// ~/.claude only: the skills CLI's ~/.agents folder and lock file are read, never written. `sources link` records the source of a
// skill a marketplace plugin ships, which `check` and `update` then treat the same way, the plugin's folder taking the place of
// ~/.claude/skills.

interface Installed {
  name: string;
  folder: string;
  source: string;
  ref: string | null;
  installedAt: string | null;
  version: string | null;
  /** The plugin that ships the skill, null for a skill in ~/.claude/skills. */
  plugin: string | null;
  link?: PluginLink;
  origin?: SkillOrigin;
}

interface SourceRow {
  name: string;
  source: string;
  ref: string | null;
  version: string | null;
  installedAt: string | null;
  repos: string[];
  plugin: string | null;
}

interface CheckRow {
  name: string;
  source: string;
  plugin: string | null;
  /** `older`: the source's version is lower than the installed one, so it differs but is not an update. */
  state: Latest['state'] | 'older';
  installed: string | null;
  newerVersion: string | null;
  error: string | null;
}

const rootOf = (a: Args) => path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

/** The version a skill's SKILL.md records, or null when it has none. */
function versionIn(folder: string): string | null {
  const file = path.join(folder, 'SKILL.md');
  return fs.existsSync(file) ? (versionOf(parseMarkdown(fs.readFileSync(file, 'utf8')).data) ?? null) : null;
}

/** The skills in ~/.claude/skills with a known source: the extension's record and the skills CLI's lock, as the extension lists them. */
function installed(root: string): Installed[] {
  return [...originsOf(root)]
    .filter(([name]) => fs.existsSync(path.join(root, 'skills', name)))
    .map(([name, origin]) => {
      const folder = path.join(root, 'skills', name);
      return { name, folder, origin, source: origin.source, ref: origin.ref ?? null, installedAt: origin.installedAt?.slice(0, 10) ?? null, version: versionIn(folder), plugin: null };
    });
}

/** A plugin of an owned marketplace: the marketplace, its catalog index and the plugin's folder. */
interface PluginAt {
  market: HuntMarket;
  entry: number;
  dir: string;
}

/** The marketplace of yours that holds a plugin: the one `wanted` names (by name or folder), else the one whose catalog lists it. */
function pluginAt(root: string, plugin: string, wanted?: string): PluginAt | string {
  const markets = readMarkets(root).filter(m => m.owned);
  const market = wanted ? markets.find(m => m.name === wanted || samePath(m.location, wanted)) : markets.find(m => catalogOf(m.location).some(e => e.name === plugin));
  if (!market) return wanted ? `${wanted} is not a marketplace folder of yours on disk.` : `No marketplace folder of yours lists a plugin called ${plugin}; pass --market.`;
  const entries = catalogOf(market.location);
  const entry = entries.findIndex(e => e.name === plugin);
  const source = entries[entry]?.source;
  if (typeof source !== 'string' || !source.startsWith('./')) return `${market.name} has no plugin folder called ${plugin}.`;
  return { market, entry, dir: path.resolve(market.location, source) };
}

/** The skills plugins ship that have a recorded source; a plugin or marketplace that is gone from disk drops its rows. */
function linked(root: string): Installed[] {
  return linksOf(root).flatMap(link => {
    const at = pluginAt(root, link.plugin, link.market);
    const folder = typeof at === 'string' ? '' : path.join(at.dir, 'skills', link.name);
    if (!folder || !fs.existsSync(folder)) return [];
    return [{ name: link.name, folder, link, source: link.source, ref: null, installedAt: link.linkedAt?.slice(0, 10) ?? null, version: link.version ?? versionIn(folder), plugin: link.plugin }];
  });
}

const everything = (root: string): Installed[] => [...installed(root), ...linked(root)].sort((x, y) => x.name.localeCompare(y.name) || (x.plugin ?? '').localeCompare(y.plugin ?? ''));

/** The repos whose `<repo>/.claude/skills/<name>` is still a link to the global folder (made by an older version). */
function linkedIn(a: Args, root: string, name: string): string[] {
  const repos = knownRepos([...(a.flags.get('repo') ?? []), ...list(a, 'repos')], one(a, 'user-config') ?? path.join(os.homedir(), '.claude.json'));
  return repos.filter(r => linkState(path.join(r, '.claude', 'skills', name), path.join(root, 'skills', name)) === 'linked').map(r => path.basename(r));
}

function listSources(a: Args, io: Io, root: string): number {
  const rows: SourceRow[] = everything(root).map(i => ({
    name: i.name,
    source: i.source,
    ref: i.ref,
    version: i.version,
    installedAt: i.installedAt,
    repos: i.plugin ? [] : linkedIn(a, root, i.name),
    plugin: i.plugin,
  }));
  const sources = new Set(rows.map(r => r.source)).size;
  emit(io, a, { skills: rows }, [
    headline(`Sources · ${plural(rows.length, 'skill')} from ${plural(sources, 'source')}`),
    '',
    ...table(
      ['Skill', 'Source', 'Ref', 'Version', 'Installed', 'Linked repos', 'Plugin'],
      rows.length ? rows.map(r => [r.name, r.source, r.ref ?? '-', r.version ? `v${r.version}` : '-', r.installedAt ?? '-', r.repos.join(', ') || '-', r.plugin ?? '-']) : [['(none)', '', '', '', '', '', '']]
    ),
  ]);
  return 0;
}

/** The source differs from the install; it is only an update when its version is not lower than the installed one. */
export function checkState(r: Latest, installedVersion: string | null): CheckRow['state'] {
  return r.state === 'newer' && r.version && installedVersion && compareVersions(r.version, installedVersion) < 0 ? 'older' : r.state;
}

/** A plugin-linked skill is newer when its source's newest release tag is higher than the recorded version. */
async function linkAnswer(i: Installed): Promise<Latest> {
  const parsed = parseSource(i.source);
  if (!parsed) return { state: 'error', error: `${i.source} is not an owner/repo address.` };
  try {
    const tag = await latestTag(parsed.owner, parsed.repo);
    if (!tag) return { state: 'error', error: `${i.source} has no release or version tag.` };
    return i.version && compareVersions(tag, i.version) > 0 ? { state: 'newer', version: tag } : { state: 'current', version: tag };
  } catch (e) {
    return { state: 'error', error: (e as Error).message };
  }
}

async function checkSources(a: Args, io: Io, root: string): Promise<number> {
  const skills = everything(root);
  const own = skills.filter(i => i.origin);
  const answers = own.length ? await latest(own.map(i => ({ name: i.name, origin: i.origin! }))) : {};
  const rows: CheckRow[] = await Promise.all(skills.map(async (i): Promise<CheckRow> => {
    // A plugin's skill has no tree hash to compare: its newest release tag is compared with the recorded version.
    const r: Latest = i.link ? await linkAnswer(i) : (answers[i.name] ?? { state: 'error', error: 'the source gave no answer' });
    const state = checkState(r, i.version);
    return {
      name: i.name,
      source: i.source,
      plugin: i.plugin,
      state,
      installed: i.version,
      newerVersion: state === 'newer' ? (r.version ?? null) : null,
      error: r.error ?? null,
    };
  }));
  const failed = rows.filter(r => r.state === 'error');
  if (rows.length && failed.length === rows.length) throw new Stop(`Could not check for updates: ${failed[0].error}`, 1);
  const newer = rows.filter(r => r.state === 'newer').length;
  emit(io, a, { checked: rows.length, newer, skills: rows }, [
    headline(`Sources check · ${newer} of ${plural(rows.length, 'skill')} ${newer === 1 ? 'has' : 'have'} a newer version`),
    '',
    ...table(
      ['Skill', 'Source', 'Status', 'Installed', 'Newer', 'Plugin'],
      rows.length
        ? rows.map(r => [r.name, r.source, r.state, r.installed ? `v${r.installed}` : '-', r.newerVersion ? `v${r.newerVersion}` : '-', r.plugin ?? '-'])
        : [['(none)', '', '', '', '', '']]
    ),
    ...(failed.length ? ['', ...failed.map(r => `Could not check ${r.name}: ${r.error}`)] : []),
  ]);
  return 0;
}

/** Where `sources update` backs the old skill folder up: the same `repo-sync-backups/<stamp>/skills` the Skills page uses. */
export const updateBackupDir = (root: string, stamp = backupStamp()) => path.join(root, 'repo-sync-backups', stamp, 'skills');

async function updateSource(a: Args, io: Io, root: string): Promise<number> {
  const name = one(a, 'name');
  if (!name || !/^[\w][\w.-]*$/.test(name)) throw new Stop('sources update needs --name <skill>, a skill installed from a source, e.g. --name media-generation --dry-run.', 2);
  const folder = path.join(root, 'skills', name);
  const plugin = one(a, 'plugin');
  const links = linksOf(root).filter(l => l.name === name && (!plugin || l.plugin === plugin));
  // A skill in ~/.claude/skills with a source wins unless --plugin names the plugin.
  if (links.length && (plugin || !(fs.existsSync(folder) && originsOf(root).has(name)))) {
    if (links.length > 1) throw new Stop(`${name} is linked from ${links.map(l => l.plugin).join(' and ')}; pass --plugin <plugin>.`, 2);
    return updateLinked(a, io, root, links[0]);
  }
  if (!fs.existsSync(folder)) throw new Stop(`${name} is not installed in ${path.join(root, 'skills')}.`, 1);
  const origin = originsOf(root).get(name);
  if (!origin) throw new Stop(`${name} is not installed from a source, so there is nothing to update it from.`, 1);
  const dry = !!one(a, 'dry-run');
  const from = versionIn(folder);
  const staged = await stage(await resolveOrigin(origin));
  try {
    staged.name = name;
    const current = staged.hash === origin.hash;
    const diff = current ? { changed: [], added: [], removed: [] } : diffFolders(folder, staged.dir);
    const backupDir = updateBackupDir(root);
    const backup = dry || current ? null : (install(root, staged, backupDir).backup ?? null);
    const status = current ? 'already up to date, nothing written' : dry ? 'dry run, nothing written' : 'updated';
    const result = {
      name,
      source: origin.source,
      from,
      to: staged.version ?? null,
      changed: diff.changed,
      added: diff.added,
      removed: diff.removed,
      backup,
    };
    const actions = current || !dry ? [] : [`[dry-run] back up ${folder} to ${path.join(backupDir, name)}`, `[dry-run] replace ${folder} with ${staged.source} at ${staged.version ? `v${staged.version}` : 'its newer version'}`];
    emit(
      io,
      a,
      result,
      [
        headline(`Sources update · ${name} · ${status}`),
        '',
        ...table(
          ['Skill', 'From', 'To', 'Overwritten', 'Added', 'Removed'],
          [[name, from ? `v${from}` : '-', staged.version ? `v${staged.version}` : '-', diff.changed.length, diff.added.length, diff.removed.length]],
          [false, false, false, true, true, true]
        ),
        ...(backup ? ['', `Backup in ${backup}`] : []),
        ...actions,
      ],
      !dry && !current
    );
  } finally {
    discard(staged);
  }
  return 0;
}

const NAME = /^[\w][\w.-]*$/;

/** `sources link`: records where a plugin's skill came from, so `check` and `update` can follow it. */
function linkSource(a: Args, io: Io, root: string): number {
  const name = one(a, 'name');
  const source = one(a, 'source');
  const plugin = one(a, 'plugin');
  if (!name || !NAME.test(name) || !source || !plugin) throw new Stop('sources link needs --name <skill> --source <owner/repo> --plugin <plugin>, e.g. --name ui-ux-pro-max --source nextlevelbuilder/ui-ux-pro-max-skill --plugin screen-design.', 2);
  const parsed = parseSource(source);
  if (!parsed || parsed.skill) throw new Stop(`${source} is not an owner/repo address.`, 2);
  const at = pluginAt(root, plugin, one(a, 'market'));
  if (typeof at === 'string') throw new Stop(at, 1);
  const folder = path.join(at.dir, 'skills', name);
  if (!fs.existsSync(path.join(folder, 'SKILL.md'))) throw new Stop(`The plugin ${plugin} has no skill named ${name}.`, 1);
  const version = one(a, 'version') ?? versionIn(folder) ?? null;
  const stageCommand = one(a, 'stage') ?? null;
  const record = recordFile(root);
  const dry = !!one(a, 'dry-run');
  if (!dry)
    recordLink(root, { name, plugin, market: at.market.name, source: `${parsed.owner}/${parsed.repo}`, url: `https://github.com/${parsed.owner}/${parsed.repo}.git`, ...(stageCommand ? { stage: stageCommand } : {}), ...(version ? { version } : {}) });
  emit(
    io,
    a,
    { name, source: `${parsed.owner}/${parsed.repo}`, plugin, market: at.market.name, stage: stageCommand, version, record },
    [
      headline(`Sources link · ${name} · ${dry ? 'dry run, nothing written' : 'linked'}`),
      '',
      ...table(['Skill', 'Source', 'Plugin', 'Market', 'Version', 'Stage'], [[name, `${parsed.owner}/${parsed.repo}`, plugin, at.market.name, version ? `v${version}` : '-', stageCommand ?? '-']]),
      ...(dry ? [`[dry-run] record ${name} from ${parsed.owner}/${parsed.repo} in ${record}`] : ['', `Recorded in ${record}`]),
    ],
    !dry
  );
  return 0;
}

const runStage = (command: string, cwd: string): Promise<string | undefined> =>
  new Promise(done => exec(command, { cwd, timeout: 600000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => done(err ? `${err.message}\n${stderr}`.trim().split('\n').slice(-3).join(' ') || stdout : undefined)));

/** A linked skill's current source, staged in a scratch folder: by its recorded command, else downloaded from the repo. `dir` is the skill folder. */
async function stageLink(link: PluginLink): Promise<{ dir: string; cleanup: () => void }> {
  if (!link.stage) {
    const parsed = parseSource(link.source)!;
    const staged = await stage(await resolve({ owner: parsed.owner, repo: parsed.repo, skill: link.name }, async () => undefined));
    return { dir: staged.dir, cleanup: () => discard(staged) };
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-skill-link-'));
  const cleanup = () => fs.rmSync(scratch, { recursive: true, force: true });
  const failed = await runStage(link.stage, scratch);
  const dir = path.join(scratch, '.claude', 'skills', link.name);
  if (failed || !fs.existsSync(path.join(dir, 'SKILL.md'))) {
    cleanup();
    throw new Stop(failed ? `The stage command failed: ${failed}` : `The stage command left no .claude/skills/${link.name}/SKILL.md.`, 1);
  }
  return { dir, cleanup };
}

/** In the staged Markdown the skill's own folder `.claude/skills/<name>/` becomes `<this skill>/`, as in a plugin copy made by hunt. */
function toThisSkill(dir: string, name: string): void {
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true }) as fs.Dirent[]) {
    if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
    const file = path.join(e.parentPath, e.name);
    const r = rewriteSkillPaths(fs.readFileSync(file, 'utf8'), n => (n === name ? '<this skill>' : null));
    if (r.hits) fs.writeFileSync(file, r.text);
  }
}

/** `sources update` of a plugin-linked skill: the plugin's skill folder is replaced by the staged one, its version bumped and the installed plugin updated. */
async function updateLinked(a: Args, io: Io, root: string, link: PluginLink): Promise<number> {
  const at = pluginAt(root, link.plugin, link.market);
  if (typeof at === 'string') throw new Stop(at, 1);
  const folder = path.join(at.dir, 'skills', link.name);
  if (!fs.existsSync(folder)) throw new Stop(`The plugin ${link.plugin} no longer has the skill ${link.name}.`, 1);
  const dry = !!one(a, 'dry-run');
  const from = link.version ?? versionIn(folder) ?? null;
  const staged = await stageLink(link);
  try {
    toThisSkill(staged.dir, link.name);
    const diff = diffFolders(folder, staged.dir);
    const differs = diff.changed.length + diff.added.length + diff.removed.length > 0;
    let to = versionIn(staged.dir) ?? null;
    if (!to) {
      const parsed = parseSource(link.source)!;
      to = (await latestTag(parsed.owner, parsed.repo).catch(() => undefined)) ?? from;
    }
    const plan = { problems: [] as string[], files: [] as string[] } as unknown as CreatePlan;
    const bump = planBump(link.plugin, catalogOf(at.market.location), { market: at.market } as CreateCtx, plan);
    if (plan.problems.length) throw new Stop(plan.problems[0], 1);
    const key = `${link.plugin}@${at.market.name}`;
    const installed = isInstalled(root, key) ? key : null;
    const backupDir = path.join(root, 'repo-sync-backups', backupStamp(), 'plugins', link.plugin, 'skills', link.name);
    const result = (backup: string | null) => ({
      name: link.name,
      source: link.source,
      from,
      to,
      changed: diff.changed,
      added: diff.added,
      removed: diff.removed,
      backup,
      plugin: link.plugin,
      version: differs ? bump.version : bump.from,
      installed,
    });
    const status = !differs ? 'already up to date, nothing written' : dry ? 'dry run, nothing written' : 'updated';
    const summary = (backup: string | null, actions: string[]) => [
      headline(`Sources update · ${link.name} · ${link.plugin} · ${status}`),
      '',
      ...table(
        ['Skill', 'From', 'To', 'Overwritten', 'Added', 'Removed'],
        [[link.name, from ? `v${from}` : '-', to ? `v${to}` : '-', diff.changed.length, diff.added.length, diff.removed.length]],
        [false, false, false, true, true, true]
      ),
      ...(diff.removed.length ? ['', `Removed: ${diff.removed.join(', ')}`] : []),
      ...(backup ? ['', `Backup in ${backup}`] : []),
      ...actions,
    ];
    if (!differs || dry) {
      emit(io, a, result(null), summary(null, differs ? [`[dry-run] back up ${folder} to ${backupDir}`, `[dry-run] replace ${folder} with the staged ${link.source}`, ...(bump.version ? [`[dry-run] ${link.plugin} version ${bump.from} to ${bump.version}`] : []), ...(installed ? [`[dry-run] claude plugin marketplace update ${at.market.name}, then claude plugin update ${installed}`] : [])] : []));
      return 0;
    }
    fs.mkdirSync(path.dirname(backupDir), { recursive: true });
    fs.cpSync(folder, backupDir, { recursive: true });
    fs.rmSync(folder, { recursive: true, force: true });
    fs.cpSync(staged.dir, folder, { recursive: true });
    let saved: { file: string; text: string }[] = [];
    try {
      saved = writeVersions([bump], at.market);
      if (installed) await updatePluginFromMarket(installed, at.market.name, bump.version ?? undefined, root);
    } catch (e) {
      fs.rmSync(folder, { recursive: true, force: true });
      fs.cpSync(backupDir, folder, { recursive: true });
      for (const s of saved) fs.writeFileSync(s.file, s.text);
      throw new Stop(`${(e as Error).message} The skill folder and the version were put back.`, 1);
    }
    recordLink(root, { ...link, ...(to ? { version: to } : {}) });
    emit(io, a, result(backupDir), summary(backupDir, []), true);
  } finally {
    staged.cleanup();
  }
  return 0;
}

export async function sourcesCommand(a: Args, io: Io): Promise<number> {
  const [, sub] = a.words;
  const root = rootOf(a);
  if (!sub) return listSources(a, io, root);
  if (sub === 'check') return checkSources(a, io, root);
  if (sub === 'update') return updateSource(a, io, root);
  if (sub === 'link') return linkSource(a, io, root);
  throw new Stop(`sources takes no ${sub}. Use sources, sources check, sources update --name <skill> or sources link --name <skill> --source <owner/repo> --plugin <plugin>.`, 2);
}
