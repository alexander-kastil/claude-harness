import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';
import { run } from '../../src/cli';
import { parseScript, setClaudeRunner } from '../../src/cli-build';
import { candidates } from '../../src/cli-complete';

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** A scratch Claude folder with a marketplace holding one plugin, an empty repo and a user config; nothing real is touched. */
function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-build-'));
  const root = path.join(tmp, '.claude');
  const repo = path.join(tmp, 'repo');
  const userConfig = path.join(tmp, 'claude.json');
  write(path.join(repo, 'CLAUDE.md'), '# repo\n');
  write(path.join(root, 'plugins/known_marketplaces.json'), JSON.stringify({ mk: { installLocation: path.join(tmp, 'mk') } }));
  write(path.join(tmp, 'mk/.claude-plugin/marketplace.json'), JSON.stringify({ name: 'mk', plugins: [{ name: 'tool', description: 'a tool' }] }));
  write(userConfig, '{}\n');
  const base = ['--root', root, '--repo', repo, '--user-config', userConfig];
  return { tmp, root, repo, userConfig, base };
}

const calls: { args: string[]; cwd: string }[] = [];
/** A claude stub that performs what the real command would write, so a rerun sees it. */
function stub(f: ReturnType<typeof fixture>, code = 0) {
  calls.length = 0;
  setClaudeRunner(async (args, cwd) => {
    calls.push({ args, cwd });
    if (code) return { code, out: 'boom' };
    if (args[0] === 'mcp' && args[1] === 'add') {
      const i = args.indexOf('--scope');
      const name = args.includes('--transport') ? args[args.length - 2] : args[i + 2];
      const entry = args.includes('--transport') ? { type: args[args.indexOf('--transport') + 1], url: args[args.length - 1] } : { command: args[args.indexOf('--') + 1], args: args.slice(args.indexOf('--') + 2) };
      const file = args[i + 1] === 'user' ? f.userConfig : path.join(cwd, '.mcp.json');
      const json = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      write(file, JSON.stringify({ ...json, mcpServers: { ...json.mcpServers, [name]: entry } }));
    } else if (args[0] === 'mcp' && args[1] === 'remove') {
      const file = args[args.indexOf('--scope') + 1] === 'user' ? f.userConfig : path.join(cwd, '.mcp.json');
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      delete json.mcpServers[args[2]];
      write(file, JSON.stringify(json));
    } else if (args[0] === 'plugin' && args[1] === 'install') {
      write(path.join(f.root, 'plugins/installed_plugins.json'), JSON.stringify({ plugins: { [args[2]]: [{ scope: 'user', installPath: f.tmp }] } }));
      write(path.join(f.root, 'settings.json'), JSON.stringify({ enabledPlugins: { [args[2]]: true } }));
    }
    return { code: 0, out: '' };
  });
}
afterEach(() => setClaudeRunner());

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const tree = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? tree(path.join(dir, e.name)) : [path.join(dir, e.name)])) : [];

test('a script is parsed: comments, repo lines, quotes and the g alias', () => {
  const { steps, problems } = parseScript('# c\n\nrepo .\nadd tool@mk\ng agent "my agent" --tools Read,Grep\ngenerate rule r --paths "src/**"\n', os.tmpdir(), '/x');
  assert.deepEqual(problems, []);
  assert.deepEqual(steps.map(s => [s.line, s.verb, s.kind, s.name]), [[4, 'add', 'plugin', 'tool@mk'], [5, 'generate', 'agent', 'my agent'], [6, 'generate', 'rule', 'r']]);
  assert.equal(steps[0].repo, path.resolve(os.tmpdir(), '.'));
});

test('validate reports every problem with its line and writes nothing; exit 2', async () => {
  const f = fixture();
  const script = path.join(f.tmp, 'bad.harness');
  write(script, ['# bad', 'frobnicate x', 'generate agent Bad_Name', 'generate agent ok --model gpt --tools Raed', 'generate rule q --colour red', 'generate mcp srv', 'generate rule r --from nope.md', 'add tool@missing', 'add nothing@mk', ''].join('\n'));
  const before = tree(f.tmp);
  const r = await cli(['validate', script, ...f.base]);
  assert.equal(r.code, 2);
  const lines = r.out.split('\n').filter(l => /^\|\s+\d/.test(l)).map(l => Number(l.split('|')[1]));
  assert.deepEqual([...new Set(lines)], [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.match(r.out, /unknown verb "frobnicate"/);
  assert.match(r.out, /not a valid agent name/);
  assert.match(r.out, /unknown model "gpt"/);
  assert.match(r.out, /unknown tool "Raed"; did you mean Read/);
  assert.match(r.out, /unknown flag: --colour/);
  assert.match(r.out, /needs --url or --command/);
  assert.match(r.out, /--from file nope.md does not exist/);
  assert.match(r.out, /no marketplace named missing/);
  assert.match(r.out, /marketplace mk has no plugin nothing/);
  assert.deepEqual(tree(f.tmp), before);
});

test('validate of a clean script exits 0; a dead CLAUDE.md pointer in --repo exits 1', async () => {
  const f = fixture();
  const script = path.join(f.tmp, 'ok.harness');
  write(script, 'generate agent helper --model haiku\n');
  assert.equal((await cli(['validate', script, ...f.base.slice(0, 2)])).code, 0);
  write(path.join(f.repo, 'CLAUDE.md'), 'See `docs/missing.md` first.\n');
  write(path.join(f.repo, '.claude/rules/r.md'), 'See `docs/missing.md` first.\n');
  const r = await cli(['validate', ...f.base]);
  assert.equal(r.code, 1);
  assert.match(r.out, /not found/);
});

test('generate agent creates, reruns with nothing to be done, and changes only what differs', async () => {
  const f = fixture();
  const argv = ['generate', 'agent', 'fact-gatherer', '--scope', 'repo', '--model', 'haiku', '--tools', 'Read,Grep,Glob', ...f.base];
  const first = await cli(argv);
  assert.equal(first.code, 0);
  assert.match(first.out, /^CREATE \.claude\/agents\/fact-gatherer\.md \(\d+ bytes\)$/m);
  const file = path.join(f.repo, '.claude/agents/fact-gatherer.md');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /model: haiku/);
  assert.match(text, /tools: Read, Grep, Glob/);
  const again = await cli(argv);
  assert.equal(again.out, 'Nothing to be done.');
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.deepEqual(tree(path.join(f.root, 'repo-sync-backups')), []);
  fs.appendFileSync(file, 'Hand written body.\n');
  const changed = await cli(['generate', 'agent', 'fact-gatherer', '--model', 'opus', '--tools', 'Read,Grep,Glob', ...f.base]);
  assert.match(changed.out, /^UPDATE \.claude\/agents\/fact-gatherer\.md/m);
  const now = fs.readFileSync(file, 'utf8');
  assert.match(now, /model: opus/);
  assert.match(now, /Hand written body\./);
  const saved = tree(path.join(f.root, 'repo-sync-backups'));
  assert.equal(saved.length, 1);
  assert.match(fs.readFileSync(saved[0], 'utf8'), /model: haiku/);
});

test('--dry-run writes nothing and ends with the NOTE line', async () => {
  const f = fixture();
  stub(f);
  const before = tree(f.tmp);
  const r = await cli(['generate', 'rule', 'working', '--dry-run', ...f.base]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^CREATE \.claude\/rules\/working\.md/m);
  assert.ok(r.out.endsWith('NOTE: The "--dry-run" option means no changes were written.'));
  const m = await cli(['generate', 'mcp', 'github', '--url', 'https://x.test/mcp', '--dry-run', ...f.base]);
  assert.match(m.out, /^CREATE \.mcp\.json/m);
  const p = await cli(['add', 'tool@mk', '--dry-run', ...f.base]);
  assert.match(p.out, /UPDATE|CREATE/);
  assert.deepEqual(tree(f.tmp), before);
  assert.deepEqual(calls, []);
});

test('generate rule --from copies the template text once', async () => {
  const f = fixture();
  const tpl = path.join(f.tmp, 'tpl.md');
  write(tpl, '# From template\n\nText.\n');
  const argv = ['generate', 'rule', 'working', '--from', tpl, ...f.base];
  assert.match((await cli(argv)).out, /^CREATE/m);
  assert.equal(fs.readFileSync(path.join(f.repo, '.claude/rules/working.md'), 'utf8'), '# From template\n\nText.\n');
  assert.equal((await cli(argv)).out, 'Nothing to be done.');
});

test('generate mcp and add go through the claude CLI, and a rerun does not call it', async () => {
  const f = fixture();
  stub(f);
  const mcp = ['generate', 'mcp', 'github', '--scope', 'repo', '--url', 'https://api.githubcopilot.com/mcp/', ...f.base];
  const first = await cli(mcp);
  assert.match(first.out, /^CREATE \.mcp\.json \(\d+ bytes\)$/m);
  assert.deepEqual(calls.map(c => c.args.slice(0, 2)), [['mcp', 'add']]);
  assert.equal(calls[0].cwd, f.repo);
  assert.equal((await cli(mcp)).out, 'Nothing to be done.');
  assert.equal(calls.length, 1);
  const changed = await cli(['generate', 'mcp', 'github', '--url', 'https://other.test/mcp', ...f.base]);
  assert.match(changed.out, /^UPDATE \.mcp\.json/m);
  assert.deepEqual(calls.slice(1).map(c => c.args.slice(0, 2)), [['mcp', 'remove'], ['mcp', 'add']]);
  const add = ['add', 'tool@mk', ...f.base];
  assert.match((await cli(add)).out, /^CREATE .*installed_plugins\.json|^UPDATE .*installed_plugins\.json/m);
  assert.deepEqual(calls[calls.length - 1].args, ['plugin', 'install', 'tool@mk', '--scope', 'user']);
  const n = calls.length;
  assert.equal((await cli(add)).out, 'Nothing to be done.');
  assert.equal(calls.length, n);
  assert.deepEqual(fs.readdirSync(f.repo).filter(x => x === 'tool' || x.endsWith('.md')), ['CLAUDE.md']);
});

test('run validates first and applies nothing on a problem; it applies, stops at a failing step and ends with a table', async () => {
  const f = fixture();
  stub(f);
  const bad = path.join(f.tmp, 'bad.harness');
  write(bad, `repo ${f.repo}\ngenerate agent a1\ngenerate agent Bad\n`);
  const r = await cli(['run', bad, ...f.base]);
  assert.equal(r.code, 2);
  assert.equal(fs.existsSync(path.join(f.repo, '.claude/agents/a1.md')), false);
  const good = path.join(f.tmp, 'good.harness');
  write(good, `repo ${f.repo}\ngenerate agent a1\ngenerate mcp srv --command node --args a.js\ngenerate rule r1\n`);
  setClaudeRunner(async () => ({ code: 1, out: 'nope' }));
  const failed = await cli(['run', good, ...f.base]);
  assert.equal(failed.code, 1);
  assert.match(failed.out, /\| +3 \|.*failed: claude mcp add srv failed: nope/);
  assert.match(failed.out, /\| +4 \|.*not run/);
  assert.equal(fs.existsSync(path.join(f.repo, '.claude/agents/a1.md')), true);
  assert.equal(fs.existsSync(path.join(f.repo, '.claude/rules/r1.md')), false);
  stub(f);
  const done = await cli(['run', good, ...f.base]);
  assert.equal(done.code, 0);
  assert.match(done.out, /\| Line \| Step/);
  const rerun = await cli(['run', good, ...f.base]);
  assert.match(rerun.out, /^Nothing to be done\./m);
  assert.equal((await cli(['run', good, '--dry-run', ...f.base])).out.includes('NOTE: The "--dry-run"'), true);
});

test('--json keeps the applied shape', async () => {
  const f = fixture();
  const r = JSON.parse((await cli(['generate', 'rule', 'j', '--json', ...f.base])).out);
  assert.equal(r.applied, true);
  assert.equal(r.changes[0].action, 'CREATE');
  const d = JSON.parse((await cli(['generate', 'rule', 'k', '--json', '--dry-run', ...f.base])).out);
  assert.equal(d.applied, false);
});

test('the new commands complete verbs, kinds, flags and values', () => {
  const texts = (line: string) => candidates(line).map(c => c.text);
  assert.ok(texts('harness ge').includes('generate'));
  assert.deepEqual(texts('harness generate '), ['agent', 'rule', 'skill', 'command', 'hook', 'mcp']);
  assert.deepEqual(texts('harness g '), ['agent', 'rule', 'skill', 'command', 'hook', 'mcp']);
  assert.deepEqual(texts('harness generate agent x --model h'), ['haiku']);
  assert.ok(texts('harness generate agent x --tools Read,G').includes('Read,Glob'));
  assert.deepEqual(texts('harness generate mcp x --transport '), ['http', 'sse']);
  assert.ok(texts('harness add --').includes('--scope'));
  assert.ok(texts('harness run --').includes('--dry-run'));
  assert.deepEqual(texts('harness generate '), ['agent', 'rule', 'skill', 'command', 'hook', 'mcp']);
  assert.deepEqual(texts('harness generate hook Pre'), ['PreToolUse', 'PreCompact']);
  assert.ok(texts('harness new --').includes('--summary'));
  assert.ok(texts('harness new x --area a=b:c --').includes('--area'));
  assert.ok(texts('harness up').includes('update'));
});

test('validate reports every problem of one line, an unknown flag included', async () => {
  const f = fixture();
  const script = path.join(f.tmp, 'many.harness');
  write(script, 'generate agent Bad_Name --colour red --model gpt --tools Raed --scope nowhere\n');
  const r = await cli(['validate', script, ...f.base.slice(0, 2)]);
  assert.equal(r.code, 2);
  for (const re of [/unknown flag: --colour/, /not a valid agent name/, /unknown model "gpt"/, /unknown tool "Raed"/, /unknown scope "nowhere"/]) assert.match(r.out, re);
  assert.match(r.out, /5 problems/);
});

test('generate skill, command and hook are idempotent and change only what differs', async () => {
  const f = fixture();
  const skill = ['generate', 'skill', 'my-skill', '--description', 'Does it', ...f.base];
  assert.match((await cli(skill)).out, /^CREATE \.claude\/skills\/my-skill\/SKILL\.md/m);
  const text = fs.readFileSync(path.join(f.repo, '.claude/skills/my-skill/SKILL.md'), 'utf8');
  assert.match(text, /name: my-skill/);
  assert.match(text, /description: Does it/);
  assert.equal((await cli(skill)).out, 'Nothing to be done.');
  assert.match((await cli(['generate', 'skill', 'my-skill', '--description', 'Does more', ...f.base])).out, /^UPDATE/m);
  const command = ['generate', 'command', 'team:ship', '--description', 'Ship', ...f.base];
  assert.match((await cli(command)).out, /^CREATE \.claude\/commands\/team\/ship\.md/m);
  assert.equal((await cli(command)).out, 'Nothing to be done.');
  const hook = ['generate', 'hook', 'PreToolUse', '--matcher', 'Bash', '--command', 'node guard.mjs', ...f.base];
  assert.match((await cli(hook)).out, /^CREATE \.claude\/settings\.json/m);
  assert.equal((await cli(hook)).out, 'Nothing to be done.');
  assert.match((await cli(['generate', 'hook', 'PreToolUse', '--matcher', 'Bash', '--command', 'node other.mjs', ...f.base])).out, /^UPDATE/m);
  await cli(['generate', 'hook', 'Stop', '--command', 'node stop.mjs', ...f.base]);
  const settings = JSON.parse(fs.readFileSync(path.join(f.repo, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(settings.hooks.PreToolUse[0].hooks.map((h: { command: string }) => h.command), ['node guard.mjs', 'node other.mjs']);
  assert.equal(settings.hooks.Stop[0].matcher, undefined);
  assert.match((await cli(['validate', (() => { const s = path.join(f.tmp, 'h.harness'); write(s, 'generate hook PreToolUsee --command x\ngenerate hook Stop\n'); return s; })(), ...f.base.slice(0, 2)])).out, /did you mean PreToolUse/);
});

/** A scratch Claude folder whose marketplace points at this repo's harness-plugin, so the real standard scripts run; nothing is installed. */
function providerRoot(f: ReturnType<typeof fixture>) {
  const pluginDir = path.resolve(__dirname, '../../../plugins/harness-plugin');
  const mk = path.join(f.tmp, 'std-mk');
  write(path.join(mk, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'std', plugins: [{ name: 'harness-plugin', source: pluginDir }] }));
  write(path.join(f.root, 'plugins/known_marketplaces.json'), JSON.stringify({ mk: { installLocation: path.join(f.tmp, 'mk') }, std: { source: { source: 'directory' }, installLocation: mk } }));
}

test('new scaffolds with the standard\'s script, skips what exists and honors --dry-run', async () => {
  const f = fixture();
  const target = path.join(f.tmp, 'fresh');
  const argv = ['new', target, '--summary', 'A test product on Node.', '--area', 'api=src/api/**:dotnet-expert', '--rule', 'Never push.', '--root', f.root, '--user-config', f.userConfig];
  const none = await cli(argv);
  assert.equal(none.code, 2);
  assert.match(none.err, /No harness standard provider/);
  providerRoot(f);
  const dry = await cli([...argv, '--dry-run']);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /^CREATE CLAUDE\.md|^CREATE .*CLAUDE\.md/m);
  assert.ok(dry.out.endsWith('NOTE: The "--dry-run" option means no changes were written.'));
  assert.equal(fs.existsSync(target), false);
  const first = await cli(argv);
  assert.equal(first.code, 0);
  assert.ok(fs.existsSync(path.join(target, 'CLAUDE.md')));
  assert.equal((await cli(argv)).out, 'Nothing to be done.');
});

test('validate --repo runs the standard\'s check from a real provider', async () => {
  const f = fixture();
  providerRoot(f);
  const target = path.join(f.tmp, 'scaffolded');
  assert.equal((await cli(['new', target, '--summary', 'A test product.', '--root', f.root, '--user-config', f.userConfig])).code, 0);
  const r = await cli(['validate', '--root', f.root, '--user-config', f.userConfig, '--repo', target, '--json']);
  const out = JSON.parse(r.out);
  assert.ok(!out.notes.some((n: string) => /No harness standard provider/.test(n)));
  assert.equal(r.code, out.problems.length ? 1 : 0);
  write(path.join(target, 'CLAUDE.md'), '# x\n');
  const empty = await cli(['validate', '--root', f.root, '--user-config', f.userConfig, '--repo', path.join(f.tmp, 'repo'), '--json']);
  assert.ok(!JSON.parse(empty.out).notes.some((n: string) => /No harness standard provider/.test(n)));
});

test('update refreshes marketplaces, updates a plugin that is behind and syncs a differing repo skill; a rerun does nothing', async () => {
  const f = fixture();
  stub(f);
  write(path.join(f.root, 'plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'tool@mk': [{ scope: 'user', version: '1.0.0', installPath: f.tmp }] } }));
  write(path.join(f.tmp, 'mk/.claude-plugin/marketplace.json'), JSON.stringify({ name: 'mk', plugins: [{ name: 'tool', version: '1.1.0' }] }));
  write(path.join(f.root, 'skills/shared/SKILL.md'), '---\nname: shared\ndescription: new\n---\n\nNew body\n');
  write(path.join(f.repo, '.claude/skills/shared/SKILL.md'), '---\nname: shared\ndescription: old\n---\n\nOld body\n');
  const dry = await cli(['update', '--dry-run', ...f.base]);
  assert.match(dry.out, /claude plugin update tool@mk: 1\.0\.0 to 1\.1\.0/);
  assert.match(dry.out, /UPDATE \.claude\/skills\/shared\/SKILL\.md/);
  assert.equal(calls.length, 0);
  setClaudeRunner(async (args, cwd) => {
    calls.push({ args, cwd });
    if (args[1] === 'update') write(path.join(f.root, 'plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'tool@mk': [{ scope: 'user', version: '1.1.0', installPath: f.tmp }] } }));
    return { code: 0, out: '' };
  });
  const r = await cli(['update', ...f.base]);
  assert.equal(r.code, 0, r.err);
  assert.ok(calls.some(c => c.args.join(' ') === 'plugin update tool@mk'));
  assert.match(fs.readFileSync(path.join(f.repo, '.claude/skills/shared/SKILL.md'), 'utf8'), /New body/);
  assert.equal(tree(path.join(f.root, 'repo-sync-backups')).length, 2);
  assert.equal((await cli(['update', '--dry-run', ...f.base])).out.split('\n')[0], 'Nothing to be done.');
});
