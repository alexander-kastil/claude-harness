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

test('skills remove retires a stray folder with no SKILL.md, of a repo with --repo, backed up first', async () => {
  const f = fixture();
  const repo = tmp('repo');
  write(repo, 'CLAUDE.md', '# repo\n\nThe vendored folder is old.\n');
  write(repo, '.claude/skills/vendored/README.md', '# vendored\n');
  write(repo, '.claude/skills/vendored/hooks/hook.mjs', 'export {};\n');
  const dry = await cli(['skills', 'remove', '--name', 'vendored', '--repo', repo, '--dry-run', ...f.base]);
  assert.equal(dry.code, 0, dry.err);
  assert.ok(has(repo, '.claude/skills/vendored/README.md'));
  const o = JSON.parse((await cli(['skills', 'remove', '--name', 'vendored', '--repo', repo, '--json', ...f.base])).out) as SkillsOut;
  assert.ok(!has(repo, '.claude/skills/vendored'));
  assert.ok(o.backup && fs.readdirSync(o.backup, { recursive: true }).some(x => String(x).endsWith(path.join('vendored', 'hooks', 'hook.mjs'))));
  assert.ok(o.changes.some(c => c.action === 'remove' && /stray, no SKILL\.md/.test(c.detail)));
  assert.ok(o.changes.some(c => c.action === 'check' && c.file.endsWith('CLAUDE.md')));
  // An empty stray of the root has nothing to back up and still says what it deleted.
  fs.mkdirSync(path.join(f.root, 'skills/empty-one'));
  const empty = JSON.parse((await cli(['skills', 'remove', '--name', 'empty-one', '--json', ...f.base])).out) as SkillsOut;
  assert.ok(!has(f.root, 'skills/empty-one'));
  assert.deepEqual(empty.changes.map(c => [c.action, c.detail]), [['remove', 'empty folder, deleted']]);
});

test('skills move finds both skills in the market plugins, stops on a name in two places, and writes an absolute mention in the plugin skill\'s own form', async () => {
  const f = fixture();
  const sql = 'plugins/azure/skills/sql-server';
  const slot = 'plugins/hetzner-cicd/skills/db-slot-sync';
  write(f.market, `${sql}/SKILL.md`, skill('sql-server', 'Run `bash ~/.claude/skills/sql-server/scripts/push.sh` or see references/push.md.'));
  write(f.market, `${sql}/scripts/push.sh`, 'echo push\n');
  write(f.market, `${sql}/references/push.md`, '# Push\n\nbash ~/.claude/skills/sql-server/scripts/push.sh --apply\n');
  write(f.market, `${slot}/SKILL.md`, skill('db-slot-sync', 'Runs <this skill>/scripts/apply.sh.'));
  write(f.root, 'agents/dba.md', '---\nname: dba\ndescription: dba\n---\n\nUse $HOME/.claude/skills/sql-server/scripts/push.sh.\n');
  const md = await cli(['skills', 'move', '--leaf', 'sql-server/references/push.md', '--to', 'db-slot-sync/references/push.md', '--json', ...f.base]);
  assert.equal(md.code, 0, md.err);
  assert.ok(has(f.market, `${slot}/references/push.md`) && !has(f.market, `${sql}/references/push.md`));
  assert.ok((JSON.parse(md.out) as SkillsOut).changes.some(c => c.action === 'check' && c.file.endsWith(`${sql}/SKILL.md`)));
  // A skill of that name under the root as well: the move stops and lists both; <plugin>:<skill> picks the plugin's.
  write(f.root, 'skills/db-slot-sync/SKILL.md', skill('db-slot-sync'));
  const two = await cli(['skills', 'move', '--leaf', 'sql-server/scripts/push.sh', '--to', 'db-slot-sync/scripts/push.sh', ...f.base]);
  assert.equal(two.code, 1);
  assert.match(two.err, /db-slot-sync is in more than one place: .*db-slot-sync, hetzner-cicd:db-slot-sync \(/);
  assert.ok(has(f.market, `${sql}/scripts/push.sh`));
  const sh = await cli(['skills', 'move', '--leaf', 'azure:sql-server/scripts/push.sh', '--to', 'hetzner-cicd:db-slot-sync/scripts/push.sh', ...f.base]);
  assert.equal(sh.code, 0, sh.err);
  assert.ok(has(f.market, `${slot}/scripts/push.sh`) && !has(f.market, `${sql}/scripts/push.sh`));
  // Inside the target skill the absolute place becomes <this skill>/...; everywhere else <skill>/..., never ~/.claude/skills/db-slot-sync.
  assert.equal(read(f.market, `${slot}/references/push.md`), '# Push\n\nbash <this skill>/scripts/push.sh --apply\n');
  assert.match(read(f.market, `${sql}/SKILL.md`), /Run `bash db-slot-sync\/scripts\/push\.sh` or see/);
  assert.match(read(f.root, 'agents/dba.md'), /^Use db-slot-sync\/scripts\/push\.sh\.$/m);
  const missing = await cli(['skills', 'move', '--leaf', 'media/references/sets.md', '--to', 'nope/references/sets.md', ...f.base]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /There is no skill nope\. Create it with skills split\./);
});

test('skills repoint leaves the plugin folder that ships the skill and the synced skills alone', async () => {
  const f = fixture();
  write(f.market, 'plugins/azure/skills/azure/SKILL.md', skill('azure', 'The azure skill.'));
  write(f.market, 'plugins/azure/skills/sql-server/SKILL.md', skill('sql-server', 'Pairs with the azure skill.'));
  write(f.market, 'plugins/other/skills/y/SKILL.md', skill('y', 'Use the azure skill.'));
  write(f.root, 'skills/synced/z/SKILL.md', skill('z', 'Use the azure skill.'));
  write(f.root, 'skills/film/references/cloud.md', 'Deploy with azure.\n');
  const dry = JSON.parse((await cli(['skills', 'repoint', '--from', 'azure', '--to', 'azure:azure', '--dry-run', '--json', ...f.base])).out) as SkillsOut;
  const rewritten = dry.changes.filter(c => c.action === 'rewrite').map(c => c.file);
  assert.equal(rewritten.length, 2, rewritten.join(', '));
  assert.ok(rewritten.includes('skills/film/references/cloud.md') && rewritten.some(x => x.endsWith('plugins/other/skills/y/SKILL.md')));
  assert.equal((await cli(['skills', 'repoint', '--from', 'azure', '--to', 'azure:azure', ...f.base])).code, 0);
  assert.equal(read(f.root, 'skills/film/references/cloud.md'), 'Deploy with azure:azure.\n');
  assert.match(read(f.market, 'plugins/azure/skills/sql-server/SKILL.md'), /Pairs with the azure skill\./);
  assert.match(read(f.root, 'skills/synced/z/SKILL.md'), /Use the azure skill\./);
});

test('skills repoint rewrites a skill name in the other skills and agents, limited by --skills', async () => {
  const f = fixture();
  const only = JSON.parse((await cli(['skills', 'repoint', '--from', 'media', '--to', 'pictures', '--skills', 'film', '--json', ...f.base])).out) as SkillsOut;
  assert.deepEqual(only.changes.filter(c => c.action === 'rewrite').map(c => c.file), ['skills/film/SKILL.md']);
  // To a plain name only the reference forms change: the paths do, the bare word comes back as a check row.
  assert.match(read(f.root, 'skills/film/SKILL.md'), /pictures\/references\/clips\.md; sets pictures\/references\/sets\.md\. Use media for sets/);
  assert.ok(only.changes.some(c => c.action === 'check' && c.file === 'skills/film/SKILL.md' && /still names it: Clips are/.test(c.detail)));
  assert.match(read(f.root, 'agents/maker.md'), /the media skill/);
  assert.match(read(f.root, 'skills/media/SKILL.md'), /references\/clips\.md/);
  const all = await cli(['skills', 'repoint', '--from', 'media', '--to', 'pictures', ...f.base]);
  assert.equal(all.code, 0);
  assert.match(read(f.root, 'agents/maker.md'), /the pictures skill/);
  assert.match(read(f.market, 'plugins/other/skills/x/SKILL.md'), /pictures\/references\/clips\.md/);
  const again = await cli(['skills', 'repoint', '--from', 'media', '--to', 'pictures', ...f.base]);
  assert.equal(again.code, 1);
  assert.match(again.err, /Nothing refers to media in a form repoint rewrites; 1 line still names it\./);
});

test('skills fix-paths writes a plugin skill\'s absolute paths as <this skill>/ or <plugin:skill>/, keeps a global one and lists the rest', async () => {
  const f = fixture();
  const catalog = { name: 'own', plugins: [{ name: 'web-quality', source: './plugins/web-quality' }, { name: 'agentic-web', source: './plugins/agentic-web' }, { name: 'corp', source: './plugins/corp' }] };
  write(f.market, '.claude-plugin/marketplace.json', JSON.stringify(catalog));
  write(f.market, 'plugins/web-quality/skills/chrome-devtools/SKILL.md', skill('chrome-devtools'));
  write(f.market, 'plugins/agentic-web/skills/hugo-authoring/SKILL.md', skill('hugo-authoring'));
  write(f.market, 'plugins/agentic-web/skills/hugo-authoring/references/create-layout-page.md', 'Run node ~/.claude/skills/hugo-authoring/scripts/create-layout-page.js.\n');
  write(f.market, 'plugins/agentic-web/skills/hugo-authoring/scripts/orphans.py', 'p = "~/.claude/skills/hugo-authoring/data.json"\n');
  write(f.root, 'skills/kept/SKILL.md', skill('kept'));
  const banner = [
    '# Banner',
    'Shoot with `node .claude/skills/chrome-devtools/scripts/screenshot.js`.',
    'Then %USERPROFILE%\\.claude\\skills\\design\\scripts\\fit.ps1 and ~/.claude/skills/kept/x.md.',
    'Gone: ~/.claude/skills/gone/y.md',
    '',
  ];
  write(f.market, 'plugins/corp/skills/design/SKILL.md', skill('design'));
  write(f.market, 'plugins/corp/skills/design/references/banner-design.md', banner.join('\n'));
  const one = JSON.parse((await cli(['skills', 'fix-paths', '--plugin', 'corp', '--dry-run', '--json', ...f.base])).out) as SkillsOut;
  assert.ok(one.changes.every(c => c.file.includes('/plugins/corp/')));
  assert.equal(read(f.market, 'plugins/corp/skills/design/references/banner-design.md'), banner.join('\n'));
  const o = JSON.parse((await cli(['skills', 'fix-paths', '--json', ...f.base])).out) as SkillsOut;
  assert.equal(
    read(f.market, 'plugins/corp/skills/design/references/banner-design.md'),
    [
      '# Banner',
      'Shoot with `node <web-quality:chrome-devtools>/scripts/screenshot.js`.',
      'Then <this skill>\\scripts\\fit.ps1 and ~/.claude/skills/kept/x.md.',
      'Gone: ~/.claude/skills/gone/y.md',
      '',
    ].join('\n')
  );
  assert.equal(read(f.market, 'plugins/agentic-web/skills/hugo-authoring/references/create-layout-page.md'), 'Run node <this skill>/scripts/create-layout-page.js.\n');
  assert.equal(read(f.market, 'plugins/agentic-web/skills/hugo-authoring/scripts/orphans.py'), 'p = "~/.claude/skills/hugo-authoring/data.json"\n');
  const checks = o.changes.filter(c => c.action === 'check').map(c => `${path.basename(c.file)} ${c.detail.slice(0, c.detail.indexOf(': '))}`);
  assert.deepEqual(checks.sort(), ['banner-design.md line 4, gone is not a skill under ' + path.join(f.root, 'skills') + ' or in the market', "orphans.py line 1, a script names hugo-authoring's global folder"]);
  assert.ok(o.backup && fs.readdirSync(o.backup, { recursive: true }).some(x => String(x).endsWith('banner-design.md')));
  assert.equal((await cli(['skills', 'fix-paths', '--plugin', 'nope', ...f.base])).code, 1);
  assert.equal((await cli(['skills', 'fix-paths', '--root', f.root])).code, 2);
});

test('skills put finds the target skill in a plugin of --market, and <plugin>:<skill> picks one', async () => {
  const f = fixture();
  const file = path.join(tmp('put'), 'tool-evals.md');
  fs.writeFileSync(file, '# Evals\n');
  write(f.market, 'plugins/agentic-web/skills/webmcp/SKILL.md', skill('webmcp'));
  const r = await cli(['skills', 'put', '--file', file, '--to', 'webmcp/references/tool-evals.md', ...f.base]);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(f.market, 'plugins/agentic-web/skills/webmcp/references/tool-evals.md'), '# Evals\n');
  write(f.root, 'skills/webmcp/SKILL.md', skill('webmcp'));
  const two = await cli(['skills', 'put', '--file', file, '--to', 'webmcp/references/other.md', ...f.base]);
  assert.equal(two.code, 1);
  assert.match(two.err, /webmcp is in more than one place/);
  assert.equal((await cli(['skills', 'put', '--file', file, '--to', 'agentic-web:webmcp/references/other.md', ...f.base])).code, 0);
  assert.ok(has(f.market, 'plugins/agentic-web/skills/webmcp/references/other.md') && !has(f.root, 'skills/webmcp/references/other.md'));
  assert.match((await cli(['skills', 'put', '--file', file, '--to', 'nope/references/x.md', ...f.base])).err, /There is no skill nope\./);
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

test('skills repoint --to takes a plugin:skill name and leaves a name that already has a prefix alone', async () => {
  const f = fixture();
  const first = JSON.parse((await cli(['skills', 'repoint', '--from', 'media', '--to', 'pictures:media', '--json', ...f.base])).out) as SkillsOut;
  assert.ok(first.changes.length > 0);
  assert.match(read(f.root, 'agents/maker.md'), /the pictures:media skill/);
  assert.match(read(f.root, 'skills/film/SKILL.md'), /Use pictures:media for sets/);
  // The second run finds nothing left to repoint: no pictures:pictures:media.
  assert.equal((await cli(['skills', 'repoint', '--from', 'media', '--to', 'pictures:media', ...f.base])).code, 1);
  assert.doesNotMatch(read(f.root, 'agents/maker.md'), /pictures:pictures/);
  assert.equal((await cli(['skills', 'repoint', '--from', 'media', '--to', 'pictures:', ...f.base])).code, 2);
});
