import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { ConsolidateOut, HuntResult, InventoryOut, parse, run } from '../../src/cli';

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
