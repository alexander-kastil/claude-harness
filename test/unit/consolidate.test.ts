import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { compareSkill, consolidateApply, consolidatePlan, routesOf } from '../../src/consolidate';
import { Asset, globalScope, linkCopies, pluginViews, repoScope, scan } from '../../src/harness';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `consolidate-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const skill = (name: string, body = 'Body') => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`;

/**
 * A fake home with global skills, a directory marketplace (a source folder) with a plugin that ships `shipped`,
 * a plugin installed from a GitHub marketplace (cache copy only) that ships `cached`, and a repo with copies.
 */
function fixture() {
  const home = tmp('home');
  const market = tmp('market');
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'local-market', plugins: [{ name: 'tools', source: './plugins/tools' }] }));
  write(market, 'plugins/tools/skills/shipped/SKILL.md', skill('shipped', 'Plugin text'));
  write(market, 'plugins/tools/skills/shipped/references/a.md', '# A\n');
  const cache = path.join(home, 'plugins', 'cache', 'gh-market', 'cached-plugin', '1.0.0');
  write(cache, 'skills/cached/SKILL.md', skill('cached'));
  write(home, 'plugins/known_marketplaces.json', JSON.stringify({
    'local-market': { source: { source: 'directory', path: market }, installLocation: market },
    'gh-market': { source: { source: 'github', repo: 'x/y' }, installLocation: path.join(home, 'plugins', 'marketplaces', 'gh-market') },
  }));
  write(home, 'plugins/installed_plugins.json', JSON.stringify({
    plugins: {
      'tools@local-market': [{ scope: 'user', installPath: path.join(home, 'plugins', 'cache', 'local-market', 'tools', '1.0.0'), version: '1.0.0' }],
      'cached-plugin@gh-market': [{ scope: 'user', installPath: cache, version: '1.0.0' }],
    },
  }));
  // The installed copy of the directory plugin: what an update overwrites.
  write(home, 'plugins/cache/local-market/tools/1.0.0/skills/shipped/SKILL.md', skill('shipped', 'Plugin text'));
  write(home, 'skills/shared/SKILL.md', skill('shared'));
  const repo = tmp('repo');
  const views = () => {
    const g = globalScope(home);
    const r = repoScope(repo);
    const list = [g, r].map(s => ({ id: s.id, label: s.label, path: s.base, categories: scan(s) }));
    linkCopies(list, pluginViews(home));
    return { list, repoSkill: (name: string) => list[1].categories.find(c => c.kind === 'skill')!.items.find(a => a.name === name) as Asset, global: g };
  };
  return { home, market, cache, repo, views };
}

test('compareSkill reads a skill folder as identical, nearly identical, contained, differs or new', () => {
  const [a, b] = [tmp('a'), tmp('b')];
  write(a, 'SKILL.md', skill('x'));
  write(a, 'references/r.md', '# R\n');
  assert.equal(compareSkill(a, path.join(b, 'missing')).state, 'new');
  assert.equal(compareSkill(a, path.join(b, 'missing')).files, 2);

  write(b, 'SKILL.md', skill('x').replace(/\n/g, '\r\n'));
  write(b, 'references/r.md', '# R\r\n');
  assert.equal(compareSkill(a, b).state, 'identical');

  write(b, 'SKILL.md', `---\nname: x\nversion: 2\ndescription: x skill\n---\n\nBody\n`);
  assert.equal(compareSkill(a, b).state, 'near');

  write(b, 'scripts/run.ps1', 'echo');
  const contained = compareSkill(a, b);
  assert.equal(contained.state, 'contained');
  assert.deepEqual(contained.targetOnly, ['scripts/run.ps1']);

  write(a, 'scripts/only-here.ps1', 'echo');
  write(b, 'references/r.md', '# Changed\n');
  const differs = compareSkill(a, b);
  assert.equal(differs.state, 'differs');
  assert.deepEqual(differs.changed, ['references/r.md']);
  assert.deepEqual(differs.repoOnly, ['scripts/only-here.ps1']);
});

test('routesOf offers retire, move, or the two merges', () => {
  assert.deepEqual(routesOf('identical'), ['retire']);
  assert.deepEqual(routesOf('near'), ['retire']);
  assert.deepEqual(routesOf('contained'), ['retire']);
  assert.deepEqual(routesOf('new'), ['move']);
  assert.deepEqual(routesOf('differs'), ['diff', 'claude']);
});

test('the default target is the plugin source folder that ships the skill, then global', () => {
  const f = fixture();
  write(f.repo, '.claude/skills/shipped/SKILL.md', skill('shipped', 'Plugin text'));
  write(f.repo, '.claude/skills/shipped/references/a.md', '# A\n');
  write(f.home, 'skills/shipped/SKILL.md', skill('shipped', 'Global text'));
  const { repoSkill } = f.views();
  const plan = consolidatePlan(repoSkill('shipped'), f.repo, f.home);
  assert.equal(plan.block, undefined);
  assert.deepEqual(plan.targets.map(t => t.id), ['tools@local-market', 'global']);
  // Written to the marketplace's source folder, never to the installed copy under plugins/cache.
  assert.equal(plan.targets[0].dir, path.join(f.market, 'plugins', 'tools', 'skills', 'shipped'));
  assert.equal(plan.targets[0].state, 'identical');
  assert.equal(plan.targets[1].state, 'differs');
  assert.ok(plan.targets.every(t => !t.dir.includes(`${path.sep}cache${path.sep}`)));
});

test('a skill only in a plugin without a source folder offers global alone, with a note', () => {
  const f = fixture();
  write(f.repo, '.claude/skills/cached/SKILL.md', skill('cached', 'Edited'));
  const { repoSkill } = f.views();
  const plan = consolidatePlan(repoSkill('cached'), f.repo, f.home);
  assert.deepEqual(plan.targets.map(t => t.id), ['global']);
  assert.equal(plan.targets[0].state, 'new');
  assert.equal(plan.notes.length, 1);
  assert.match(plan.notes[0], /cached-plugin@gh-market/);
});

test('a skill only in the repo goes to global, whole folder; a global one with that name refuses the move', () => {
  const f = fixture();
  write(f.repo, '.claude/skills/solo/SKILL.md', skill('solo'));
  write(f.repo, '.claude/skills/solo/references/deep/notes.md', '# Notes\n');
  write(f.repo, '.claude/skills/solo/scripts/run.ps1', 'echo');
  const { repoSkill } = f.views();
  const asset = repoSkill('solo');
  const plan = consolidatePlan(asset, f.repo, f.home);
  assert.deepEqual(plan.targets.map(t => [t.id, t.state]), [['global', 'new']]);
  const backups = path.join(f.home, 'repo-sync-backups');
  const dest = consolidateApply(asset, f.repo, plan.targets[0], 'move', backups, '20261024-120000');
  for (const rel of ['SKILL.md', 'references/deep/notes.md', 'scripts/run.ps1']) assert.ok(fs.existsSync(path.join(f.home, 'skills', 'solo', ...rel.split('/'))), rel);
  assert.ok(!fs.existsSync(asset.dir!), 'the repo copy is gone');
  assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')), 'and backed up');

  // The name is taken now: a second skill of that name cannot be moved over it.
  write(f.repo, '.claude/skills/solo/SKILL.md', skill('solo', 'Other'));
  const again = f.views().repoSkill('solo');
  const target = consolidatePlan(again, f.repo, f.home).targets[0];
  assert.equal(target.state, 'differs');
  assert.throws(() => consolidateApply(again, f.repo, { ...target, state: 'new' }, 'move', backups, '20261024-120001'), /already has a skill named solo/);
  assert.ok(fs.existsSync(again.dir!), 'nothing was removed');
  assert.match(fs.readFileSync(path.join(f.home, 'skills', 'solo', 'SKILL.md'), 'utf8'), /Body/);
});

test('an identical copy is retired into the backup and the target stays untouched', () => {
  const f = fixture();
  write(f.repo, '.claude/skills/shared/SKILL.md', skill('shared').replace(/\n/g, '\r\n'));
  const asset = f.views().repoSkill('shared');
  const target = consolidatePlan(asset, f.repo, f.home).targets[0];
  assert.equal(target.id, 'global');
  assert.equal(target.state, 'identical');
  const before = fs.readFileSync(path.join(f.home, 'skills', 'shared', 'SKILL.md'), 'utf8');
  const dest = consolidateApply(asset, f.repo, target, 'retire', path.join(f.home, 'repo-sync-backups'), '20261024-120002');
  assert.ok(!fs.existsSync(asset.dir!));
  assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')));
  assert.equal(fs.readFileSync(path.join(f.home, 'skills', 'shared', 'SKILL.md'), 'utf8'), before);
});

test('a copy that differs is not retired until the target has its changes', () => {
  const f = fixture();
  write(f.repo, '.claude/skills/shared/SKILL.md', skill('shared', 'Repo edit'));
  write(f.repo, '.claude/skills/shared/references/new.md', '# New\n');
  const asset = f.views().repoSkill('shared');
  const target = consolidatePlan(asset, f.repo, f.home).targets[0];
  assert.equal(target.state, 'differs');
  assert.deepEqual(target.repoOnly, ['references/new.md']);
  const backups = path.join(f.home, 'repo-sync-backups');
  assert.throws(() => consolidateApply(asset, f.repo, target, 'retire', backups, '20261024-120003'), /still has changes/);
  assert.ok(fs.existsSync(asset.dir!), 'the repo copy stays');

  // The owner merges the changes into the target (here the target also keeps a file of its own): now it is retired.
  write(f.home, 'skills/shared/SKILL.md', skill('shared', 'Repo edit'));
  write(f.home, 'skills/shared/references/new.md', '# New\n');
  write(f.home, 'skills/shared/references/target-only.md', '# Mine\n');
  const merged = consolidatePlan(asset, f.repo, f.home).targets[0];
  assert.equal(merged.state, 'contained');
  consolidateApply(asset, f.repo, merged, 'retire', backups, '20261024-120004');
  assert.ok(!fs.existsSync(asset.dir!));
});

test('only a repo skill is consolidated, and a repo that keeps its copies is left alone', () => {
  const f = fixture();
  write(f.repo, '.claude/skills/shared/SKILL.md', skill('shared'));
  const { list, repoSkill, global } = f.views();
  const globalSkill = list[0].categories.find(c => c.kind === 'skill')!.items.find(a => a.name === 'shared')!;
  assert.match(consolidatePlan(globalSkill, undefined, f.home).block!, /Only a repo skill/);
  assert.ok(global.root);
  fs.mkdirSync(path.join(f.repo, 'labs'));
  assert.match(consolidatePlan(repoSkill('shared'), f.repo, f.home, { folders: ['labs'] }).block!, /keeps its copies/);
  const agent = { ...repoSkill('shared'), kind: 'agent' } as Asset;
  assert.match(consolidatePlan(agent, f.repo, f.home).block!, /Only skills/);
});
