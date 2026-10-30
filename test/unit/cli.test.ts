import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { ConsolidateOut, HuntAddResult, HuntResult, InventoryOut, parse, run } from '../../src/cli';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `cli-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const skill = (name: string, body = 'Body') => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`;

/** A fake Claude folder with a marketplace of the owner's, and a repo that copies two global skills (one identical, one changed). */
function fixture() {
  const root = tmp('root');
  const market = tmp('market');
  const repo = tmp('repo');
  const userConfig = path.join(tmp('cfg'), '.claude.json');
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins: [] }));
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ own: { source: { source: 'directory', path: market }, installLocation: market } }));
  write(root, 'skills/same/SKILL.md', skill('same'));
  write(root, 'skills/moved/SKILL.md', skill('moved', 'Global text'));
  write(root, 'agents/helper.md', '---\nname: helper\ndescription: helps\n---\n\nHi\n');
  write(repo, 'CLAUDE.md', '# repo\n');
  write(repo, '.claude/skills/same/SKILL.md', skill('same'));
  write(repo, '.claude/skills/moved/SKILL.md', skill('moved', 'Repo text'));
  write(path.dirname(userConfig), '.claude.json', JSON.stringify({ projects: { [repo]: {} } }));
  const base = ['--root', root, '--user-config', userConfig, '--repos', repo];
  return { root, market, repo, base };
}

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('the CLI loads without vscode', () => {
  assert.ok(!Object.keys(require.cache).some(k => /[\\/]node_modules[\\/]vscode[\\/]/.test(k) || /[\\/]vscode$/.test(k)));
});

test('parse splits words and flags, and booleans take no value', () => {
  const a = parse(['hunt', 'plan', '--name', 'x', '--skills=a,b', '--dry-run', '--repo', 'r1', '--repo', 'r2']);
  assert.deepEqual(a.words, ['hunt', 'plan']);
  assert.deepEqual(a.flags.get('skills'), ['a,b']);
  assert.deepEqual(a.flags.get('dry-run'), ['true']);
  assert.deepEqual(a.flags.get('repo'), ['r1', 'r2']);
  assert.throws(() => parse(['inventory', '--root']), /needs a value/);
});

test('no command prints help and exits 1; --help exits 0', async () => {
  assert.equal((await cli([])).code, 1);
  const h = await cli(['--help']);
  assert.equal(h.code, 0);
  assert.match(h.out, /consolidate retire/);
});

test('inventory --json lists the harness of Global and of one repo', async () => {
  const f = fixture();
  const g = JSON.parse((await cli(['inventory', '--json', ...f.base])).out) as InventoryOut;
  assert.equal(g.scope.id, 'global');
  const skills = g.categories.find(c => c.kind === 'skill')!;
  assert.deepEqual(skills.items.map(i => i.name).sort(), ['moved', 'same']);
  assert.ok(skills.items.find(i => i.name === 'same')!.copies![0].state === 'identical');
  assert.equal(g.categories.find(c => c.kind === 'agent')!.count, 1);
  assert.deepEqual(g.repos.map(r => r.toLowerCase()), [f.repo.toLowerCase()]);
  const r = JSON.parse((await cli(['inventory', '--json', '--repo', f.repo, ...f.base])).out) as InventoryOut;
  assert.equal(r.scope.label, path.basename(f.repo));
  assert.equal(r.categories.find(c => c.kind === 'skill')!.count, 2);
  const text = (await cli(['inventory', ...f.base])).out;
  assert.match(text, /\*\*Skills \(2\)\*\*/);
  assert.match(text, /^\| Name +\| Description +\| Status +\| Also in +\|$/m);
  assert.match(text, /^\| same +\| same skill +\| +\| .* \(identical\) \|$/m);
});

test('inventory takes every --repo given: one inventory each in text, and inventories in --json', async () => {
  const f = fixture();
  const two = tmp('repo2');
  write(two, 'CLAUDE.md', '# two\n');
  write(two, '.claude/agents/solo.md', '---\nname: solo\ndescription: solo\n---\n\nHi\n');
  const repos = ['--repo', f.repo, '--repo', two];
  const j = JSON.parse((await cli(['inventory', '--json', ...repos, ...f.base])).out) as { inventories: InventoryOut[]; applied: boolean };
  assert.deepEqual(j.inventories.map(o => o.scope.label), [path.basename(f.repo), path.basename(two)]);
  assert.equal(j.applied, false);
  const text = (await cli(['inventory', ...repos, ...f.base])).out;
  assert.match(text, new RegExp(`\\*\\*${path.basename(f.repo)} \\(`));
  assert.match(text, new RegExp(`\\*\\*${path.basename(two)} \\(`));
  assert.match(text, /^\| solo +\|/m);
  assert.match(text, /^\| same +\|/m);
  write(two, '.claude/skills/same/SKILL.md', skill('same'));
  const c = JSON.parse((await cli(['consolidate', '--json', ...repos, ...f.base])).out) as ConsolidateOut;
  const same = c.elements.find(e => e.name === 'same')!;
  assert.ok(same.copies.some(x => x.label === path.basename(f.repo)) && same.copies.some(x => x.label === path.basename(two)));
});

test('consolidate and hunt catalog print a headline and a table in text mode', async () => {
  const f = fixture();
  const c = (await cli(['consolidate', ...f.base])).out;
  assert.match(c, /^\*\*2 elements exist in more than one place\*\*$/m);
  assert.match(c, /^\| Kind +\| Name +\| Place +\| State +\| File +\|$/m);
  assert.match(c, /^\| skill +\| moved +\| .* \| differs +\|/m);
  const h = (await cli(['hunt', 'catalog', ...f.base])).out;
  assert.match(h, /^\*\*3 skills and agents can go into a plugin\*\*$/m);
  assert.match(h, /^\| Kind +\| Name +\| Where +\| Shipped by +\| Description +\|$/m);
});

test('consolidate --json lists every element with copies and whether each differs', async () => {
  const f = fixture();
  const o = JSON.parse((await cli(['consolidate', '--json', ...f.base])).out) as ConsolidateOut;
  assert.deepEqual(o.elements.map(e => `${e.kind}:${e.name}:${e.allIdentical}`), ['skill:moved:false', 'skill:same:true']);
  assert.deepEqual(o.elements[0].copies.map(c => c.state), ['reference', 'differs']);
  const one = JSON.parse((await cli(['consolidate', '--name', 'same', '--json', ...f.base])).out) as ConsolidateOut;
  assert.equal(one.elements.length, 1);
});

test('an unknown flag exits 2, and --apply is accepted', async () => {
  const f = fixture();
  const bad = await cli(['inventory', '--bogus', ...f.base]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /unknown flag: --bogus/);
  assert.equal((await cli(['inventory', '--apply', ...f.base])).code, 0);
});

test('read-only commands end in a JSON object with applied false', async () => {
  const f = fixture();
  for (const argv of [['inventory'], ['consolidate'], ['hunt', 'catalog']]) assert.equal(JSON.parse((await cli([...argv, '--json', ...f.base])).out).applied, false);
});

test('consolidate retire --dry-run writes nothing; the default backs up then deletes; both answer the same shape', async () => {
  const f = fixture();
  const args = ['consolidate', 'retire', '--name', 'same', '--kind', 'skill', '--from', f.repo, '--json', ...f.base];
  const dry = await cli([...args, '--dry-run']);
  assert.equal(dry.code, 0);
  assert.ok(fs.existsSync(path.join(f.repo, '.claude/skills/same/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(f.root, 'repo-sync-backups')));
  const planned = JSON.parse(dry.out) as { backup: string; applied: boolean };
  assert.equal(planned.applied, false);
  assert.match((await cli([...args.filter(x => x !== '--json'), '--dry-run'])).out, /^\[dry-run\] back up/);
  const done = await cli(args);
  assert.equal(done.code, 0);
  const o = JSON.parse(done.out) as { backup: string; applied: boolean };
  assert.equal(o.applied, true);
  assert.deepEqual(Object.keys(o), Object.keys(planned));
  assert.ok(fs.existsSync(path.join(o.backup, 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(f.repo, '.claude/skills/same')));
  const changed = await cli(['consolidate', 'retire', '--name', 'moved', '--kind', 'skill', '--from', f.repo, ...f.base]);
  assert.equal(changed.code, 1);
  assert.match(changed.err, /no identical/);
  assert.ok(fs.existsSync(path.join(f.repo, '.claude/skills/moved/SKILL.md')));
});

test('hunt catalog --json lists skills and agents across Global and repos', async () => {
  const f = fixture();
  const o = JSON.parse((await cli(['hunt', 'catalog', '--json', ...f.base])).out) as { catalog: { asset: { kind: string; name: string; repos: unknown[] } }[] };
  assert.deepEqual(o.catalog.map(c => `${c.asset.kind}:${c.asset.name}`), ['agent:helper', 'skill:moved', 'skill:same']);
  assert.equal(o.catalog[2].asset.repos.length, 1);
});

test('hunt plan and hunt create --dry-run print the plan and write nothing', async () => {
  const f = fixture();
  const args = ['hunt', 'plan', '--name', 'tools', '--category', 'misc', '--skills', 'same', '--agents', 'helper', '--retire', '--json', ...f.base];
  const plan = await cli(args);
  assert.equal(plan.code, 0);
  const o = JSON.parse(plan.out) as HuntResult;
  assert.equal(o.applied, false);
  assert.equal(o.installed, 'tools@own');
  assert.ok(o.backup);
  assert.equal(o.market, 'own');
  assert.deepEqual(o.problems, []);
  assert.ok(o.files.some(x => x.endsWith('skills/same/SKILL.md')) && o.files.some(x => x.endsWith('agents/helper.md')));
  assert.equal(o.retired.length, 3);
  const create = await cli(['hunt', 'create', '--dry-run', ...args.slice(2)]);
  assert.equal(create.code, 0);
  assert.deepEqual(Object.keys(JSON.parse(create.out)), Object.keys(o));
  assert.match((await cli(['hunt', 'create', '--dry-run', ...args.slice(2).filter(x => x !== '--json')])).out, /^\[dry-run\] write /);
  assert.ok(!fs.existsSync(o.dir));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.market, '.claude-plugin/marketplace.json'), 'utf8')).plugins.length, 0);
  const bad = await cli(['hunt', 'plan', '--name', 'tools', '--skills', 'nope', ...f.base]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /no skill named nope/);
});

/** A plugin `kit` at 0.2.0 in the fixture's marketplace that already ships a skill `held`, and a repo CLAUDE.md that names the skill `moved`. */
function withKit(f: ReturnType<typeof fixture>) {
  const kit = path.join(f.market, 'plugins/kit');
  write(f.market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins: [{ name: 'kit', source: './plugins/kit', version: '0.2.0' }] }, null, 2));
  write(kit, '.claude-plugin/plugin.json', JSON.stringify({ name: 'kit', version: '0.2.0' }, null, 2));
  write(kit, 'skills/held/SKILL.md', skill('held'));
  write(f.root, 'skills/held/SKILL.md', skill('held'));
  write(f.repo, 'CLAUDE.md', '# repo\n\n- `.claude/skills/` moved, held\n- kit:moved is the plugin one\n');
  return kit;
}

const ADD_KEYS = ['name', 'market', 'problems', 'files', 'retired', 'kept', 'check', 'version', 'installed', 'backup', 'applied'];

test('hunt add --dry-run plans the copy into an existing plugin, the patch bump and the lines that still name a retired copy, and writes nothing', async () => {
  const f = fixture();
  const kit = withKit(f);
  const before = fs.readFileSync(path.join(f.market, '.claude-plugin/marketplace.json'), 'utf8');
  const dry = await cli(['hunt', 'add', '--name', 'kit', '--skills', 'moved', '--agents', 'helper', '--retire', '--dry-run', '--json', ...f.base]);
  assert.equal(dry.code, 0, dry.err);
  const o = JSON.parse(dry.out) as HuntAddResult;
  assert.deepEqual(Object.keys(o), ADD_KEYS);
  assert.equal(o.applied, false);
  assert.equal(o.market, 'own');
  assert.equal(o.version, '0.2.1');
  assert.equal(o.installed, null);
  assert.ok(o.backup);
  assert.deepEqual(o.problems, []);
  assert.ok(o.files.some(x => x.endsWith('plugins/kit/skills/moved/SKILL.md')) && o.files.some(x => x.endsWith('plugins/kit/agents/helper.md')));
  assert.ok(o.files.some(x => x.endsWith('plugin.json (version 0.2.0 to 0.2.1)')) && o.files.some(x => x.endsWith('marketplace.json (kit version 0.2.0 to 0.2.1)')));
  assert.equal(o.retired.length, 3);
  // The CLAUDE.md line that names moved; the plugin:moved line and the element's own files are left out.
  assert.deepEqual(o.check.map(c => [path.basename(c.file), c.line, c.text]), [['CLAUDE.md', 3, '- `.claude/skills/` moved, held']]);
  assert.ok(!fs.existsSync(path.join(kit, 'skills/moved')) && !fs.existsSync(path.join(kit, 'agents')));
  assert.equal(fs.readFileSync(path.join(f.market, '.claude-plugin/marketplace.json'), 'utf8'), before);
  const text = (await cli(['hunt', 'add', '--name', 'kit', '--skills', 'moved', '--retire', '--dry-run', ...f.base])).out;
  assert.match(text, /^\[dry-run\] write /);
  assert.match(text, /^\*\*1 line still names a retired copy\*\*$/m);
  assert.match(text, /^\| File +\| Line \| Text +\|$/m);
  // An element the plugin already has is a problem, never an overwrite; an unknown plugin stops.
  const held = await cli(['hunt', 'add', '--name', 'kit', '--skills', 'held', '--json', ...f.base]);
  assert.equal(held.code, 1);
  assert.deepEqual((JSON.parse(held.out) as HuntAddResult).problems, ['kit already has the skill held.']);
  const none = await cli(['hunt', 'add', '--name', 'nope', '--skills', 'moved', ...f.base]);
  assert.equal(none.code, 1);
  assert.match(none.err, /No marketplace folder of yours lists a plugin called nope/);
});

test('hunt add copies into the plugin, bumps both versions and retires every copy, backed up first; without --retire check stays empty', async () => {
  const f = fixture();
  const kit = withKit(f);
  const plain = JSON.parse((await cli(['hunt', 'add', '--name', 'kit', '--agents', 'helper', '--dry-run', '--json', ...f.base])).out) as HuntAddResult;
  assert.deepEqual(plain.check, []);
  assert.equal(plain.backup, null);
  const done = await cli(['hunt', 'add', '--name', 'kit', '--skills', 'moved', '--agents', 'helper', '--retire', '--json', ...f.base]);
  assert.equal(done.code, 0, done.err);
  const o = JSON.parse(done.out) as HuntAddResult;
  assert.deepEqual(Object.keys(o), ADD_KEYS);
  assert.equal(o.applied, true);
  // The global copy is the plugin's version.
  assert.match(fs.readFileSync(path.join(kit, 'skills/moved/SKILL.md'), 'utf8'), /Global text/);
  assert.ok(fs.existsSync(path.join(kit, 'agents/helper.md')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(kit, '.claude-plugin/plugin.json'), 'utf8')).version, '0.2.1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.market, '.claude-plugin/marketplace.json'), 'utf8')).plugins[0].version, '0.2.1');
  assert.ok(!fs.existsSync(path.join(f.root, 'skills/moved')) && !fs.existsSync(path.join(f.repo, '.claude/skills/moved')) && !fs.existsSync(path.join(f.root, 'agents/helper.md')));
  assert.ok(o.backup && fs.existsSync(o.backup));
  assert.equal(o.check.length, 1);
});

test('hunt add writes a copied skill\'s own absolute path as <this skill>/ and lists the paths into other skills as check rows', async () => {
  const f = fixture();
  const kit = withKit(f);
  write(f.root, 'skills/deploy/SKILL.md', skill('deploy', 'Run `bash ~/.claude/skills/deploy/scripts/run.sh`.'));
  write(f.root, 'skills/deploy/references/shots.md', '# Shots\n\nnode ~/.claude/skills/chrome-devtools/scripts/shot.js\nC:\\Users\\me\\.claude\\skills\\deploy\\scripts\\run.ps1\n');
  write(f.root, 'skills/deploy/scripts/run.sh', 'cat ~/.claude/skills/deploy/data.json\n');
  const dry = JSON.parse((await cli(['hunt', 'add', '--name', 'kit', '--skills', 'deploy', '--dry-run', '--json', ...f.base])).out) as HuntAddResult;
  assert.ok(dry.files.includes('plugins/kit/skills/deploy/SKILL.md (1 absolute path to <this skill>/)'));
  assert.ok(dry.files.includes('plugins/kit/skills/deploy/references/shots.md (1 absolute path to <this skill>/)'));
  // Another skill's folder, and a script's own path (code, not text), are only listed.
  assert.deepEqual(dry.check.map(c => [path.relative(kit, c.file).split(path.sep).join('/'), c.line, c.text]), [
    ['skills/deploy/references/shots.md', 3, 'node ~/.claude/skills/chrome-devtools/scripts/shot.js'],
    ['skills/deploy/scripts/run.sh', 1, 'cat ~/.claude/skills/deploy/data.json'],
  ]);
  const done = await cli(['hunt', 'add', '--name', 'kit', '--skills', 'deploy', '--json', ...f.base]);
  assert.equal(done.code, 0, done.err);
  assert.match(fs.readFileSync(path.join(kit, 'skills/deploy/SKILL.md'), 'utf8'), /Run `bash <this skill>\/scripts\/run\.sh`\./);
  assert.equal(fs.readFileSync(path.join(kit, 'skills/deploy/references/shots.md'), 'utf8'), '# Shots\n\nnode ~/.claude/skills/chrome-devtools/scripts/shot.js\n<this skill>\\scripts\\run.ps1\n');
  assert.equal(fs.readFileSync(path.join(kit, 'skills/deploy/scripts/run.sh'), 'utf8'), 'cat ~/.claude/skills/deploy/data.json\n');
  // The global copy is not touched.
  assert.match(fs.readFileSync(path.join(f.root, 'skills/deploy/SKILL.md'), 'utf8'), /~\/\.claude\/skills\/deploy\/scripts/);
});

test('hunt add keeps the marketplace repo\'s package.json and lock file at the plugin\'s version when they were in step', async () => {
  const f = fixture();
  const kit = withKit(f);
  const lock = (v: string) => JSON.stringify({ name: 'repo', version: v, lockfileVersion: 3, packages: { '': { name: 'repo', version: v } } }, null, 2);
  write(f.market, 'package.json', JSON.stringify({ name: 'repo', version: '0.2.0', scripts: {} }, null, 2));
  write(f.market, 'package-lock.json', lock('0.2.0'));
  const dry = JSON.parse((await cli(['hunt', 'add', '--name', 'kit', '--skills', 'moved', '--dry-run', '--json', ...f.base])).out) as HuntAddResult;
  const base = path.basename(f.market);
  assert.ok(dry.files.includes(`${base}/package.json (version 0.2.0 to 0.2.1)`) && dry.files.includes(`${base}/package-lock.json (version 0.2.0 to 0.2.1)`));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.market, 'package.json'), 'utf8')).version, '0.2.0');
  const done = await cli(['hunt', 'add', '--name', 'kit', '--skills', 'moved', '--json', ...f.base]);
  assert.equal(done.code, 0, done.err);
  assert.equal(JSON.parse(fs.readFileSync(path.join(kit, '.claude-plugin/plugin.json'), 'utf8')).version, '0.2.1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.market, 'package.json'), 'utf8')).version, '0.2.1');
  assert.equal(fs.readFileSync(path.join(f.market, 'package-lock.json'), 'utf8'), lock('0.2.1'));
  // A package.json at another version is not the plugin's and stays.
  write(f.market, 'package.json', JSON.stringify({ name: 'repo', version: '5.0.0' }, null, 2));
  const other = JSON.parse((await cli(['hunt', 'add', '--name', 'kit', '--agents', 'helper', '--dry-run', '--json', ...f.base])).out) as HuntAddResult;
  assert.equal(other.version, '0.2.2');
  assert.ok(!other.files.some(x => /package/.test(x)));
});

test('hunt add takes the addition out again when the plugin update fails, and updates an installed plugin', { skip: process.platform !== 'win32' }, async () => {
  const fake = (update: string) => {
    const bin = tmp('fake-claude');
    fs.writeFileSync(path.join(bin, 'claude.cmd'), ['@echo off', `if "%2"=="update" (`, update, ')', 'exit /b 0', ''].join('\r\n'));
    return bin;
  };
  const installed = (f: ReturnType<typeof fixture>) => write(f.root, 'plugins/installed_plugins.json', JSON.stringify({ plugins: { 'kit@own': [{ scope: 'user', version: '0.2.0' }] } }));
  const before = process.env.PATH;
  try {
    const f = fixture();
    const kit = withKit(f);
    installed(f);
    const manifest = fs.readFileSync(path.join(kit, '.claude-plugin/plugin.json'), 'utf8');
    const catalog = fs.readFileSync(path.join(f.market, '.claude-plugin/marketplace.json'), 'utf8');
    process.env.PATH = fake('  echo boom\r\n  exit /b 1');
    const failed = await cli(['hunt', 'add', '--name', 'kit', '--skills', 'moved', '--agents', 'helper', '--retire', ...f.base]);
    assert.equal(failed.code, 1);
    assert.match(failed.err, /claude plugin update kit@own failed: boom.*taken out again; no copy was retired/);
    assert.ok(!fs.existsSync(path.join(kit, 'skills/moved')) && !fs.existsSync(path.join(kit, 'agents')));
    assert.equal(fs.readFileSync(path.join(kit, '.claude-plugin/plugin.json'), 'utf8'), manifest);
    assert.equal(fs.readFileSync(path.join(f.market, '.claude-plugin/marketplace.json'), 'utf8'), catalog);
    assert.ok(fs.existsSync(path.join(f.root, 'skills/moved/SKILL.md')) && fs.existsSync(path.join(f.repo, '.claude/skills/moved/SKILL.md')));
    const g = fixture();
    withKit(g);
    installed(g);
    process.env.PATH = fake('  echo {"plugins":{"%3":[{"scope":"user","version":"0.2.1"}]}}> "%CLAUDE_CONFIG_DIR%\\plugins\\installed_plugins.json"');
    const ok = await cli(['hunt', 'add', '--name', 'kit', '--skills', 'moved', '--json', ...g.base]);
    assert.equal(ok.code, 0, ok.err);
    const o = JSON.parse(ok.out) as HuntAddResult;
    assert.equal(o.installed, 'kit@own');
    assert.equal(o.version, '0.2.1');
    assert.ok(fs.existsSync(path.join(g.root, 'skills/moved/SKILL.md')));
  } finally {
    process.env.PATH = before;
  }
});

/** A plugin `azure` at 0.1.0 in the fixture's marketplace with a skill m365, an agent mailer, and text that names azure:m365. */
function withAzure(f: ReturnType<typeof fixture>) {
  const azure = path.join(f.market, 'plugins/azure');
  const catalog = JSON.parse(fs.readFileSync(path.join(f.market, '.claude-plugin/marketplace.json'), 'utf8'));
  catalog.plugins.push({ name: 'azure', source: './plugins/azure', version: '0.1.0' });
  write(f.market, '.claude-plugin/marketplace.json', JSON.stringify(catalog, null, 2));
  write(azure, '.claude-plugin/plugin.json', JSON.stringify({ name: 'azure', version: '0.1.0' }, null, 2));
  write(azure, 'skills/azure/SKILL.md', skill('azure', 'For mail see azure:m365.'));
  write(azure, 'skills/m365/SKILL.md', skill('m365', 'Mail and Teams.'));
  write(azure, 'agents/mailer.md', '---\nname: mailer\ndescription: mails\n---\n\nHi\n');
  write(f.repo, 'CLAUDE.md', '# repo\n\nUse azure:m365 for mail.\n');
  return azure;
}

test('hunt add takes <plugin>:<name> out of another plugin of the marketplace: copied, removed there after a backup, both versions bumped', async () => {
  const f = fixture();
  const kit = withKit(f);
  const azure = withAzure(f);
  const args = ['hunt', 'add', '--name', 'kit', '--skills', 'azure:m365', '--agents', 'azure:mailer', '--json', ...f.base];
  const dry = JSON.parse((await cli([...args, '--dry-run'])).out) as HuntAddResult;
  assert.deepEqual(dry.problems, []);
  assert.deepEqual(dry.retired, ['skill m365 in plugin azure', 'agent mailer in plugin azure']);
  assert.ok(dry.files.some(x => x.endsWith('plugins/kit/skills/m365/SKILL.md')) && dry.files.some(x => x.endsWith('plugins/kit/agents/mailer.md')));
  assert.ok(dry.files.includes('plugins/azure/.claude-plugin/plugin.json (version 0.1.0 to 0.1.1)'));
  assert.ok(dry.files.some(x => x.endsWith('marketplace.json (azure version 0.1.0 to 0.1.1)')));
  assert.equal(dry.version, '0.2.1');
  assert.ok(dry.backup);
  // The mentions of the old plugin:name, in a repo and in the plugin it leaves; the element's own files are left out.
  assert.deepEqual(dry.check.map(c => [path.basename(path.dirname(c.file)), c.line, c.text]).sort(), [
    ['azure', 6, 'For mail see azure:m365.'],
    [path.basename(f.repo), 3, 'Use azure:m365 for mail.'],
  ]);
  assert.ok(fs.existsSync(path.join(azure, 'skills/m365/SKILL.md')));
  const done = await cli(args);
  assert.equal(done.code, 0, done.err);
  const o = JSON.parse(done.out) as HuntAddResult;
  assert.match(fs.readFileSync(path.join(kit, 'skills/m365/SKILL.md'), 'utf8'), /Mail and Teams/);
  assert.ok(fs.existsSync(path.join(kit, 'agents/mailer.md')));
  assert.ok(!fs.existsSync(path.join(azure, 'skills/m365')) && !fs.existsSync(path.join(azure, 'agents/mailer.md')));
  assert.ok(fs.existsSync(path.join(azure, 'skills/azure/SKILL.md')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(azure, '.claude-plugin/plugin.json'), 'utf8')).version, '0.1.1');
  const catalog = JSON.parse(fs.readFileSync(path.join(f.market, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.deepEqual(catalog.plugins.map((x: { name: string; version: string }) => `${x.name}@${x.version}`), ['kit@0.2.1', 'azure@0.1.1']);
  assert.ok(o.backup && fs.existsSync(path.join(o.backup, path.basename(f.market), 'plugins/azure/skills/m365/SKILL.md')));
  // A plugin or element that is not there stops.
  const nope = await cli(['hunt', 'add', '--name', 'kit', '--skills', 'nope:m365', ...f.base]);
  assert.equal(nope.code, 1);
  assert.match(nope.err, /own has no plugin folder called nope\./);
  assert.match((await cli(['hunt', 'add', '--name', 'kit', '--skills', 'azure:m365', ...f.base])).err, /The plugin azure has no skill named m365\./);
});

test('hunt create puts everything back when the moved-from plugin\'s update fails after the install', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture();
  const azure = withAzure(f);
  write(f.root, 'plugins/installed_plugins.json', JSON.stringify({ plugins: { 'azure@own': [{ scope: 'user', version: '0.1.0' }] } }));
  const catalog = fs.readFileSync(path.join(f.market, '.claude-plugin/marketplace.json'), 'utf8');
  const manifest = fs.readFileSync(path.join(azure, '.claude-plugin/plugin.json'), 'utf8');
  const bin = tmp('fake-claude');
  fs.writeFileSync(
    path.join(bin, 'claude.cmd'),
    [
      '@echo off',
      'if "%2"=="update" (',
      '  echo boom',
      '  exit /b 1',
      ')',
      'if "%2"=="install" (',
      '  mkdir "%CLAUDE_CONFIG_DIR%\\plugins" 2>nul',
      '  echo {"plugins":{"%3":[{}]}}> "%CLAUDE_CONFIG_DIR%\\plugins\\installed_plugins.json"',
      ')',
      'exit /b 0',
      '',
    ].join('\r\n')
  );
  const plan = JSON.parse((await cli(['hunt', 'plan', '--name', 'mail', '--skills', 'azure:m365', '--json', ...f.base])).out) as HuntResult;
  assert.equal(plan.source, './plugins/mail');
  assert.deepEqual(plan.retired, ['skill m365 in plugin azure']);
  const before = process.env.PATH;
  process.env.PATH = bin;
  try {
    const r = await cli(['hunt', 'create', '--name', 'mail', '--skills', 'azure:m365', ...f.base]);
    assert.equal(r.code, 1);
    assert.match(r.err, /claude plugin update azure@own failed: boom.*removed again, and the moved elements are back in their plugins; no copy was retired\. Claude Code has mail@own, azure@own as before\./);
  } finally {
    process.env.PATH = before;
  }
  assert.ok(!fs.existsSync(path.join(f.market, 'plugins/mail')));
  assert.equal(fs.readFileSync(path.join(f.market, '.claude-plugin/marketplace.json'), 'utf8'), catalog);
  assert.equal(fs.readFileSync(path.join(azure, '.claude-plugin/plugin.json'), 'utf8'), manifest);
  assert.match(fs.readFileSync(path.join(azure, 'skills/m365/SKILL.md'), 'utf8'), /Mail and Teams/);
});

test('hunt create --retire reports the lines that still name a retired copy, the same rows as hunt add', async () => {
  const f = fixture();
  write(f.repo, 'CLAUDE.md', '# repo\n\nThe helper agent writes.\n');
  write(f.root, 'rules/team.md', 'Ask helper first.\nAsk tools:helper later.\n');
  const o = JSON.parse((await cli(['hunt', 'plan', '--name', 'tools', '--category', 'misc', '--agents', 'helper', '--retire', '--json', ...f.base])).out) as HuntResult;
  assert.deepEqual(o.check.map(c => [path.basename(c.file), c.line, c.text]).sort(), [['CLAUDE.md', 3, 'The helper agent writes.'], ['team.md', 1, 'Ask helper first.']]);
  const kept = JSON.parse((await cli(['hunt', 'plan', '--name', 'tools', '--category', 'misc', '--agents', 'helper', '--json', ...f.base])).out) as HuntResult;
  assert.deepEqual(kept.check, []);
});

test('hunt plan needs no --category for a flat marketplace and drops one given; a marketplace with category folders needs it', async () => {
  const f = fixture();
  const plan = async (...extra: string[]) => {
    const r = await cli(['hunt', 'plan', '--name', 'tools', '--skills', 'same', '--json', ...extra, ...f.base]);
    return { code: r.code, o: JSON.parse(r.out) as HuntResult };
  };
  for (const plugins of [[], [{ name: 'kit', source: './plugins/kit' }]]) {
    write(f.market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins }));
    const bare = await plan();
    assert.equal(bare.code, 0);
    assert.deepEqual(bare.o.problems, []);
    assert.equal(bare.o.source, './plugins/tools');
    assert.equal((await plan('--category', 'misc')).o.source, './plugins/tools');
  }
  write(f.market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins: [{ name: 'a', source: './plugins/dev/a' }, { name: 'b', source: './plugins/ops/b' }] }));
  const missing = await plan();
  assert.equal(missing.code, 1);
  assert.deepEqual(missing.o.problems, ['own keeps plugins in category folders: give the card a category.']);
  assert.equal((await plan('--category', 'dev')).o.source, './plugins/dev/tools');
});

test('hunt catalog lists the strays: folders under a skills root with no SKILL.md, but not the synced folder or dot folders', async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.root, 'skills/empty-one'), { recursive: true });
  fs.mkdirSync(path.join(f.root, 'skills/synced/x'), { recursive: true });
  fs.mkdirSync(path.join(f.root, 'skills/.trash/old'), { recursive: true });
  fs.mkdirSync(path.join(f.repo, '.claude/skills/.archive'), { recursive: true });
  write(f.repo, '.claude/skills/vendored/README.md', '# vendored\n');
  write(f.repo, '.claude/skills/vendored/hooks/hook.mjs', '');
  const o = JSON.parse((await cli(['hunt', 'catalog', '--json', ...f.base])).out) as { strays: { scope: string; path: string; why: string }[] };
  assert.deepEqual(o.strays.map(s => `${s.scope}:${path.basename(s.path)}`).sort(), ['global:empty-one', `${path.basename(f.repo)}:vendored`].sort());
  assert.equal(o.strays.find(s => s.scope === 'global')!.why, 'Empty folder, no SKILL.md.');
  assert.equal(o.strays.find(s => s.scope !== 'global')!.why, 'No SKILL.md; holds README.md, hooks/.');
  const text = (await cli(['hunt', 'catalog', ...f.base])).out;
  assert.match(text, /^\*\*2 folders under a skills root have no SKILL\.md\*\*$/m);
  assert.match(text, /^\| Scope +\| Path +\| Why +\|$/m);
});

test('the command modules are wired: media doctor and usage refuse missing arguments with exit 2', async () => {
  assert.equal((await cli(['media', 'doctor'])).code, 2);
  assert.equal((await cli(['usage'])).code, 2);
});

test('hunt catalog --kind and --query keep the matching skills and agents', async () => {
  const f = fixture();
  const names = async (...extra: string[]) => (JSON.parse((await cli(['hunt', 'catalog', '--json', ...extra, ...f.base])).out) as { catalog: { asset: { name: string } }[] }).catalog.map(c => c.asset.name);
  assert.deepEqual(await names('--kind', 'agent'), ['helper']);
  assert.deepEqual(await names('--kind', 'skill', '--query', 'MOVED'), ['moved']);
  assert.deepEqual(await names('--query', 'helps'), ['helper']);
  assert.equal((await cli(['hunt', 'catalog', '--kind', 'rule', ...f.base])).code, 2);
});
