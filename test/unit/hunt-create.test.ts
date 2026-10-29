import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CreatePlan, claudeLauncher, installPlugin, isInstalled, runClaude, writePlugin } from '../../src/hunt-create';
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
