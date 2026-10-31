import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';

const SKILL = '---\nname: browser-automations\ndescription: procedures\n---\n\n| Procedure | Keep as |\n|---|---|\n| ionos-dns | a guided browser run with the saved click path |\n';

/** A Claude root whose Global holds the browser-automations skill. */
function world(skill = true) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-browser-hunt-'));
  const root = path.join(home, '.claude');
  fs.mkdirSync(path.join(root, 'skills', 'browser-automations'), { recursive: true });
  if (skill) fs.writeFileSync(path.join(root, 'skills', 'browser-automations', 'SKILL.md'), SKILL);
  fs.writeFileSync(path.join(home, '.claude.json'), '{}');
  return { root, file: path.join(root, 'skills', 'browser-automations', 'SKILL.md'), userConfig: path.join(home, '.claude.json') };
}

async function cli(w: ReturnType<typeof world>, argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...argv, '--root', w.root, '--user-config', w.userConfig], { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('browser-hunt procedures lists the skill table', async () => {
  const w = world();
  const r = await cli(w, ['browser-hunt', 'procedures']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^\*\*Browser automation procedures: 1/);
  assert.match(r.out, /\| ionos-dns +\| Guided run +\|/);
  const o = JSON.parse((await cli(w, ['browser-hunt', 'procedures', '--json'])).out);
  assert.equal(o.procedures[0].keep, 'guided');
  assert.equal(o.source, w.file);
});

test('browser-hunt procedures says when the skill is missing', async () => {
  const r = await cli(world(false), ['browser-hunt', 'procedures']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /No browser-automations skill was found/);
});

test('browser-hunt plan and create --dry-run write nothing', async () => {
  const w = world();
  const args = ['--name', 'gamma-theme', '--goal', 'Set the theme', '--keep', 'cli', '--step', 'Open settings', '--step', 'Sign in (manual)'];
  for (const argv of [['browser-hunt', 'plan', ...args], ['browser-hunt', 'create', ...args, '--dry-run']]) {
    const r = await cli(w, [...argv, '--json']);
    assert.equal(r.code, 0, r.err);
    const o = JSON.parse(r.out);
    assert.equal(o.applied, false);
    assert.equal(o.steps, 2);
    assert.equal(o.problem, null);
  }
  assert.equal(fs.readFileSync(w.file, 'utf8'), SKILL);
  assert.equal(fs.existsSync(path.join(path.dirname(w.file), 'references')), false);
});

test('browser-hunt create writes the row and the leaf, backed up', async () => {
  const w = world();
  const r = await cli(w, ['browser-hunt', 'create', '--name', 'gamma-theme', '--goal', 'Set the theme', '--keep', 'cli', '--stage', 'optimized', '--step', 'Open settings', '--step', 'Sign in (manual)', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).applied, true);
  assert.match(fs.readFileSync(w.file, 'utf8'), /\| gamma-theme \| the command line/);
  const leaf = fs.readFileSync(path.join(path.dirname(w.file), 'references', 'gamma-theme.md'), 'utf8');
  assert.match(leaf, /Stage: Optimized in code/);
  assert.match(leaf, /2\. Sign in \(manual\)/);
  assert.ok(fs.readdirSync(path.join(w.root, 'repo-sync-backups')).some(d => d.startsWith('browser-hunt-')));
});

test('browser-hunt refuses a bad name, keep, stage and a card without steps', async () => {
  const w = world();
  assert.equal((await cli(w, ['browser-hunt', 'plan', '--name', 'Bad Name', '--step', 'a'])).code, 2);
  assert.equal((await cli(w, ['browser-hunt', 'plan', '--name', 'ok', '--keep', 'x', '--step', 'a'])).code, 2);
  assert.equal((await cli(w, ['browser-hunt', 'plan', '--name', 'ok', '--stage', 'x', '--step', 'a'])).code, 2);
  const none = await cli(w, ['browser-hunt', 'create', '--name', 'ok']);
  assert.equal(none.code, 1);
  assert.match(none.err, /at least one step/);
  assert.equal((await cli(w, ['browser-hunt'])).code, 2);
});
