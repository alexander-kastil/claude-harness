import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { pluginDirs } from './harness';
import { Args, Io, Stop, World, emit, headline, load, one, table } from './cli-core';

// `agents list` and `agents route`: the agents of Global, the plugins and the repos, and the delegation plugin's routing.

const ROUTER = 'subagent-delegation-plugin';

export type CopyState = 'identical' | 'nearly identical' | 'differs';

export interface AgentRow {
  name: string;
  scope: string;
  file: string;
  model: string | null;
  tools: string[];
  gated: boolean;
  summary: string;
  copies: { scope: string; state: CopyState }[];
}

export interface AgentsListOut {
  agents: AgentRow[];
  counts: { global: number; plugins: number; repos: number; gated: number; drifted: number };
}

export interface RouteOut {
  prompt: string;
  stacks: string[];
  owners: { name: string; score: number; terms: string[]; scope: string }[];
  dropped: { name: string; reason: 'gated' | 'fact-gatherer' }[];
  fallback: string | null;
}

export async function agentsCommand(a: Args, io: Io): Promise<number> {
  const [, sub] = a.words;
  if (sub === 'list') return agentsList(a, io);
  if (sub === 'route') return agentsRoute(a, io);
  throw new Stop('agents needs list or route. Run with --help.', 2);
}

// ---- list ----

const stateOf = (c: { same: boolean; near?: boolean }): CopyState => (c.same ? 'identical' : c.near ? 'nearly identical' : 'differs');

/** The first sentence of a description, or the whole description when it has none. */
const firstSentence = (description: string) => description.match(/^.*?[.!?](?=\s|$)/)?.[0].trim() ?? description.trim();

// The CommonJS build would turn a plain import() into require(), which cannot load a file URL of an ES module.
const esmImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{ GATED?: RegExp }>;

/** The delegation plugin's folders: the directory source first, then the installed copy in the cache. */
function routerDirs(root: string): string[] {
  return pluginDirs(root, true)
    .filter(p => p.plugin === ROUTER)
    .sort((x, y) => Number(x.installed) - Number(y.installed))
    .map(p => p.dir);
}

/** The plugin's routing pattern, from its single source; undefined when no copy has hooks/route.mjs. */
async function gatedPattern(root: string): Promise<RegExp | undefined> {
  const file = routerDirs(root)
    .map(dir => path.join(dir, 'hooks', 'route.mjs'))
    .find(f => fs.existsSync(f));
  if (!file) return undefined;
  return (await esmImport(pathToFileURL(file).href)).GATED;
}

/** The agents a repo's .claude/routing.json lists under "gated". */
function gatedInRouting(repo: string): string[] {
  const file = path.join(repo, '.claude', 'routing.json');
  if (!fs.existsSync(file)) return [];
  const routing = JSON.parse(fs.readFileSync(file, 'utf8')) as { gated?: string[] | Record<string, unknown> };
  return Array.isArray(routing.gated) ? routing.gated : Object.keys(routing.gated ?? {});
}

function agentRows(w: World, pattern: RegExp | undefined): AgentRow[] {
  const rows: AgentRow[] = [];
  for (const view of [...w.views, ...w.plugins]) {
    const repoGated = view.id === 'global' || view.id.startsWith('plugin:') ? [] : gatedInRouting(view.path);
    for (const category of view.categories)
      if (category.kind === 'agent')
        for (const asset of category.items) {
          if (pattern) pattern.lastIndex = 0;
          const gated = !!asset.meta?.gated || repoGated.includes(asset.name) || (!!pattern && pattern.test(asset.description));
          rows.push({
            name: asset.name,
            scope: asset.scope,
            file: asset.file,
            model: asset.meta?.model ?? null,
            tools: asset.meta?.tools ?? [],
            gated,
            summary: firstSentence(asset.description),
            copies: (asset.copies ?? []).map(c => ({ scope: c.scope, state: stateOf(c) })),
          });
        }
  }
  return rows.sort((x, y) => x.name.localeCompare(y.name) || x.scope.localeCompare(y.scope));
}

async function agentsList(a: Args, io: Io): Promise<number> {
  const w = load(a);
  const agents = agentRows(w, await gatedPattern(w.root));
  const counts = {
    global: agents.filter(r => r.scope === 'global').length,
    plugins: agents.filter(r => r.scope.startsWith('plugin:')).length,
    repos: agents.filter(r => r.scope !== 'global' && !r.scope.startsWith('plugin:')).length,
    gated: agents.filter(r => r.gated).length,
    drifted: agents.filter(r => r.copies.some(c => c.state !== 'identical')).length,
  };
  const out: AgentsListOut = { agents, counts };
  const rows = agents.map(r => [r.name, r.scope, r.model ?? '', r.tools.join(', '), r.gated ? 'yes' : 'no', r.copies.map(c => c.state).join(', '), r.summary]);
  emit(io, a, out, [
    headline(`Agents · ${counts.global + counts.plugins + counts.repos} · ${counts.gated} gated · ${counts.drifted} drifted`),
    '',
    ...table(['Agent', 'Scope', 'Model', 'Tools', 'Gated', 'Copies', 'Summary'], rows),
  ]);
  return 0;
}

// ---- route ----

/** The fallback names its specialist as `name` (scope) in route.mjs's sentence; the sentence itself is shown when it names none. */
const fallbackCell = (fallback: string | null): string => {
  if (!fallback) return '(none)';
  const named = fallback.match(/`([^`]+)`\s*\((\w+)\)/);
  return named ? `${named[1]} (${named[2]})` : fallback;
};

const routeLines = (o: RouteOut): string[] => [
  headline(`Routing "${o.prompt}"`),
  '',
  ...table(
    ['Owner', 'Score', 'Terms', 'Scope'],
    o.owners.length ? o.owners.map(x => [x.name, x.score, x.terms.join(', '), x.scope]) : [['(none)', '', '', '']],
    [false, true, false, false],
  ),
  ...(o.dropped.length ? ['', ...table(['Dropped', 'Reason'], o.dropped.map(x => [x.name, x.reason]))] : []),
  '',
  ...table(['Stacks', 'Fallback'], [[o.stacks.join(', ') || '(none)', fallbackCell(o.fallback)]]),
];

function runRoute(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(process.execPath, [script, ...args], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Stop(`route.mjs failed: ${(stderr || err.message).trim()}`, 1));
      else resolve(stdout);
    }),
  );
}

async function agentsRoute(a: Args, io: Io): Promise<number> {
  const prompt = a.words[2];
  if (!prompt) throw new Stop('agents route needs a prompt: agents route "<prompt>".', 2);
  const root = path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));
  const repo = path.resolve(one(a, 'repo') ?? process.cwd());
  const dirs = routerDirs(root);
  if (!dirs.length) throw new Stop(`${ROUTER} is not installed under ${root}: no scripts/route.mjs to run.`, 1);
  const script = dirs.map(dir => path.join(dir, 'scripts', 'route.mjs')).find(f => fs.existsSync(f));
  if (!script) throw new Stop(`Missing ${path.join(dirs[0], 'scripts', 'route.mjs')}.`, 1);
  const stdout = await runRoute(script, ['--prompt', prompt, '--repo', repo, '--root', root, '--json']);
  let out: RouteOut;
  try {
    out = JSON.parse(stdout) as RouteOut;
  } catch {
    throw new Stop(`${script} printed no JSON.`, 1);
  }
  emit(io, a, out, routeLines(out));
  return 0;
}
