import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Args, Io, Stop, emit, headline, one, table, winPath } from './cli-core';
import { pluginDirs } from './harness';
import { findPython, run, runScript } from './standard';

// `media doctor <dir>`: checks a film or images folder under assets/films or assets/images.
// Read-only: it never writes, moves or deletes.

export type Kind = 'film' | 'images';

export interface Problem {
  check: string;
  path: string;
  line?: number;
  detail: string;
}

export interface Output {
  file: string;
  version: number;
  seconds: number | null;
  size: string | null;
  fps: number | null;
  changelog: string | null;
}

interface Probe {
  seconds?: number;
  size?: string;
  fps?: number;
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** Everything the doctor asks outside its folder. Tests pass stubs; the command passes the real ones. */
export interface Tools {
  python: () => Promise<string[] | undefined>;
  plugin: (name: string, rel: string) => string | undefined;
  script: (py: string[], file: string, args: string[]) => Promise<Result>;
  probe: (file: string) => Promise<Probe | undefined>;
  git: (args: string[], cwd: string) => Promise<Result>;
}

const PLUGIN_SCRIPT: Record<Kind, [string, string]> = {
  film: ['film-producer', 'skills/video-creation/scripts/media-project.py'],
  images: ['image-artist', 'skills/image-generation/scripts/media-project.py'],
};
const LAYOUT = new Set(['story', 'changelog', 'rig', 'media', 'scripts']);
// Video and audio outputs carry the naming rule; .wav is never an output, only a work file.
const OUTPUT_EXT = new Set(['.mp4', '.mov', '.webm', '.mp3', '.m4a', '.wav']);
// The binary types the media storage block sends to Git LFS (media-project.py LFS_EXT); SVG, HTML and other text stay plain Git.
const LFS_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.webm', '.wav', '.mp3', '.m4a']);
const SCRIPT_EXT = new Set(['.py', '.mjs', '.js', '.ts', '.ps1']);
const SKIP_DIRS = new Set(['__pycache__', 'node_modules', 'out']);
const SCRATCH = /temp[\\/]claude[\\/]/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function kindOf(dir: string): Kind | undefined {
  const up = path.dirname(path.resolve(dir));
  const area = `${path.basename(path.dirname(up))}/${path.basename(up)}`.toLowerCase();
  return area === 'assets/films' ? 'film' : area === 'assets/images' ? 'images' : undefined;
}

export function realTools(root: string): Tools {
  return {
    python: findPython,
    plugin: (name, rel) => {
      const found = pluginDirs(root, true).find(p => p.plugin === name && fs.existsSync(path.join(p.dir, rel)));
      return found && path.join(found.dir, rel);
    },
    script: (py, file, args) => runScript(py, file, args),
    probe: probeFile,
    git: (args, cwd) => run('git', args, cwd),
  };
}

async function probeFile(file: string): Promise<Probe | undefined> {
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', file]);
  if (r.code !== 0) return undefined;
  try {
    const data = JSON.parse(r.stdout);
    const stream = data.streams?.[0] ?? {};
    const [num, den] = String(stream.r_frame_rate ?? '0/1').split('/').map(Number);
    const seconds = Number(data.format?.duration);
    return {
      seconds: Number.isFinite(seconds) ? Math.round(seconds * 100) / 100 : undefined,
      size: stream.width && stream.height ? `${stream.width}x${stream.height}` : undefined,
      fps: den ? Math.round((num / den) * 100) / 100 : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Entry point of `media doctor`: the folder comes after `doctor`; exit 1 with problems, 2 for bad arguments. */
export async function mediaCommand(a: Args, io: Io): Promise<number> {
  return doctorCommand(a, io, realTools(one(a, 'root') ?? path.join(os.homedir(), '.claude')));
}

export async function doctorCommand(a: Args, io: Io, tools: Tools): Promise<number> {
  const word = a.words[a.words.indexOf('doctor') + 1];
  if (!word) throw new Stop('media doctor needs a folder: media doctor <dir>', 2);
  const dir = path.resolve(winPath(word));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Stop(`${word} is not a folder`, 2);
  const kind = kindOf(dir);
  if (!kind) throw new Stop(`${word} is not under assets/films or assets/images`, 2);
  const { problems, outputs } = await diagnose(dir, kind, tools);
  const text = [headline(`Media doctor · ${path.basename(dir)} · ${kind} · ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}`), ''];
  text.push(...(problems.length ? table(['Check', 'Path', 'Line', 'Problem'], problems.map(p => [p.check, p.path, p.line ?? '', shorten(p.detail)]), [false, false, true, false]) : ['No problems.']));
  if (outputs.some(o => o.seconds !== null || o.size !== null || o.fps !== null)) {
    text.push('', ...table(['Output', 'Version', 'Seconds', 'Size', 'FPS', 'Changelog'], outputs.map(o => [o.file, o.version, o.seconds ?? '', o.size ?? '', o.fps ?? '', o.changelog ?? '']), [false, true, true, true, true, false]));
  }
  emit(io, a, { dir, kind, problems, outputs }, text);
  return problems.length ? 1 : 0;
}

/** A table cell: the stem problem keeps its count and drops its file list (the JSON keeps it); long details are cut. */
function shorten(detail: string): string {
  const short = / use(s)? the stem /.test(detail) ? detail.replace(/: .*$/, '') : detail;
  return short.length > 100 ? `${short.slice(0, 99)}…` : short;
}

export async function diagnose(dir: string, kind: Kind, tools: Tools): Promise<{ problems: Problem[]; outputs: Output[] }> {
  const problems: Problem[] = [];
  const top = await repoRoot(dir, tools);
  await layout(dir, kind, tools, problems);
  references(dir, top, problems);
  const { outputs, named } = await outputChecks(dir, tools, problems);
  await storage(dir, top, tools, named, problems);
  return { problems, outputs };
}

async function repoRoot(dir: string, tools: Tools): Promise<string | undefined> {
  const r = await tools.git(['rev-parse', '--show-toplevel'], dir);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

async function layout(dir: string, kind: Kind, tools: Tools, problems: Problem[]): Promise<void> {
  const [plugin, rel] = PLUGIN_SCRIPT[kind];
  const script = tools.plugin(plugin, rel);
  if (!script) {
    problems.push({ check: 'layout', path: dir, detail: `No ${plugin} plugin has ${rel}, so the layout check did not run.` });
    return;
  }
  const py = await tools.python();
  if (!py) {
    problems.push({ check: 'layout', path: dir, detail: 'Python 3 is not on PATH, so the layout check did not run.' });
    return;
  }
  const r = await tools.script(py, script, ['inventory', dir, '--kind', kind, '--json']);
  let res: { moves?: { from: string; to: string; reason: string }[]; unplaced?: { path: string; reason: string }[] };
  try {
    res = JSON.parse(r.stdout);
  } catch {
    problems.push({ check: 'layout', path: dir, detail: r.stderr.trim() || `The inventory printed no JSON (exit ${r.code}).` });
    return;
  }
  for (const m of res.moves ?? []) problems.push({ check: 'layout', path: m.from, detail: `moves to ${m.to} (${m.reason})` });
  for (const u of res.unplaced ?? []) problems.push({ check: 'layout', path: u.path, detail: u.reason });
}

/** Every file in a folder, optionally with its subfolders; the skipped folders never hold a project's own paths. */
function files(dir: string, recursive: boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return recursive && !SKIP_DIRS.has(e.name) ? files(full, true) : [];
    return e.isFile() ? [full] : [];
  });
}

const rel = (dir: string, file: string) => path.relative(dir, file).split(path.sep).join('/');

/** The quoted literals of a script line, or the backtick spans of a changelog line. */
function literals(text: string, md: boolean): string[] {
  const re = md ? /`([^`]*)`/g : /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`]*)`/g;
  return [...text.matchAll(re)].map(m => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\\\/g, '\\'));
}

/** Where a literal may point: absolute as written, or relative to the film folder or the repo root. */
function targets(dir: string, top: string | undefined, p: string): string[] {
  if (/[{}$%*?<>|]/.test(p) || SCRATCH.test(p)) return [];
  if (/^[A-Za-z]:[\\/]/.test(p)) return [p];
  const clean = p.replace(/^\.[\\/]/, '');
  if (!/[\\/]/.test(clean) || !LAYOUT.has(clean.split(/[\\/]/)[0])) return [];
  return top ? [path.join(dir, clean), path.join(top, clean)] : [path.join(dir, clean)];
}

function references(dir: string, top: string | undefined, problems: Problem[]): void {
  const media = path.join(dir, 'media');
  const sources = [
    ...files(dir, true).filter(f => !f.startsWith(media + path.sep) && SCRIPT_EXT.has(path.extname(f).toLowerCase())),
    ...files(path.join(dir, 'changelog'), false).filter(f => f.endsWith('.md')),
  ];
  for (const file of sources) {
    const md = file.endsWith('.md');
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((text, i) => {
      for (const literal of literals(text, md)) {
        const found = targets(dir, top, literal);
        if (found.length && !found.some(t => fs.existsSync(t))) problems.push({ check: 'references', path: rel(dir, file), line: i + 1, detail: `points at ${literal}, which does not exist` });
      }
    });
  }
}

/** The numbers a changelog states; a number counts only when the changelog states exactly one value of it. */
function claims(text: string): Probe {
  const sole = <T>(xs: T[]) => (new Set(xs).size === 1 ? xs[0] : undefined);
  return {
    seconds: sole([...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/gi)].map(m => Number(m[1]))),
    size: sole([...text.matchAll(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/gi)].map(m => `${m[1]}x${m[2]}`)),
    fps: sole([...text.matchAll(/(\d+(?:\.\d+)?)\s*fps\b/gi)].map(m => Number(m[1]))),
  };
}

async function outputChecks(dir: string, tools: Tools, problems: Problem[]): Promise<{ outputs: Output[]; named: string[] }> {
  const film = path.basename(dir);
  const outDir = path.join(dir, 'media', 'output');
  const names = files(outDir, false).map(f => path.basename(f));
  const nameRe = new RegExp(`^${esc(film)}-v(\\d+)(-silent|-draft\\d+|-no-intro)?\\.(mp4|mov|webm|mp3|m4a)$`);
  const changelog = new Map<number, { file: string; text: string }>();
  for (const f of files(path.join(dir, 'changelog'), false)) {
    const m = /^v(\d+)\.md$/.exec(path.basename(f));
    if (m) changelog.set(Number(m[1]), { file: f, text: fs.readFileSync(f, 'utf8') });
  }

  const outputs: Output[] = [];
  const stems = new Map<string, string[]>();
  const unversioned: string[] = [];
  for (const name of names) {
    const where = `media/output/${name}`;
    const ext = path.extname(name).toLowerCase();
    if (!OUTPUT_EXT.has(ext)) continue;
    if (ext === '.wav') {
      problems.push({ check: 'outputs', path: where, detail: 'audio work file in the output folder' });
      continue;
    }
    const m = nameRe.exec(name);
    if (!m) {
      const stem = name.replace(/\.[^.]+$/, '').replace(/(-v\d+|-draft\d+|-silent|-no-intro)+$/i, '');
      if (stem === film) unversioned.push(name);
      else stems.set(stem, [...(stems.get(stem) ?? []), name]);
      continue;
    }
    const version = Number(m[1]);
    const cl = changelog.get(version);
    const probed = await tools.probe(path.join(outDir, name));
    if (probed && !m[2] && cl) {
      const said = claims(cl.text);
      if (said.seconds !== undefined && probed.seconds !== undefined && Math.abs(said.seconds - probed.seconds) > 0.5)
        problems.push({ check: 'outputs', path: where, detail: `changelog says ${said.seconds} s, the file is ${probed.seconds} s` });
      if (said.size !== undefined && probed.size !== undefined && said.size !== probed.size)
        problems.push({ check: 'outputs', path: where, detail: `changelog says ${said.size}, the file is ${probed.size}` });
      if (said.fps !== undefined && probed.fps !== undefined && Math.abs(said.fps - probed.fps) > 0.5)
        problems.push({ check: 'outputs', path: where, detail: `changelog says ${said.fps} fps, the file is ${probed.fps} fps` });
    }
    if (!cl) problems.push({ check: 'outputs', path: where, detail: `no changelog/v${version}.md` });
    outputs.push({
      file: name,
      version,
      seconds: probed?.seconds ?? null,
      size: probed?.size ?? null,
      fps: probed?.fps ?? null,
      changelog: cl ? rel(dir, cl.file) : null,
    });
  }

  for (const [stem, list] of stems) {
    const n = list.length;
    problems.push({ check: 'outputs', path: 'media/output', detail: `${n} ${n === 1 ? 'output uses' : 'outputs use'} the stem ${stem}, not ${film}: ${list.join(', ')}` });
  }
  if (unversioned.length) problems.push({ check: 'outputs', path: 'media/output', detail: `not versioned as ${film}-v<N>.mp4: ${unversioned.join(', ')}` });

  const named: string[] = [];
  for (const [version, cl] of changelog) {
    const where = rel(dir, cl.file);
    // An output is named by its v<N> whatever its stem, so a wrong stem is reported once above, not here.
    const outs = [...new Set(cl.text.match(/[\w.-]*-v\d+[\w-]*\.mp4/g) ?? [])].filter(n => Number(/-v(\d+)/.exec(n)![1]) === version);
    if (!outs.length) problems.push({ check: 'outputs', path: where, detail: 'names no output' });
    for (const n of outs) {
      if (names.includes(n)) named.push(n);
      else problems.push({ check: 'outputs', path: where, detail: `names media/output/${n}, which does not exist` });
    }
  }
  return { outputs, named };
}

function startsAsPointer(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(40);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8', 0, n).startsWith('version https://git-lfs');
  } finally {
    fs.closeSync(fd);
  }
}

async function storage(dir: string, top: string | undefined, tools: Tools, named: string[], problems: Problem[]): Promise<void> {
  if (!top) return;
  // A film git ignores as a whole (claude-harness ignores /assets/*) has nothing in git, so there is no storage to check.
  const folder = path.relative(top, dir).split(path.sep).join('/');
  if ((await tools.git(['check-ignore', '-q', '--', folder], dir)).code === 0) return;
  const media = files(path.join(dir, 'media'), true).filter(f => LFS_EXT.has(path.extname(f).toLowerCase()));
  const all = media.map(f => rel(dir, f));
  // Files git ignores are never committed, so they are not checked; the rest are tracked or would be.
  const ignored = new Set<string>();
  for (let i = 0; i < all.length; i += 100) {
    const r = await tools.git(['check-ignore', '--', ...all.slice(i, i + 100)], dir);
    for (const line of r.stdout.split(/\r?\n/)) if (line.trim()) ignored.add(line.trim());
  }
  const kept = all.map((p, i) => ({ p, file: media[i] })).filter(k => !ignored.has(k.p));
  const attributes = path.join(top, '.gitattributes');
  const lfs = fs.existsSync(attributes) && /filter=lfs/.test(fs.readFileSync(attributes, 'utf8'));
  if (!lfs && kept.length) {
    problems.push({ check: 'storage', path: '.gitattributes', detail: `no Git LFS rule, so ${kept.length} media file(s) would be stored as plain Git files` });
  }
  if (lfs) {
    for (let i = 0; i < kept.length; i += 100) {
      const chunk = kept.slice(i, i + 100).map(k => k.p);
      const r = await tools.git(['check-attr', '-z', 'filter', '--', ...chunk], dir);
      const fields = r.stdout.split('\0');
      for (let j = 0; j + 2 < fields.length; j += 3) {
        if (fields[j + 2] !== 'lfs') problems.push({ check: 'storage', path: fields[j], detail: `not stored in Git LFS (filter: ${fields[j + 2]})` });
      }
    }
  }
  for (const k of kept) {
    if (startsAsPointer(k.file)) problems.push({ check: 'storage', path: k.p, detail: 'a Git LFS pointer that was never pulled' });
  }
  for (const n of named) {
    const where = `media/output/${n}`;
    const ignored = await tools.git(['check-ignore', '-q', '--', where], dir);
    if (ignored.code === 0) problems.push({ check: 'storage', path: where, detail: 'a changelog names it and git ignores it' });
  }
}
