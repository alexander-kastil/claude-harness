import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import type { SkillsOut } from '../../src/cli-skills';
import type { PluginRenameOut } from '../../src/cli-plugins';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `rename-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const has = (root: string, rel: string) => fs.existsSync(path.join(root, rel));

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function skillFixture() {
  const root = tmp('skill-root');
  write(root, 'skills/old-skill/SKILL.md', '---\nname: old-skill\ndescription: Old skill\n---\n\nSee old-skill/references/a.md.\n');
  write(root, 'skills/old-skill/references/a.md', '# A\n');
  write(root, 'skills/user/SKILL.md', '---\nname: user\ndescription: u\n---\n\nUse old-skill, or plug:old-skill, but not old-skills.\n');
  write(root, 'agents/maker.md', '---\nname: maker\n---\n\nThe old-skill skill.\n');
  return root;
}

test('skills rename --dry-run lists the changes and writes nothing', async () => {
  const root = skillFixture();
  const r = await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'new-skill', '--dry-run', '--json', '--root', root]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as SkillsOut & { applied: boolean };
  assert.equal(o.op, 'rename');
  assert.equal(o.applied, false);
  assert.equal(o.backup, null);
  assert.ok(o.changes.some(c => c.action === 'rename'));
  assert.ok(has(root, 'skills/old-skill/SKILL.md') && !has(root, 'skills/new-skill'));
  assert.match(read(root, 'agents/maker.md'), /old-skill/);
  assert.ok(!has(root, 'repo-sync-backups'));
});

test('skills rename renames the folder and the name line, repoints mentions, backs up, and a second run exits 1', async () => {
  const root = skillFixture();
  const r = await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'new-skill', '--json', '--root', root]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as SkillsOut & { applied: boolean };
  assert.equal(o.applied, true);
  assert.ok(o.backup);
  assert.ok(!has(root, 'skills/old-skill') && has(root, 'skills/new-skill/references/a.md'));
  assert.match(read(root, 'skills/new-skill/SKILL.md'), /^---\nname: new-skill\n/);
  assert.match(read(root, 'skills/new-skill/SKILL.md'), /new-skill\/references\/a\.md/);
  assert.match(read(root, 'skills/user/SKILL.md'), /Use new-skill, or plug:new-skill, but not old-skills\./);
  assert.match(read(root, 'agents/maker.md'), /The new-skill skill/);
  assert.match(fs.readFileSync(path.join(o.backup!, 'agents/maker.md'), 'utf8'), /old-skill/);
  assert.equal((await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'other', '--root', root])).code, 1);
});

test('skills rename leaves a plugin prefix alone: x-conventions:x-conventions becomes x-conventions:x', async () => {
  const root = tmp('skill-prefix');
  write(root, 'skills/x-conventions/SKILL.md', '---\nname: x-conventions\ndescription: x\n---\n\nBody\n');
  write(root, 'agents/a.md', 'Use x-conventions:x-conventions and the x-conventions skill.\n');
  const r = await cli(['skills', 'rename', '--from', 'x-conventions', '--to', 'x', '--root', root]);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(root, 'agents/a.md'), 'Use x-conventions:x and the x skill.\n');
  assert.match(read(root, 'skills/x/SKILL.md'), /name: x\n/);
});

test('skills rename stops when the new name exists, and finds a skill in the market', async () => {
  const root = skillFixture();
  assert.equal((await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'user', '--root', root])).code, 1);
  const market = tmp('skill-market');
  write(market, 'plugins/p/skills/inner/SKILL.md', '---\nname: inner\ndescription: i\n---\n\nBody\n');
  const r = await cli(['skills', 'rename', '--from', 'inner', '--to', 'core', '--market', market, '--root', root]);
  assert.equal(r.code, 0);
  assert.match(read(market, 'plugins/p/skills/core/SKILL.md'), /name: core/);
  assert.ok(!has(market, 'plugins/p/skills/inner'));
});

function pluginFixture() {
  const root = tmp('plugin-root');
  const market = tmp('plugin-market');
  const repo = tmp('plugin-repo');
  const userConfig = path.join(tmp('plugin-cfg'), 'claude.json');
  fs.writeFileSync(userConfig, '{}');
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins: [{ name: 'old-plug', source: './plugins/old-plug' }, { name: 'dep', source: './plugins/dep' }] }, null, 2));
  write(market, 'plugins/old-plug/.claude-plugin/plugin.json', JSON.stringify({ name: 'old-plug', version: '1.0.0' }, null, 2));
  write(market, 'plugins/old-plug/skills/s/SKILL.md', '---\nname: s\n---\n\nRun old-plug:s.\n');
  write(market, 'plugins/dep/.claude-plugin/plugin.json', JSON.stringify({ name: 'dep', dependencies: ['old-plug', 'keep'] }, null, 2));
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ own: { source: { source: 'directory', path: market }, installLocation: market } }));
  write(root, 'settings.json', JSON.stringify({ enabledPlugins: { 'old-plug@own': true, 'other@own': true } }, null, 2));
  write(root, 'CLAUDE.md', 'Use old-plug:s, install old-plug@own, see plugins/old-plug/hooks and the old-plug plugin.\n');
  write(root, 'rules/r.md', 'Rule for old-plug:s.\n');
  write(repo, 'CLAUDE.md', 'Repo uses old-plug@own.\n');
  write(repo, '.claude/settings.local.json', JSON.stringify({ enabledPlugins: { 'old-plug@own': false } }, null, 2));
  write(repo, '.claude/rules/x.md', 'Mentions old-plug:s and old-plug-extra.\n');
  const base = ['--root', root, '--repo', repo, '--user-config', userConfig];
  return { root, market, repo, base };
}

const renameArgs = ['plugins', 'rename', '--from', 'old-plug@own', '--to', 'new-plug'];

test('plugins rename --dry-run lists the changes and writes nothing', async () => {
  const f = pluginFixture();
  const r = await cli([...renameArgs, '--dry-run', '--json', ...f.base]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as PluginRenameOut & { applied: boolean };
  assert.equal(o.applied, false);
  assert.equal(o.backup, null);
  assert.equal(o.commands.length, 4);
  assert.match(o.commands[3], /claude plugin install new-plug@own/);
  assert.ok(o.changes.some(c => c.action === 'rename'));
  assert.ok(has(f.market, 'plugins/old-plug') && !has(f.market, 'plugins/new-plug'));
  assert.match(read(f.root, 'CLAUDE.md'), /old-plug:s/);
  assert.ok(!has(f.root, 'repo-sync-backups'));
});

test('plugins rename moves the folder, edits manifests, catalog, dependents and settings, rewrites namespace, id and path, reports bare mentions, and backs up', async () => {
  const f = pluginFixture();
  const r = await cli([...renameArgs, '--json', ...f.base]);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out) as PluginRenameOut & { applied: boolean };
  assert.equal(o.applied, true);
  assert.ok(o.backup);
  assert.ok(!has(f.market, 'plugins/old-plug') && has(f.market, 'plugins/new-plug/skills/s/SKILL.md'));
  assert.equal(JSON.parse(read(f.market, 'plugins/new-plug/.claude-plugin/plugin.json')).name, 'new-plug');
  const catalog = JSON.parse(read(f.market, '.claude-plugin/marketplace.json')).plugins;
  assert.deepEqual(catalog[0], { name: 'new-plug', source: './plugins/new-plug' });
  assert.deepEqual(JSON.parse(read(f.market, 'plugins/dep/.claude-plugin/plugin.json')).dependencies, ['new-plug', 'keep']);
  assert.deepEqual(JSON.parse(read(f.root, 'settings.json')).enabledPlugins, { 'other@own': true, 'new-plug@own': true });
  assert.deepEqual(JSON.parse(read(f.repo, '.claude/settings.local.json')).enabledPlugins, { 'new-plug@own': false });
  assert.equal(read(f.root, 'CLAUDE.md'), 'Use new-plug:s, install new-plug@own, see plugins/new-plug/hooks and the old-plug plugin.\n');
  assert.equal(read(f.root, 'rules/r.md'), 'Rule for new-plug:s.\n');
  assert.equal(read(f.repo, 'CLAUDE.md'), 'Repo uses new-plug@own.\n');
  assert.match(read(f.market, 'plugins/new-plug/skills/s/SKILL.md'), /Run new-plug:s\./);
  // Bare mentions are listed, a longer name that starts with the old one is not a mention.
  const checks = o.changes.filter(c => c.action === 'check');
  assert.ok(checks.some(c => /CLAUDE\.md$/.test(c.file) && /old-plug 1 time/.test(c.detail)));
  assert.ok(!checks.some(c => /x\.md$/.test(c.file)));
  assert.match(fs.readFileSync(path.join(o.backup!, 'settings.json'), 'utf8'), /old-plug@own/);
  assert.ok(fs.readdirSync(o.backup!, { recursive: true }).some(p => String(p).endsWith('marketplace.json')));
});

test('plugins rename exits 1 when the plugin is gone or the new name exists, 2 without --from', async () => {
  const f = pluginFixture();
  assert.equal((await cli([...renameArgs, ...f.base])).code, 0);
  assert.equal((await cli([...renameArgs, ...f.base])).code, 1);
  assert.equal((await cli(['plugins', 'rename', '--from', 'dep@own', '--to', 'new-plug', ...f.base])).code, 1);
  assert.equal((await cli(['plugins', 'rename', '--from', 'dep@nowhere', '--to', 'x', ...f.base])).code, 1);
  assert.equal((await cli(['plugins', 'rename', '--to', 'x', ...f.base])).code, 2);
});

test('a failing backup writes nothing, for repoint, skills rename and plugins rename', async () => {
  const root = skillFixture();
  // A file where the backup folder belongs makes every backup fail.
  fs.writeFileSync(path.join(root, 'repo-sync-backups'), 'not a folder');
  const agent = read(root, 'agents/maker.md');
  assert.equal((await cli(['skills', 'repoint', '--from', 'old-skill', '--to', 'new-skill', '--root', root])).code, 1);
  assert.equal((await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'new-skill', '--root', root])).code, 1);
  assert.equal(read(root, 'agents/maker.md'), agent);
  assert.match(read(root, 'skills/user/SKILL.md'), /Use old-skill/);
  assert.ok(has(root, 'skills/old-skill/SKILL.md'));
  const f = pluginFixture();
  fs.writeFileSync(path.join(f.root, 'repo-sync-backups'), 'not a folder');
  const claude = read(f.root, 'CLAUDE.md');
  assert.equal((await cli([...renameArgs, ...f.base])).code, 1);
  assert.equal(read(f.root, 'CLAUDE.md'), claude);
  assert.equal(JSON.parse(read(f.market, 'plugins/old-plug/.claude-plugin/plugin.json')).name, 'old-plug');
  assert.ok(has(f.market, 'plugins/old-plug'));
});

test('a market on another drive is backed up under outside/<drive>/', async (t) => {
  const other = ['D', 'E', 'F'].find(d => !path.resolve(os.tmpdir()).toUpperCase().startsWith(`${d}:`) && fs.existsSync(`${d}:\\`));
  if (process.platform !== 'win32' || !other) return t.skip('needs a second drive');
  let market: string;
  try {
    market = fs.mkdtempSync(`${other}:/rename-xdrive-`);
  } catch {
    return t.skip('second drive not writable');
  }
  try {
    const root = skillFixture();
    write(market, 'plugins/p/skills/x/SKILL.md', '---\nname: x\ndescription: x\n---\n\nUse old-skill.\n');
    const r = await cli(['skills', 'repoint', '--from', 'old-skill', '--to', 'new-skill', '--market', market, '--json', '--root', root]);
    assert.equal(r.code, 0, r.err);
    const o = JSON.parse(r.out) as SkillsOut;
    assert.ok(fs.existsSync(path.join(o.backup!, 'outside', other, path.basename(market), 'plugins/p/skills/x/SKILL.md')));
    assert.match(read(market, 'plugins/p/skills/x/SKILL.md'), /new-skill/);
  } finally {
    fs.rmSync(market, { recursive: true, force: true });
  }
});
