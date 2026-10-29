import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { moveToRepo } from '../../src/distributor';
import { originsOf, recordOrigin } from '../../src/skill-lock';

// Temp folders only: the owner's ~/.claude and repos are never named.

const junction = process.platform === 'win32' ? 'junction' : 'dir';

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'move-to-repo-'));
  const root = path.join(base, '.claude');
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(root, 'skills', 'media', 'references'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'media', 'SKILL.md'), '---\nname: media\n---\n');
  fs.writeFileSync(path.join(root, 'skills', 'media', 'references', 'a.md'), 'a');
  fs.mkdirSync(path.join(repo, '.claude', 'skills'), { recursive: true });
  recordOrigin(root, 'media', { source: 'owner/tools', sourceType: 'github', url: 'https://github.com/owner/tools.git', path: 'skills/media/SKILL.md', hash: 'abc' });
  return { base, root, repo, dest: path.join(repo, '.claude', 'skills', 'media') };
}

test('moveToRepo moves the folder: the repo gets real files and the global folder is gone', () => {
  const { root, repo, dest } = fixture();
  assert.equal(moveToRepo(root, repo, 'media'), dest);
  assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(dest, 'references', 'a.md'), 'utf8'), 'a');
  assert.equal(fs.existsSync(path.join(root, 'skills', 'media')), false);
});

test('moveToRepo moves the recorded source with the skill', () => {
  const { root, repo } = fixture();
  moveToRepo(root, repo, 'media');
  assert.equal(originsOf(root).has('media'), false);
  assert.equal(originsOf(path.join(repo, '.claude')).get('media')?.source, 'owner/tools');
});

test('moveToRepo replaces a link made by the old code as a link, never through its target', () => {
  const { root, repo, dest } = fixture();
  fs.symlinkSync(path.join(root, 'skills', 'media'), dest, junction);
  moveToRepo(root, repo, 'media');
  assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), '---\nname: media\n---\n');
  assert.equal(fs.existsSync(path.join(root, 'skills', 'media')), false);
});

test('moveToRepo refuses a folder of its own and a link to something else, and moves nothing', () => {
  const own = fixture();
  fs.mkdirSync(own.dest, { recursive: true });
  assert.throws(() => moveToRepo(own.root, own.repo, 'media'), /folder of its own/);
  assert.equal(fs.existsSync(path.join(own.root, 'skills', 'media', 'SKILL.md')), true);

  const other = fixture();
  const elsewhere = path.join(other.base, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, other.dest, junction);
  assert.throws(() => moveToRepo(other.root, other.repo, 'media'), /link to something else/);
  assert.equal(fs.existsSync(path.join(other.root, 'skills', 'media', 'SKILL.md')), true);
  assert.equal(fs.existsSync(elsewhere), true);
});

test('moveToRepo of a global skill that is a link copies the files and removes only the link', () => {
  const { base, root, repo, dest } = fixture();
  const agents = path.join(base, '.agents', 'skills', 'media');
  fs.mkdirSync(path.dirname(agents), { recursive: true });
  fs.renameSync(path.join(root, 'skills', 'media'), agents);
  fs.symlinkSync(agents, path.join(root, 'skills', 'media'), junction);
  moveToRepo(root, repo, 'media');
  assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(root, 'skills', 'media')), false);
  assert.equal(fs.existsSync(path.join(agents, 'SKILL.md')), true);
});
