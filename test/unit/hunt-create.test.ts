import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CreatePlan, claudeLauncher, installPlugin, isInstalled, modLayout, runClaude, writePlugin } from '../../src/hunt-create';
import type { HuntMarket, HuntProposal } from '../../src/shared/hunt';

const win = process.platform === 'win32';

/** A folder on the PATH with a fake claude.cmd that records an install the way the CLI does. */
function fakeClaude() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
  fs.writeFileSync(
    path.join(bin, 'claude.cmd'),
    ['@echo off', 'if "%2"=="install" (', '  mkdir "%CLAUDE_CONFIG_DIR%\\plugins" 2>nul', '  echo {"plugins":{"%3":[{}]}}> "%CLAUDE_CONFIG_DIR%\\plugins\\installed_plugins.json"', ')', 'echo args=%*', ''].join('\r\n')
  );
  return bin;
}

test('an install that exits 0 without listing the plugin says so, and one that fails keeps its last output line', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-silent-'));
  const p = { name: 't2-plugin' } as HuntProposal;
  const market = { name: 'mock-market' } as HuntMarket;
  await assert.rejects(
    installPlugin(p, market, root, async () => ({ code: 0, out: '' })),
    (e: Error) => e.message === `claude plugin install t2-plugin@mock-market exited 0 but the plugin is not listed in ${path.join(root, 'plugins', 'installed_plugins.json')}.`
  );
  await assert.rejects(installPlugin(p, market, root, async () => ({ code: 1, out: 'a\nboom' })), /failed: boom/);
});

test('claudeLauncher: claude.exe on the PATH is started directly, claude.cmd through cmd.exe', { skip: !win }, () => {
  const exe = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-exe-'));
  fs.writeFileSync(path.join(exe, 'claude.exe'), '');
  assert.deepEqual(claudeLauncher({ PATH: exe }), [path.join(exe, 'claude.exe')]);
  const cmd = fakeClaude();
  const [shell, ...lead] = claudeLauncher({ PATH: cmd, ComSpec: 'cmd.exe' });
  assert.equal(shell, 'cmd.exe');
  assert.deepEqual(lead, ['/d', '/s', '/c', path.join(cmd, 'claude.cmd')]);
});

test('the install step runs claude with an argument array and no shell: no DEP0190 warning, the plugin is installed', { skip: !win }, async () => {
  const bin = fakeClaude();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-root-'));
  const warnings: string[] = [];
  const onWarning = (w: Error & { code?: string }) => warnings.push(w.code ?? w.name);
  const before = process.env.PATH;
  process.on('warning', onWarning);
  // Only the fake on the PATH, so a real claude.exe of this machine is not picked first.
  process.env.PATH = bin;
  try {
    const r = await runClaude(['plugin', 'install', 'x@own', '--scope', 'user'], root);
    assert.equal(r.code, 0);
    assert.match(r.out, /args=plugin install x@own --scope user/);
    const p = { name: 'x' } as HuntProposal;
    await installPlugin(p, { name: 'own' } as HuntMarket, root);
    assert.ok(isInstalled(root, 'x@own'));
    await new Promise(r => setImmediate(r));
  } finally {
    process.env.PATH = before;
    process.off('warning', onWarning);
  }
  assert.ok(!warnings.includes('DEP0190'));
});

test('a new plugin carries the author of the marketplace\'s existing plugins, else the marketplace owner', async () => {
  const author = async (existing: unknown) => {
    const market = fs.mkdtempSync(path.join(os.tmpdir(), 'author-'));
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(market, rel)), { recursive: true });
      fs.writeFileSync(path.join(market, rel), text);
    };
    write('.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', owner: { name: 'the-org' }, plugins: existing ? [{ name: 'old', source: './plugins/old' }] : [] }));
    if (existing) write('plugins/old/.claude-plugin/plugin.json', JSON.stringify({ name: 'old', author: existing }));
    const dir = path.join(market, 'plugins', 'fresh');
    const plan = { problems: [], files: [], retired: [], kept: [], source: './plugins/fresh', dir, chosen: [], retires: [] } as unknown as CreatePlan;
    await writePlugin({ name: 'fresh', description: 'd', assets: [] } as unknown as HuntProposal, plan, { name: 'own', location: market, owned: true } as HuntMarket);
    return JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).author;
  };
  assert.deepEqual(await author({ name: 'Alexander Kastil' }), { name: 'Alexander Kastil' });
  assert.deepEqual(await author(undefined), { name: 'the-org' });
});

test('a renamed skill is written under its new folder with the new name in its front matter', async () => {
  const market = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-'));
  fs.mkdirSync(path.join(market, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'own', plugins: [] }));
  const src = path.join(market, 'src', 'docker-images');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'SKILL.md'), '---\r\nname: docker-images\r\ndescription: Builds images\r\n---\r\n\r\nname: stays in the body\r\n');
  const dir = path.join(market, 'plugins', 'fresh');
  const from = { id: 'g', scope: 'global', kind: 'skill', name: 'docker-images', file: path.join(src, 'SKILL.md'), dir: src } as any;
  const asset = { kind: 'skill', name: 'docker-images', as: 'hetzner-docker', include: true, repos: [] };
  const plan = { problems: [], files: [], retired: [], kept: [], source: './plugins/fresh', dir, chosen: [{ asset, from, kind: 'skill' }], retires: [] } as unknown as CreatePlan;
  await writePlugin({ name: 'fresh', description: 'd', assets: [asset] } as unknown as HuntProposal, plan, { name: 'own', location: market, owned: true } as HuntMarket);
  const text = fs.readFileSync(path.join(dir, 'skills', 'hetzner-docker', 'SKILL.md'), 'utf8');
  assert.ok(text.startsWith('---\r\nname: hetzner-docker\r\ndescription: Builds images\r\n---'));
  assert.ok(text.includes('name: stays in the body'));
  assert.ok(!fs.existsSync(path.join(dir, 'skills', 'docker-images')));
});

function modSource() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'modsrc-'));
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    fs.writeFileSync(path.join(src, rel), text);
    return path.join(src, rel);
  };
  return { src, put };
}

test('a hook module lands at mods/<name>/<file>, its relative imports beside it, and hooks.json names it', async () => {
  const { src, put } = modSource();
  const hooksJson = put('hooks/hooks.json', JSON.stringify({ modules: ['./guard.mjs'] }));
  const guard = put('hooks/guard.mjs', "import { x } from './util.mjs';\nconst y = await import('./lib/deep.mjs');\n");
  put('hooks/util.mjs', 'export const x = 1;\n');
  put('hooks/lib/deep.mjs', 'export const d = 1;\n');
  const extra = modLayout([
    { from: hooksJson, to: 'hooks/hooks.json', drop: false },
    { from: guard, to: 'hooks/guard.mjs', drop: true },
  ]);
  assert.deepEqual(extra.map(e => e.to).sort(), ['hooks/hooks.json', 'mods/guard/guard.mjs', 'mods/guard/lib/deep.mjs', 'mods/guard/util.mjs']);
  assert.deepEqual(JSON.parse(extra.find(e => e.to === 'hooks/hooks.json')!.content!), { modules: ['../mods/guard/guard.mjs'] });
  assert.equal(extra.find(e => e.to === 'mods/guard/guard.mjs')!.drop, true);
  assert.equal(extra.find(e => e.to === 'mods/guard/util.mjs')!.drop, false);
  assert.ok(fs.existsSync(src));
});

test('a script at hooks/<name>.ts beside a modules hooks.json is a module even when the file does not list it', () => {
  const { put } = modSource();
  const hooksJson = put('h/hooks.json', JSON.stringify({ modules: [] }));
  const ts = put('h/watch.ts', 'export {};\n');
  const extra = modLayout([
    { from: hooksJson, to: 'hooks/hooks.json', drop: false },
    { from: ts, to: 'hooks/watch.ts', drop: false },
  ]);
  assert.deepEqual(extra.map(e => e.to).sort(), ['hooks/hooks.json', 'mods/watch/watch.ts']);
  assert.deepEqual(JSON.parse(extra.find(e => e.to === 'hooks/hooks.json')!.content!), { modules: ['../mods/watch/watch.ts'] });
});

test('a command-hook hooks.json and an .mcp.json stay where they were placed', () => {
  const { put } = modSource();
  const hooks = put('a/hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs' }] }] } }));
  const script = put('a/x.mjs', 'process.exit(0);\n');
  const mcp = put('a/.mcp.json', '{}');
  const input = [
    { from: hooks, to: 'hooks/hooks.json', drop: false },
    { from: script, to: 'hooks/x.mjs', drop: false },
    { from: mcp, to: '.mcp.json', drop: false },
  ];
  assert.deepEqual(modLayout(input), input);
});

test('a created plugin gets the mods layout on disk', async () => {
  const market = fs.mkdtempSync(path.join(os.tmpdir(), 'modsmk-'));
  fs.mkdirSync(path.join(market, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'own', plugins: [] }));
  const { put } = modSource();
  const hooksJson = put('hooks/hooks.json', JSON.stringify({ modules: ['./guard.mjs'] }));
  const guard = put('hooks/guard.mjs', "import './util.mjs';\n");
  put('hooks/util.mjs', '\n');
  const dir = path.join(market, 'plugins', 'fresh');
  const extra = modLayout([
    { from: hooksJson, to: 'hooks/hooks.json', drop: false },
    { from: guard, to: 'hooks/guard.mjs', drop: false },
  ]);
  const plan = { problems: [], files: [], retired: [], kept: [], source: './plugins/fresh', dir, chosen: [], retires: [], extra } as unknown as CreatePlan;
  await writePlugin({ name: 'fresh', description: 'd', assets: [] } as unknown as HuntProposal, plan, { name: 'own', location: market, owned: true } as HuntMarket);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'hooks', 'hooks.json'), 'utf8')), { modules: ['../mods/guard/guard.mjs'] });
  assert.ok(fs.existsSync(path.join(dir, 'mods', 'guard', 'util.mjs')));
  assert.ok(!fs.existsSync(path.join(dir, 'hooks', 'guard.mjs')));
});
