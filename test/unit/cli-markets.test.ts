import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import type { MarketplacesOut, RenameOut } from '../../src/cli-markets';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `markets-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/**
 * A Claude folder with two marketplaces: "own" is a directory on disk with two plugins (alpha is installed one version behind its
 * source, beta is enabled but not installed) and "hosted" is a GitHub marketplace with one installed plugin. A repo enables alpha.
 */
function fixture() {
  const root = tmp('root');
  const market = tmp('own');
  const hosted = tmp('hosted');
  const repo = tmp('repo');
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins: [{ name: 'alpha', source: './plugins/alpha', version: '1.2.0' }, { name: 'beta', source: './plugins/beta', version: '0.1.0' }] }));
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ own: { source: { source: 'directory', path: market }, installLocation: market }, hosted: { source: { source: 'github', repo: 'example/hosted' }, installLocation: hosted } }));
  write(root, 'plugins/installed_plugins.json', JSON.stringify({ plugins: { 'alpha@own': [{ scope: 'user', version: '1.0.0' }], 'other@hosted': [{ scope: 'user', version: '2.0.0' }] } }));
  write(root, 'settings.json', JSON.stringify({ enabledPlugins: { 'alpha@own': true, 'beta@own': true, 'other@hosted': true } }));
  write(repo, '.claude/settings.json', JSON.stringify({ enabledPlugins: { 'alpha@own': true } }, null, 2));
  const userConfig = path.join(tmp('config'), 'claude.json');
  write(path.dirname(userConfig), 'claude.json', '{}');
  return { root, market, hosted, repo, base: ['--root', root, '--user-config', userConfig] };
}

test('marketplaces lists each marketplace with its plugin counts and the problems', async () => {
  const f = fixture();
  const r = await cli(['marketplaces', ...f.base]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^\*\*Marketplaces: 2, 2 problems\*\*/);
  assert.match(r.out, /\| own\s+\| directory/);
  assert.match(r.out, /\| Update available\s+\| 1\.0\.0\s+\| 1\.2\.0/);
  assert.match(r.out, /\| Enabled, not installed/);
});

test('marketplaces --json gives one object with the counts, the problems and applied false', async () => {
  const f = fixture();
  const r = await cli(['marketplaces', '--json', ...f.base]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as MarketplacesOut & { applied: boolean };
  assert.equal(o.applied, false);
  const own = o.marketplaces.find(m => m.name === 'own')!;
  assert.deepEqual([own.plugins, own.installed, own.enabled, own.updates], [2, 1, 2, 1]);
  const hosted = o.marketplaces.find(m => m.name === 'hosted')!;
  assert.deepEqual([hosted.kind, hosted.plugins, hosted.installed, hosted.enabled], ['github', 1, 1, 1]);
  assert.deepEqual(o.problems.map(p => [p.plugin, p.problem]), [
    ['alpha', 'Update available'],
    ['beta', 'Enabled, not installed'],
  ]);
});

test('marketplaces with no marketplace prints a (none) row and no problems table', async () => {
  const root = tmp('empty');
  const r = await cli(['marketplaces', '--root', root]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^\*\*Marketplaces: 0, 0 problems\*\*/);
  assert.match(r.out, /\(none\)/);
  assert.doesNotMatch(r.out, /Problems/);
});

test('marketplaces rename --dry-run prints each rewrite and writes nothing', async () => {
  const f = fixture();
  const before = [read(f.root, 'settings.json'), read(f.market, '.claude-plugin/marketplace.json'), read(f.repo, '.claude/settings.json')];
  const r = await cli(['marketplaces', 'rename', '--from', 'own', '--to', 'mine', '--dry-run', '--repo', f.repo, '--json', ...f.base]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as RenameOut & { applied: boolean };
  assert.equal(o.applied, false);
  assert.equal(o.changes.length, 3);
  assert.deepEqual(o.commands.slice(0, 2), ['claude plugin marketplace remove own', `claude plugin marketplace add "${f.market}"`]);
  assert.deepEqual([read(f.root, 'settings.json'), read(f.market, '.claude-plugin/marketplace.json'), read(f.repo, '.claude/settings.json')], before);
});

test('marketplaces rename rewrites the settings, the catalog and the repo settings', async () => {
  const f = fixture();
  const r = await cli(['marketplaces', 'rename', '--from', 'own', '--to', 'mine', '--repo', f.repo, ...f.base]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^\*\*Rename own to mine: 3 files\*\*/);
  assert.doesNotMatch(r.out, /dry-run/);
  assert.deepEqual(JSON.parse(read(f.root, 'settings.json')).enabledPlugins, { 'alpha@mine': true, 'beta@mine': true, 'other@hosted': true });
  assert.equal(JSON.parse(read(f.market, '.claude-plugin/marketplace.json')).name, 'mine');
  assert.deepEqual(JSON.parse(read(f.repo, '.claude/settings.json')).enabledPlugins, { 'alpha@mine': true });
  const again = await cli(['marketplaces', '--json', ...f.base]);
  assert.equal(JSON.parse(again.out).marketplaces.some((m: { name: string }) => m.name === 'mine'), false);
});

test('marketplaces rename exits 1 for an unknown name, an existing target and a hosted marketplace', async () => {
  const f = fixture();
  const unknown = await cli(['marketplaces', 'rename', '--from', 'nope', '--to', 'mine', ...f.base]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /There is no marketplace named nope/);
  const taken = await cli(['marketplaces', 'rename', '--from', 'own', '--to', 'hosted', '--dry-run', ...f.base]);
  assert.equal(taken.code, 1);
  assert.match(taken.err, /hosted already exists/);
  const hostedOnly = await cli(['marketplaces', 'rename', '--from', 'hosted', '--to', 'mine', '--dry-run', ...f.base]);
  assert.equal(hostedOnly.code, 1);
  assert.match(hostedOnly.err, /is a github marketplace/);
});

test('marketplaces rename exits 2 for a missing flag, a bad name and an unknown word', async () => {
  const f = fixture();
  const missing = await cli(['marketplaces', 'rename', '--from', 'own', ...f.base]);
  assert.equal(missing.code, 2);
  const bad = await cli(['marketplaces', 'rename', '--from', 'own', '--to', 'Not Valid', '--dry-run', ...f.base]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /lowercase letters, digits and dashes/);
  const word = await cli(['marketplaces', 'remove', ...f.base]);
  assert.equal(word.code, 2);
});
