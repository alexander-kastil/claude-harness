import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Asset, backupStamp, isSyncedPath } from './harness';
import { Args, Io, Stop, World, emit, headline, load, one, table } from './cli-core';
import { ScheduledTask, fetchScheduled } from './cowork-scheduled';
import { loadCoworkProjects } from './cowork-desktop';

// `cowork pull`: copy a skill, or the skills of a plugin, that Claude.ai synced into ~/.claude into Global or a repo as a Code-owned copy.
// The synced folders are only read; Claude.ai overwrites them on every sync.
// A scheduled task becomes a skill, a project's CLAUDE.md a rules file or a section of CLAUDE.md; Cowork data and the desktop app's data are only read.

/** Where a pulled copy came from; kept in `.cowork-origins.json` beside the skills folder, keyed by `skills/<name>`, `rules/<name>.md` or `CLAUDE.md#<name>`. */
export interface CoworkOrigin {
  /** The Cowork item that was pulled: the skill, or the plugin that holds it, the task or the project. */
  item: string;
  kind: 'skill' | 'plugin' | 'task' | 'project';
  owner?: string;
  /** The synced folder the copy was made from; for a task `scheduled-task:<id>`, for a project its CLAUDE.md. */
  from: string;
  /** Hash of the origin's content when it was pulled. */
  hash: string;
  pulledAt: string;
  /** A project pulled into CLAUDE.md: that file, which sits outside the `.claude` folder of a repo. */
  file?: string;
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
  kind: 'skill' | 'plugin' | 'task' | 'project';
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
  kind: CoworkOrigin['kind'];
  /** differs: the copy or its Cowork origin changed since the pull; gone: the Cowork origin is no longer synced. */
  state: 'same' | 'differs' | 'gone';
  from: string;
  to: string;
  /** What the Cowork side would write now, for Compare; a task or project only. */
  current?: string;
}

/** What a pull of the task writes: its instructions, then what it uses. */
export function renderTaskSkill(t: Pick<ScheduledTask, 'name' | 'instructions' | 'connectorNames' | 'pluginNames' | 'marketplaceNames'>): string {
  const first = (t.instructions.split(/\r?\n/).find(l => l.trim()) ?? t.name).trim().slice(0, 200);
  const uses = [
    ['Connectors', t.connectorNames],
    ['Plugins', t.pluginNames],
    ['Marketplaces', t.marketplaceNames],
  ].filter(([, list]) => (list as string[]).length);
  const tail = uses.length ? `\n\n## Uses\n\n${uses.map(([label, list]) => `- ${label}: ${(list as string[]).join(', ')}`).join('\n')}\n` : '\n';
  return `---\nname: ${slugOf(t.name)}\ndescription: ${JSON.stringify(first)}\n---\n\n${t.instructions.trim()}${tail}`;
}

/** The rules file a pull of the project writes. */
export const renderProjectRules = (name: string, text: string): string => `# Cowork project: ${name}\n\n${text.trim()}\n`;

const markers = (slug: string) => [`<!-- cowork-pull:${slug} -->`, `<!-- /cowork-pull:${slug} -->`];
/** The section a pull of the project writes into CLAUDE.md. */
export const renderProjectSection = (slug: string, name: string, text: string): string => `${markers(slug)[0]}\n## Cowork project: ${name}\n\n${text.trim()}\n${markers(slug)[1]}\n`;

const sectionOf = (file: string, slug: string): string | null => {
  const [open, close] = markers(slug);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
  const a = text.indexOf(open);
  const b = text.indexOf(close);
  return a >= 0 && b > a ? text.slice(a, b + close.length) + '\n' : null;
};

export const slugOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cowork';
export const textHash = (t: string): string => crypto.createHash('sha256').update(t).digest('hex');

/** Every pulled item under a `.claude` folder with whether it still matches its Cowork origin. `tasks` is the live list of scheduled tasks when it was read; without it a task is only checked against its own copy. */
export function coworkDrift(base: string, tasks?: ScheduledTask[]): PulledDrift[] {
  return Object.entries(readOrigins(base)).map(([key, o]) => {
    const rel = key.split('#')[0];
    const to = o.file ?? path.join(base, ...rel.split('/'));
    const name = key.replace(/^skills\//, '').replace(/^rules\//, '').replace(/\.md$/, '');
    if (o.kind === 'task') {
      const live = tasks?.find(t => `scheduled-task:${t.id}` === o.from);
      const current = live ? renderTaskSkill(live) : undefined;
      const own = fs.existsSync(path.join(to, 'SKILL.md')) ? textHash(fs.readFileSync(path.join(to, 'SKILL.md'), 'utf8')) : '';
      const state = tasks && !live ? 'gone' : own === o.hash && (!current || textHash(current) === o.hash) ? 'same' : 'differs';
      return { skill: name, item: o.item, kind: o.kind, state, from: o.from, to, current };
    }
    if (o.kind === 'project') {
      const slug = key.includes('#') ? key.split('#')[1] : name;
      const pname = o.item;
      let text = '';
      try {
        text = fs.readFileSync(o.from, 'utf8');
      } catch {
        return { skill: name, item: o.item, kind: o.kind, state: 'gone', from: o.from, to };
      }
      const current = key.includes('#') ? renderProjectSection(slug, pname, text) : renderProjectRules(pname, text);
      const own = key.includes('#') ? sectionOf(to, slug) : fs.existsSync(to) ? fs.readFileSync(to, 'utf8') : null;
      const state = own !== null && textHash(own.replace(/\r\n/g, '\n')) === o.hash && textHash(current) === o.hash ? 'same' : 'differs';
      return { skill: name, item: o.item, kind: o.kind, state, from: o.from, to, current };
    }
    const state = !fs.existsSync(o.from) ? 'gone' : fs.existsSync(to) && folderHash(to) === folderHash(o.from) ? 'same' : 'differs';
    return { skill: name, item: o.item, kind: o.kind, state, from: o.from, to };
  });
}

export interface TextPlan extends PullOut {
  base: string;
  key: string;
  origin: Omit<CoworkOrigin, 'pulledAt'>;
  content: string;
  /** Set when the text is a section of an existing CLAUDE.md. */
  section?: string;
  file: string;
}

/** Plans a pull of a scheduled task to a skill; nothing is written. */
export function planTaskPull(w: Pick<World, 'root'>, t: ScheduledTask, repo?: string): TextPlan {
  if (repo && !fs.existsSync(path.resolve(repo))) throw new Stop(`${repo} is not a folder.`);
  if (!t.instructions.trim()) throw new Stop(`${t.name} has no instructions to pull.`);
  const base = baseOf(w, repo);
  const slug = slugOf(t.name);
  const dir = path.join(base, 'skills', slug);
  const file = path.join(dir, 'SKILL.md');
  const content = renderTaskSkill(t);
  const hash = textHash(content);
  return { name: t.name, kind: 'task', target: base, base, key: `skills/${slug}`, file, content, origin: { item: t.name, kind: 'task', from: `scheduled-task:${t.id}`, hash }, rows: [{ skill: slug, action: fs.existsSync(file) ? 'replace' : 'create', from: `scheduled-task:${t.id}`, to: dir, hash, backup: null }] };
}

/** Plans a pull of a project's CLAUDE.md to a rules file or a section of CLAUDE.md; nothing is written. */
export function planProjectPull(w: Pick<World, 'root'>, p: { name: string; folder: string }, into: 'rules' | 'claude-md', repo?: string): TextPlan {
  if (repo && !fs.existsSync(path.resolve(repo))) throw new Stop(`${repo} is not a folder.`);
  const from = path.join(p.folder, 'CLAUDE.md');
  if (!p.folder || !fs.existsSync(from)) throw new Stop(`${p.name} has no CLAUDE.md on this PC; instructions kept only on claude.ai are not pulled.`);
  const text = fs.readFileSync(from, 'utf8');
  const base = baseOf(w, repo);
  const slug = slugOf(p.name);
  const file = into === 'rules' ? path.join(base, 'rules', `${slug}.md`) : repo ? path.join(path.resolve(repo), 'CLAUDE.md') : path.join(w.root, 'CLAUDE.md');
  const content = into === 'rules' ? renderProjectRules(p.name, text) : renderProjectSection(slug, p.name, text);
  const hash = textHash(content);
  const key = into === 'rules' ? `rules/${slug}.md` : `CLAUDE.md#${slug}`;
  return { name: p.name, kind: 'project', target: base, base, key, file, content, section: into === 'claude-md' ? slug : undefined, origin: { item: p.name, kind: 'project', from, hash, ...(into === 'claude-md' && { file }) }, rows: [{ skill: slug, action: fs.existsSync(file) ? 'replace' : 'create', from, to: file, hash, backup: null }] };
}

/** Writes a task skill or a project's text; an existing target is backed up first. Cowork data is never touched. */
export function applyTextPull(w: Pick<World, 'root'>, plan: TextPlan, now = new Date()): PullOut {
  const stamp = backupStamp(now);
  const row = plan.rows[0];
  const target = plan.file;
  if (fs.existsSync(target)) {
    const rel = path.relative(plan.base, target).startsWith('..') ? path.basename(target) : path.relative(plan.base, target);
    const backup = path.join(w.root, 'repo-sync-backups', stamp, path.basename(plan.base), rel);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(target, backup);
    row.backup = backup;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (plan.section) {
    const old = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
    const had = sectionOf(target, plan.section);
    fs.writeFileSync(target, had ? old.replace(had.replace(/\n$/, ''), plan.content.replace(/\n$/, '')) : `${old}${old && !old.endsWith('\n\n') ? (old.endsWith('\n') ? '\n' : '\n\n') : ''}${plan.content}`);
  } else fs.writeFileSync(target, plan.content);
  const origins = readOrigins(plan.base);
  origins[plan.key] = { ...plan.origin, pulledAt: now.toISOString() };
  fs.writeFileSync(path.join(plan.base, ORIGINS_FILE), JSON.stringify(origins, null, 2) + '\n');
  return { name: plan.name, kind: plan.kind, target: plan.target, rows: plan.rows };
}

const HEAD = ['Skill', 'Action', 'From', 'To', 'Backup'];

const pullLines = (o: PullOut, dry: boolean): string[] => [
  headline(`${dry ? '[dry-run] ' : ''}Pull ${o.kind} ${o.name} to ${o.target}`),
  '',
  ...table(HEAD, o.rows.map(r => [r.skill, r.action, r.from, r.to, r.backup ?? ''])),
];

export async function coworkCommand(a: Args, io: Io): Promise<number> {
  const [, sub, name] = a.words;
  if (sub !== 'pull') throw new Stop('cowork needs a subcommand: cowork pull <name> [--repo <dir>] [--kind skill|plugin|task|project] [--into rules|claude-md] [--dry-run].', 2);
  if (!name) throw new Stop('cowork pull needs the name of a Cowork skill, plugin, scheduled task or project.', 2);
  const kind = one(a, 'kind');
  if (kind && !['skill', 'plugin', 'task', 'project'].includes(kind)) throw new Stop(`cowork pull --kind takes skill, plugin, task or project, got "${kind}".`, 2);
  const into = one(a, 'into') ?? 'rules';
  if (into !== 'rules' && into !== 'claude-md') throw new Stop(`cowork pull --into takes rules or claude-md, got "${into}".`, 2);
  const repos = a.flags.get('repo') ?? [];
  if (repos.length > 1) throw new Stop('cowork pull takes one --repo.', 2);
  // The target is a repo given by --repo, else Global; --repo here is not added to the loaded world.
  const w = load({ words: a.words, flags: new Map([...a.flags].filter(([k]) => k !== 'repo')) });
  const dry = !!one(a, 'dry-run');
  const isSynced = (k?: string) => w.cowork.categories.some(c => (c.kind === 'skill' || c.kind === 'plugin') && (!k || c.kind === k) && c.items.some(i => i.name === name));
  const same = (n: string, id: string) => n === name || id === name || n.toLowerCase() === name.toLowerCase();
  let out: PullOut;
  if (kind === 'skill' || kind === 'plugin' || (!kind && isSynced())) {
    const plan = planPull(w, name, kind, repos[0]);
    out = dry ? { name: plan.name, kind: plan.kind, target: plan.target, rows: plan.rows } : applyPull(w, plan);
  } else {
    let plan: TextPlan | undefined;
    if (kind !== 'project') {
      const list = await fetchScheduled(w.root);
      if (list.state !== 'ok' && kind === 'task') throw new Stop(list.note);
      const task = list.tasks.find(t => same(t.name, t.id));
      if (task) plan = planTaskPull(w, task, repos[0]);
    }
    if (!plan && kind !== 'task') {
      const project = loadCoworkProjects().projects.find(p => same(p.name, p.id));
      if (project) plan = planProjectPull(w, project, into, repos[0]);
    }
    if (!plan && !kind) planPull(w, name, undefined, repos[0]);
    if (!plan) throw new Stop(`Cowork has no ${kind} named ${name}.`);
    out = dry ? { name: plan.name, kind: plan.kind, target: plan.target, rows: plan.rows } : applyTextPull(w, plan);
  }
  emit(io, a, out, pullLines(out, dry), !dry);
  return 0;
}
