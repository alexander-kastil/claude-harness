import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { Asset, globalScope, linkCopies, repoScope, scan } from '../../src/harness';
import { keyChanges, mcpApply, mcpVersions, syncApply, syncFiles, syncSource, updateMarketPlugins, updatePluginFromMarket } from '../../src/sync';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `sync-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`;

test('a repo skill that differs from Global is replaced, added to and trimmed, with a backup', () => {
  const home = tmp('home');
  const repo = tmp('repo');
  write(home, 'skills/tool/SKILL.md', skill('tool', 'Global text'));
  write(home, 'skills/tool/references/new.md', '# New\n');
  write(home, 'skills/tool/references/same.md', '# Same\n');
  write(repo, '.claude/skills/tool/SKILL.md', skill('tool', 'Repo text'));
  write(repo, '.claude/skills/tool/references/same.md', '# Same\r\n');
  write(repo, '.claude/skills/tool/references/old.md', '# Old\n');
  const global = globalScope(path.join(home));
  const views = [global, repoScope(repo, path.join(home, 'none.json'))].map(s => ({ id: s.id, label: s.label, path: s.base, categories: scan(s) }));
  linkCopies(views);
  const asset = views[1].categories.find(c => c.kind === 'skill')!.items[0];
  const { source, block } = syncSource(asset, repo);
  assert.equal(block, undefined);
  const from = views[0].categories.find(c => c.kind === 'skill')!.items.find(a => a.id === source!.id) as Asset;
  assert.deepEqual(syncFiles(asset, from), { replaced: ['SKILL.md'], added: ['references/new.md'], deleted: ['references/old.md'] });
  const backup = syncApply(asset, from, repo, path.join(home, 'repo-sync-backups'), '20260101-000000');
  assert.ok(fs.existsSync(path.join(backup, 'references', 'old.md')));
  assert.match(fs.readFileSync(path.join(repo, '.claude/skills/tool/SKILL.md'), 'utf8'), /Global text/);
  assert.ok(fs.existsSync(path.join(repo, '.claude/skills/tool/references/new.md')));
  assert.ok(!fs.existsSync(path.join(repo, '.claude/skills/tool/references/old.md')));
});

test('an identical repo copy has nothing to sync', () => {
  const home = tmp('home');
  const repo = tmp('repo');
  write(home, 'agents/a.md', '---\nname: a\n---\nBody\n');
  write(repo, '.claude/agents/a.md', '---\nname: a\n---\nBody\n');
  const views = [globalScope(home), repoScope(repo, path.join(home, 'none.json'))].map(s => ({ id: s.id, label: s.label, path: s.base, categories: scan(s) }));
  linkCopies(views);
  const asset = views[1].categories.find(c => c.kind === 'agent')!.items[0];
  assert.match(syncSource(asset, repo).block ?? '', /identical/);
});

test('an MCP entry is written into the other files and nothing else changes', () => {
  const dir = tmp('mcp');
  write(dir, 'a/.mcp.json', '{\n  "mcpServers": {\n    "x": { "command": "old", "args": ["1"] },\n    "keep": { "url": "https://k" }\n  }\n}\n');
  write(dir, 'b/.mcp.json', '{\r\n  "mcpServers": {\r\n    "x": { "command": "new", "args": ["1"], "env": { "A": "b" } }\r\n  }\r\n}\r\n');
  const asset = (rel: string): Asset => ({ id: rel, scope: rel, kind: 'mcp', name: 'x', description: '', file: path.join(dir, rel, '.mcp.json'), jsonPath: ['mcpServers', 'x'], mtime: 0, source: 'project' });
  const [a, b] = [asset('a'), asset('b')];
  const versions = mcpVersions([a, b]);
  assert.equal(versions.length, 2);
  assert.deepEqual(keyChanges(versions[1].config, versions[0].config), ['command (changed)', 'env (added)']);
  mcpApply(versions[1].config, [{ asset: a, label: 'a', keys: [] }], path.join(dir, 'backups'), 's');
  const after = fs.readFileSync(a.file, 'utf8');
  assert.match(after, /"command": "new"/);
  assert.match(after, /"keep": \{ "url": "https:\/\/k" \}/);
  assert.ok(fs.existsSync(path.join(dir, 'backups', 's', 'mcp')));
  assert.equal(mcpVersions([a, b]).length, 1);
});

test('a plugin sync refreshes the marketplace, then updates, and checks the version', async () => {
  const root = tmp('root');
  const calls: string[] = [];
  const run = async (args: string[]) => {
    calls.push(args.join(' '));
    if (args[1] === 'update') write(root, 'plugins/installed_plugins.json', JSON.stringify({ plugins: { 'p@m': [{ scope: 'user', version: '2.0.0' }] } }));
    return { code: 0, out: '' };
  };
  await updatePluginFromMarket('p@m', 'm', '2.0.0', root, run);
  assert.deepEqual(calls, ['plugin marketplace update m', 'plugin update p@m']);
  await assert.rejects(updatePluginFromMarket('p@m', 'm', '3.0.0', root, run), /installed 2\.0\.0/);
});

test('a marketplace sync refreshes the marketplace once, updates each plugin that is ahead, and goes on past a failure', async () => {
  const root = tmp('root');
  const calls: string[] = [];
  const versions: Record<string, { scope: string; version: string }[]> = {};
  const run = async (args: string[]) => {
    calls.push(args.join(' '));
    if (args[1] === 'update' && args[2] !== 'b@m') {
      versions[args[2]] = [{ scope: 'user', version: '2.0.0' }];
      write(root, 'plugins/installed_plugins.json', JSON.stringify({ plugins: versions }));
    }
    return { code: args[2] === 'b@m' ? 1 : 0, out: args[2] === 'b@m' ? 'b broke' : '' };
  };
  const steps: string[] = [];
  const result = await updateMarketPlugins('m', [{ key: 'a@m', want: '2.0.0' }, { key: 'b@m', want: '2.0.0' }, { key: 'c@m', want: '2.0.0' }], root, run, (key, done) => steps.push(`${key}:${done}`));
  assert.deepEqual(calls, ['plugin marketplace update m', 'plugin update a@m', 'plugin update b@m', 'plugin update c@m']);
  assert.deepEqual(result.synced, ['a@m', 'c@m']);
  assert.deepEqual(result.failed.map(f => f.key), ['b@m']);
  assert.match(result.failed[0].error, /b broke/);
  assert.deepEqual(steps, ['a@m:0', 'b@m:1', 'c@m:2']);
});
