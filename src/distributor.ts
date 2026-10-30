// Skills from a distributor (skills.sh, which serves GitHub repos): find a skill in its repo, download it into ~/.claude/skills,
// ask GitHub whether the skill's folder changed since it was installed, and move an installed global skill into a repo
// (a real move, no link). Where a skill came from is recorded in skill-lock.ts.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareVersions } from './fleet';
import { parseMarkdown, versionOf } from './harness';
import { SkillOrigin, forgetOrigin, originsOf, recordOrigin } from './skill-lock';

/** What a skills.sh or GitHub address names: a repo, and perhaps a skill in it. */
export interface Source {
  owner: string;
  repo: string;
  skill?: string;
  branch?: string;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `skills.sh/owner/repo/skill`, `github.com/owner/repo[/tree/branch/skills/skill]` or `owner/repo[/skill]`. */
export function parseSource(text: string): Source | undefined {
  const parts = text
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')
    .filter(Boolean);
  const host = /^[\w-]+(\.[\w-]+)+$/.test(parts[0] ?? '') ? parts.shift()!.toLowerCase() : '';
  if (host && host !== 'skills.sh' && host !== 'github.com') return undefined;
  const [owner, repoRaw, ...rest] = parts;
  const repo = repoRaw?.replace(/\.git$/i, '');
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return undefined;
  const src: Source = { owner, repo };
  if (host === 'github.com' && (rest[0] === 'tree' || rest[0] === 'blob') && rest[1]) {
    src.branch = rest[1];
    const tail = rest.slice(2);
    if (tail[tail.length - 1]?.toLowerCase() === 'skill.md') tail.pop();
    if (tail.length) src.skill = tail[tail.length - 1];
  } else if (rest[0]) src.skill = rest[0];
  if (src.skill && !NAME.test(src.skill)) return undefined;
  return src;
}

const headers = (): Record<string, string> => {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return { 'User-Agent': 'claude-harness', Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

const get = async (url: string): Promise<Response> => {
  let r: Response;
  try {
    r = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new Error(`Could not reach ${new URL(url).host}: ${(e as Error).message}`);
  }
  if (r.status === 403 || r.status === 429) throw new Error('GitHub refused the request, most likely its limit of 60 requests an hour without a token. Set GITHUB_TOKEN to raise it.');
  return r;
};

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

/** The whole tree of a repo at its default branch, from one request. */
export interface RepoTree {
  sha: string;
  entries: TreeEntry[];
  byPath: Map<string, TreeEntry>;
}

export async function repoTree(owner: string, repo: string, ref = 'HEAD'): Promise<RepoTree> {
  const r = await get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  if (r.status === 404) throw new Error(`${owner}/${repo} was not found on GitHub, or it is private.`);
  if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${owner}/${repo}.`);
  const body = (await r.json()) as { sha: string; tree: TreeEntry[]; truncated?: boolean };
  if (body.truncated) throw new Error(`${owner}/${repo} is too large to list from GitHub in one request.`);
  return { sha: body.sha, entries: body.tree, byPath: new Map(body.tree.map(e => [e.path, e])) };
}

const rawUrl = (owner: string, repo: string, ref: string, file: string) => `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${file.split('/').map(encodeURIComponent).join('/')}`;

/** The folders of a tree that hold a SKILL.md; '' is the repo root. */
export const skillDirs = (tree: RepoTree): string[] =>
  tree.entries
    .filter(e => e.type === 'blob' && path.posix.basename(e.path) === 'SKILL.md')
    .map(e => (path.posix.dirname(e.path) === '.' ? '' : path.posix.dirname(e.path)))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));

/** A skill found in a repo: its folder and the git tree SHA of that folder. */
export interface Resolved {
  src: Source;
  tree: RepoTree;
  dir: string;
}

const hashOf = (tree: RepoTree, dir: string) => (dir === '' ? tree.sha : tree.byPath.get(dir)?.type === 'tree' ? tree.byPath.get(dir)!.sha : undefined);

/**
 * Finds the skill an address names. A repo with several skills and no name in the address asks `choose`, which gets the folders.
 * The folder name is the skill's slug; a skill at the repo root is named by the repo, or by its frontmatter.
 */
export async function resolve(src: Source, choose: (dirs: string[], why?: string) => Promise<string | undefined>): Promise<Resolved> {
  const tree = await repoTree(src.owner, src.repo, src.branch);
  const dirs = skillDirs(tree);
  if (!dirs.length) throw new Error(`${src.owner}/${src.repo} has no SKILL.md.`);
  let dir: string | undefined;
  if (src.skill) {
    const slug = (d: string) => (d === '' ? src.repo : path.posix.basename(d));
    const matches = dirs.filter(d => slug(d).toLowerCase() === src.skill!.toLowerCase());
    // A copy under a dot folder or a plugin wrapper loses to the repo's own skills folder.
    dir = matches.find(d => d.startsWith('skills/')) ?? matches.find(d => !d.split('/').some(p => p.startsWith('.'))) ?? matches[0];
    if (dir === undefined && dirs.includes('')) {
      const text = await (await get(rawUrl(src.owner, src.repo, src.branch ?? 'HEAD', 'SKILL.md'))).text();
      if (String(parseMarkdown(text).data.name ?? '').toLowerCase() === src.skill.toLowerCase()) dir = '';
    }
    if (dir === undefined) dir = await choose(dirs, `${src.owner}/${src.repo} has no skill named ${src.skill}.`);
  } else dir = dirs.length === 1 ? dirs[0] : await choose(dirs);
  if (dir === undefined) throw new Cancelled();
  return { src, tree, dir };
}

/** The owner closed a question the command was waiting on: stop without a message. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

/** A skill downloaded to a scratch folder, ready to install. */
export interface Staged {
  /** The SKILL.md description, which Claude reads in every session. */
  description?: string;
  /** The skill's name: its frontmatter name when that is a plain slug, else its folder. */
  name: string;
  /** `owner/repo`. */
  source: string;
  url: string;
  /** The SKILL.md inside the repo. */
  path: string;
  hash: string;
  ref?: string;
  dir: string;
  files: string[];
  version?: string;
}

/** What a repository holds beside a skill that sits at its root: git and tool folders, readmes, changelogs, tests, docs and the Codex agent file. */
export const ROOT_NOISE = /^(\.|(README|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|AGENTS|CLAUDE)[^/]*$|(tests?|docs)\/|agents\/openai\.yaml$)/i;

const MAX_FILES = 400;
const MAX_BYTES = 25 * 1024 * 1024;

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    })
  );
}

export async function stage(found: Resolved): Promise<Staged> {
  const { src, tree, dir } = found;
  const prefix = dir ? `${dir}/` : '';
  const hash = hashOf(tree, dir);
  if (!hash) throw new Error(`${dir} is not a folder of ${src.owner}/${src.repo}.`);
  const blobs = tree.entries.filter(e => e.type === 'blob' && e.path.startsWith(prefix) && !(dir === '' && ROOT_NOISE.test(e.path)));
  if (blobs.length > MAX_FILES || blobs.reduce((n, e) => n + (e.size ?? 0), 0) > MAX_BYTES) throw new Error(`${dir || src.repo} holds more than ${MAX_FILES} files or ${MAX_BYTES / 1024 / 1024} MB: not a skill folder.`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH));
  live.add(scratch);
  try {
    await pool(blobs, 6, async e => {
      const rel = e.path.slice(prefix.length);
      const r = await get(rawUrl(src.owner, src.repo, src.branch ?? 'HEAD', e.path));
      if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${e.path}.`);
      const file = path.join(scratch, ...rel.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    });
  } catch (e) {
    fs.rmSync(scratch, { recursive: true, force: true });
    throw e;
  }
  const { data } = parseMarkdown(fs.readFileSync(path.join(scratch, 'SKILL.md'), 'utf8'));
  const slug = dir === '' ? src.repo : path.posix.basename(dir);
  const named = typeof data.name === 'string' && NAME.test(data.name.trim()) ? data.name.trim() : slug;
  return {
    name: named,
    source: `${src.owner}/${src.repo}`,
    url: `https://github.com/${src.owner}/${src.repo}.git`,
    path: `${prefix}SKILL.md`,
    hash,
    ref: src.branch,
    dir: scratch,
    files: blobs.map(e => e.path.slice(prefix.length)).sort(),
    version: versionOf(data),
    description: typeof data.description === 'string' ? data.description.replace(/\s+/g, ' ').trim() : undefined,
  };
}

const SCRATCH = 'harness-skill-';
const live = new Set<string>();

/** Removes the downloads this window still holds; unless `mineOnly`, also the ones a closed window or a killed process left in the temp folder over an hour ago. */
export function sweepStaged(mineOnly = false): void {
  for (const dir of live) fs.rmSync(dir, { recursive: true, force: true });
  live.clear();
  if (mineOnly) return;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      const full = path.join(os.tmpdir(), name);
      if (name.startsWith(SCRATCH) && Date.now() - fs.statSync(full).mtimeMs > 3600 * 1000) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch {
    // a temp folder that cannot be read has nothing to sweep
  }
}

/** Why an address is not one this extension can read, or nothing when it is. */
export function explainSource(text: string): string | undefined {
  const raw = text.trim();
  if (!raw) return 'Type or paste the address of a skill.';
  if (parseSource(raw)) return undefined;
  const parts = raw.replace(/[?#].*$/, '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/').filter(Boolean);
  const host = /^[\w-]+(\.[\w-]+)+$/.test(parts[0] ?? '') ? parts.shift()!.toLowerCase() : '';
  if (host && host !== 'skills.sh' && host !== 'github.com') return `${host} is not supported: only skills.sh and github.com addresses.`;
  if (parts.length < 2) return 'The address needs the owner and the repository, like owner/repo.';
  if (!NAME.test(parts[0]) || !NAME.test(parts[1])) return `${parts[!NAME.test(parts[0]) ? 0 : 1]} is not a valid owner or repository name: use letters, digits, dots, dashes and underscores.`;
  return `${parts[parts.length - 1]} is not a valid skill name: use letters, digits, dots, dashes and underscores.`;
}

export const discard = (staged: Staged): void => {
  live.delete(staged.dir);
  fs.rmSync(staged.dir, { recursive: true, force: true });
};

/** The skill an installed origin names, found again in its repo. */
export async function resolveOrigin(origin: SkillOrigin): Promise<Resolved> {
  const [owner, repo] = origin.source.split('/');
  const tree = await repoTree(owner, repo, origin.ref);
  const dir = path.posix.dirname(origin.path) === '.' ? '' : path.posix.dirname(origin.path);
  if (!hashOf(tree, dir)) throw new Error(`${origin.source} no longer has ${dir || 'a SKILL.md at its root'}.`);
  return { src: { owner, repo, branch: origin.ref }, tree, dir };
}

/** What the distributor says about one installed skill. */
export interface Latest {
  state: 'current' | 'newer' | 'gone' | 'error';
  version?: string;
  error?: string;
}

/** One tree request per repo answers for every skill installed from it. */
export async function latest(items: { name: string; origin: SkillOrigin }[]): Promise<Record<string, Latest>> {
  const out: Record<string, Latest> = {};
  const repos = new Map<string, { name: string; origin: SkillOrigin }[]>();
  for (const item of items) repos.set(`${item.origin.source}@${item.origin.ref ?? ''}`, [...(repos.get(`${item.origin.source}@${item.origin.ref ?? ''}`) ?? []), item]);
  await Promise.all(
    [...repos.values()].map(async group => {
      const [owner, repo] = group[0].origin.source.split('/');
      let tree: RepoTree;
      try {
        tree = await repoTree(owner, repo, group[0].origin.ref);
      } catch (e) {
        for (const item of group) out[item.name] = { state: 'error', error: (e as Error).message };
        return;
      }
      for (const { name, origin } of group) {
        const dir = path.posix.dirname(origin.path) === '.' ? '' : path.posix.dirname(origin.path);
        const hash = hashOf(tree, dir);
        if (!hash) out[name] = { state: 'gone' };
        else if (hash === origin.hash) out[name] = { state: 'current' };
        else {
          out[name] = { state: 'newer' };
          try {
            const r = await get(rawUrl(owner, repo, origin.ref ?? 'HEAD', origin.path));
            if (r.ok) out[name].version = versionOf(parseMarkdown(await r.text()).data);
          } catch {
            // the version pair is a nicety
          }
        }
      }
    })
  );
  return out;
}

/** The newest release tag of a repo (its latest release, else the highest version among its tags) without a leading `v`, or undefined when it has neither. */
export async function latestTag(owner: string, repo: string): Promise<string | undefined> {
  const plain = (t: unknown) => (typeof t === 'string' ? t.replace(/^v(?=\d)/i, '') : undefined);
  const release = await get(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
  if (release.ok) {
    const tag = plain(((await release.json()) as { tag_name?: string }).tag_name);
    if (tag) return tag;
  } else if (release.status !== 404) throw new Error(`GitHub answered ${release.status} for the releases of ${owner}/${repo}.`);
  const tags = await get(`https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`);
  if (!tags.ok) throw new Error(`GitHub answered ${tags.status} for the tags of ${owner}/${repo}.`);
  const names = ((await tags.json()) as { name?: string }[]).map(t => plain(t.name)).filter((t): t is string => !!t && /^\d+\.\d+/.test(t));
  return names.sort(compareVersions).pop();
}

const filesOf = (dir: string): string[] =>
  fs.existsSync(dir)
    ? (fs.readdirSync(dir, { recursive: true, withFileTypes: true }) as fs.Dirent[]).filter(e => e.isFile()).map(e => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/')).sort()
    : [];

const sameBytes = (a: string, b: string) => {
  const x = fs.readFileSync(a);
  const y = fs.readFileSync(b);
  return x.equals(y) || x.toString('latin1').replace(/\r\n/g, '\n') === y.toString('latin1').replace(/\r\n/g, '\n');
};

/** How a folder on disk differs from the downloaded one, line endings aside. */
export function diffFolders(existing: string, downloaded: string): { changed: string[]; added: string[]; removed: string[] } {
  const had = new Set(filesOf(existing));
  const now = filesOf(downloaded);
  return {
    changed: now.filter(f => had.has(f) && !sameBytes(path.join(existing, f), path.join(downloaded, f))),
    added: now.filter(f => !had.has(f)),
    removed: [...had].filter(f => !now.includes(f)),
  };
}

export type LinkState = 'none' | 'linked' | 'elsewhere' | 'copy';

/** What a skill folder is: absent, a real folder, or a link (to `target` when given, else elsewhere). */
export function linkState(link: string, target: string): LinkState {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(link);
  } catch {
    return 'none';
  }
  if (!stat.isSymbolicLink()) return 'copy';
  try {
    return path.resolve(fs.realpathSync(link)).toLowerCase() === path.resolve(target).toLowerCase() ? 'linked' : 'elsewhere';
  } catch {
    return 'elsewhere';
  }
}

// A junction or symlink is removed as a link, never through its target.
const removeLink = (p: string) => {
  try {
    fs.unlinkSync(p);
  } catch {
    fs.rmdirSync(p);
  }
};

const backUp = (from: string, backupDir: string, label: string): string => {
  const dest = path.join(backupDir, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // A link is copied as the files it points to, never as another link.
  fs.cpSync(from, dest, { recursive: true, dereference: true });
  return dest;
};

/**
 * Writes the downloaded skill's files into ~/.claude/skills/<name> and records where it came from. What was there is backed up
 * first: a plain copy as it is, a link (a skills CLI install points into ~/.agents) as the files it points to. A link is
 * replaced by the folder; the link's target is not touched.
 */
export function install(claudeRoot: string, s: Staged, backupDir: string): { folder: string; backup?: string } {
  const folder = path.join(claudeRoot, 'skills', s.name);
  const state = linkState(folder, folder);
  let backup: string | undefined;
  if (state !== 'none') backup = backUp(folder, backupDir, s.name);
  if (state === 'linked' || state === 'elsewhere') removeLink(folder);
  else fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  fs.cpSync(s.dir, folder, { recursive: true });
  recordOrigin(claudeRoot, s.name, { source: s.source, sourceType: 'github', url: s.url, path: s.path, hash: s.hash, ref: s.ref });
  return { folder, backup };
}

/**
 * Moves an installed global skill into a repo: the folder leaves `~/.claude/skills/<name>` and becomes `<repo>/.claude/skills/<name>`.
 * The two can be on different drives, so it is copied and then the source is removed. A repo link left by the earlier link
 * code is removed as a link. The skill's recorded source follows it into the repo's own record.
 */
export function moveToRepo(claudeRoot: string, repoDir: string, name: string): string {
  const source = path.join(claudeRoot, 'skills', name);
  const dest = path.join(repoDir, '.claude', 'skills', name);
  const state = linkState(dest, source);
  if (state === 'copy') throw new Error(`${dest} is a folder of its own. Retire or move it first.`);
  if (state === 'elsewhere') throw new Error(`${dest} is a link to something else.`);
  if (!fs.existsSync(source)) throw new Error(`${source} does not exist.`);
  const origin = originsOf(claudeRoot).get(name);
  if (state === 'linked') removeLink(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // A source that is itself a link (a skills CLI install) is copied as the files it points to.
  fs.cpSync(source, dest, { recursive: true, dereference: true });
  if (fs.lstatSync(source).isSymbolicLink()) removeLink(source);
  else fs.rmSync(source, { recursive: true, force: true });
  if (origin) recordOrigin(path.join(repoDir, '.claude'), name, origin, origin.updatedAt ? new Date(origin.updatedAt) : undefined);
  forgetOrigin(claudeRoot, name);
  return dest;
}
