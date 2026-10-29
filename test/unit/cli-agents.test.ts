import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { run } from '../../src/cli';
import type { AgentsListOut, RouteOut } from '../../src/cli-agents';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `agents-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const agent = (name: string, description: string, body = 'Body', extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`;

/** A fake delegation plugin: hooks/route.mjs exports its routing pattern, "manual-only"; scripts/route.mjs prints a fixed object with what it was given. */
const GATED_JS = 'export const GATED = /manual-only/i;\n';
const ROUTE_JS = `const at = flag => process.argv[process.argv.indexOf(flag) + 1];
const prompt = at('--prompt');
const none = prompt.includes('nothing');
console.log(JSON.stringify({
  script: import.meta.url, prompt, repo: at('--repo'), root: at('--root'),
  stacks: none ? [] : ['node'],
  owners: none ? [] : [{ name: 'helper', score: 2, terms: ['docs'], scope: 'global' }],
  dropped: [{ name: 'plugged', reason: 'gated' }],
  fallback: none ? 'Specialists for this prompt: \`vscode-ext-specialist\` (global), owner of this repo.' : null,
}));
`;

/**
 * A fake Claude folder: Global has helper, shared and moved agents; a repo has shared (identical), moved (changed),
 * routed (gated by its routing.json) and flagged (gated by its frontmatter); the helpers plugin has plugged (gated by the router's pattern).
 */
function fixture(withRouter = true) {
  const root = tmp('root');
  const repo = tmp('repo');
  const userConfig = path.join(tmp('cfg'), '.claude.json');
  const market = tmp('market');
  const router = path.join(root, 'plugins', 'cache', 'router');
  const source = path.join(market, 'plugins', 'agent-control-plugin');
  const helpers = path.join(root, 'plugins', 'cache', 'helpers');
  // The cache copy predates scripts/route.mjs; the directory source has both files.
  if (withRouter) write(router, 'hooks/route.mjs', GATED_JS);
  else write(router, 'README.md', 'no route script\n');
  if (withRouter) {
    write(source, 'hooks/route.mjs', GATED_JS);
    write(source, 'scripts/route.mjs', ROUTE_JS);
  }
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins: [{ name: 'agent-control-plugin', source: './plugins/agent-control-plugin' }] }));
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ own: { source: { source: 'directory', path: market }, installLocation: market } }));
  write(root, 'plugins/installed_plugins.json', JSON.stringify({ plugins: { 'agent-control-plugin@own': [{ installPath: router }], 'helpers@own': [{ installPath: helpers }] } }));
  write(helpers, 'agents/plugged.md', agent('plugged', 'Runs on manual-only requests. Second sentence.'));
  write(root, 'agents/helper.md', agent('helper', 'Helps with things. Second sentence here.', 'Hi', 'model: haiku\ntools: Read, Grep\n'));
  write(root, 'agents/shared.md', agent('shared', 'Shared agent.'));
  write(root, 'agents/moved.md', agent('moved', 'Moved agent.', 'Global text'));
  write(repo, 'CLAUDE.md', '# repo\n');
  write(repo, '.claude/agents/shared.md', agent('shared', 'Shared agent.'));
  write(repo, '.claude/agents/moved.md', agent('moved', 'Moved agent.', 'Repo text'));
  write(repo, '.claude/agents/routed.md', agent('routed', 'Routed agent.'));
  write(repo, '.claude/agents/flagged.md', agent('flagged', 'Flagged agent.', 'Body', 'gated: true\n'));
  write(repo, '.claude/routing.json', JSON.stringify({ gated: ['routed'] }));
  write(path.dirname(userConfig), '.claude.json', JSON.stringify({ projects: { [repo]: {} } }));
  const base = ['--root', root, '--user-config', userConfig, '--repos', repo];
  return { root, repo, router, source, base };
}

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('agents list --json lists every agent with its scope, gate and copy states, and counts them', async () => {
  const f = fixture();
  const o = JSON.parse((await cli(['agents', 'list', '--json', ...f.base])).out) as AgentsListOut & { applied: boolean };
  assert.equal(o.applied, false);
  const names = o.agents.map(a => `${a.name}:${a.scope === 'global' ? 'global' : a.scope.startsWith('plugin:') ? 'plugin' : 'repo'}`);
  assert.deepEqual(names, ['flagged:repo', 'helper:global', 'moved:global', 'moved:repo', 'plugged:plugin', 'routed:repo', 'shared:global', 'shared:repo']);
  assert.deepEqual(o.counts, { global: 3, plugins: 1, repos: 4, gated: 3, drifted: 2 });
  const gated = o.agents.filter(a => a.gated).map(a => a.name).sort();
  assert.deepEqual(gated, ['flagged', 'plugged', 'routed']);
  const sharedGlobal = o.agents.find(a => a.name === 'shared' && a.scope === 'global')!;
  assert.deepEqual(sharedGlobal.copies.map(c => c.state), ['identical']);
  const movedGlobal = o.agents.find(a => a.name === 'moved' && a.scope === 'global')!;
  assert.deepEqual(movedGlobal.copies.map(c => c.state), ['differs']);
});

test('the summary is the first sentence, and model and tools come from the frontmatter', async () => {
  const f = fixture();
  const o = JSON.parse((await cli(['agents', 'list', '--json', ...f.base])).out) as AgentsListOut;
  const helper = o.agents.find(a => a.name === 'helper')!;
  assert.equal(helper.summary, 'Helps with things.');
  assert.equal(helper.model, 'haiku');
  assert.deepEqual(helper.tools, ['Read', 'Grep']);
  const plugged = o.agents.find(a => a.name === 'plugged')!;
  assert.equal(plugged.summary, 'Runs on manual-only requests.');
  assert.equal(plugged.model, null);
});

test('the text form is a headline, then one table row per agent', async () => {
  const f = fixture();
  const text = (await cli(['agents', 'list', ...f.base])).out;
  assert.equal(text.split('\n')[0], '**Agents · 8 · 3 gated · 2 drifted**');
  assert.match(text, /^\| Agent\s+\| Scope\s+\| Model\s+\| Tools\s+\| Gated\s+\| Copies\s+\| Summary\s+\|$/m);
  const rows = text.split('\n').filter(l => /^\| [a-z]/.test(l));
  assert.equal(rows.length, 8);
  assert.match(text, /^\| helper\s+\| global\s+\| haiku\s+\| Read, Grep\s+\| no\s+\|\s+\| Helps with things\.\s+\|$/m);
});

test('the plugin gate comes from the router pattern; without a route.mjs only the frontmatter and routing gate', async () => {
  const f = fixture(false);
  const o = JSON.parse((await cli(['agents', 'list', '--json', ...f.base])).out) as AgentsListOut;
  assert.equal(o.agents.find(a => a.name === 'plugged')!.gated, false);
  assert.equal(o.agents.find(a => a.name === 'routed')!.gated, true);
  assert.equal(o.agents.find(a => a.name === 'flagged')!.gated, true);
  assert.equal(o.counts.gated, 2);
});

test('agents route runs route.mjs with the prompt as one argument and emits its object with applied false', async () => {
  const f = fixture();
  const prompt = 'docs; echo hacked && rm -rf x';
  const r = await cli(['agents', 'route', prompt, '--repo', f.repo, ...f.base, '--json']);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as RouteOut & { script: string; repo: string; root: string; applied: boolean };
  assert.equal(o.script, pathToFileURL(path.join(f.source, 'scripts', 'route.mjs')).href);
  assert.equal(o.prompt, prompt);
  assert.equal(o.repo, f.repo);
  assert.equal(o.root, f.root);
  assert.deepEqual(o.owners, [{ name: 'helper', score: 2, terms: ['docs'], scope: 'global' }]);
  assert.deepEqual(o.dropped, [{ name: 'plugged', reason: 'gated' }]);
  assert.equal(o.fallback, null);
  assert.equal(o.applied, false);
});

test('agents route text is a headline naming the prompt, an owner table and a dropped table', async () => {
  const f = fixture();
  const r = await cli(['agents', 'route', 'write docs', ...f.base]);
  assert.equal(r.code, 0);
  assert.equal(r.out.split('\n')[0], '**Routing "write docs"**');
  assert.match(r.out, /^\| Owner\s+\| Score\s+\| Terms\s+\| Scope\s+\|$/m);
  assert.match(r.out, /^\| helper\s+\|\s+2\s+\| docs\s+\| global\s+\|$/m);
  assert.match(r.out, /^\| Dropped\s+\| Reason\s+\|$/m);
  assert.match(r.out, /^\| plugged\s+\| gated\s+\|$/m);
  assert.match(r.out, /^\| Stacks\s+\| Fallback\s+\|$/m);
  assert.match(r.out, /^\| node\s+\| \(none\)\s+\|$/m);
});

test('agents route with no owner keeps the tables: a (none) owner row and the fallback specialist', async () => {
  const f = fixture();
  const r = await cli(['agents', 'route', 'nothing to route', ...f.base]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^\| \(none\)\s+\|\s+\|\s+\|\s+\|$/m);
  assert.doesNotMatch(r.out, /No owner/);
  assert.match(r.out, /^\| \(none\)\s+\| vscode-ext-specialist \(global\)\s+\|$/m);
});

test('agents route without a prompt exits 2', async () => {
  const f = fixture();
  const r = await cli(['agents', 'route', ...f.base]);
  assert.equal(r.code, 2);
  assert.match(r.err, /needs a prompt/);
});

test('agents route without an installed router exits 1 and names it', async () => {
  const f = fixture();
  fs.rmSync(path.join(f.root, 'plugins', 'installed_plugins.json'));
  fs.rmSync(path.join(f.root, 'plugins', 'known_marketplaces.json'));
  const r = await cli(['agents', 'route', 'docs', ...f.base]);
  assert.equal(r.code, 1);
  assert.match(r.err, /agent-control-plugin is not installed/);
});

test('agents route with a router that has no scripts/route.mjs exits 1 and names the file', async () => {
  const f = fixture(false);
  const r = await cli(['agents', 'route', 'docs', ...f.base]);
  assert.equal(r.code, 1);
  assert.match(r.err, /scripts[\\/]route\.mjs/);
});

test('agents without list or route exits 2', async () => {
  const f = fixture();
  assert.equal((await cli(['agents', ...f.base])).code, 2);
});
