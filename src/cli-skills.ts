import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { backupStamp } from './harness';
import { Args, Io, Stop, emit, headline, list, one, table } from './cli-core';

// `skills move`, `skills split` and `skills repoint`: reorganise skills under a Claude folder (leaf files between skills, a part of a skill into a new one) and keep the references pointing at the right place.

export interface SkillChange {
  action: 'move' | 'create' | 'rewrite' | 'remove' | 'check';
  file: string;
  detail: string;
}

export interface SkillsOut {
  op: 'move' | 'split' | 'put' | 'remove' | 'repoint';
  changes: SkillChange[];
  /** The folder the originals go to before any change; null when nothing is written. */
  backup: string | null;
}

const rootOf = (a: Args) => path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));
const posix = (p: string) => p.split(path.sep).join('/');

function skillName(text: string | undefined, what: string): string {
  if (!text || !/^[\w][\w.-]*$/.test(text)) throw new Stop(`${what} needs a skill name, got "${text ?? ''}".`, 2);
  return text;
}

/** A leaf as `skill/relative/path.md`. */
function leafOf(text: string | undefined, what: string): { skill: string; rel: string } {
  const i = (text ?? '').indexOf('/');
  if (i < 1 || i === text!.length - 1 || text!.split('/').includes('..')) throw new Stop(`${what} needs <skill>/<relative path>, e.g. media-generation/references/film-project.md.`, 2);
  return { skill: skillName(text!.slice(0, i), what), rel: text!.slice(i + 1) };
}

/** The Markdown files of the root's skills and agents, and of the market's plugins with --market. */
function textFiles(a: Args, root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.md$/i.test(e.name)) files.push(f);
    }
  };
  walk(path.join(root, 'skills'));
  walk(path.join(root, 'agents'));
  const market = one(a, 'market');
  if (market) walk(path.resolve(market));
  return files;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const skillRef = (name: string) => new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w-])`, 'g');

class Session {
  readonly changes: SkillChange[] = [];
  private readonly dir: string;
  private made = false;
  constructor(readonly a: Args, readonly root: string, readonly op: SkillsOut['op']) {
    this.dir = path.join(root, 'repo-sync-backups', backupStamp());
  }
  get dry() {
    return !!one(this.a, 'dry-run');
  }
  get backup() {
    return this.made ? this.dir : null;
  }
  private shown(file: string) {
    const rel = path.relative(this.root, file);
    return posix(rel.startsWith('..') ? file : rel);
  }
  record(action: SkillChange['action'], file: string, detail: string) {
    this.changes.push({ action, file: this.shown(file), detail });
  }
  /** Copy a file into the backup, mirrored by its path under the root (or the market). */
  save(file: string) {
    if (this.dry || !fs.existsSync(file)) return;
    const rel = path.relative(this.root, file);
    const target = path.join(this.dir, rel.startsWith('..') ? path.join('outside', path.relative(path.parse(file).root, file)) : rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    this.made = true;
  }
  write(file: string, text: string) {
    if (this.dry) return;
    this.save(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  move(from: string, to: string) {
    if (this.dry) return;
    this.save(from);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.rmSync(from);
  }
  /** Replace text in every file but the skipped ones. */
  replace(files: string[], pattern: RegExp, to: string, skip: string[] = []) {
    for (const f of files) {
      if (skip.includes(f) || !fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      const hits = text.match(pattern)?.length ?? 0;
      if (!hits) continue;
      this.record('rewrite', f, `${hits} reference${hits > 1 ? 's' : ''} to ${to}`);
      this.write(f, text.replace(pattern, to));
    }
  }
}

/** The files under a folder, relative to it, whatever their type. */
function filesUnder(dir: string, rel = ''): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(e => {
    if (e.name === '__pycache__') return [];
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? filesUnder(dir, r) : [r];
  });
}

function moveLeaf(s: Session, root: string, from: { skill: string; rel: string }, toSkill: string, toRel: string) {
  const src = path.join(root, 'skills', from.skill, from.rel);
  const dst = path.join(root, 'skills', toSkill, toRel);
  if (!fs.existsSync(src)) throw new Stop(`There is no ${from.skill}/${from.rel} under ${path.join(root, 'skills')}.`);
  if (!fs.existsSync(path.join(root, 'skills', toSkill))) throw new Stop(`There is no skill ${toSkill}. Create it with skills split.`);
  if (fs.statSync(src).isDirectory()) {
    for (const f of filesUnder(src)) moveLeaf(s, root, { skill: from.skill, rel: `${from.rel}/${f}` }, toSkill, `${toRel}/${f}`);
    if (!s.dry) fs.rmSync(src, { recursive: true, force: true });
    return;
  }
  if (fs.existsSync(dst)) {
    // The destination already holds the same file: the source is only dropped.
    if (!fs.readFileSync(src).equals(fs.readFileSync(dst))) throw new Stop(`${toSkill}/${toRel} exists already and differs from ${from.skill}/${from.rel}.`);
    s.record('move', src, `${toSkill}/${toRel} holds the same file, source dropped`);
    s.save(src);
    if (!s.dry) fs.rmSync(src);
  } else {
    s.record('move', src, `to ${toSkill}/${toRel}`);
    s.move(src, dst);
  }
  const files = textFiles(s.a, root);
  // Inside the old skill the leaf was named relatively; those rows now point nowhere.
  const oldSkill = path.join(root, 'skills', from.skill);
  for (const f of files.filter(x => x.startsWith(oldSkill + path.sep) && fs.existsSync(x))) {
    if (new RegExp(`(?<![\\w/-])${escape(from.rel)}`).test(fs.readFileSync(f, 'utf8'))) s.record('check', f, `still names ${from.rel}, which moved to ${toSkill}`);
  }
  s.replace(files, new RegExp(`(?<![\\w-])${escape(`${from.skill}/${from.rel}`)}`, 'g'), `${toSkill}/${toRel}`, [dst]);
}

const lines = (o: SkillsOut, dry: boolean): string[] => [
  headline(`${o.op}: ${o.changes.filter(c => c.action !== 'check').length} change${o.changes.filter(c => c.action !== 'check').length === 1 ? '' : 's'}${o.backup ? `, backup in ${o.backup}` : ''}`),
  '',
  ...table(['Action', 'File', 'Detail'], o.changes.map(c => [c.action, c.file, c.detail])),
  ...(dry ? o.changes.filter(c => c.action !== 'check').map(c => `[dry-run] ${c.action} ${c.file}: ${c.detail}`) : []),
];

export async function skillsCommand(a: Args, io: Io): Promise<number> {
  const [, sub] = a.words;
  const root = rootOf(a);
  const s = new Session(a, root, sub as SkillsOut['op']);
  if (sub === 'move') {
    const from = leafOf(one(a, 'leaf'), 'skills move --leaf');
    const to = (one(a, 'to') ?? '').split('/');
    const toSkill = skillName(to[0], 'skills move --to');
    moveLeaf(s, root, from, toSkill, to.slice(1).join('/') || from.rel);
  } else if (sub === 'split') {
    const from = skillName(one(a, 'from'), 'skills split --from');
    const name = skillName(one(a, 'name'), 'skills split --name');
    const leaves = list(a, 'leaves');
    if (!leaves.length) throw new Stop('skills split needs --leaves a,b: paths inside the skill, e.g. references/film-project.md.', 2);
    const dir = path.join(root, 'skills', name);
    if (fs.existsSync(dir)) throw new Stop(`Skill ${name} exists already.`);
    const description = one(a, 'description') ?? `Split from ${from}: ${leaves.map(l => path.basename(l, '.md')).join(', ')}.`;
    const body = ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`, '', '| Question | Reference |', '| --- | --- |', ...leaves.map(l => `| ${path.basename(l, '.md')} | [${l}](${l}) |`), ''].join('\n');
    s.record('create', path.join(dir, 'SKILL.md'), `new skill ${name} from ${from}`);
    s.write(path.join(dir, 'SKILL.md'), body);
    if (s.dry) fs.mkdirSync(dir, { recursive: true });
    try {
      for (const l of leaves) moveLeaf(s, root, { skill: from, rel: l }, name, l);
    } finally {
      if (s.dry) fs.rmSync(dir, { recursive: true, force: true });
    }
  } else if (sub === 'put') {
    // New or rewritten text that no move can produce: a file from outside lands in a skill.
    const file = one(a, 'file');
    const target = one(a, 'to') ?? '';
    const agent = /^agents\/[\w.-]+\.md$/.test(target);
    const to = agent ? { skill: '', rel: target } : leafOf(target, 'skills put --to');
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Stop(`skills put needs --file <an existing file>, got "${file ?? ''}".`, 2);
    const dst = agent ? path.join(root, to.rel) : path.join(root, 'skills', to.skill, to.rel);
    if (!agent && !fs.existsSync(path.join(root, 'skills', to.skill))) throw new Stop(`There is no skill ${to.skill}.`);
    s.record(fs.existsSync(dst) ? 'rewrite' : 'create', dst, `from ${path.basename(file)}`);
    if (!s.dry) {
      s.save(dst);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(file, dst);
    }
  } else if (sub === 'remove') {
    // A whole skill (--name) or one leaf file or folder of it (--leaf), backed up first.
    const leaf = one(a, 'leaf') ? leafOf(one(a, 'leaf'), 'skills remove --leaf') : undefined;
    const name = leaf ? leaf.skill : skillName(one(a, 'name'), 'skills remove --name');
    const dir = path.join(root, 'skills', name);
    const target = leaf ? path.join(dir, leaf.rel) : dir;
    if (!fs.existsSync(target)) throw new Stop(`There is no ${leaf ? `${name}/${leaf.rel}` : `skill ${name}`} under ${path.join(root, 'skills')}.`);
    const files = fs.statSync(target).isDirectory() ? filesUnder(target).map(f => path.join(target, f)) : [target];
    for (const f of files) {
      s.record('remove', f, 'backed up, then deleted');
      s.save(f);
    }
    if (!s.dry) fs.rmSync(target, { recursive: true, force: true });
    const ref = leaf ? new RegExp(`(?<![\\w-])${escape(`${name}/${leaf.rel}`)}`, 'g') : skillRef(name);
    for (const f of textFiles(a, root)) {
      const n = fs.existsSync(f) ? (fs.readFileSync(f, 'utf8').match(ref)?.length ?? 0) : 0;
      if (n) s.record('check', f, `still mentions ${leaf ? `${name}/${leaf.rel}` : name} ${n} time${n > 1 ? 's' : ''}`);
    }
  } else if (sub === 'repoint') {
    const from = skillName(one(a, 'from'), 'skills repoint --from');
    const to = skillName(one(a, 'to'), 'skills repoint --to');
    const only = [...list(a, 'skills').map(n => path.join(root, 'skills', n)), ...list(a, 'agents').map(n => path.join(root, 'agents', `${n}.md`))];
    const own = path.join(root, 'skills', from) + path.sep;
    const files = textFiles(a, root).filter(f => !f.startsWith(own) && (!only.length || only.some(o => f === o || f.startsWith(o + path.sep))));
    s.replace(files, skillRef(from), to);
    if (!s.changes.length) throw new Stop(`Nothing refers to ${from}.`);
  } else throw new Stop('skills needs move, split, put, remove or repoint. Run with --help.', 2);
  const out: SkillsOut = { op: sub as SkillsOut['op'], changes: s.changes, backup: s.backup };
  emit(io, a, out, lines(out, s.dry), !s.dry);
  return 0;
}
