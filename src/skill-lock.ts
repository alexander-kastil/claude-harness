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
}

type Entry = Record<string, unknown> & { source?: string; sourceType?: string; sourceUrl?: string; skillPath?: string; skillFolderHash?: string; ref?: string; installedAt?: string; updatedAt?: string };

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

const originOf = (e: Entry): SkillOrigin | undefined =>
  typeof e.source === 'string' && typeof e.skillPath === 'string' && typeof e.skillFolderHash === 'string'
    ? {
        source: e.source,
        sourceType: String(e.sourceType ?? 'github'),
        url: typeof e.sourceUrl === 'string' ? e.sourceUrl : `https://github.com/${e.source}.git`,
        path: e.skillPath,
        hash: e.skillFolderHash,
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

/** Every skill with a known source, by name: the extension's record first, then what the skills CLI recorded. */
export function originsOf(claudeRoot: string): Map<string, SkillOrigin> {
  const own = recordFile(claudeRoot);
  const cli = cliLockFile(claudeRoot);
  const key = `${own}:${mtime(own)}:${cli}:${mtime(cli)}`;
  if (cache?.key === key) return cache.origins;
  const origins = new Map<string, SkillOrigin>();
  for (const file of [cli, own])
    for (const [name, e] of Object.entries(read(file)?.skills ?? {})) {
      const origin = originOf(e);
      if (origin) origins.set(name, origin);
    }
  cache = { key, origins };
  return origins;
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
