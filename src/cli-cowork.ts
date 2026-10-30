import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Asset, backupStamp, isSyncedPath } from './harness';
import { Args, Io, Stop, World, emit, headline, load, one, table } from './cli-core';

// `cowork pull`: copy a skill, or the skills of a plugin, that Claude.ai synced into ~/.claude into Global or a repo as a Code-owned copy.
// The synced folders are only read; Claude.ai overwrites them on every sync.

/** Where a pulled copy came from; kept in `.cowork-origins.json` beside the skills folder, keyed by `skills/<name>`. */
export interface CoworkOrigin {
  /** The Cowork item that was pulled: the skill, or the plugin that holds it. */
  item: string;
  kind: 'skill' | 'plugin';
  owner?: string;
  /** The synced folder the copy was made from. */
  from: string;
  /** Hash of the origin's content when it was pulled. */
  hash: string;
  pulledAt: string;
}

export interface PullRow {
  skill: string;
  action: 'create' | 'replace';
  from: string;
  to: string;
  hash: string;
  /** The folder the replaced copy was saved to; null when nothing was replaced or on a dry run. */
  backup: string | null;
}

export interface PullOut {
  name: string;
  kind: 'skill' | 'plugin';
  target: string;
  rows: PullRow[];
}

export const ORIGINS_FILE = '.cowork-origins.json';

const filesOf = (dir: string, rel = ''): string[] =>
  fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(e => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? filesOf(dir, r) : [r];
  });

/** The content of a folder as one hash: its relative paths and bytes in path order. */
export function folderHash(dir: string): string {
  const hash = crypto.createHash('sha256');
  for (const rel of filesOf(dir).sort()) {
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(dir, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const readOrigins = (base: string): Record<string, CoworkOrigin> => {
  try {
    return JSON.parse(fs.readFileSync(path.join(base, ORIGINS_FILE), 'utf8')) as Record<string, CoworkOrigin>;
  } catch {
    return {};
  }
};

/** The skills a pull of this Cowork item copies: the skill itself, or each skill the synced plugin ships. */
function sourcesOf(asset: Asset): { skill: string; dir: string }[] {
  if (asset.kind === 'skill') return [{ skill: asset.name, dir: asset.dir! }];
  const skills = path.join(asset.dir!, 'skills');
  if (!fs.existsSync(skills)) return [];
  return fs
    .readdirSync(skills, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(skills, e.name, 'SKILL.md')))
    .map(e => ({ skill: e.name, dir: path.join(skills, e.name) }));
}

/** The `.claude` folder a pull writes into: the Claude root for Global, the repo's `.claude` for --repo. */
const baseOf = (w: Pick<World, 'root'>, repo?: string) => (repo ? path.join(path.resolve(repo), '.claude') : w.root);

/** Plans a pull; nothing is written. */
export function planPull(w: Pick<World, 'root' | 'cowork'>, name: string, kind: string | undefined, repo?: string): PullOut & { asset: Asset; base: string } {
  const found = w.cowork.categories.filter(c => (c.kind === 'skill' || c.kind === 'plugin') && (!kind || c.kind === kind)).flatMap(c => c.items.filter(i => i.name === name));
  if (!found.length) throw new Stop(`Cowork has no ${kind ?? 'skill or plugin'} named ${name}. Run: harness inventory --cowork`);
  if (found.length > 1) throw new Stop(`Cowork has a skill and a plugin named ${name}; pass --kind skill|plugin.`, 2);
  const asset = found[0];
  const base = baseOf(w, repo);
  if (repo && !fs.existsSync(path.resolve(repo))) throw new Stop(`${repo} is not a folder.`);
  const sources = sourcesOf(asset);
  if (!sources.length) throw new Stop(`${name} holds no skill to pull.`);
  const rows = sources.map<PullRow>(s => {
    const to = path.join(base, 'skills', s.skill);
    // Claude.ai overwrites the synced folders: never a target, never a link out of them.
    if (isSyncedPath(w.root, to)) throw new Stop(`${to} is inside a synced folder, which Claude.ai overwrites.`);
    return { skill: s.skill, action: fs.existsSync(to) ? 'replace' : 'create', from: s.dir, to, hash: folderHash(s.dir), backup: null };
  });
  return { name, kind: asset.kind as 'skill' | 'plugin', target: base, rows, asset, base };
}

/** Carries a plan out: backs up an existing target, copies the synced folder, records the origin. */
export function applyPull(w: Pick<World, 'root'>, plan: ReturnType<typeof planPull>, now = new Date()): PullOut {
  const stamp = backupStamp(now);
  const backupRoot = path.join(w.root, 'repo-sync-backups');
  const origins = readOrigins(plan.base);
  for (const row of plan.rows) {
    if (row.action === 'replace') {
      const backup = path.join(backupRoot, stamp, path.basename(plan.base), path.relative(plan.base, row.to));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.cpSync(row.to, backup, { recursive: true, dereference: true });
      row.backup = backup;
      fs.rmSync(row.to, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(row.to), { recursive: true });
    fs.cpSync(row.from, row.to, { recursive: true });
    origins[`skills/${row.skill}`] = { item: plan.name, kind: plan.kind, ...(plan.asset.owner && { owner: plan.asset.owner }), from: row.from, hash: row.hash, pulledAt: now.toISOString() };
  }
  fs.writeFileSync(path.join(plan.base, ORIGINS_FILE), JSON.stringify(origins, null, 2) + '\n');
  return { name: plan.name, kind: plan.kind, target: plan.target, rows: plan.rows };
}

export interface PulledDrift {
  skill: string;
  item: string;
  /** differs: the copy or its Cowork origin changed since the pull; gone: the Cowork origin is no longer synced. */
  state: 'same' | 'differs' | 'gone';
  from: string;
  to: string;
}

/** Every pulled skill under a `.claude` folder with whether it still matches its Cowork origin. */
export function coworkDrift(base: string): PulledDrift[] {
  return Object.entries(readOrigins(base)).map(([key, o]) => {
    const to = path.join(base, ...key.split('/'));
    const state = !fs.existsSync(o.from) ? 'gone' : fs.existsSync(to) && folderHash(to) === folderHash(o.from) ? 'same' : 'differs';
    return { skill: key.replace(/^skills\//, ''), item: o.item, state, from: o.from, to };
  });
}

const HEAD = ['Skill', 'Action', 'From', 'To', 'Backup'];

const pullLines = (o: PullOut, dry: boolean): string[] => [
  headline(`${dry ? '[dry-run] ' : ''}Pull ${o.kind} ${o.name} to ${o.target}`),
  '',
  ...table(HEAD, o.rows.map(r => [r.skill, r.action, r.from, r.to, r.backup ?? ''])),
];

export async function coworkCommand(a: Args, io: Io): Promise<number> {
  const [, sub, name] = a.words;
  if (sub !== 'pull') throw new Stop('cowork needs a subcommand: cowork pull <name> [--repo <dir>] [--kind skill|plugin] [--dry-run].', 2);
  if (!name) throw new Stop('cowork pull needs the name of a Cowork skill or plugin.', 2);
  const kind = one(a, 'kind');
  if (kind && kind !== 'skill' && kind !== 'plugin') throw new Stop(`cowork pull --kind takes skill or plugin, got "${kind}".`, 2);
  const repos = a.flags.get('repo') ?? [];
  if (repos.length > 1) throw new Stop('cowork pull takes one --repo.', 2);
  // The target is a repo given by --repo, else Global; --repo here is not added to the loaded world.
  const w = load({ words: a.words, flags: new Map([...a.flags].filter(([k]) => k !== 'repo')) });
  const plan = planPull(w, name, kind, repos[0]);
  const dry = !!one(a, 'dry-run');
  const out: PullOut = dry ? { name: plan.name, kind: plan.kind, target: plan.target, rows: plan.rows } : applyPull(w, plan);
  emit(io, a, out, pullLines(out, dry), !dry);
  return 0;
}
