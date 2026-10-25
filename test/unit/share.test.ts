import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { Asset, HarnessScope, repoScope, scan } from '../../src/harness';
import { readMarkets } from '../../src/hunt-market';
import { Pack, ShareKind, applyImport, freeName, notShareable, packAsset, packPlugin, planImport, planPluginImport, pluginInventory, readPackage, scanSecrets, writePluginImport } from '../../src/share';
import { readZip, writeZip } from '../../src/zip';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `share-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

/** A global folder, one repo that holds one of every shareable kind, and a directory marketplace. */
function fixture() {
  const home = tmp('home');
  const repo = tmp('repo');
  const market = tmp('market');
  const userConfig = path.join(home, 'claude.json');
  const global: HarnessScope = { id: 'global', label: 'Global', base: home, root: home, memory: ['CLAUDE.md'], mcpFile: userConfig, userConfig, installedPlugins: true };
  const repoS = repoScope(repo, userConfig);
  write(repo, 'CLAUDE.md', '# Repo memory\n\nBe brief.\n');
  write(repo, '.claude/agents/scout.md', '---\nname: scout\ndescription: Finds things\ntools: Read, Grep\nmodel: sonnet\n---\n\nLook around.\n');
  write(repo, '.claude/commands/ship.md', '---\ndescription: Ship it\nargument-hint: <tag>\n---\n\nShip $ARGUMENTS\n');
  write(repo, '.claude/commands/team/deploy.md', '---\ndescription: Deploy\n---\n\nDeploy\n');
  write(repo, '.claude/output-styles/terse.md', '---\nname: terse\ndescription: Short answers\nkeep-coding-instructions: true\n---\n\nBe terse.\n');
  write(repo, '.claude/rules/style.md', '---\npaths:\n  - "src/**"\n---\n\n# Style\n\nTabs.\n');
  write(repo, '.claude/skills/pdf/SKILL.md', '---\nname: pdf\ndescription: Reads PDFs\n---\n\n# pdf\n');
  write(repo, '.claude/skills/pdf/references/a.md', '# A\n');
  write(repo, '.claude/skills/pdf/scripts/run.py', 'print(1)\n');
  write(repo, '.claude/hooks/guard.sh', '#!/bin/sh\nexit 0\n');
  write(repo, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh"' }] }], Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } }, null, 2));
  write(repo, '.mcp.json', JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['-y', 'files'], env: { API_TOKEN: 'abc123def456ghi' } }, web: { type: 'http', url: 'https://example.com/mcp' } } }, null, 2));
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'mine', owner: { name: 'me' }, plugins: [{ name: 'old', source: './plugins/old' }] }, null, 2));
  write(market, 'plugins/old/.claude-plugin/plugin.json', JSON.stringify({ name: 'old', version: '1.0.0' }));
  write(home, 'plugins/known_marketplaces.json', JSON.stringify({ mine: { source: { source: 'directory', path: market }, installLocation: market } }));
  write(home, 'settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] } }, null, 2));
  const plugin = path.join(tmp('plugin'), 'tools');
  write(plugin, '.claude-plugin/plugin.json', JSON.stringify({ name: 'tools', version: '2.0.0', description: 'Tools' }));
  write(plugin, 'skills/one/SKILL.md', '---\nname: one\ndescription: One\n---\n');
  write(plugin, 'skills/two/SKILL.md', '---\nname: two\ndescription: Two\n---\n');
  write(plugin, 'agents/helper.md', '---\nname: helper\ndescription: Helps\n---\n');
  const assets = scan(repoS).flatMap(c => c.items);
  const of = (kind: string, name?: string) => assets.find(a => a.kind === kind && (!name || a.name === name))!;
  return { home, repo, market, global, repoS, plugin, of };
}

const shareAndRead = (asset: Asset, from: HarnessScope, kind: ShareKind) => {
  const pack = packAsset(asset, from);
  const dir = tmp('dl');
  const file = path.join(dir, freeName(dir, pack.file));
  fs.writeFileSync(file, pack.data);
  const read = readPackage(kind, file);
  assert.ok('pkg' in read, 'problem' in read ? read.problem : '');
  return { pack, pkg: (read as { pkg: import('../../src/share').Pkg }).pkg };
};

test('zip: entries come back byte for byte, with folders and large files', () => {
  const big = Buffer.alloc(100000, 'abc');
  const out = readZip(writeZip([{ name: 'a/x.txt', data: Buffer.from('hello') }, { name: 'a/big.bin', data: big }, { name: 'empty', data: Buffer.alloc(0) }]));
  assert.deepEqual(out.map(e => e.name), ['a/x.txt', 'a/big.bin', 'empty']);
  assert.equal(out[0].data.toString(), 'hello');
  assert.ok(out[1].data.equals(big));
  assert.throws(() => readZip(Buffer.from('not a zip')));
});

test('skill: the zip holds the folder at its root with references and scripts, and imports into global', () => {
  const f = fixture();
  const { pack, pkg } = shareAndRead(f.of('skill', 'pdf'), f.repoS, 'skill');
  assert.deepEqual(readZip(pack.data).map(e => e.name).sort(), ['pdf/SKILL.md', 'pdf/references/a.md', 'pdf/scripts/run.py']);
  const plan = planImport(pkg, f.global);
  assert.equal(plan.exists, undefined);
  applyImport(pkg, f.global, plan, false, path.join(f.home, 'repo-sync-backups'), '20260101-000000');
  for (const rel of ['SKILL.md', 'references/a.md', 'scripts/run.py']) assert.equal(fs.readFileSync(path.join(f.home, 'skills', 'pdf', rel), 'utf8'), fs.readFileSync(path.join(f.repo, '.claude', 'skills', 'pdf', rel), 'utf8'));
});

test('skill: an existing name offers replace with a backup, or a new name', () => {
  const f = fixture();
  const { pkg } = shareAndRead(f.of('skill', 'pdf'), f.repoS, 'skill');
  const backups = path.join(f.home, 'repo-sync-backups');
  applyImport(pkg, f.global, planImport(pkg, f.global), false, backups, 's1');
  write(f.home, 'skills/pdf/extra.txt', 'mine');
  const plan = planImport(pkg, f.global);
  assert.ok(plan.exists);
  assert.throws(() => applyImport(pkg, f.global, plan, false, backups, 's2'), /already exists/);
  const backup = applyImport(pkg, f.global, plan, true, backups, 's2');
  assert.ok(fs.existsSync(path.join(backup!, path.basename(f.home), 'skills', 'pdf', 'extra.txt')));
  assert.ok(!fs.existsSync(path.join(f.home, 'skills', 'pdf', 'extra.txt')));
  const other = planImport(pkg, f.global, 'pdf-2');
  assert.equal(other.exists, undefined);
  applyImport(pkg, f.global, other, false, backups, 's3');
  assert.match(fs.readFileSync(path.join(f.home, 'skills', 'pdf-2', 'SKILL.md'), 'utf8'), /^name: pdf-2$/m);
});

test('agent, command, output style, rule and CLAUDE.md are the file itself and import by their kind', () => {
  const f = fixture();
  const cases: [ShareKind, string, string][] = [
    ['agent', 'scout', path.join('agents', 'scout.md')],
    ['command', 'ship', path.join('commands', 'ship.md')],
    ['outputStyle', 'terse', path.join('output-styles', 'terse.md')],
    ['rule', 'style', path.join('rules', 'style.md')],
  ];
  for (const [kind, name, rel] of cases) {
    const asset = f.of(kind, name);
    const { pack, pkg } = shareAndRead(asset, f.repoS, kind);
    assert.equal(pack.data.toString(), fs.readFileSync(asset.file, 'utf8'), kind);
    const plan = planImport(pkg, f.global);
    applyImport(pkg, f.global, plan, false, path.join(f.home, 'b'), 's');
    assert.equal(fs.readFileSync(path.join(f.home, rel), 'utf8'), fs.readFileSync(path.join(f.repo, '.claude', rel), 'utf8'), kind);
  }
  const memory = shareAndRead(f.of('memory'), f.repoS, 'memory');
  assert.equal(memory.pack.file, 'CLAUDE.md');
  applyImport(memory.pkg, f.global, planImport(memory.pkg, f.global), false, path.join(f.home, 'b'), 's');
  assert.equal(fs.readFileSync(path.join(f.home, 'CLAUDE.md'), 'utf8'), '# Repo memory\n\nBe brief.\n');
});

test('import checks the kind: a file of another kind is refused with the reason', () => {
  const f = fixture();
  const agent = f.of('agent', 'scout').file;
  const style = f.of('outputStyle', 'terse').file;
  const command = f.of('command', 'ship').file;
  const rule = f.of('rule', 'style').file;
  const say = (kind: ShareKind, file: string) => ('problem' in readPackage(kind, file) ? (readPackage(kind, file) as { problem: string }).problem : 'accepted');
  assert.match(say('outputStyle', agent), /agent field/);
  assert.match(say('agent', style), /output style field/);
  assert.match(say('agent', command), /frontmatter that has a name/);
  assert.match(say('command', agent), /fields a command does not/);
  assert.match(say('rule', agent), /fields a rule does not/);
  assert.equal(say('rule', rule), 'accepted');
  assert.match(say('skill', agent), /is a .zip/);
  assert.match(say('mcp', agent), /not valid JSON|shaped/);
  assert.match(say('hook', agent), /not valid JSON|shaped/);
  const skillZip = path.join(tmp('z'), 'x.zip');
  fs.writeFileSync(skillZip, writeZip([{ name: 'x/readme.md', data: Buffer.from('hi') }]));
  assert.match(say('skill', skillZip), /no SKILL.md/);
  assert.match(say('plugin', skillZip), /no .claude-plugin\/plugin.json/);
});

test('mcp: the entry keeps the source shape, its env is listed, and the import leaves the other servers alone', () => {
  const f = fixture();
  const { pack, pkg } = shareAndRead(f.of('mcp', 'files'), f.repoS, 'mcp');
  assert.deepEqual(JSON.parse(pack.data.toString()), { mcpServers: { files: { command: 'npx', args: ['-y', 'files'], env: { API_TOKEN: 'abc123def456ghi' } } } });
  assert.ok(pack.secrets.some(s => s.includes('API_TOKEN')));
  write(f.home, 'claude.json', JSON.stringify({ theme: 'dark', mcpServers: { other: { type: 'http', url: 'https://o.example/mcp' } } }, null, 2));
  const plan = planImport(pkg, f.global);
  assert.equal(plan.exists, undefined);
  applyImport(pkg, f.global, plan, false, path.join(f.home, 'b'), 's');
  const json = JSON.parse(fs.readFileSync(path.join(f.home, 'claude.json'), 'utf8'));
  assert.equal(json.theme, 'dark');
  assert.ok(json.mcpServers.other);
  assert.deepEqual(json.mcpServers.files, JSON.parse(pack.data.toString()).mcpServers.files);
  const again = planImport(pkg, f.global);
  assert.ok(again.exists);
  const backup = applyImport(pkg, f.global, again, true, path.join(f.home, 'b'), 's2');
  assert.ok(fs.existsSync(path.join(backup!, path.basename(f.home), 'claude.json')));
  assert.equal(notShareable(f.of('mcp', 'web')), undefined);
});

test('hook: a plain entry is settings-shaped JSON and merges beside the existing hooks', () => {
  const f = fixture();
  const stop = f.of('hook', 'Stop');
  const { pack, pkg } = shareAndRead(stop, f.repoS, 'hook');
  assert.equal(pack.file.endsWith('.json'), true);
  assert.deepEqual(JSON.parse(pack.data.toString()), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } });
  applyImport(pkg, f.global, planImport(pkg, f.global), false, path.join(f.home, 'b'), 's');
  const settings = JSON.parse(fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8'));
  assert.deepEqual(settings.hooks.Stop.map((g: { hooks: { command: string }[] }) => g.hooks[0].command), ['echo existing', 'echo done']);
  assert.match(planImport(pkg, f.global).notes.join(' '), /identical entry is already there/);
  applyImport(pkg, f.global, planImport(pkg, f.global), false, path.join(f.home, 'b'), 's2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8')).hooks.Stop.length, 2);
});

test('hook: an entry that runs a script under .claude is a zip with the script, repointed on import', () => {
  const f = fixture();
  const guard = f.of('hook', 'PreToolUse · Bash');
  const { pack, pkg } = shareAndRead(guard, f.repoS, 'hook');
  assert.equal(pack.file.endsWith('.zip'), true);
  assert.deepEqual(readZip(pack.data).map(e => e.name).sort(), ['.claude/hooks/guard.sh', 'hooks.json']);
  const plan = planImport(pkg, f.global);
  assert.ok(plan.files.includes(path.join(f.home, 'hooks', 'guard.sh')));
  applyImport(pkg, f.global, plan, false, path.join(f.home, 'b'), 's');
  assert.equal(fs.readFileSync(path.join(f.home, 'hooks', 'guard.sh'), 'utf8'), '#!/bin/sh\nexit 0\n');
  const settings = JSON.parse(fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8'));
  const command = settings.hooks.PreToolUse[0].hooks[0].command as string;
  assert.ok(command.includes(`${f.home.replace(/\\/g, '/')}/hooks/guard.sh`), command);
});

test('plugin: the whole folder is a zip, the inventory counts it, and the import lands in a directory marketplace', () => {
  const f = fixture();
  const inv = pluginInventory(f.plugin);
  assert.equal(inv.skills, 2);
  assert.equal(inv.agents, 1);
  const pack: Pack = packPlugin(f.plugin, 'tools@elsewhere');
  assert.ok(readZip(pack.data).some(e => e.name === 'tools/.claude-plugin/plugin.json'));
  const file = path.join(tmp('dl'), 'tools.zip');
  fs.writeFileSync(file, pack.data);
  const read = readPackage('plugin', file);
  assert.ok('pkg' in read);
  const pkg = (read as { pkg: import('../../src/share').Pkg & { kind: 'plugin' } }).pkg;
  const market = readMarkets(f.home).find(m => m.name === 'mine')!;
  const plan = planPluginImport(pkg, market);
  assert.equal(plan.exists, false);
  writePluginImport(pkg, plan, market, path.join(f.home, 'b'), 's');
  assert.ok(fs.existsSync(path.join(f.market, 'plugins', 'tools', 'skills', 'one', 'SKILL.md')));
  const catalog = JSON.parse(fs.readFileSync(path.join(f.market, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.deepEqual(catalog.plugins.map((p: { name: string }) => p.name), ['old', 'tools']);
  // The name is taken now: replace backs the folder up, a new name renames the manifest.
  const again = planPluginImport(pkg, market);
  assert.equal(again.exists, true);
  const backup = writePluginImport(pkg, again, market, path.join(f.home, 'b'), 's2');
  assert.ok(backup && fs.existsSync(path.join(backup, path.basename(f.market), 'plugins', 'tools', '.claude-plugin', 'plugin.json')));
  const renamed = planPluginImport(pkg, market, 'tools-2');
  writePluginImport(pkg, renamed, market, path.join(f.home, 'b'), 's3');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.market, 'plugins', 'tools-2', '.claude-plugin', 'plugin.json'), 'utf8')).name, 'tools-2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.market, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins.length, 3);
});

test('secrets: key names are listed, values never, placeholders are not secrets', () => {
  const found = scanSecrets([
    { name: 'a.json', data: Buffer.from('{"GITHUB_TOKEN": "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "password": "hunter2hunter2"}') },
    { name: 'b.json', data: Buffer.from('{"API_KEY": "${API_KEY}", "token": "<your token>"}') },
  ]);
  assert.ok(found.some(s => s.includes('password in a.json')));
  assert.ok(found.some(s => s.startsWith('a token starting ghp_')));
  assert.ok(!found.some(s => s.includes('b.json')));
  assert.ok(!found.join(' ').includes('hunter2'));
});

test('a settings file, a workflow and a claude.ai connector have no share format', () => {
  const f = fixture();
  write(f.repo, '.claude/workflows/w.js', "export const meta = { name: 'w' }\n");
  const assets = scan(f.repoS).flatMap(c => c.items);
  assert.match(notShareable(assets.find(a => a.kind === 'settings')!)!, /no share format/);
  assert.match(notShareable(assets.find(a => a.kind === 'workflow')!)!, /no share format/);
  assert.match(notShareable({ ...f.of('mcp', 'web'), file: '', jsonPath: undefined, source: 'claude.ai' })!, /claude.ai connector/);
});

test('freeName numbers a name that exists', () => {
  const dir = tmp('free');
  assert.equal(freeName(dir, 'x.zip'), 'x.zip');
  fs.writeFileSync(path.join(dir, 'x.zip'), '');
  assert.equal(freeName(dir, 'x.zip'), 'x (2).zip');
  fs.writeFileSync(path.join(dir, 'x (2).zip'), '');
  assert.equal(freeName(dir, 'x.zip'), 'x (3).zip');
});
