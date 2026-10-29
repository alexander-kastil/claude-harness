import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Args, Io, Stop, emit, headline, list, one, table } from './cli-core';
import { Latest, discard, install, latest, linkState, resolveOrigin, stage, diffFolders } from './distributor';
import { compareVersions } from './fleet';
import { backupStamp, knownRepos, parseMarkdown, versionOf } from './harness';
import { SkillOrigin, originsOf } from './skill-lock';

// `sources`: the skills installed from a source, with their ref, version, install date and linked repos; `sources check` asks each
// source for a newer version; `sources update --name <skill>` installs the newer version, backed up first. Skill sources install into
// ~/.claude only: the skills CLI's ~/.agents folder and lock file are read, never written.

interface Installed {
  name: string;
  folder: string;
  origin: SkillOrigin;
  version: string | null;
}

interface SourceRow {
  name: string;
  source: string;
  ref: string | null;
  version: string | null;
  installedAt: string | null;
  repos: string[];
}

interface CheckRow {
  name: string;
  source: string;
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
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([name, origin]) => {
      const folder = path.join(root, 'skills', name);
      return { name, folder, origin, version: versionIn(folder) };
    });
}

/** The repos a skill is linked into: `<repo>/.claude/skills/<name>` is a junction to the global folder. */
function linkedIn(a: Args, root: string, name: string): string[] {
  const repos = knownRepos([...(a.flags.get('repo') ?? []), ...list(a, 'repos')], one(a, 'user-config') ?? path.join(os.homedir(), '.claude.json'));
  return repos.filter(r => linkState(path.join(r, '.claude', 'skills', name), path.join(root, 'skills', name)) === 'linked').map(r => path.basename(r));
}

function listSources(a: Args, io: Io, root: string): number {
  const rows: SourceRow[] = installed(root).map(i => ({
    name: i.name,
    source: i.origin.source,
    ref: i.origin.ref ?? null,
    version: i.version,
    installedAt: i.origin.installedAt?.slice(0, 10) ?? null,
    repos: linkedIn(a, root, i.name),
  }));
  const sources = new Set(rows.map(r => r.source)).size;
  emit(io, a, { skills: rows }, [
    headline(`Sources · ${plural(rows.length, 'skill')} from ${plural(sources, 'source')}`),
    '',
    ...table(
      ['Skill', 'Source', 'Ref', 'Version', 'Installed', 'Linked repos'],
      rows.length ? rows.map(r => [r.name, r.source, r.ref ?? '-', r.version ? `v${r.version}` : '-', r.installedAt ?? '-', r.repos.join(', ') || '-']) : [['(none)', '', '', '', '', '']]
    ),
  ]);
  return 0;
}

/** The source differs from the install; it is only an update when its version is not lower than the installed one. */
export function checkState(r: Latest, installedVersion: string | null): CheckRow['state'] {
  return r.state === 'newer' && r.version && installedVersion && compareVersions(r.version, installedVersion) < 0 ? 'older' : r.state;
}

async function checkSources(a: Args, io: Io, root: string): Promise<number> {
  const skills = installed(root);
  const answers = skills.length ? await latest(skills.map(i => ({ name: i.name, origin: i.origin }))) : {};
  const rows: CheckRow[] = skills.map(i => {
    const r: Latest = answers[i.name] ?? { state: 'error', error: 'the source gave no answer' };
    const state = checkState(r, i.version);
    return {
      name: i.name,
      source: i.origin.source,
      state,
      installed: i.version,
      newerVersion: state === 'newer' ? (r.version ?? null) : null,
      error: r.error ?? null,
    };
  });
  const failed = rows.filter(r => r.state === 'error');
  if (rows.length && failed.length === rows.length) throw new Stop(`Could not check for updates: ${failed[0].error}`, 1);
  const newer = rows.filter(r => r.state === 'newer').length;
  emit(io, a, { checked: rows.length, newer, skills: rows }, [
    headline(`Sources check · ${newer} of ${plural(rows.length, 'skill')} ${newer === 1 ? 'has' : 'have'} a newer version`),
    '',
    ...table(
      ['Skill', 'Source', 'Status', 'Installed', 'Newer'],
      rows.length
        ? rows.map(r => [r.name, r.source, r.state, r.installed ? `v${r.installed}` : '-', r.newerVersion ? `v${r.newerVersion}` : '-'])
        : [['(none)', '', '', '', '']]
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

export async function sourcesCommand(a: Args, io: Io): Promise<number> {
  const [, sub] = a.words;
  const root = rootOf(a);
  if (!sub) return listSources(a, io, root);
  if (sub === 'check') return checkSources(a, io, root);
  if (sub === 'update') return updateSource(a, io, root);
  throw new Stop(`sources takes no ${sub}. Use sources, sources check or sources update --name <skill>.`, 2);
}
