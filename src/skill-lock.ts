// Where each skill came from: the extension's own record, ~/.claude/.skill-sources.json. Skills the skills CLI installed
// (`npx skills add -g`) are known from the CLI's lock file, ~/.agents/.skill-lock.json, which is only ever read here, never written.
import * as fs from 'fs';
import * as path from 'path';

/** Where a skill came from. */
export interface SkillOrigin {
  /** `owner/repo`. */
  source: string;
  sourceType: string;
  /** The repository's clone URL. */
  url: string;
  /** The SKILL.md inside the repo, such as `skills/marketing-psychology/SKILL.md`. */
  path: string;
  /** The git tree SHA of the skill's folder in the repo when it was installed: what a newer version is compared against. */
  hash: string;
  ref?: string;
  installedAt?: string;
  updatedAt?: string;
  /** Set when the skills CLI recorded it: its global lock or the repo's skills-lock.json. `npx skills check` and `update` work from that lock. */
  lock?: 'global' | 'project';
}

type Entry = Record<string, unknown> & { source?: string; sourceType?: string; sourceUrl?: string; skillPath?: string; skillFolderHash?: string; computedHash?: string; ref?: string; installedAt?: string; updatedAt?: string };

interface Record_ {
  version: number;
  skills: Record<string, Entry>;
  [key: string]: unknown;
}

const VERSION = 1;

export const recordFile = (claudeRoot: string): string => path.join(claudeRoot, '.skill-sources.json');

/** The skills CLI's global lock file, beside the Claude folder. Read only. */
export const cliLockFile = (claudeRoot: string): string => path.join(path.dirname(claudeRoot), '.agents', '.skill-lock.json');

function read(file: string): Record_ | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record_;
    return data && typeof data === 'object' && data.skills && typeof data.skills === 'object' ? data : undefined;
  } catch {
    return undefined;
  }
}

/** A repo's own lock file, `skills-lock.json` at the repo root (`npx skills add` without -g): it holds a hash of the files (`computedHash`), not the git tree SHA. */
export const projectLockFile = (claudeRoot: string): string => path.join(path.dirname(claudeRoot), 'skills-lock.json');

/** Whether a recorded hash is a git tree SHA, which a newer version can be compared against. */
export const isTreeHash = (hash: string): boolean => /^[0-9a-f]{40}$/i.test(hash);

const originOf = (e: Entry): SkillOrigin | undefined =>
  typeof e.source === 'string' && typeof e.skillPath === 'string' && (typeof e.skillFolderHash === 'string' || typeof e.computedHash === 'string')
    ? {
        source: e.source,
        sourceType: String(e.sourceType ?? 'github'),
        url: typeof e.sourceUrl === 'string' ? e.sourceUrl : `https://github.com/${e.source}.git`,
        path: e.skillPath,
        hash: (e.skillFolderHash ?? e.computedHash) as string,
        ref: typeof e.ref === 'string' ? e.ref : undefined,
        installedAt: e.installedAt,
        updatedAt: e.updatedAt,
      }
    : undefined;

let cache: { key: string; origins: Map<string, SkillOrigin> } | undefined;

const mtime = (file: string) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** Every skill with a known source, by name: the extension's record first, then what the skills CLI recorded (its global lock, and a repo's skills-lock.json). */
export function originsOf(claudeRoot: string): Map<string, SkillOrigin> {
  const own = recordFile(claudeRoot);
  const cli = cliLockFile(claudeRoot);
  const project = projectLockFile(claudeRoot);
  const key = `${own}:${mtime(own)}:${cli}:${mtime(cli)}:${project}:${mtime(project)}`;
  if (cache?.key === key) return cache.origins;
  const origins = new Map<string, SkillOrigin>();
  for (const [file, lock] of [[project, 'project'], [cli, 'global'], [own, undefined]] as const)
    for (const [name, e] of Object.entries(read(file)?.skills ?? {})) {
      const origin = originOf(e);
      if (origin) origins.set(name, lock ? { ...origin, lock } : origin);
    }
  cache = { key, origins };
  return origins;
}

/** The skills a repo's skills-lock.json lists, by name. */
export function projectLockNames(repoDir: string): string[] {
  return Object.keys(read(path.join(repoDir, 'skills-lock.json'))?.skills ?? {});
}

/** The skills a repo's skills-lock.json lists that are on disk in neither .agents/skills nor .claude/skills: what `npx skills experimental_install` restores. */
export function lockMissing(repoDir: string): string[] {
  const here = (folder: string, name: string) => fs.existsSync(path.join(repoDir, folder, 'skills', name, 'SKILL.md'));
  return projectLockNames(repoDir).filter(name => !here('.agents', name) && !here('.claude', name));
}

/** A skill a marketplace plugin ships whose source is a GitHub repo: kept apart from `skills` because the plugin, not ~/.claude/skills, holds the copy. */
export interface PluginLink {
  name: string;
  plugin: string;
  /** The marketplace's name. */
  market: string;
  /** `owner/repo`. */
  source: string;
  url: string;
  /** The command that stages the skill in an empty folder, which then holds `.claude/skills/<name>`; without it the repo's own skill folder is downloaded. */
  stage?: string;
  /** The source's version the plugin's copy was taken from. */
  version?: string;
  linkedAt?: string;
  updatedAt?: string;
}

const linkKey = (plugin: string, name: string) => `${plugin}/${name}`;

/** Every plugin-linked skill in the extension's record. */
export function linksOf(claudeRoot: string): PluginLink[] {
  const links = (read(recordFile(claudeRoot)) as { links?: Record<string, unknown> } | undefined)?.links ?? {};
  return Object.values(links).filter((l): l is PluginLink => !!l && typeof l === 'object' && typeof (l as PluginLink).name === 'string' && typeof (l as PluginLink).plugin === 'string' && typeof (l as PluginLink).source === 'string');
}

/** Adds or updates one plugin-linked skill, keeping every other entry; the first link time survives an update. */
export function recordLink(claudeRoot: string, link: PluginLink, now = new Date()): void {
  const file = recordFile(claudeRoot);
  const data = (read(file) ?? { version: VERSION, skills: {} }) as Record_ & { links?: Record<string, PluginLink> };
  const stamp = now.toISOString();
  const key = linkKey(link.plugin, link.name);
  const before = data.links?.[key];
  data.links = { ...data.links, [key]: { ...link, linkedAt: before?.linkedAt ?? stamp, updatedAt: stamp } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, file);
  cache = undefined;
}

/** Drops one skill's entry from the extension's record (the skills CLI's lock is never touched). */
export function forgetOrigin(claudeRoot: string, name: string): void {
  const file = recordFile(claudeRoot);
  const data = read(file);
  if (!data || !(name in data.skills)) return;
  delete data.skills[name];
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, file);
  cache = undefined;
}

/** Adds or updates one skill's entry in the extension's record, keeping every other entry. */
export function recordOrigin(claudeRoot: string, name: string, origin: Omit<SkillOrigin, 'installedAt' | 'updatedAt'>, now = new Date()): void {
  const file = recordFile(claudeRoot);
  const data: Record_ = read(file) ?? { version: VERSION, skills: {} };
  const stamp = now.toISOString();
  // Installed time survives an update; a skill first seen through the CLI's lock keeps the CLI's.
  const before = data.skills[name] ?? ({ installedAt: originsOf(claudeRoot).get(name)?.installedAt } as Entry);
  data.skills[name] = {
    ...before,
    source: origin.source,
    sourceType: origin.sourceType,
    sourceUrl: origin.url,
    skillPath: origin.path,
    skillFolderHash: origin.hash,
    ...(origin.ref ? { ref: origin.ref } : {}),
    installedAt: before.installedAt ?? stamp,
    updatedAt: stamp,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, file);
  cache = undefined;
}
