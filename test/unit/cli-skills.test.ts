import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import type { SkillsOut } from '../../src/cli-skills';
import type { HuntResult } from '../../src/cli';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `skills-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const has = (root: string, rel: string) => fs.existsSync(path.join(root, rel));
const skill = (name: string, body = 'Body') => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`;

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/**
 * A Claude folder with a big media skill (a leaf to move, leaves to split off), a film skill, a social skill, an agent and a marketplace plugin
 * that mention them, and a market of the owner's.
 */
function fixture() {
  const root = tmp('root');
  const market = tmp('market');
  write(root, 'skills/media/SKILL.md', skill('media', 'See references/clips.md and references/sets.md.'));
  write(root, 'skills/media/references/clips.md', '# Clips\nClips text\n');
  write(root, 'skills/media/references/sets.md', '# Sets\n');
  write(root, 'skills/media/scripts/tool.py', 'print(1)\n');
  write(root, 'skills/film/SKILL.md', skill('film', 'Clips are media/references/clips.md; sets media/references/sets.md. Use media for sets.'));
  write(root, 'skills/film/references/cut.md', '# Cut\n');
  write(root, 'skills/cutter/SKILL.md', skill('cutter'));
  write(root, 'skills/cutter/references/cut.md', '# Cut\n');
  write(root, 'agents/maker.md', '---\nname: maker\ndescription: makes\n---\n\nFollow media/references/clips.md and the media skill.\n');
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins: [] }));
  write(market, 'plugins/other/skills/x/SKILL.md', skill('x', 'Read media/references/clips.md.'));
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ own: { source: { source: 'directory', path: market }, installLocation: market } }));
  const base = ['--root', root, '--market', market];
  return { root, market, base };
}

const backups = (root: string) => (has(root, 'repo-sync-backups') ? fs.readdirSync(path.join(root, 'repo-sync-backups')) : []);

test('skills move moves a leaf, repoints every reference to it, and backs the original up', async () => {
  const f = fixture();
  const r = await cli(['skills', 'move', '--leaf', 'media/references/clips.md', '--to', 'film/references/generated.md', '--json', ...f.base]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as SkillsOut & { applied: boolean };
  assert.equal(o.applied, true);
  assert.equal(o.op, 'move');
  assert.ok(!has(f.root, 'skills/media/references/clips.md'));
  assert.equal(read(f.root, 'skills/film/references/generated.md'), '# Clips\nClips text\n');
  assert.match(read(f.root, 'skills/film/SKILL.md'), /film\/references\/generated\.md/);
  assert.match(read(f.root, 'agents/maker.md'), /film\/references\/generated\.md and the media skill/);
  assert.match(read(f.market, 'plugins/other/skills/x/SKILL.md'), /film\/references\/generated\.md/);
  // The old skill's own table still names the leaf: reported, not edited.
  assert.ok(o.changes.some(c => c.action === 'check' && c.file === 'skills/media/SKILL.md'));
  assert.ok(o.backup && fs.existsSync(path.join(o.backup, 'skills/media/references/clips.md')));
  assert.ok(fs.existsSync(path.join(o.backup, 'agents/maker.md')));
  assert.match(path.basename(o.backup), /^\d{8}-\d{6}$/);
  assert.equal(path.dirname(o.backup), path.join(f.root, 'repo-sync-backups'));
  assert.ok(!has(f.root, 'skill-sync-backups'));
});

test('skills move keeps the leaf path when --to names only the skill, and moves a folder', async () => {
  const f = fixture();
  assert.equal((await cli(['skills', 'move', '--leaf', 'media/scripts', '--to', 'film', ...f.base])).code, 0);
  assert.ok(has(f.root, 'skills/film/scripts/tool.py'));
  assert.ok(!has(f.root, 'skills/media/scripts'));
});

test('--dry-run prints [dry-run] lines and changes nothing, not even a backup', async () => {
  const f = fixture();
  const before = read(f.root, 'agents/maker.md');
  const r = await cli(['skills', 'move', '--leaf', 'media/references/clips.md', '--to', 'film', '--dry-run', ...f.base]);
  assert.equal(r.code, 0);
  assert.match(r.out, /\[dry-run\] move skills\/media\/references\/clips\.md/);
  assert.match(r.out, /^\*\*move: \d changes?\*\*/);
  assert.ok(has(f.root, 'skills/media/references/clips.md'));
  assert.equal(read(f.root, 'agents/maker.md'), before);
  assert.deepEqual(backups(f.root), []);
  const j = JSON.parse((await cli(['skills', 'move', '--leaf', 'media/references/clips.md', '--to', 'film', '--dry-run', '--json', ...f.base])).out) as SkillsOut & { applied: boolean };
  assert.equal(j.applied, false);
  assert.equal(j.backup, null);
});

test('a move onto an identical file only drops the source, onto a different file it stops', async () => {
  const f = fixture();
  const same = await cli(['skills', 'move', '--leaf', 'film/references/cut.md', '--to', 'cutter', ...f.base]);
  assert.equal(same.code, 0);
  assert.match(same.out, /holds the same file/);
  assert.ok(!has(f.root, 'skills/film/references/cut.md'));
  write(f.root, 'skills/film/references/cut.md', '# Other\n');
  const diff = await cli(['skills', 'move', '--leaf', 'film/references/cut.md', '--to', 'cutter', ...f.base]);
  assert.equal(diff.code, 1);
  assert.match(diff.err, /exists already and differs/);
  assert.ok(has(f.root, 'skills/film/references/cut.md'));
});

test('skills split makes a new skill from leaves and repoints the references', async () => {
  const f = fixture();
  const r = await cli(['skills', 'split', '--from', 'media', '--name', 'sets', '--leaves', 'references/sets.md,scripts/tool.py', '--description', 'Image sets.', '--json', ...f.base]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as SkillsOut;
  assert.equal(o.op, 'split');
  assert.match(read(f.root, 'skills/sets/SKILL.md'), /^---\nname: sets\ndescription: Image sets\./);
  assert.match(read(f.root, 'skills/sets/SKILL.md'), /references\/sets\.md/);
  assert.ok(has(f.root, 'skills/sets/references/sets.md') && has(f.root, 'skills/sets/scripts/tool.py'));
  assert.ok(!has(f.root, 'skills/media/references/sets.md'));
  assert.match(read(f.root, 'skills/film/SKILL.md'), /sets\/references\/sets\.md/);
  assert.equal((await cli(['skills', 'split', '--from', 'media', '--name', 'sets', '--leaves', 'references/clips.md', ...f.base])).code, 1);
  assert.equal((await cli(['skills', 'split', '--from', 'media', '--name', 'more', ...f.base])).code, 2);
});

test('a dry-run split leaves no new skill folder behind', async () => {
  const f = fixture();
  const r = await cli(['skills', 'split', '--from', 'media', '--name', 'sets', '--leaves', 'references/sets.md', '--dry-run', ...f.base]);
  assert.equal(r.code, 0);
  assert.match(r.out, /\[dry-run\] create skills\/sets\/SKILL\.md/);
  assert.ok(!has(f.root, 'skills/sets'));
  assert.ok(has(f.root, 'skills/media/references/sets.md'));
});

test('skills put writes a file into a skill or an agent and backs a replaced one up', async () => {
  const f = fixture();
  const src = path.join(tmp('src'), 'new.md');
  fs.writeFileSync(src, 'new text\n');
  const made = JSON.parse((await cli(['skills', 'put', '--file', src, '--to', 'film/references/new.md', '--json', ...f.base])).out) as SkillsOut;
  assert.equal(made.changes[0].action, 'create');
  assert.equal(made.backup, null);
  assert.equal(read(f.root, 'skills/film/references/new.md'), 'new text\n');
  const over = JSON.parse((await cli(['skills', 'put', '--file', src, '--to', 'agents/maker.md', '--json', ...f.base])).out) as SkillsOut;
  assert.equal(over.changes[0].action, 'rewrite');
  assert.equal(read(f.root, 'agents/maker.md'), 'new text\n');
  assert.ok(over.backup && /Follow media/.test(fs.readFileSync(path.join(over.backup, 'agents/maker.md'), 'utf8')));
  assert.equal((await cli(['skills', 'put', '--file', src, '--to', 'nope/x.md', ...f.base])).code, 1);
  assert.equal((await cli(['skills', 'put', '--file', path.join(src, 'missing'), '--to', 'film/x.md', ...f.base])).code, 2);
});

test('skills remove deletes a leaf or a skill after a backup and lists what still mentions it', async () => {
  const f = fixture();
  const leaf = JSON.parse((await cli(['skills', 'remove', '--leaf', 'media/references/clips.md', '--json', ...f.base])).out) as SkillsOut;
  assert.ok(!has(f.root, 'skills/media/references/clips.md'));
  assert.ok(leaf.backup && has(leaf.backup, 'skills/media/references/clips.md'));
  assert.ok(leaf.changes.some(c => c.action === 'check' && c.file === 'agents/maker.md'));
  const whole = await cli(['skills', 'remove', '--name', 'media', '--dry-run', ...f.base]);
  assert.match(whole.out, /\[dry-run\] remove skills\/media\/SKILL\.md/);
  assert.ok(has(f.root, 'skills/media/SKILL.md'));
  assert.equal((await cli(['skills', 'remove', '--name', 'media', ...f.base])).code, 0);
  assert.ok(!has(f.root, 'skills/media'));
  assert.equal((await cli(['skills', 'remove', '--name', 'media', ...f.base])).code, 1);
});

test('skills repoint rewrites a skill name in the other skills and agents, limited by --skills', async () => {
  const f = fixture();
  const only = JSON.parse((await cli(['skills', 'repoint', '--from', 'media', '--to', 'pictures', '--skills', 'film', '--json', ...f.base])).out) as SkillsOut;
  assert.deepEqual(only.changes.map(c => c.file), ['skills/film/SKILL.md']);
  assert.match(read(f.root, 'skills/film/SKILL.md'), /Use pictures for sets/);
  // A path such as media/references is a different word boundary than the skill name only when followed by a slash: both are rewritten.
  assert.match(read(f.root, 'skills/film/SKILL.md'), /pictures\/references\/clips\.md/);
  assert.match(read(f.root, 'agents/maker.md'), /the media skill/);
  assert.match(read(f.root, 'skills/media/SKILL.md'), /references\/clips\.md/);
  const all = await cli(['skills', 'repoint', '--from', 'media', '--to', 'pictures', ...f.base]);
  assert.equal(all.code, 0);
  assert.match(read(f.root, 'agents/maker.md'), /the pictures skill/);
  assert.match(read(f.market, 'plugins/other/skills/x/SKILL.md'), /pictures\/references\/clips\.md/);
  assert.equal((await cli(['skills', 'repoint', '--from', 'media', '--to', 'pictures', ...f.base])).code, 1);
});

test('skills needs a known subcommand and valid names', async () => {
  const f = fixture();
  assert.equal((await cli(['skills', 'frobnicate', ...f.base])).code, 2);
  assert.equal((await cli(['skills', 'move', '--leaf', 'media', '--to', 'film', ...f.base])).code, 2);
  assert.equal((await cli(['skills', 'move', '--leaf', 'media/../x', '--to', 'film', ...f.base])).code, 2);
  assert.equal((await cli(['skills', 'move', '--leaf', 'media/references/none.md', '--to', 'film', ...f.base])).code, 1);
  assert.equal((await cli(['skills', 'move', '--leaf', 'media/references/clips.md', '--to', 'ghost', ...f.base])).code, 1);
});

test('hunt plan --files rides plain files into a plugin made of them alone and drops only the ones under the root', async () => {
  const f = fixture();
  write(f.root, 'hooks/gate.mjs', '// gate\n');
  const hooks = path.join(tmp('hooks'), 'hooks.json');
  fs.writeFileSync(hooks, '{}');
  const r = await cli(['hunt', 'plan', '--name', 'gate-plugin', '--files', `${path.join(f.root, 'hooks/gate.mjs')}=hooks/gate.mjs,${hooks}=hooks/hooks.json`, '--drop-files', '--market', f.market, '--json', '--root', f.root, '--repos', '']);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as HuntResult;
  assert.deepEqual(o.problems, []);
  assert.ok(o.files.some(x => x.endsWith('gate-plugin/hooks/gate.mjs')) && o.files.some(x => x.endsWith('gate-plugin/hooks/hooks.json')));
  assert.equal(o.retired.length, 1);
  assert.match(o.retired[0], /gate\.mjs/);
  assert.ok(has(f.root, 'hooks/gate.mjs'));
  const bad = await cli(['hunt', 'plan', '--name', 'gate-plugin', '--files', 'nothing', '--root', f.root]);
  assert.equal(bad.code, 2);
  const gone = await cli(['hunt', 'plan', '--name', 'gate-plugin', '--files', `${path.join(f.root, 'nope.mjs')}=x.mjs`, '--root', f.root]);
  assert.equal(gone.code, 1);
  assert.match(gone.out, /is gone from disk/);
});
