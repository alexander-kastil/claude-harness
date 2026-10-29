import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Args, Io, Stop, one } from './cli-core';
import { marketplacePlugins, pluginDirs } from './harness';
import { HOOK_EVENTS, KNOWN_MODELS, KNOWN_TOOLS } from './cli-build';
import { projectSlug } from './fleet';
import { readMarkets } from './hunt-market';
import { isPrompt, promptText } from './sessions';

// `complete`: the candidates for the word at the cursor. The shell completers that `completion` prints call it per Tab with the line.

/** Where a value comes from: a fixed list, or a lookup that the line's own flags narrow. `[]` is a value with no candidates. */
type Values = string[] | 'names' | 'skills' | 'agents' | 'session' | 'markets' | 'media' | 'plugins' | 'scripts' | 'tools';

export interface FlagSpec {
  name: string;
  /** Present when the flag takes a value; a switch has none. */
  takes?: Values;
}

export interface CommandSpec {
  /** The words after `harness`, as HELP names them. */
  path: string;
  flags: FlagSpec[];
  /** The one positional argument the command takes, when it completes. */
  positional?: Values;
}

export interface Candidate {
  text: string;
  kind: 'command' | 'flag' | 'value';
  description: string;
}

const REPO: FlagSpec = { name: 'repo', takes: [] };
const DRY: FlagSpec = { name: 'dry-run' };
const SCOPE: FlagSpec = { name: 'scope', takes: ['repo', 'user'] };

/** The .harness scripts of the current folder and its harness folder. */
function scriptItems(): Item[] {
  return ['.', 'harness'].flatMap(dir => {
    const abs = path.resolve(dir);
    return fs.existsSync(abs) ? fs.readdirSync(abs).filter(f => f.endsWith('.harness')).map(f => ({ text: dir === '.' ? f : `${dir}/${f}`, description: 'script' })) : [];
  });
}
const HUNT: FlagSpec[] = [
  { name: 'name', takes: [] },
  { name: 'category', takes: [] },
  { name: 'skills', takes: 'skills' },
  { name: 'agents', takes: 'agents' },
  { name: 'market', takes: 'markets' },
  { name: 'description', takes: [] },
  { name: 'retire' },
  { name: 'files', takes: [] },
  { name: 'drop-files' },
];
const GLOBAL: FlagSpec[] = [{ name: 'root', takes: [] }, REPO, { name: 'repos', takes: [] }, { name: 'json' }, { name: 'help' }];
/** Flags that may repeat on one line; they are offered again after use. */
const REPEATABLE = new Set(['repo', 'repos', 'area', 'rule']);

/** Every command HELP names. A test keeps this table and HELP in step. */
export const COMMANDS: CommandSpec[] = [
  { path: 'inventory', flags: [REPO] },
  { path: 'consolidate', flags: [{ name: 'name', takes: 'names' }] },
  { path: 'consolidate retire', flags: [{ name: 'name', takes: 'names' }, { name: 'kind', takes: ['skill', 'agent'] }, { name: 'from', takes: [] }, DRY] },
  { path: 'hunt catalog', flags: [{ name: 'kind', takes: ['skill', 'agent'] }, { name: 'query', takes: [] }] },
  { path: 'hunt plan', flags: HUNT },
  { path: 'hunt create', flags: [...HUNT, DRY] },
  { path: 'agents list', flags: [] },
  { path: 'agents route', flags: [REPO] },
  { path: 'usage', flags: [{ name: 'session', takes: 'session' }, REPO, { name: 'week' }, { name: 'week-used', takes: [] }] },
  { path: 'delegation', flags: [{ name: 'session', takes: 'session' }, REPO] },
  { path: 'media doctor', flags: [], positional: 'media' },
  { path: 'skills move', flags: [{ name: 'leaf', takes: [] }, { name: 'to', takes: 'skills' }, { name: 'market', takes: [] }, DRY] },
  { path: 'skills split', flags: [{ name: 'from', takes: 'skills' }, { name: 'name', takes: [] }, { name: 'leaves', takes: [] }, { name: 'description', takes: [] }, { name: 'market', takes: [] }, DRY] },
  { path: 'skills put', flags: [{ name: 'file', takes: [] }, { name: 'to', takes: [] }, DRY] },
  { path: 'skills remove', flags: [{ name: 'name', takes: 'skills' }, { name: 'leaf', takes: [] }, { name: 'leaf', takes: [] },{ name: 'market', takes: [] }, DRY] },
  { path: 'skills repoint', flags: [{ name: 'from', takes: 'skills' }, { name: 'to', takes: 'skills' }, { name: 'skills', takes: 'skills' }, { name: 'agents', takes: 'agents' }, { name: 'market', takes: [] }, DRY] },
  { path: 'generate agent', flags: [SCOPE, { name: 'model', takes: KNOWN_MODELS }, { name: 'tools', takes: 'tools' }, { name: 'description', takes: [] }, { name: 'from', takes: [] }, DRY] },
  { path: 'generate rule', flags: [SCOPE, { name: 'paths', takes: [] }, { name: 'from', takes: [] }, DRY] },
  { path: 'generate skill', flags: [SCOPE, { name: 'description', takes: [] }, { name: 'from', takes: [] }, DRY] },
  { path: 'generate command', flags: [SCOPE, { name: 'description', takes: [] }, { name: 'from', takes: [] }, DRY] },
  { path: 'generate hook', flags: [SCOPE, { name: 'matcher', takes: [] }, { name: 'command', takes: [] }, DRY], positional: HOOK_EVENTS },
  { path: 'new', flags: [{ name: 'summary', takes: [] }, { name: 'area', takes: [] }, { name: 'rule', takes: [] }, DRY] },
  { path: 'update', flags: [REPO, DRY] },
  { path: 'generate mcp', flags: [SCOPE, { name: 'url', takes: [] }, { name: 'command', takes: [] }, { name: 'args', takes: [] }, { name: 'transport', takes: ['http', 'sse'] }, DRY] },
  { path: 'add', flags: [SCOPE, DRY], positional: 'plugins' },
  { path: 'validate', flags: [REPO], positional: 'scripts' },
  { path: 'run', flags: [DRY], positional: 'scripts' },
  { path: 'marketplaces', flags: [] },
  { path: 'marketplaces rename', flags: [{ name: 'from', takes: 'markets' }, { name: 'to', takes: [] }, DRY] },
  { path: 'check', flags: [REPO] },
  { path: 'check fix', flags: [REPO, DRY] },
  { path: 'fleet', flags: [] },
  { path: 'sync', flags: [REPO] },
  { path: 'sync apply', flags: [REPO, { name: 'name', takes: 'names' }, DRY] },
  { path: 'sync plugin', flags: [{ name: 'name', takes: [] }, DRY] },
  { path: 'sessions', flags: [REPO, { name: 'limit', takes: [] }] },
  { path: 'sessions rename', flags: [{ name: 'session', takes: 'session' }, { name: 'title', takes: [] }, REPO, DRY] },
  { path: 'mods', flags: [{ name: 'session', takes: 'session' }, REPO] },
  { path: 'time', flags: [REPO, { name: 'days', takes: [] }] },
  { path: 'lessons', flags: [REPO, { name: 'find', takes: [] }] },
  { path: 'sources', flags: [] },
  { path: 'sources check', flags: [] },
  { path: 'sources update', flags: [{ name: 'name', takes: 'skills' }, DRY] },
  { path: 'complete', flags: [{ name: 'line', takes: [] }, { name: 'position', takes: [] }] },
  { path: 'completion', flags: [], positional: ['powershell', 'bash'] },
];

const claudeRoot = (a: Args) => path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));
const repoDir = (a: Args) => path.resolve(one(a, 'repo') ?? process.cwd());

interface Item {
  text: string;
  description: string;
}

/**
 * The skills and agents of Global, the repo and the plugins, each name once. Read from the folders: a full load costs most of a second
 * on a real root, and this runs on every keystroke.
 */
function assetItems(a: Args, kinds: string[]): Item[] {
  const claude = claudeRoot(a);
  const homes = [claude, path.join(repoDir(a), '.claude'), ...pluginDirs(claude).map(p => p.dir)];
  const seen = new Map<string, string>();
  for (const home of homes) for (const kind of kinds) for (const item of folderItems(home, kind)) if (!seen.has(item.text)) seen.set(item.text, item.description);
  return [...seen].map(([text, description]) => ({ text, description }));
}

/** A skill is a folder with a SKILL.md; an agent is a markdown file. The description is the frontmatter's first line of it. */
function folderItems(home: string, kind: string): Item[] {
  const dir = path.join(home, kind === 'skill' ? 'skills' : 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (kind === 'skill') {
      const file = path.join(dir, e.name, 'SKILL.md');
      return e.isDirectory() && fs.existsSync(file) ? [{ text: e.name, description: descriptionOf(file) }] : [];
    }
    return e.isFile() && e.name.endsWith('.md') ? [{ text: e.name.replace(/\.md$/, ''), description: descriptionOf(path.join(dir, e.name)) }] : [];
  });
}

function descriptionOf(file: string): string {
  try {
    return /^description:\s*(.+)$/m.exec(fs.readFileSync(file, 'utf8').slice(0, 2048))?.[1].trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * The newest twenty sessions of the repo by file time, each with its first prompt. Only the head of each file is read: listSessions
 * reads every session of the repo, which takes 0.4 s on a big one, and this runs on every keystroke.
 */
function sessionItems(a: Args): Item[] {
  const folder = path.join(claudeRoot(a), 'projects', projectSlug(repoDir(a)));
  const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter(f => f.endsWith('.jsonl')) : [];
  const recent = files
    .map(f => ({ id: f.slice(0, -'.jsonl'.length), file: path.join(folder, f), mtime: fs.statSync(path.join(folder, f)).mtimeMs }))
    .sort((x, y) => y.mtime - x.mtime)
    .slice(0, 20);
  return [
    { text: 'latest', description: 'the newest session' },
    { text: 'previous', description: 'the session before the newest' },
    ...recent.map(s => ({ text: s.id, description: firstPromptOf(s.file).slice(0, 100) })),
  ];
}

/** The first prompt of a session, from the first 256 KB of its transcript. */
function firstPromptOf(file: string): string {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    for (const line of buf.toString('utf8', 0, n).split('\n')) {
      let record: { message?: { content?: unknown } };
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (isPrompt(record)) return promptText(record.message?.content) ?? '';
    }
  } catch {
    // An unreadable session is listed without a description.
  }
  return '';
}

/** The film and images folders of the repo, absolute so the command finds them from any folder. */
function mediaItems(a: Args): Item[] {
  return ['films', 'images'].flatMap(sub => {
    const area = path.join(repoDir(a), 'assets', sub);
    if (!fs.existsSync(area)) return [];
    return fs
      .readdirSync(area, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ text: path.join(area, e.name), description: sub === 'films' ? 'film' : 'images' }))
      .sort((x, y) => x.text.localeCompare(y.text));
  });
}

function itemsOf(source: Exclude<Values, string[]>, a: Args): Item[] {
  if (source === 'names') {
    const kind = one(a, 'kind');
    return assetItems(a, kind === 'skill' || kind === 'agent' ? [kind] : ['skill', 'agent']);
  }
  if (source === 'skills') return assetItems(a, ['skill']);
  if (source === 'agents') return assetItems(a, ['agent']);
  if (source === 'session') return sessionItems(a);
  if (source === 'plugins') return marketplacePlugins(claudeRoot(a)).map(p => ({ text: p.key, description: p.description.slice(0, 100) }));
  if (source === 'scripts') return scriptItems();
  if (source === 'tools') return KNOWN_TOOLS.map(text => ({ text, description: '' }));
  if (source === 'markets') return readMarkets(claudeRoot(a)).filter(m => m.owned).map(m => ({ text: m.name, description: m.location }));
  return mediaItems(a);
}

/** A comma list completes the item after its last comma and leaves the ones already typed alone. */
function valuesFor(source: Values, typed: string, a: Args): Candidate[] {
  const list = source === 'skills' || source === 'agents' || source === 'tools';
  const cut = list ? typed.lastIndexOf(',') + 1 : 0;
  const base = typed.slice(0, cut);
  const prefix = typed.slice(cut);
  const taken = new Set(base.split(',').filter(Boolean));
  const items: Item[] = Array.isArray(source) ? source.map(text => ({ text, description: '' })) : itemsOf(source, a);
  return items
    .filter(i => i.text.startsWith(prefix) && !taken.has(i.text))
    .map(i => ({ text: quote(base + i.text), kind: 'value' as const, description: i.description }));
}

/** A value with a space goes in quotes, so the shell keeps it one word. */
const quote = (text: string) => (/\s/.test(text) ? `"${text}"` : text);

/** Splits a line into words; a quoted run stays one word and its quotes are dropped. */
function words(text: string): string[] {
  return (text.match(/(?:"[^"]*"?|'[^']*'?|[^\s"']+)+/g) ?? []).map(w => w.replace(/["']/g, ''));
}

/** The flags typed before the cursor, and the flag still waiting for its value when the cursor sits on it. */
function scan(rest: string[], flags: FlagSpec[]): { used: Map<string, string[]>; positionals: string[]; pending?: FlagSpec } {
  const used = new Map<string, string[]>();
  const positionals: string[] = [];
  let pending: FlagSpec | undefined;
  const add = (name: string, value: string) => used.set(name, [...(used.get(name) ?? []), value]);
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    if (!w.startsWith('--')) {
      positionals.push(w);
      continue;
    }
    const eq = w.indexOf('=');
    const name = eq < 0 ? w.slice(2) : w.slice(2, eq);
    const spec = flags.find(f => f.name === name);
    if (eq >= 0) add(name, w.slice(eq + 1));
    else if (spec?.takes) {
      if (i === rest.length - 1) pending = spec;
      else add(name, rest[++i]);
    } else add(name, 'true');
  }
  return { used, positionals, pending };
}

/** The flags and the positional of one command, for the words after it. */
function argumentCandidates(spec: CommandSpec, rest: string[], typed: string): Candidate[] {
  const flags = [...new Map([...spec.flags, ...GLOBAL].map(f => [f.name, f])).values()];
  const { used, positionals, pending } = scan(rest, flags);
  const a: Args = { words: [], flags: used };
  if (pending) return valuesFor(pending.takes!, typed, a);
  if (typed.startsWith('--') && typed.includes('=')) {
    const eq = typed.indexOf('=');
    const flag = flags.find(f => f.name === typed.slice(2, eq));
    if (!flag?.takes) return [];
    return valuesFor(flag.takes, typed.slice(eq + 1), a).map(c => ({ ...c, text: `${typed.slice(0, eq + 1)}${c.text}` }));
  }
  const out: Candidate[] = [];
  if (!typed.startsWith('-') && spec.positional && !positionals.length) out.push(...valuesFor(spec.positional, typed, a));
  for (const f of flags)
    if ((!used.has(f.name) || REPEATABLE.has(f.name)) && `--${f.name}`.startsWith(typed)) out.push({ text: `--${f.name}`, kind: 'flag', description: '' });
  return out;
}

/** The candidates for the words after `harness`: `done` are complete words, `typed` is the word at the cursor. */
function candidatesFor(done: string[], typed: string): Candidate[] {
  const commandOf = (text: string): Candidate => ({ text, kind: 'command', description: '' });
  if (!done.length) {
    const top = [...new Set(COMMANDS.map(c => c.path.split(' ')[0]))].filter(t => t.startsWith(typed));
    return top.map(commandOf);
  }
  const [head, second] = done;
  const subs = COMMANDS.filter(c => c.path.startsWith(`${head} `)).map(c => c.path.slice(head.length + 1));
  if (second !== undefined && subs.includes(second)) return argumentCandidates(COMMANDS.find(c => c.path === `${head} ${second}`)!, done.slice(2), typed);
  const out: Candidate[] = [];
  if (done.length === 1 && !typed.startsWith('-')) out.push(...subs.filter(s => s.startsWith(typed)).map(commandOf));
  const own = COMMANDS.find(c => c.path === head);
  if (own) out.push(...argumentCandidates(own, done.slice(1), typed));
  return out;
}

/** The candidates for the word at `position` (the end of the line when omitted). Never throws: a failure answers nothing. */
export function candidates(line: string, position = line.length): Candidate[] {
  try {
    const before = line.slice(0, Math.max(0, Math.min(position, line.length)));
    const tokens = words(before);
    if (!before.length || /\s$/.test(before)) tokens.push('');
    const typed = tokens.pop() ?? '';
    // The first word is the command itself, `harness`; its own candidates are not ours to give.
    if (!tokens.length) return [];
    const rest = tokens.slice(1);
    if (rest[0] === 'g') rest[0] = 'generate';
    return candidatesFor(rest, typed);
  } catch {
    return [];
  }
}

/** PowerShell: a native argument completer that asks `harness complete` with the line and the cursor offset inside it. */
const POWERSHELL = [
  'Register-ArgumentCompleter -Native -CommandName harness -ScriptBlock {',
  '  param($wordToComplete, $commandAst, $cursorPosition)',
  '  $line = $commandAst.ToString()',
  '  $start = $commandAst.Extent.StartOffset',
  '  $end = $commandAst.Extent.EndOffset',
  '  if ($cursorPosition -gt $end) { $line += " " * ($cursorPosition - $end) }',
  '  $position = [Math]::Min($cursorPosition - $start, $line.Length)',
  '  if ($PSVersionTable.PSVersion -lt [version]"7.3") { $line = $line -replace \'"\', \'\\"\' }',
  '  harness complete --line $line --position $position 2>$null | ForEach-Object {',
  '    $text = if ($_ -match "\\s") { "\'$_\'" } else { $_ }',
  '    [System.Management.Automation.CompletionResult]::new($text, $_, "ParameterValue", $_)',
  '  }',
  '}',
].join('\n');

/** Bash (Git Bash included): a `complete -F` function that asks `harness complete` with COMP_LINE and COMP_POINT. */
const BASH = [
  '_harness_complete() {',
  '  local IFS=$\'\\n\'',
  '  COMPREPLY=( $(harness complete --line "$COMP_LINE" --position "$COMP_POINT" 2>/dev/null) )',
  '}',
  'complete -F _harness_complete harness',
].join('\n');

/** `completion powershell|bash`: the script a shell profile evaluates to register Tab completion for `harness`. */
export async function completionCommand(a: Args, io: Io): Promise<number> {
  const shell = a.words[1];
  if (shell === 'powershell') io.out(POWERSHELL);
  else if (shell === 'bash') io.out(BASH);
  else throw new Stop('Usage: harness completion powershell|bash', 2);
  return 0;
}

/** `complete --line "<command line>" [--position <n>]`: one candidate per line, or a JSON array with --json. */
export async function completeCommand(a: Args, io: Io): Promise<number> {
  const line = one(a, 'line') ?? '';
  const position = Number(one(a, 'position'));
  const found = candidates(line, Number.isInteger(position) ? position : line.length);
  if (one(a, 'json')) io.out(JSON.stringify(found.map(({ text, kind, description }) => ({ text, kind, description }))));
  else if (found.length) io.out(found.map(c => c.text).join('\n'));
  return 0;
}

