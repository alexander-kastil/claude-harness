import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import { ORIGINS_FILE, coworkDrift, folderHash } from '../../src/cli-cowork';

const fixtureRoot = (): string => {
  if (process.env.COWORK_FIXTURE) return process.env.COWORK_FIXTURE;
  for (const start of [__dirname, process.cwd()]) {
    for (let dir = start, up = 0; up < 8; dir = path.dirname(dir), up++) {
      const candidate = path.join(dir, 'test', 'fixtures', 'cowork-claude');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('test/fixtures/cowork-claude not found');
};

/** A Claude root that holds a copy of the fixture, so a test can change the synced folders and still compare. */
function world() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-pull-'));
  const root = path.join(home, '.claude');
  fs.cpSync(fixtureRoot(), root, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), '{}');
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  return { home, root, repo, userConfig: path.join(home, '.claude.json') };
}

async function cli(w: ReturnType<typeof world>, argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...argv, '--root', w.root, '--user-config', w.userConfig], { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const synced = (w: ReturnType<typeof world>) => [path.join(w.root, 'skills', 'synced'), path.join(w.root, 'plugins', 'synced')].map(folderHash).join('|');

test('pull --dry-run lists the copy and writes nothing', async () => {
  const w = world();
  const before = synced(w);
  const r = await cli(w, ['cowork', 'pull', 'brand-notes', '--dry-run', '--json']);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out);
  assert.equal(o.applied, false);
  assert.equal(o.rows[0].action, 'create');
  assert.equal(fs.existsSync(path.join(w.root, 'skills', 'brand-notes')), false);
  assert.equal(fs.existsSync(path.join(w.root, ORIGINS_FILE)), false);
  assert.equal(synced(w), before);
});

test('pull to Global copies the skill whole, records the origin and leaves the synced folders unchanged', async () => {
  const w = world();
  const before = synced(w);
  const r = await cli(w, ['cowork', 'pull', 'brand-notes']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^\*\*Pull skill brand-notes/);
  const to = path.join(w.root, 'skills', 'brand-notes');
  assert.ok(fs.existsSync(path.join(to, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(to, 'references', 'voice.md')));
  const origins = JSON.parse(fs.readFileSync(path.join(w.root, ORIGINS_FILE), 'utf8'));
  const o = origins['skills/brand-notes'];
  assert.equal(o.kind, 'skill');
  assert.equal(o.hash, folderHash(to));
  assert.ok(o.from.includes(path.join('skills', 'synced')));
  assert.equal(synced(w), before);
  assert.deepEqual(coworkDrift(w.root).map(d => d.state), ['same']);
});

test('pull to a repo writes under its .claude and keeps Global clean', async () => {
  const w = world();
  const r = await cli(w, ['cowork', 'pull', 'docs', '--repo', w.repo]);
  assert.equal(r.code, 0, r.err);
  assert.ok(fs.existsSync(path.join(w.repo, '.claude', 'skills', 'docs', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(w.repo, '.claude', ORIGINS_FILE)));
  assert.equal(fs.existsSync(path.join(w.root, 'skills', 'docs')), false);
});

test('pull backs up an existing target before it replaces it', async () => {
  const w = world();
  const target = path.join(w.root, 'skills', 'brand-notes');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'mine\n');
  const r = await cli(w, ['cowork', 'pull', 'brand-notes', '--json']);
  assert.equal(r.code, 0, r.err);
  const row = JSON.parse(r.out).rows[0];
  assert.equal(row.action, 'replace');
  assert.equal(fs.readFileSync(path.join(row.backup, 'SKILL.md'), 'utf8'), 'mine\n');
  assert.notEqual(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), 'mine\n');
});

test('a pulled skill that differs from its origin is reported as drift', async () => {
  const w = world();
  await cli(w, ['cowork', 'pull', 'brand-notes']);
  fs.appendFileSync(path.join(w.root, 'skills', 'brand-notes', 'SKILL.md'), 'edited\n');
  assert.deepEqual(coworkDrift(w.root).map(d => d.state), ['differs']);
});

test('pull of a plugin copies each skill it ships; an unknown name stops', async () => {
  const w = world();
  const r = await cli(w, ['cowork', 'pull', 'design']);
  assert.equal(r.code, 0, r.err);
  assert.ok(fs.existsSync(path.join(w.root, 'skills', 'critique', 'SKILL.md')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.root, ORIGINS_FILE), 'utf8'))['skills/critique'].kind, 'plugin');
  const bad = await cli(w, ['cowork', 'pull', 'nope']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /no skill or plugin named nope/);
});
