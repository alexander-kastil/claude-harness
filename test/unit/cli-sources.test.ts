import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import { install, linkToRepo } from '../../src/distributor';
import { updateBackupDir } from '../../src/cli-sources';

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
  linkToRepo(root, repo, 'media');
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
    { name: 'media', source: 'owner/tools', ref: 'main', version: '1.2.0', installedAt: '2026-10-01', repos: ['repo'] },
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
