import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import { ROOT_NOISE, install } from '../../src/distributor';
import { checkState, updateBackupDir } from '../../src/cli-sources';

// The fixture is a Claude folder of its own under a temp folder: no network, and the owner's ~/.claude is never named.

const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/**
 * A Claude folder with one skill installed from a source (media, version 1.2.0, linked into one repo), one skill with no source (plain),
 * and a record for a skill whose folder is gone (ghost).
 */
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-'));
  const root = path.join(base, '.claude');
  const userConfig = path.join(base, 'claude.json');
  const repo = path.join(base, 'repo');
  write(base, 'claude.json', '{}');
  write(root, 'skills/media/SKILL.md', '---\nname: media\ndescription: media skill\nversion: 1.2.0\n---\n\nBody\n');
  write(root, 'skills/plain/SKILL.md', '---\nname: plain\ndescription: plain skill\n---\n\nBody\n');
  write(
    root,
    '.skill-sources.json',
    JSON.stringify(
      {
        version: 1,
        skills: {
          media: {
            source: 'owner/tools',
            sourceType: 'github',
            sourceUrl: 'https://github.com/owner/tools.git',
            skillPath: 'skills/media/SKILL.md',
            skillFolderHash: 'abc123',
            ref: 'main',
            installedAt: '2026-10-01T10:00:00.000Z',
            updatedAt: '2026-10-01T10:00:00.000Z',
          },
          ghost: {
            source: 'owner/tools',
            sourceType: 'github',
            sourceUrl: 'https://github.com/owner/tools.git',
            skillPath: 'skills/ghost/SKILL.md',
            skillFolderHash: 'def456',
            installedAt: '2026-09-01T10:00:00.000Z',
          },
        },
      },
      null,
      2
    )
  );
  fs.mkdirSync(path.join(repo, '.claude', 'skills'), { recursive: true });
  // The link an older version made.
  fs.symlinkSync(path.join(root, 'skills', 'media'), path.join(repo, '.claude', 'skills', 'media'), process.platform === 'win32' ? 'junction' : 'dir');
  return { base, root, repo, userConfig };
}

test('sources lists the skills installed from a source, with their version and linked repos', async () => {
  const { root, repo, userConfig } = fixture();
  const text = await cli(['sources', '--root', root, '--user-config', userConfig, '--repo', repo]);
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, /^\*\*Sources · 1 skill from 1 source\*\*/);
  assert.match(text.out, /\| media \| owner\/tools \| main \| v1\.2\.0 +\| 2026-10-01 \| repo +\|/);
  assert.doesNotMatch(text.out, /plain|ghost/);

  const json = await cli(['sources', '--root', root, '--user-config', userConfig, '--repo', repo, '--json']);
  assert.equal(json.code, 0, json.err);
  const data = JSON.parse(json.out);
  assert.equal(data.applied, false);
  assert.deepEqual(data.skills, [
    { name: 'media', source: 'owner/tools', ref: 'main', version: '1.2.0', installedAt: '2026-10-01', repos: ['repo'], plugin: null },
  ]);
});

test('sources with nothing installed from a source prints a (none) row', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-empty-'));
  const root = path.join(base, '.claude');
  fs.mkdirSync(root, { recursive: true });
  const userConfig = path.join(base, 'claude.json');
  write(base, 'claude.json', '{}');
  const text = await cli(['sources', '--root', root, '--user-config', userConfig]);
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, /\(none\)/);
  const json = await cli(['sources', '--root', root, '--user-config', userConfig, '--json']);
  assert.deepEqual(JSON.parse(json.out).skills, []);
});

test('sources check with nothing installed from a source answers without the network', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-check-'));
  const root = path.join(base, '.claude');
  const userConfig = path.join(base, 'claude.json');
  write(base, 'claude.json', '{}');
  write(root, 'skills/plain/SKILL.md', '---\nname: plain\ndescription: plain skill\n---\n\nBody\n');
  const text = await cli(['sources', 'check', '--root', root, '--user-config', userConfig]);
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, /^\*\*Sources check · 0 of 0 skills have a newer version\*\*/);
  assert.match(text.out, /\(none\)/);
});

test('sources update without --name is a bad argument', async () => {
  const { root, userConfig } = fixture();
  const r = await cli(['sources', 'update', '--root', root, '--user-config', userConfig, '--dry-run']);
  assert.equal(r.code, 2);
  assert.match(r.err, /needs --name/);
});

test('sources update of a skill that is not installed stops with an error', async () => {
  const { root, userConfig } = fixture();
  const r = await cli(['sources', 'update', '--name', 'ghost', '--root', root, '--user-config', userConfig, '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.err, /ghost is not installed/);
});

test('sources update of a skill with no source stops before any download', async () => {
  const { root, userConfig } = fixture();
  const r = await cli(['sources', 'update', '--name', 'plain', '--root', root, '--user-config', userConfig, '--dry-run']);
  assert.equal(r.code, 1);
  assert.match(r.err, /plain is not installed from a source/);
});

test('sources update backs the old skill up under repo-sync-backups/<stamp>/skills', () => {
  const { root } = fixture();
  const dir = updateBackupDir(root, '20261028-120000');
  assert.equal(dir, path.join(root, 'repo-sync-backups', '20261028-120000', 'skills'));
  const staged = path.join(root, 'staged');
  write(staged, 'SKILL.md', '---\nname: media\ndescription: new\nversion: 1.3.0\n---\n');
  const r = install(root, { name: 'media', dir: staged, source: 'owner/tools', url: '', path: 'skills/media/SKILL.md', hash: 'new', ref: 'main' } as Parameters<typeof install>[1], dir);
  assert.equal(r.backup, path.join(dir, 'media'));
  assert.ok(fs.existsSync(path.join(dir, 'media', 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(root, 'skill-sync-backups')));
});

test('sources takes only check and update after its name', async () => {
  const { root, userConfig } = fixture();
  const r = await cli(['sources', 'bogus', '--root', root, '--user-config', userConfig]);
  assert.equal(r.code, 2);
  assert.match(r.err, /sources takes no bogus/);
});

test('a source whose version is lower than the installed one is older, not newer', () => {
  assert.equal(checkState({ state: 'newer', version: '2.4.0' }, '3.0.0'), 'older');
  assert.equal(checkState({ state: 'newer', version: '3.1.0' }, '3.0.0'), 'newer');
  assert.equal(checkState({ state: 'newer', version: '3.0.0' }, '3.0.0'), 'newer');
  assert.equal(checkState({ state: 'newer' }, '3.0.0'), 'newer');
  assert.equal(checkState({ state: 'newer', version: '2.4.0' }, null), 'newer');
  assert.equal(checkState({ state: 'current' }, '3.0.0'), 'current');
});

test('a skill at the repository root leaves the readme, changelog, tool folders and tests out of the install', () => {
  for (const noise of ['README.md', 'CHANGELOG.md', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.agents/x.json', 'agents/openai.yaml', 'tests/corpus/a.md', 'docs/a.md', 'AGENTS.md', '.gitignore']) assert.ok(ROOT_NOISE.test(noise), noise);
  for (const kept of ['SKILL.md', 'references/readme.md', 'scripts/run.py', 'agents/reviewer.md', 'assets/logo.png', 'testing/a.md']) assert.ok(!ROOT_NOISE.test(kept), kept);
});

/** A Claude folder that knows one directory marketplace `mk` with the plugin `design`, which ships the skill `ui` with a stale file; `stage` writes a newer `ui` into the folder it runs in. */
function pluginFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-plugin-'));
  const root = path.join(base, '.claude');
  const market = path.join(base, 'market');
  const userConfig = path.join(base, 'claude.json');
  write(base, 'claude.json', '{}');
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'mk', plugins: [{ name: 'design', source: './plugins/design', version: '1.0.0' }] }, null, 2));
  write(market, 'plugins/design/.claude-plugin/plugin.json', JSON.stringify({ name: 'design', version: '1.0.0' }, null, 2));
  write(market, 'plugins/design/skills/ui/SKILL.md', '---\nname: ui\nversion: 1.0.0\n---\nOld\n');
  write(market, 'plugins/design/skills/ui/stale.md', 'stale\n');
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ mk: { source: { source: 'directory', path: market }, installLocation: market } }));
  const script = path.join(base, 'stage.js').replace(/\\/g, '/');
  fs.writeFileSync(
    script,
    [
      "const fs = require('fs');",
      "fs.mkdirSync('.claude/skills/ui/refs', { recursive: true });",
      "const nl = String.fromCharCode(10);",
      "fs.writeFileSync('.claude/skills/ui/SKILL.md', ['---', 'name: ui', 'version: 2.0.0', '---', 'See .claude/skills/ui/refs/a.md', ''].join(nl));",
      "fs.writeFileSync('.claude/skills/ui/refs/a.md', 'x');",
    ].join('\n')
  );
  const link = ['sources', 'link', '--name', 'ui', '--source', 'owner/ui-pro', '--plugin', 'design', '--stage', `node "${script}"`, '--root', root, '--user-config', userConfig];
  const common = ['--root', root, '--user-config', userConfig];
  return { base, root, market, link, common };
}

test('sources link --dry-run answers with the record it would write and writes nothing', async () => {
  const { root, link } = pluginFixture();
  const r = await cli([...link, '--dry-run', '--json']);
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(r.out);
  assert.equal(data.applied, false);
  assert.deepEqual([data.name, data.source, data.plugin, data.market, data.version], ['ui', 'owner/ui-pro', 'design', 'mk', '1.0.0']);
  assert.match(data.stage, /^node /);
  assert.equal(data.record, path.join(root, '.skill-sources.json'));
  assert.ok(!fs.existsSync(data.record));
});

test('sources link records the plugin skill, and sources lists it with its plugin', async () => {
  const { link, common } = pluginFixture();
  const made = await cli([...link, '--json']);
  assert.equal(made.code, 0, made.err);
  assert.equal(JSON.parse(made.out).applied, true);
  const rows = JSON.parse((await cli(['sources', ...common, '--json'])).out).skills;
  assert.deepEqual(rows.map((x: { name: string; source: string; plugin: string | null; version: string | null }) => [x.name, x.source, x.plugin, x.version]), [['ui', 'owner/ui-pro', 'design', '1.0.0']]);
  assert.match((await cli(['sources', ...common])).out, /\| ui +\| owner\/ui-pro +\|.*\| design +\|/);
});

test('sources link stops when the plugin has no such skill or the marketplace is unknown', async () => {
  const { link, common } = pluginFixture();
  const noSkill = await cli(['sources', 'link', '--name', 'nope', '--source', 'owner/x', '--plugin', 'design', ...common]);
  assert.equal(noSkill.code, 1);
  assert.match(noSkill.err, /design has no skill named nope/);
  const noPlugin = await cli(['sources', 'link', '--name', 'ui', '--source', 'owner/x', '--plugin', 'ghost', ...common]);
  assert.equal(noPlugin.code, 1);
  assert.match(noPlugin.err, /No marketplace folder of yours lists a plugin called ghost/);
  const noMarket = await cli([...link, '--market', 'elsewhere']);
  assert.equal(noMarket.code, 1);
  assert.match(noMarket.err, /elsewhere is not a marketplace folder/);
});

test('sources update of a plugin-linked skill replaces the plugin folder, bumps the plugin and records the version', async () => {
  const { root, market, link, common } = pluginFixture();
  await cli(link);
  const skill = path.join(market, 'plugins', 'design', 'skills', 'ui');

  const dry = JSON.parse((await cli(['sources', 'update', '--name', 'ui', ...common, '--dry-run', '--json'])).out);
  assert.deepEqual({ ...dry, backup: null }, { name: 'ui', source: 'owner/ui-pro', from: '1.0.0', to: '2.0.0', changed: ['SKILL.md'], added: ['refs/a.md'], removed: ['stale.md'], backup: null, plugin: 'design', version: '1.0.1', installed: null, applied: false });
  assert.ok(fs.existsSync(path.join(skill, 'stale.md')));

  const done = JSON.parse((await cli(['sources', 'update', '--name', 'ui', ...common, '--json'])).out);
  assert.equal(done.applied, true);
  assert.equal(done.version, '1.0.1');
  assert.ok(!fs.existsSync(path.join(skill, 'stale.md')));
  assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /See <this skill>\/refs\/a\.md/);
  assert.ok(fs.existsSync(path.join(done.backup, 'stale.md')));
  assert.ok(done.backup.startsWith(path.join(root, 'repo-sync-backups')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(market, 'plugins/design/.claude-plugin/plugin.json'), 'utf8')).version, '1.0.1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(market, '.claude-plugin/marketplace.json'), 'utf8')).plugins[0].version, '1.0.1');
  assert.equal(JSON.parse((await cli(['sources', ...common, '--json'])).out).skills[0].version, '2.0.0');

  const again = JSON.parse((await cli(['sources', 'update', '--name', 'ui', ...common, '--json'])).out);
  assert.equal(again.applied, false);
  assert.deepEqual([again.changed, again.added, again.removed, again.backup], [[], [], [], null]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(market, 'plugins/design/.claude-plugin/plugin.json'), 'utf8')).version, '1.0.1');
});

test('a stage command that leaves no skill folder stops the update with nothing changed', async () => {
  const { market, link, common } = pluginFixture();
  await cli([...link.slice(0, link.indexOf('--stage')), '--stage', 'node -e "0"', ...link.slice(link.indexOf('--stage') + 2)]);
  const r = await cli(['sources', 'update', '--name', 'ui', ...common]);
  assert.equal(r.code, 1);
  assert.match(r.err, /left no \.claude\/skills\/ui\/SKILL\.md/);
  assert.ok(fs.existsSync(path.join(market, 'plugins/design/skills/ui/stale.md')));
});
