import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { backupStamp } from './harness';
import { Args, Io, Stop, emit, headline, list, one, table } from './cli-core';
import { catalogOf } from './hunt-market';
import { rewriteSkillPaths } from './skill-paths';

// `skills move`, `skills split` and `skills repoint`: reorganise skills under a Claude folder (leaf files between skills, a part of a skill into a new one) and keep the references pointing at the right place.

export interface SkillChange {
  action: 'move' | 'create' | 'rewrite' | 'remove' | 'rename' | 'check';
  file: string;
  detail: string;
}

export interface SkillsOut {
  op: 'move' | 'split' | 'put' | 'remove' | 'repoint' | 'rename' | 'fix-paths';
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

/** A leaf as `skill/relative/path.md`; the skill may carry its plugin, `plugin:skill/relative/path.md`. */
function leafOf(text: string | undefined, what: string): { skill: string; rel: string } {
  const i = (text ?? '').indexOf('/');
  if (i < 1 || i === text!.length - 1 || text!.split('/').includes('..') || !/^(?:[\w][\w.-]*:)?[\w][\w.-]*$/.test(text!.slice(0, i)))
    throw new Stop(`${what} needs <skill>/<relative path>, e.g. media-generation/references/film-project.md.`, 2);
  return { skill: text!.slice(0, i), rel: text!.slice(i + 1) };
}

/** The Markdown files of the root's skills and agents (and of `more` folders under it), and of the market's plugins with --market. */
function textFiles(a: Args, root: string, more: string[] = []): string[] {
  const files: string[] = [];
  // Claude.ai manages and overwrites the synced skills; nothing there is ours to rewrite.
  const synced = path.join(root, 'skills', 'synced');
  const walk = (dir: string) => {
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (f !== synced) walk(f);
      } else if (/\.md$/i.test(e.name)) files.push(f);
    }
  };
  walk(path.join(root, 'skills'));
  walk(path.join(root, 'agents'));
  for (const m of more) walk(path.join(root, m));
  const market = one(a, 'market');
  if (market) walk(path.resolve(market));
  return files;
}

export const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const skillRef = (name: string) => new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w-])`, 'g');

/** A skill's folder; `plugin` is the folder name of the market plugin that ships it, absent for the root's. */
interface SkillAt {
  name: string;
  dir: string;
  plugin?: string;
}

/** Every folder that holds a skill of that name: the root's first, then each plugin of --market that ships one. */
function skillDirs(a: Args, root: string, name: string): Omit<SkillAt, 'name'>[] {
  const out: Omit<SkillAt, 'name'>[] = [];
  const own = path.join(root, 'skills', name);
  if (fs.existsSync(own) && fs.statSync(own).isDirectory()) out.push({ dir: own });
  const find = (dir: string) => {
    const skills = path.basename(dir) === 'skills';
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (skills && e.name === name) out.push({ dir: path.join(dir, e.name), plugin: path.basename(path.dirname(dir)) });
      // A skills folder holds skills; nothing below one is another plugin's.
      else if (!skills) find(path.join(dir, e.name));
    }
  };
  const market = one(a, 'market');
  if (market) find(path.join(path.resolve(market), 'plugins'));
  return out;
}

/** Whether an agent has this name, under the root or in a plugin of --market: then a bare `name` or `<plugin>:name` may be the agent. */
function hasAgent(a: Args, root: string, name: string): boolean {
  if (fs.existsSync(path.join(root, 'agents', `${name}.md`))) return true;
  const market = one(a, 'market');
  if (!market) return false;
  const plugins = path.join(path.resolve(market), 'plugins');
  const find = (dir: string): boolean =>
    (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []).some(e => {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'skills') return false;
      return e.name === 'agents' ? fs.existsSync(path.join(dir, e.name, `${name}.md`)) : find(path.join(dir, e.name));
    });
  return find(plugins);
}

/**
 * The places a skill name is a reference: `name` in backticks, `<plugin>:name`, `skills/name`, `name/references/...` and
 * `name/scripts/...`, a relative link target into the skill's folder (`](../name/...)`), and "name skill". Each alternative matches
 * only the name, so the replacement keeps what stands around it.
 */
function referencePattern(name: string): RegExp {
  const n = escape(name);
  return new RegExp(
    [
      `(?<=\`)${n}(?=\`)`,
      `(?<=(?<![\\w.-])[\\w][\\w.-]*:)${n}(?![\\w-])(?!:[\\w])`,
      `(?<=(?<![\\w-])skills[\\\\/])${n}(?![\\w.-])`,
      `(?<![\\w.:-])${n}(?=[\\\\/](?:references|scripts)[\\\\/])`,
      `(?<=\\]\\((?:\\.{1,2}\\/)*)${n}(?=[\\\\/])`,
      `(?<![\\w.:-])${n}(?=\`? [Ss]kill\\b)`,
    ].join('|'),
    'g'
  );
}

/**
 * Rewrites the reference forms of a skill name. A mention beside the word agent or on a subagent_type line is the agent of that name and
 * stays, and so does `agents/name.md`; with `agentToo` a bare `name` in backticks or a `<plugin>:name` stays too unless "skill" follows.
 */
export function rewriteRefs(text: string, from: string, to: string, agentToo = false): { text: string; hits: number } {
  let hits = 0;
  const next = text.replace(referencePattern(from), (m: string, offset: number, whole: string) => {
    const start = whole.lastIndexOf('\n', offset - 1) + 1;
    const stop = whole.indexOf('\n', offset);
    const line = whole.slice(start, stop < 0 ? undefined : stop);
    const before = whole.slice(start, offset);
    const after = whole.slice(offset + m.length, stop < 0 ? undefined : stop);
    const skill = /^`? [Ss]kill\b/.test(after);
    const agent = /subagent_type/i.test(line) || /^`?\s+(?:sub)?agents?\b/i.test(after) || /\b(?:sub)?agents?\s+`?$/i.test(before);
    if (!skill && (agent || (agentToo && (before.endsWith('`') || before.endsWith(':'))))) return m;
    hits++;
    return to;
  });
  return { text: next, hits };
}

/** Any mention of a name left after a rewrite, a `<plugin>:name` included. */
const mentionOf = (name: string) => new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w-])`);

/**
 * A skill named on the command line, under the root or in a plugin of --market; `<plugin>:<skill>` names a plugin's copy. A name found in
 * more than one place stops with the places listed.
 */
function skillAt(a: Args, root: string, text: string | undefined, what: string, missing?: string): SkillAt {
  const colon = (text ?? '').indexOf(':');
  const plugin = colon > 0 ? skillName(text!.slice(0, colon), what) : undefined;
  const name = skillName(colon > 0 ? text!.slice(colon + 1) : text, what);
  const found = skillDirs(a, root, name).filter(c => !plugin || c.plugin === plugin);
  if (!found.length) throw new Stop(missing ?? `There is no skill ${text} under ${path.join(root, 'skills')}${one(a, 'market') ? ` or in ${one(a, 'market')}` : ''}.`);
  if (found.length > 1) {
    const places = found.map(c => (c.plugin ? `${c.plugin}:${name} (${c.dir})` : c.dir)).join(', ');
    throw new Stop(`The skill ${name} is in more than one place: ${places}. Name a plugin's copy as <plugin>:${name}${found.some(c => !c.plugin) ? `, or leave out --market for the one under ${path.join(root, 'skills')}` : ''}.`);
  }
  return { name, ...found[0] };
}

export class Session {
  readonly changes: SkillChange[] = [];
  private readonly dir: string;
  private made = false;
  /** A file is backed up once per session, so a second write keeps the original. */
  private readonly saved = new Set<string>();
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
    if (this.dry || !fs.existsSync(file) || this.saved.has(file)) return;
    this.saved.add(file);
    const rel = path.relative(this.root, file);
    // A file outside the root, on another drive too, goes under outside/<drive>/ without the colon.
    const outside = rel.startsWith('..') || path.isAbsolute(rel);
    const drive = path.parse(file).root.replace(/[:\\/]/g, '');
    const target = path.join(this.dir, outside ? path.join('outside', drive, path.relative(path.parse(file).root, file)) : rel);
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
  /**
   * Rewrite every file with `change`, which returns the new text and how many references it changed; each line of the new text that
   * `left` still finds comes back as a check row.
   */
  rewrite(files: string[], change: (text: string, file: string) => { text: string; hits: number }, to: string, left: RegExp) {
    const hit: { f: string; next: string; hits: number }[] = [];
    for (const f of files) {
      if (!fs.existsSync(f)) continue;
      const r = change(fs.readFileSync(f, 'utf8'), f);
      if (r.hits) hit.push({ f, next: r.text, hits: r.hits });
      r.text.split(/\r?\n/).forEach((l, i) => {
        const t = l.trim();
        if (left.test(l)) this.record('check', f, `line ${i + 1} still names it: ${t.length > 160 ? `${t.slice(0, 157)}...` : t}`);
      });
    }
    // Every backup first: a failure there writes nothing.
    for (const h of hit) this.save(h.f);
    for (const h of hit) {
      this.record('rewrite', h.f, `${h.hits} reference${h.hits > 1 ? 's' : ''} to ${to}`);
      this.write(h.f, h.next);
    }
  }
  /** Replace text in every file but the skipped ones; `into` gives the replacement per file and the pattern's first group instead of `to`. */
  replace(files: string[], pattern: RegExp, to: string, skip: string[] = [], into?: (file: string, first: string | undefined) => string) {
    const hit: { f: string; text: string; hits: number }[] = [];
    for (const f of files) {
      if (skip.includes(f) || !fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      const hits = text.match(pattern)?.length ?? 0;
      if (hits) hit.push({ f, text, hits });
    }
    // Every backup first: a failure there writes nothing.
    for (const h of hit) this.save(h.f);
    for (const { f, text, hits } of hit) {
      this.record('rewrite', f, `${hits} reference${hits > 1 ? 's' : ''} to ${to}`);
      this.write(f, into ? text.replace(pattern, (_m: string, first: string | undefined) => into(f, first)) : text.replace(pattern, to));
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

/** A path written from the home folder to the global skills: `~/.claude/skills/`, `$HOME/...`, `%USERPROFILE%\...`. */
const HOME_SKILLS = String.raw`(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[\\/]\.claude[\\/]skills[\\/]`;

/** Moves a leaf of one skill to another, each under the root or in a plugin of --market, and repoints the mentions of its old place. */
function moveLeaf(s: Session, root: string, from: SkillAt, rel: string, to: SkillAt, toRel: string) {
  const src = path.join(from.dir, rel);
  const dst = path.join(to.dir, toRel);
  if (!fs.existsSync(src)) throw new Stop(`There is no ${from.name}/${rel} in ${from.dir}.`);
  if (fs.statSync(src).isDirectory()) {
    for (const f of filesUnder(src)) moveLeaf(s, root, from, `${rel}/${f}`, to, `${toRel}/${f}`);
    if (!s.dry) fs.rmSync(src, { recursive: true, force: true });
    return;
  }
  if (fs.existsSync(dst)) {
    // The destination already holds the same file: the source is only dropped.
    if (!fs.readFileSync(src).equals(fs.readFileSync(dst))) throw new Stop(`${to.name}/${toRel} exists already and differs from ${from.name}/${rel}.`);
    s.record('move', src, `${to.name}/${toRel} holds the same file, source dropped`);
    s.save(src);
    if (!s.dry) fs.rmSync(src);
  } else {
    s.record('move', src, `to ${to.name}/${toRel}`);
    s.move(src, dst);
  }
  const files = textFiles(s.a, root);
  // Inside the old skill the leaf was named relatively (or as <this skill>/...); those rows now point nowhere.
  const oldSkill = from.dir + path.sep;
  for (const f of files.filter(x => x.startsWith(oldSkill) && fs.existsSync(x))) {
    if (new RegExp(`(?:<this skill>/|(?<![\\w/-]))${escape(rel)}`).test(fs.readFileSync(f, 'utf8'))) s.record('check', f, `still names ${rel}, which moved to ${to.name}`);
  }
  if (!to.plugin) {
    s.replace(files, new RegExp(`(?<![\\w-])${escape(`${from.name}/${rel}`)}`, 'g'), `${to.name}/${toRel}`, [dst]);
    return;
  }
  // A plugin's skill has no ~/.claude/skills folder: an absolute mention becomes <this skill>/... inside the target skill, as its own
  // files name it, and <skill>/... everywhere else.
  const inside = (to.dir + path.sep).toLowerCase();
  s.replace(files, new RegExp(`(${HOME_SKILLS})?(?<![\\w-])${escape(`${from.name}/${rel}`)}`, 'g'), `${to.name}/${toRel}`, [dst], (f, home) =>
    home && f.toLowerCase().startsWith(inside) ? `<this skill>/${toRel}` : `${to.name}/${toRel}`
  );
}

/**
 * `skills fix-paths`: in the skills of the market's plugins (or one plugin), an absolute path to a global skill folder becomes the form a
 * plugin skill uses. Its own folder becomes `<this skill>`, another skill that ships in exactly one plugin of the market
 * `<plugin:skill>`; a skill that still exists under the root keeps its path. Only Markdown is rewritten; the rest, a script's path
 * included, comes back as check rows.
 */
function fixPaths(s: Session, a: Args, root: string): void {
  const market = one(a, 'market');
  if (!market) throw new Stop('skills fix-paths needs --market <dir>.', 2);
  const only = one(a, 'plugin');
  const plugins = catalogOf(path.resolve(market))
    .filter(e => e.name && typeof e.source === 'string' && e.source.startsWith('./'))
    .map(e => ({ name: e.name!, dir: path.resolve(market, e.source as string) }));
  if (only && !plugins.some(p => p.name === only)) throw new Stop(`${market} has no plugin called ${only}.`);
  const skillsOf = (dir: string) =>
    (fs.existsSync(path.join(dir, 'skills')) ? fs.readdirSync(path.join(dir, 'skills'), { withFileTypes: true }) : [])
      .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, 'skills', e.name, 'SKILL.md')))
      .map(e => e.name);
  // Which plugins of the market ship each skill name.
  const ships = new Map<string, string[]>();
  for (const p of plugins) for (const n of skillsOf(p.dir)) ships.set(n, [...(ships.get(n) ?? []), p.name]);
  const global = (n: string) => fs.existsSync(path.join(root, 'skills', n, 'SKILL.md'));
  for (const p of plugins.filter(x => !only || x.name === only))
    for (const skill of skillsOf(p.dir)) {
      const dir = path.join(p.dir, 'skills', skill);
      const decide = (n: string): string | null | undefined => {
        if (n === skill) return '<this skill>';
        if (global(n)) return null;
        const by = ships.get(n) ?? [];
        return by.length === 1 ? `<${by[0]}:${n}>` : undefined;
      };
      const why = (n: string, md: boolean) => {
        if (!md) return `a script names ${n}'s global folder`;
        const by = ships.get(n) ?? [];
        return by.length > 1 ? `${n} ships in ${by.join(' and ')}` : `${n} is not a skill under ${path.join(root, 'skills')} or in the market`;
      };
      for (const rel of filesUnder(dir)) {
        const file = path.join(dir, rel);
        if (!/\.(md|mdx|txt|json|ya?ml|py|ps1|sh|mjs|cjs|js|ts)$/i.test(rel) || fs.statSync(file).size > 512 * 1024) continue;
        const md = /\.md$/i.test(rel);
        const r = rewriteSkillPaths(fs.readFileSync(file, 'utf8'), n => (md ? decide(n) : decide(n) === null ? null : undefined));
        for (const l of r.left) s.record('check', file, `line ${l.line}, ${why(l.name, md)}: ${l.text.length > 160 ? `${l.text.slice(0, 157)}...` : l.text}`);
        if (!r.hits) continue;
        s.record('rewrite', file, `${r.hits} absolute ${r.hits === 1 ? 'path' : 'paths'} to <this skill> or <plugin:skill>`);
        s.write(file, r.text);
      }
    }
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
    const leaf = leafOf(one(a, 'leaf'), 'skills move --leaf');
    const from = skillAt(a, root, leaf.skill, 'skills move --leaf');
    const to = (one(a, 'to') ?? '').split('/');
    const target = skillAt(a, root, to[0], 'skills move --to', `There is no skill ${to[0]}. Create it with skills split.`);
    moveLeaf(s, root, from, leaf.rel, target, to.slice(1).join('/') || leaf.rel);
  } else if (sub === 'split') {
    const source = skillAt(a, root, one(a, 'from'), 'skills split --from');
    const from = source.name;
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
      for (const l of leaves) moveLeaf(s, root, source, l, { name, dir }, l);
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
    // The skill is the root's or, with --market, a plugin's, found as skills move finds it.
    const dst = agent ? path.join(root, to.rel) : path.join(skillAt(a, root, to.skill, 'skills put --to', `There is no skill ${to.skill}.`).dir, to.rel);
    s.record(fs.existsSync(dst) ? 'rewrite' : 'create', dst, `from ${path.basename(file)}`);
    if (!s.dry) {
      s.save(dst);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(file, dst);
    }
  } else if (sub === 'remove') {
    // A whole skill (--name), a stray folder with no SKILL.md, or one leaf file or folder of a skill (--leaf), backed up first.
    // --repo takes it from the repo's .claude/skills instead of the root's skills.
    // Without --repo the skill is the root's or, with --market, a plugin's, found as skills move finds it.
    const leaf = one(a, 'leaf') ? leafOf(one(a, 'leaf'), 'skills remove --leaf') : undefined;
    const what = leaf ? 'skills remove --leaf' : 'skills remove --name';
    const repo = one(a, 'repo') ? path.resolve(one(a, 'repo')!) : undefined;
    const skills = repo ? path.join(repo, '.claude', 'skills') : path.join(root, 'skills');
    const at = repo ? { name: skillName(leaf ? leaf.skill : one(a, 'name'), what), dir: '' } : skillAt(a, root, leaf ? leaf.skill : one(a, 'name'), what);
    const name = at.name;
    const dir = repo ? path.join(skills, name) : at.dir;
    const target = leaf ? path.join(dir, leaf.rel) : dir;
    if (!fs.existsSync(target)) throw new Stop(`There is no ${leaf ? `${name}/${leaf.rel}` : `skill ${name}`} under ${repo ? skills : path.dirname(dir)}.`);
    const files = fs.statSync(target).isDirectory() ? filesUnder(target).map(f => path.join(target, f)) : [target];
    const stray = !leaf && !fs.existsSync(path.join(dir, 'SKILL.md'));
    for (const f of files) {
      s.record('remove', f, `${stray ? 'stray, no SKILL.md: ' : ''}backed up, then deleted`);
      s.save(f);
    }
    if (!files.length) s.record('remove', target, 'empty folder, deleted');
    if (!s.dry) fs.rmSync(target, { recursive: true, force: true });
    const ref = leaf ? new RegExp(`(?<![\\w-])${escape(`${name}/${leaf.rel}`)}`, 'g') : skillRef(name);
    const repoFiles = repo ? [path.join(repo, 'CLAUDE.md'), ...textFiles(a, path.join(repo, '.claude'), ['rules'])] : [];
    for (const f of new Set([...textFiles(a, root), ...repoFiles])) {
      const n = fs.existsSync(f) ? (fs.readFileSync(f, 'utf8').match(ref)?.length ?? 0) : 0;
      if (n) s.record('check', f, `still mentions ${leaf ? `${name}/${leaf.rel}` : name} ${n} time${n > 1 ? 's' : ''}`);
    }
  } else if (sub === 'repoint') {
    const from = skillName(one(a, 'from'), 'skills repoint --from');
    // --to may carry a plugin prefix (plugin:skill), the form a skill takes once it ships in a plugin.
    const toText = one(a, 'to') ?? '';
    const colon = toText.indexOf(':');
    const to = colon > 0 ? `${skillName(toText.slice(0, colon), 'skills repoint --to plugin')}:${skillName(toText.slice(colon + 1), 'skills repoint --to')}` : skillName(toText, 'skills repoint --to');
    const only = [...list(a, 'skills').map(n => path.join(root, 'skills', n)), ...list(a, 'agents').map(n => path.join(root, 'agents', `${n}.md`))];
    // The skill's own folder and every plugin folder of --market that ships it (or ships the --to skill) name it as their own.
    const shipping = [...skillDirs(a, root, from), ...(colon > 0 ? skillDirs(a, root, to.slice(colon + 1)).filter(c => c.plugin === to.slice(0, colon)) : [])]
      .filter(c => c.plugin)
      .map(c => path.dirname(path.dirname(c.dir)));
    const own = [path.join(root, 'skills', from), ...shipping].map(d => d.toLowerCase() + path.sep);
    const files = textFiles(a, root).filter(f => !own.some(o => f.toLowerCase().startsWith(o)) && (!only.length || only.some(o => f === o || f.startsWith(o + path.sep))));
    if (colon > 0) {
      // A name already behind a plugin prefix is not repointed again, so a second run changes nothing.
      s.replace(files, new RegExp(`(?<![\\w.:-])${escape(from)}(?![\\w-])`, 'g'), to);
      if (!s.changes.length) throw new Stop(`Nothing refers to ${from}.`);
    } else {
      // To a plain name only the reference forms change; every other mention comes back as a check row.
      const agentToo = hasAgent(a, root, from);
      s.rewrite(files, text => rewriteRefs(text, from, to, agentToo), to, mentionOf(from));
      const checks = s.changes.length;
      if (!s.changes.some(c => c.action === 'rewrite')) throw new Stop(`Nothing refers to ${from} in a form repoint rewrites${checks ? `; ${checks} ${checks === 1 ? 'line still names' : 'lines still name'} it` : ''}.`);
    }
  } else if (sub === 'rename') {
    const at = skillAt(a, root, one(a, 'from'), 'skills rename --from');
    const from = at.name;
    const to = skillName(one(a, 'to'), 'skills rename --to');
    const dir = at.dir;
    const dst = path.join(path.dirname(dir), to);
    if (fs.existsSync(dst)) throw new Stop(`Skill ${to} exists already beside ${from}.`);
    s.save(path.join(dir, 'SKILL.md'));
    // Only the reference forms change, the skill's own files included, and its own name: line; every other mention, and an agent of the
    // same name, comes back as a check row.
    const md = path.join(dir, 'SKILL.md');
    const agentToo = hasAgent(a, root, from);
    s.rewrite(
      textFiles(a, root),
      (text, file) => {
        const r = rewriteRefs(text, from, to, agentToo);
        const front = file === md ? /^(---\r?\n[\s\S]*?^name:[ \t]*)(.+?)([ \t]*\r?$)/m.exec(r.text) : null;
        return front && front[2] !== to ? { text: r.text.replace(front[0], `${front[1]}${to}${front[3]}`), hits: r.hits + 1 } : r;
      },
      to,
      mentionOf(from)
    );
    s.record('rename', dir, `to ${to}`);
    if (!s.dry) fs.renameSync(dir, dst);
  } else if (sub === 'fix-paths') {
    fixPaths(s, a, root);
  } else throw new Stop('skills needs move, split, put, remove, repoint, rename or fix-paths. Run with --help.', 2);
  const out: SkillsOut = { op: sub as SkillsOut['op'], changes: s.changes, backup: s.backup };
  emit(io, a, out, lines(out, s.dry), !s.dry);
  return 0;
}
