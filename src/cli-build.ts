import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Args, Io, Stop, winPath, emit, headline, list, load, one, parse, table } from './cli-core';
import { Asset, McpConfig, closest, deadPointers, marketplacePlugins, mcpAddCommand, parseMarkdown, readMarkdown, readText, rosterOf, serializeMarkdown, setPluginEnabled, splitCommandLine, validateName, MCP_NAME, repoScope, pluginDirs } from './harness';
import { CliResult, runClaude } from './hunt-create';
import { samePath } from './hunt-catalog';
import { readJson } from './hunt-market';
import { NO_PROVIDER, ScaffoldForm, checkRepo, findProvider, findPython, parseScaffoldOutput, runScript, scaffoldArgs } from './standard';
import { applyEdits, modify } from 'jsonc-parser';
import { installedVersion, syncApply, syncSource, updatePluginFromMarket } from './sync';

// `generate`, `add`, `validate` and `run`: a harness built from commands or from a .harness script. Every write step means "make sure this exists like this".

export type Runner = (args: string[], cwd: string, root: string) => Promise<CliResult>;
const defaultRunner: Runner = (args, cwd, root) => runClaude(args, root, 180000, cwd);
let claude: Runner = defaultRunner;
/** Tests replace the claude CLI with a stub; no argument restores it. */
export const setClaudeRunner = (r?: Runner): void => {
  claude = r ?? defaultRunner;
};

const MODELS = ['sonnet', 'opus', 'haiku', 'inherit'];
const TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Grep', 'Glob', 'LS', 'Bash', 'BashOutput', 'KillShell', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite', 'NotebookEdit', 'NotebookRead', 'Skill', 'SlashCommand', 'ExitPlanMode', 'AskUserQuestion', 'SendMessage'];
export const KNOWN_TOOLS = TOOLS;
export const KNOWN_MODELS = MODELS;

export const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop', 'SessionStart', 'SessionEnd', 'PreCompact'];

const FLAGS: Record<string, string[]> = {
  agent: ['scope', 'model', 'tools', 'description', 'from'],
  rule: ['scope', 'paths', 'from'],
  skill: ['scope', 'description', 'from'],
  command: ['scope', 'description', 'from'],
  hook: ['scope', 'matcher', 'command'],
  mcp: ['scope', 'url', 'command', 'args', 'transport'],
  plugin: ['scope'],
  scaffold: ['summary', 'area', 'rule'],
  update: [],
};
const KINDS = ['agent', 'rule', 'skill', 'command', 'hook', 'mcp'] as const;
/** On the command line these ride along with every command. */
const GLOBAL = new Set(['root', 'repo', 'user-config', 'json', 'dry-run', 'help', 'apply', 'yes']);

export interface Step {
  line: number;
  /** The step as written, for the summary. */
  text: string;
  verb: 'generate' | 'add' | 'new' | 'update';
  kind: 'agent' | 'rule' | 'skill' | 'command' | 'hook' | 'mcp' | 'plugin' | 'scaffold' | 'update';
  name: string;
  args: Args;
  repo: string;
  /** --from resolved. */
  from?: string;
}

export interface ScriptProblem {
  line: number;
  message: string;
}

export interface Change {
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  /** As shown: relative to the repo when inside it. */
  file: string;
  abs: string;
  size?: number;
  note?: string;
  /** The apply step backs this file up itself. */
  skipBackup?: boolean;
}

interface Ctx {
  root: string;
  userConfig: string;
  dry: boolean;
  stamp: string;
  backups: string[];
}

const stampOf = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function ctxOf(a: Args, dry: boolean): Ctx {
  return {
    root: path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude')),
    userConfig: path.resolve(one(a, 'user-config') ?? path.join(os.homedir(), '.claude.json')),
    dry,
    stamp: stampOf(),
    backups: [],
  };
}

// ---- parsing ----

/** Splits a script line into words; a quoted run stays one word and its quotes are dropped. */
function tokens(text: string): string[] {
  return (text.match(/(?:"[^"]*"?|'[^']*'?|[^\s"']+)+/g) ?? []).map(w => w.replace(/["']/g, ''));
}

/** One step from parsed arguments. `script` lines allow only the flags of their verb; the command line also lets the global ones through. */
function stepFrom(a: Args, line: number, text: string, repo: string, baseDir: string, script: boolean): { step?: Step; problems: ScriptProblem[] } {
  const problems: ScriptProblem[] = [];
  const bad = (message: string) => problems.push({ line, message });
  const verb = a.words[0] === 'g' ? 'generate' : a.words[0];
  let kind: Step['kind'];
  let name = '';
  let rest = 0;
  if (verb === 'generate') {
    const k = a.words[1];
    if (!(KINDS as readonly string[]).includes(k)) {
      bad(k ? `unknown kind "${k}": generate takes ${KINDS.join(', ')}` : `generate needs a kind: ${KINDS.join(', ')}`);
      return { problems };
    }
    kind = k as Step['kind'];
    name = a.words[2] ?? '';
    rest = 3;
    if (!name) bad(`generate ${k} needs a name`);
  } else if (verb === 'add') {
    kind = 'plugin';
    name = a.words[1] ?? '';
    rest = 2;
    if (!name) bad('add needs <plugin>@<marketplace>');
  } else if (verb === 'new') {
    kind = 'scaffold';
    name = a.words[1] ?? '';
    rest = 2;
    if (!name) bad('new needs a repo folder');
  } else if (verb === 'update') {
    kind = 'update';
    rest = 1;
  } else {
    bad(`unknown verb "${verb}"`);
    return { problems };
  }
  if (a.words.length > rest) bad(`unexpected argument "${a.words[rest]}"`);
  const allowed = FLAGS[kind];
  const label = verb === 'generate' ? `generate ${kind}` : verb;
  for (const key of a.flags.keys()) if (!allowed.includes(key) && !(!script && GLOBAL.has(key))) bad(`unknown flag --${key} for ${label}`);
  const from = one(a, 'from');
  const target = kind === 'scaffold' ? path.resolve(baseDir, name) : repo;
  return { step: { line, text, verb, kind, name, args: a, repo: target, from: from ? path.resolve(baseDir, from) : undefined }, problems };
}

/** `parse` stops at the first bad flag; here each one becomes a problem and is dropped, so the rest of the line is still checked. */
function lenientParse(words: string[]): { args: Args; messages: string[] } {
  const w = [...words];
  const messages: string[] = [];
  for (let guard = 0; guard < 64; guard++) {
    try {
      return { args: parse(w), messages };
    } catch (e) {
      const message = (e as Error).message;
      messages.push(message);
      const key = /^unknown flag: --([^\s=]+)/.exec(message)?.[1] ?? /^--([^\s=]+) needs a value/.exec(message)?.[1];
      const i = key ? w.findIndex(x => x === `--${key}` || x.startsWith(`--${key}=`)) : -1;
      if (i < 0) break;
      const hasValue = !w[i].includes('=') && w[i + 1] !== undefined && !w[i + 1].startsWith('--') && !message.includes('needs a value');
      w.splice(i, hasValue ? 2 : 1);
    }
  }
  return { args: { words: words.filter(x => !x.startsWith('--')), flags: new Map() }, messages };
}

/** The script's lines; every problem is collected with its line number. `repo <dir>` sets the target of the lines after it. */
export function parseScript(text: string, baseDir: string, defaultRepo: string): { steps: Step[]; problems: ScriptProblem[] } {
  const steps: Step[] = [];
  const problems: ScriptProblem[] = [];
  let repo = defaultRepo;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t || t.startsWith('#')) return;
    const words = tokens(t);
    if (words[0] === 'repo') {
      if (words.length !== 2) problems.push({ line, message: 'repo needs one folder: repo <dir>' });
      else {
        repo = path.resolve(baseDir, winPath(words[1]));
        if (!fs.existsSync(repo)) problems.push({ line, message: `repo folder ${words[1]} does not exist` });
      }
      return;
    }
    const lenient = lenientParse(words);
    problems.push(...lenient.messages.map(message => ({ line, message })));
    const r = stepFrom(lenient.args, line, t, repo, baseDir, true);
    problems.push(...r.problems);
    if (r.step) steps.push(r.step);
  });
  return { steps, problems };
}

// ---- validating ----

/** Everything wrong with one step that can be known without writing. */
export function validateStep(step: Step, ctx: Pick<Ctx, 'root'>): string[] {  const out: string[] = [];
  const a = step.args;
  const scope = one(a, 'scope');
  if (scope && scope !== 'repo' && scope !== 'user') out.push(`unknown scope "${scope}": repo or user`);
  if (step.kind === 'plugin') {
    if (!/^[\w.-]+@[\w.-]+$/.test(step.name)) return [...out, `"${step.name}" is not <plugin>@<marketplace>`];
    const [, market] = step.name.split('@');
    const known = Object.keys(readJson(path.join(ctx.root, 'plugins', 'known_marketplaces.json')));
    if (!known.includes(market)) out.push(`no marketplace named ${market} is registered`);
    else if (!marketplacePlugins(ctx.root).some(p => p.key === step.name)) out.push(`marketplace ${market} has no plugin ${step.name.split('@')[0]}`);
    return out;
  }
  if (step.kind === 'mcp') {
    if (!MCP_NAME.test(step.name)) out.push(`"${step.name}" is not a valid MCP server name`);
    const url = one(a, 'url');
    const command = one(a, 'command');
    if (!url && !command) out.push('an MCP server needs --url or --command');
    if (url && command) out.push('an MCP server takes --url or --command, not both');
    if (url && !/^https?:\/\/\S+$/.test(url)) out.push(`"${url}" is not an http(s) URL`);
    const transport = one(a, 'transport');
    if (transport && !['http', 'sse'].includes(transport)) out.push(`unknown transport "${transport}": http or sse`);
    if (transport && !url) out.push('--transport goes with --url');
    if (!url && one(a, 'args') && !command) out.push('--args goes with --command');
    return out;
  }
  if (step.kind === 'update') return out;
  if (step.kind === 'scaffold') {
    if (!one(a, 'summary')) out.push('new needs --summary "<what the product is and its stack>"');
    for (const area of a.flags.get('area') ?? []) if (!/^[^=]+=[^:]+:[^:]+$/.test(area)) out.push(`--area needs name=glob[,glob]:owner-agent, got "${area}"`);
    if (!findProvider(pluginDirs(ctx.root, true))?.scaffold) out.push(`${NO_PROVIDER} It has the scaffold script that new needs.`);
    return out;
  }
  if (step.kind === 'hook') {
    if (!HOOK_EVENTS.includes(step.name)) out.push(`unknown hook event "${step.name}"${closest(step.name, HOOK_EVENTS).length ? `; did you mean ${closest(step.name, HOOK_EVENTS)[0]}?` : `: ${HOOK_EVENTS.join(', ')}`}`);
    if (!one(a, 'command')) out.push('a hook needs --command');
    return out;
  }
  const bad = (step.kind === 'command' ? step.name.split(':') : [step.name]).map(validateName).find(Boolean);
  if (bad) out.push(`"${step.name}" is not a valid ${step.kind} name. ${bad}`);
  if (step.from && !fs.existsSync(step.from)) out.push(`--from file ${one(a, 'from')} does not exist`);
  if (step.kind === 'agent') {
    const model = one(a, 'model');
    if (model && !MODELS.includes(model) && !/^claude-[\w.-]+$/.test(model)) out.push(`unknown model "${model}": ${MODELS.join(', ')} or a claude-... id${closest(model, MODELS).length ? `; did you mean ${closest(model, MODELS)[0]}?` : ''}`);
    for (const tool of list(a, 'tools')) {
      const bare = tool.replace(/\(.*$/, '');
      if (!TOOLS.includes(bare) && !/^mcp__\S+$/.test(bare)) out.push(`unknown tool "${tool}"${closest(bare, TOOLS).length ? `; did you mean ${closest(bare, TOOLS)[0]}?` : ''}`);
    }
  }
  return out;
}

// ---- planning and applying ----

interface Plan {
  changes: Change[];
  apply: () => Promise<void>;
}

const NOTHING: Plan = { changes: [], apply: async () => undefined };

const slash = (p: string) => p.split(path.sep).join('/');
const shown = (file: string, repo: string) => {
  const rel = path.relative(repo, file);
  return !rel.startsWith('..') && !path.isAbsolute(rel) ? slash(rel) : slash(file);
};
const change = (action: Change['action'], abs: string, repo: string, extra: Partial<Change> = {}): Change => ({ action, file: shown(abs, repo), abs, ...extra });
const normLines = (s: string) => s.replace(/\r\n/g, '\n');
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(',')).map(s => s.trim()).filter(Boolean);
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

function planMarkdown(step: Step, ctx: Ctx): Plan {
  const a = step.args;
  const base = one(a, 'scope') === 'user' ? ctx.root : path.join(step.repo, '.claude');
  const file =
    step.kind === 'skill'
      ? path.join(base, 'skills', step.name, 'SKILL.md')
      : step.kind === 'command'
        ? path.join(base, 'commands', ...step.name.split(':')) + '.md'
        : path.join(base, step.kind === 'agent' ? 'agents' : 'rules', `${step.name}.md`);
  const exists = fs.existsSync(file);
  const old = exists ? readMarkdown(file) : { data: {} as Record<string, unknown>, body: '', hasFrontmatter: false };
  const original = exists ? readText(file) : '';
  const fromText = step.from ? readText(step.from) : undefined;
  const fromDoc = fromText !== undefined ? parseMarkdown(fromText) : undefined;
  let data: Record<string, unknown>;
  let body: string;
  if (step.kind === 'agent') {
    data = { ...old.data };
    if (!exists) Object.assign(data, { name: step.name, description: '', model: 'inherit' });
    const description = one(a, 'description');
    if (description !== undefined && data.description !== description) data.description = description;
    const model = one(a, 'model');
    if (model && data.model !== model) data.model = model;
    const tools = list(a, 'tools');
    if (tools.length && !same(asList(data.tools), tools)) data.tools = tools.join(', ');
    body = fromDoc ? fromDoc.body : old.body;
  } else {
    data = fromDoc ? { ...fromDoc.data } : { ...old.data };
    if (!exists && step.kind === 'skill' && data.name === undefined) data.name = step.name;
    if (!exists && (step.kind === 'skill' || step.kind === 'command') && data.description === undefined) data.description = '';
    const description = one(a, 'description');
    if (description !== undefined && data.description !== description) data.description = description;
    const paths = list(a, 'paths');
    if (paths.length && !same(asList(data.paths), paths)) data.paths = paths;
    body = fromDoc ? fromDoc.body : exists ? old.body : step.kind === 'command' ? '' : `# ${step.name}\n\n`;
  }
  if (exists && same(data, old.data) && normLines(body) === normLines(old.body)) return NOTHING;
  const text = serializeMarkdown(fromText !== undefined && !Object.keys(data).length ? fromText : original, data, body);
  return {
    changes: [change(exists ? 'UPDATE' : 'CREATE', file, step.repo, { size: Buffer.byteLength(text) })],
    apply: async () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, 'utf8');
    },
  };
}

function planMcp(step: Step, ctx: Ctx): Plan {
  const a = step.args;
  const user = one(a, 'scope') === 'user';
  const file = user ? ctx.userConfig : path.join(step.repo, '.mcp.json');
  const url = one(a, 'url');
  const transport = one(a, 'transport') === 'sse' ? 'sse' : 'http';
  const config: McpConfig = url ? { type: transport, url } : { command: one(a, 'command'), args: list(a, 'args') };
  const existing = (readJson(file).mcpServers ?? {})[step.name] as McpConfig | undefined;
  const holds = existing && (url ? existing.url === url && (existing.type ?? 'http') === transport : existing.command === config.command && same(existing.args ?? [], config.args ?? []));
  if (holds) return NOTHING;
  const scope = user ? 'user' : 'project';
  return {
    changes: [change(fs.existsSync(file) ? 'UPDATE' : 'CREATE', file, step.repo, { note: `claude mcp add ${step.name}` })],
    apply: async () => {
      if (existing) {
        const removed = await claude(['mcp', 'remove', step.name, '--scope', scope], step.repo, ctx.root);
        if (removed.code !== 0) throw new Error(`claude mcp remove ${step.name} failed: ${lastLine(removed.out)}`);
      }
      const r = await claude(splitCommandLine(mcpAddCommand(step.name, config, scope)).slice(1), step.repo, ctx.root);
      if (r.code !== 0) throw new Error(`claude mcp add ${step.name} failed: ${lastLine(r.out)}`);
    },
  };
}

const lastLine = (out: string) => out.split('\n').filter(Boolean).slice(-1)[0] ?? 'no output';

function planPlugin(step: Step, ctx: Ctx): Plan {
  const project = one(step.args, 'scope') === 'repo';
  const entries = readJson(path.join(ctx.root, 'plugins', 'installed_plugins.json')).plugins?.[step.name];
  const installed = Array.isArray(entries) && entries.some((e: { scope?: string; projectPath?: string }) => (project ? e.scope === 'project' && !!e.projectPath && samePath(e.projectPath, step.repo) : (e.scope ?? 'user') === 'user'));
  const settings = path.join(project ? path.join(step.repo, '.claude') : ctx.root, 'settings.json');
  const enabledNow = () => readJson(settings).enabledPlugins?.[step.name] === true;
  if (installed && enabledNow()) return NOTHING;
  const registry = path.join(ctx.root, 'plugins', 'installed_plugins.json');
  const changes = installed ? [] : [change(fs.existsSync(registry) ? 'UPDATE' : 'CREATE', registry, step.repo, { note: `claude plugin install ${step.name}` })];
  changes.push(change(fs.existsSync(settings) ? 'UPDATE' : 'CREATE', settings, step.repo));
  return {
    changes,
    apply: async () => {
      if (!installed) {
        const r = await claude(['plugin', 'install', step.name, '--scope', project ? 'project' : 'user'], step.repo, ctx.root);
        if (r.code !== 0) throw new Error(`claude plugin install ${step.name} failed: ${lastLine(r.out)}`);
      }
      if (!enabledNow()) {
        fs.mkdirSync(path.dirname(settings), { recursive: true });
        setPluginEnabled(project ? repoScope(step.repo, ctx.userConfig) : { ...repoScope(step.repo, ctx.userConfig), root: ctx.root }, step.name, true);
      }
    },
  };
}

function planHook(step: Step, ctx: Ctx): Plan {
  const a = step.args;
  const file = path.join(one(a, 'scope') === 'user' ? ctx.root : path.join(step.repo, '.claude'), 'settings.json');
  const exists = fs.existsSync(file);
  const text = exists ? readText(file) : '{}\n';
  const command = one(a, 'command')!;
  const matcher = one(a, 'matcher');
  type Entry = { matcher?: string; hooks?: { command?: string }[] };
  const entries = ((readJson(file).hooks ?? {})[step.name] ?? []) as Entry[];
  if (entries.some(e => e.matcher === matcher && (e.hooks ?? []).some(h => h.command === command))) return NOTHING;
  const format = { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' };
  const at = entries.findIndex(e => e.matcher === matcher);
  const edits =
    at >= 0
      ? modify(text, ['hooks', step.name, at, 'hooks', -1], { type: 'command', command }, { formattingOptions: format, isArrayInsertion: true })
      : entries.length
        ? modify(text, ['hooks', step.name, -1], { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] }, { formattingOptions: format, isArrayInsertion: true })
        : modify(text, ['hooks', step.name], [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] }], { formattingOptions: format });
  const next = applyEdits(text, edits);
  return {
    changes: [change(exists ? 'UPDATE' : 'CREATE', file, step.repo, { size: Buffer.byteLength(next) })],
    apply: async () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, next, 'utf8');
    },
  };
}

/** The standard's scaffold script says what it would create; only those files are changes. */
async function planScaffold(step: Step, ctx: Ctx): Promise<Plan> {
  const provider = findProvider(pluginDirs(ctx.root, true));
  if (!provider?.scaffold) throw new Error(NO_PROVIDER);
  const py = await findPython();
  const a = step.args;
  const form: ScaffoldForm = {
    summary: one(a, 'summary') ?? '',
    areas: (a.flags.get('area') ?? []).map(x => {
      const eq = x.indexOf('=');
      const colon = x.lastIndexOf(':');
      return { name: x.slice(0, eq), globs: x.slice(eq + 1, colon), owner: x.slice(colon + 1) };
    }),
    rules: a.flags.get('rule') ?? [],
  };
  const preview = await runScript(py, provider.scaffold, scaffoldArgs(step.repo, form, false));
  if (preview.code !== 0) throw new Error(preview.stderr.trim() || `The scaffold script exited with ${preview.code}`);
  const created = parseScaffoldOutput(preview.stdout).files.filter(f => f.action === 'create');
  if (!created.length) return NOTHING;
  return {
    changes: created.map(f => change('CREATE', path.join(step.repo, ...f.rel.split('/')), step.repo)),
    apply: async () => {
      const r = await runScript(py, provider.scaffold!, scaffoldArgs(step.repo, form, true));
      if (r.code !== 0) throw new Error(r.stderr.trim() || `The scaffold script exited with ${r.code}`);
    },
  };
}

/** The version a marketplace lists for a plugin: its catalog entry, else the plugin's own manifest. */
function marketVersion(root: string, key: string): string | undefined {
  const [name, market] = key.split('@');
  const location = (readJson(path.join(root, 'plugins', 'known_marketplaces.json'))[market] as { installLocation?: string } | undefined)?.installLocation ?? path.join(root, 'plugins', 'marketplaces', market);
  const entry = ((readJson(path.join(location, '.claude-plugin', 'marketplace.json')).plugins ?? []) as { name?: string; version?: string; source?: unknown }[]).find(p => p.name === name);
  if (!entry) return undefined;
  const dir = typeof entry.source === 'string' ? path.resolve(location, entry.source) : path.join(location, name);
  return entry.version ?? (readJson(path.join(dir, '.claude-plugin', 'plugin.json')).version as string | undefined);
}

/** Plugins behind their marketplace, and repo skills and agents that differ from their Global copy. */
async function planUpdate(step: Step, ctx: Ctx): Promise<Plan> {
  const registry = path.join(ctx.root, 'plugins', 'installed_plugins.json');
  const keys = Object.keys(readJson(registry).plugins ?? {}).filter(k => k.includes('@'));
  if (!ctx.dry)
    for (const market of new Set(keys.map(k => k.split('@')[1]))) {
      const r = await claude(['plugin', 'marketplace', 'update', market], step.repo, ctx.root);
      if (r.code !== 0) throw new Error(`claude plugin marketplace update ${market} failed: ${lastLine(r.out)}`);
    }
  const behind = keys.flatMap(key => {
    const want = marketVersion(ctx.root, key);
    const have = installedVersion(ctx.root, key);
    return want && have !== want ? [{ key, want, have }] : [];
  });
  const changes: Change[] = behind.map(b => change('UPDATE', registry, step.repo, { note: `claude plugin update ${b.key}: ${b.have ?? 'none'} to ${b.want}` }));
  const syncs: { asset: Asset; from: Asset; base: string }[] = [];
  const w = load({ words: [], flags: new Map([['root', [ctx.root]], ['user-config', [ctx.userConfig]], ['repo', [step.repo]]]) });
  const view = w.views.find(v => v.id !== 'global' && samePath(v.path, step.repo));
  for (const category of view?.categories ?? [])
    for (const asset of category.items) {
      const { source } = syncSource(asset, view!.path);
      const from = source && w.views[0].categories.find(c => c.kind === asset.kind)?.items.find(i => i.name === asset.name);
      if (!from) continue;
      syncs.push({ asset, from, base: view!.path });
      changes.push(change('UPDATE', asset.file, step.repo, { note: `from Global`, skipBackup: true }));
    }
  if (!changes.length) return NOTHING;
  return {
    changes,
    apply: async () => {
      for (const b of behind) await updatePluginFromMarket(b.key, b.key.split('@')[1], b.want, ctx.root, (args, root) => claude(args, step.repo, root));
      for (const s of syncs) syncApply(s.asset, s.from, s.base, path.join(ctx.root, 'repo-sync-backups'), ctx.stamp);
    },
  };
}

async function planStep(step: Step, ctx: Ctx): Promise<Plan> {
  switch (step.kind) {
    case 'mcp':
      return planMcp(step, ctx);
    case 'plugin':
      return planPlugin(step, ctx);
    case 'hook':
      return planHook(step, ctx);
    case 'scaffold':
      return planScaffold(step, ctx);
    case 'update':
      return planUpdate(step, ctx);
    default:
      return planMarkdown(step, ctx);
  }
}

/** Copies a file that is about to change into the backup folder of this run, laid out as the retire backup is. */
function backup(file: string, repo: string, ctx: Ctx): void {
  if (!fs.existsSync(file)) return;
  const inside = (base: string) => !path.relative(base, file).startsWith('..') && !path.isAbsolute(path.relative(base, file));
  const folder = path.join(ctx.root, 'repo-sync-backups', ctx.stamp);
  const dest = inside(repo)
    ? path.join(folder, path.basename(repo), path.relative(repo, file))
    : inside(ctx.root)
      ? path.join(folder, path.basename(ctx.root), path.relative(ctx.root, file))
      : path.join(folder, 'files', path.relative(path.parse(file).root, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  ctx.backups.push(dest);
}

async function execute(step: Step, ctx: Ctx): Promise<Change[]> {
  const plan = await planStep(step, ctx);
  if (ctx.dry || !plan.changes.length) return plan.changes;
  for (const c of plan.changes) if (!c.skipBackup) backup(c.abs, step.repo, ctx);
  await plan.apply();
  for (const c of plan.changes) if (fs.existsSync(c.abs)) c.size = fs.statSync(c.abs).size;
  return plan.changes;
}

// ---- output ----

const sizeOf = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${Number((n / 1024).toFixed(1))} KB` : `${Number((n / 1024 / 1024).toFixed(1))} MB`);
const changeLine = (c: Change) => `${c.action} ${c.file}${c.size !== undefined ? ` (${sizeOf(c.size)})` : c.note ? ` (${c.note})` : ''}`;
const DRY_NOTE = 'NOTE: The "--dry-run" option means no changes were written.';
const NOTHING_LINE = 'Nothing to be done.';

export interface StepResult {
  line: number;
  step: string;
  result: 'done' | 'nothing to be done' | 'failed' | 'not run';
  error?: string;
  changes: Change[];
}

const jsonChange = (c: Change) => ({ action: c.action, file: c.file, ...(c.size !== undefined && { size: c.size }), ...(c.note && { note: c.note }) });

async function runSteps(steps: Step[], ctx: Ctx): Promise<StepResult[]> {
  const results: StepResult[] = [];
  let failed = false;
  for (const step of steps) {
    if (failed) {
      results.push({ line: step.line, step: step.text, result: 'not run', changes: [] });
      continue;
    }
    try {
      const changes = await execute(step, ctx);
      results.push({ line: step.line, step: step.text, result: changes.length ? 'done' : 'nothing to be done', changes });
    } catch (e) {
      failed = true;
      results.push({ line: step.line, step: step.text, result: 'failed', error: (e as Error).message, changes: [] });
    }
  }
  return results;
}

function report(io: Io, a: Args, results: StepResult[], ctx: Ctx, summary: boolean): number {
  const changes = results.flatMap(r => r.changes);
  const failed = results.find(r => r.result === 'failed');
  const lines = changes.map(changeLine);
  if (!changes.length && !failed) lines.push(NOTHING_LINE);
  if (ctx.backups.length) lines.push(`Backup: ${slash(path.join(ctx.root, 'repo-sync-backups', ctx.stamp))}`);
  if (ctx.dry) lines.push(DRY_NOTE);
  if (summary) lines.push('', headline(`${results.length} steps`), '', ...table(['Line', 'Step', 'Result'], results.map(r => [r.line, r.step, r.error ? `failed: ${r.error}` : r.result]), [true]));
  emit(io, a, { steps: results.map(r => ({ line: r.line, step: r.step, result: r.result, ...(r.error && { error: r.error }), changes: r.changes.map(jsonChange) })), changes: changes.map(jsonChange), backups: ctx.backups }, lines, !ctx.dry && !failed);
  if (failed) io.err(failed.error!);
  return failed ? 1 : 0;
}

const problemLines = (problems: ScriptProblem[], file: string, steps: number): string[] =>
  problems.length ? [headline(`${problems.length} problems in ${file}`), '', ...table(['Line', 'Problem'], problems.map(p => [p.line, p.message]), [true])] : [headline(`${file}: ${steps} steps, no problems.`)];

/** Parse and validate a whole script; the problems are sorted by line. */
function checkScript(file: string, ctx: Ctx, defaultRepo: string): { steps: Step[]; problems: ScriptProblem[] } {
  if (!fs.existsSync(file)) throw new Stop(`${file} does not exist.`, 2);
  return checkScriptText(fs.readFileSync(file, 'utf8'), path.dirname(path.resolve(file)), ctx.root, defaultRepo);
}

/** The same check on text that is not saved yet, which is what the editor's diagnostics run it on. */
export function checkScriptText(text: string, baseDir: string, root: string, defaultRepo: string, typing: number[] = []): { steps: Step[]; problems: ScriptProblem[] } {
  const parsed = parseScript(text, baseDir, defaultRepo);
  const problems = [...parsed.problems, ...parsed.steps.flatMap(s => validateStep(s, { root }).map(message => ({ line: s.line, message })))];
  // a line the cursor is still on is being typed: every prefix of a valid line (`--tools Re`, `--model o`) is a problem until it is finished
  return { steps: parsed.steps, problems: problems.filter(p => !typing.includes(p.line)).sort((x, y) => x.line - y.line) };
}

// ---- the harness check ----

interface HarnessProblem {
  file: string;
  line: number;
  level: string;
  message: string;
}

async function checkHarness(a: Args, repo: string, ctx: Ctx): Promise<{ problems: HarnessProblem[]; notes: string[] }> {
  const problems: HarnessProblem[] = [];
  const notes: string[] = [];
  const provider = findProvider(pluginDirs(ctx.root, true));
  if (provider) {
    const result = await checkRepo(provider, await findPython(), repo);
    for (const f of result.findings) {
      const message = f.text.replace(/^(FAIL|REVIEW|INFO) /, '');
      for (const l of f.locations.length ? f.locations : [{ file: '', line: null }]) if (f.level === 'FAIL') problems.push({ file: l.file, line: l.line ?? 0, level: f.level, message });
    }
  } else notes.push(`${NO_PROVIDER} The standard's check was skipped.`);
  const w = load(a);
  const roster = rosterOf(w.views, w.plugins);
  const docs = [['CLAUDE.md', ['skill', 'agent']], ['.claude/CLAUDE.md', ['skill', 'agent']]] as const;
  const rulesDir = path.join(repo, '.claude', 'rules');
  const files: [string, ('path' | 'skill' | 'agent')[]][] = docs.map(([f, k]) => [f, [...k]] as [string, ('path' | 'skill' | 'agent')[]]);
  if (fs.existsSync(rulesDir)) for (const f of fs.readdirSync(rulesDir).filter(n => n.endsWith('.md'))) files.push([`.claude/rules/${f}`, ['path', 'skill', 'agent']]);
  for (const [rel, kinds] of files) {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) continue;
    for (const t of deadPointers(fs.readFileSync(abs, 'utf8'), repo, roster, kinds)) problems.push({ file: rel, line: t.line + 1, level: 'POINTER', message: `${t.kind} \`${t.token}\` not found` });
  }
  return { problems, notes };
}

// ---- the commands ----

export async function buildCommand(a: Args, io: Io): Promise<number> {
  const cmd = a.words[0];
  const dry = !!one(a, 'dry-run');
  const ctx = ctxOf(a, dry);
  const repo = path.resolve(one(a, 'repo') ?? process.cwd());
  if (cmd === 'validate' || cmd === 'run') {
    const file = a.words[1];
    if (cmd === 'run' && (!file || a.words.length > 2)) throw new Stop('Usage: harness run <file> [--dry-run]', 2);
    if (cmd === 'validate' && a.words.length > 2) throw new Stop('Usage: harness validate [<file>] [--repo <dir>]', 2);
    let steps: Step[] = [];
    let problems: ScriptProblem[] = [];
    if (file) {
      ({ steps, problems } = checkScript(file, ctx, repo));
      if (problems.length) {
        emit(io, a, { file, problems }, problemLines(problems, file, steps.length));
        return 2;
      }
    }
    if (cmd === 'run') return report(io, a, await runSteps(steps, ctx), ctx, true);
    if (file && !one(a, 'repo')) {
      emit(io, a, { file, steps: steps.length, problems: [] }, problemLines([], file, steps.length));
      return 0;
    }
    if (!fs.existsSync(repo)) throw new Stop(`${repo} does not exist.`, 2);
    const h = await checkHarness(a, repo, ctx);
    const lines = [
      ...(file ? [...problemLines([], file, steps.length), ''] : []),
      ...h.notes,
      h.problems.length ? headline(`${h.problems.length} problems in the harness of ${slash(repo)}`) : headline(`The harness of ${slash(repo)} has no problems.`),
      ...(h.problems.length ? ['', ...table(['Level', 'File', 'Line', 'Problem'], h.problems.map(p => [p.level, p.file, p.line || '', p.message]), [false, false, true])] : []),
    ];
    emit(io, a, { repo, problems: h.problems, notes: h.notes }, lines);
    return h.problems.length ? 1 : 0;
  }
  const { step, problems } = stepFrom(a, 0, a.words.join(' '), repo, process.cwd(), false);
  const all = [...problems, ...(step ? validateStep(step, ctx).map(message => ({ line: 0, message })) : [])];
  if (all.length) {
    for (const p of all) io.err(p.message);
    return 2;
  }
  return report(io, a, await runSteps([step!], ctx), ctx, false);
}
