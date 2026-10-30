import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import type { MarketplacesOut } from '../../src/cli-markets';
import { harnessState, marketplaceHealth } from '../../src/fleet';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `market-harness-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

function fixtureSource(): string {
  // COWORK_FIXTURE names the folder when the tests run from an output folder outside the repo.
  if (process.env.COWORK_FIXTURE) return process.env.COWORK_FIXTURE;
  for (let dir of [__dirname, process.cwd()]) {
    for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'test', 'fixtures', 'cowork-claude');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('test/fixtures/cowork-claude not found');
}

/**
 * A copy of the Cowork fixture (synced: design from the Anthropic catalog, marketing from an upload) plus a directory marketplace "own"
 * whose catalog lists marketing (also in Cowork), design (only the Anthropic catalog's copy is in Cowork) and tools (Code only).
 */
function fixture() {
  const root = tmp('root');
  fs.cpSync(fixtureSource(), root, { recursive: true });
  const market = tmp('own');
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins: ['marketing', 'design', 'tools'].map(name => ({ name, source: `./plugins/${name}`, version: '1.0.0' })) }));
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ own: { source: { source: 'directory', path: market }, installLocation: market } }));
  write(root, 'plugins/installed_plugins.json', JSON.stringify({ plugins: {} }));
  return { root, market };
}

test('harnessState names the four states', () => {
  assert.deepEqual([harnessState(true, false), harnessState(false, true), harnessState(true, true), harnessState(false, false)], ['code', 'cowork', 'both', 'none']);
});

test('every plugin of the marketplace carries its Harness state, read from the synced plugins', () => {
  const { root } = fixture();
  const own = marketplaceHealth(root).find(m => m.name === 'own')!;
  const states = Object.fromEntries(own.plugins.map(p => [p.name, p.harness]));
  assert.deepEqual(states, { design: 'code', marketing: 'both', tools: 'code' });
});

test('the marketplaces command counts the plugins not in Cowork and lists each state', async () => {
  const { root } = fixture();
  const out: string[] = [];
  const config = path.join(tmp('config'), 'claude.json');
  write(path.dirname(config), 'claude.json', '{}');
  const code = await run(['marketplaces', '--root', root, '--user-config', config, '--json'], { out: t => out.push(t), err: () => undefined });
  assert.equal(code, 0);
  const own = (JSON.parse(out.join('\n')) as MarketplacesOut).marketplaces.find(m => m.name === 'own')!;
  assert.equal(own.notInCowork, 2);
  assert.deepEqual(own.harness.map(h => `${h.plugin}:${h.state}`).sort(), ['design:code', 'marketing:both', 'tools:code']);
});

test('reading the marketplaces writes nothing under the synced folders', () => {
  const { root } = fixture();
  const list = (dir: string): string[] => fs.readdirSync(dir, { recursive: true, withFileTypes: false }).map(String).sort();
  const before = list(path.join(root, 'plugins', 'synced'));
  marketplaceHealth(root);
  assert.deepEqual(list(path.join(root, 'plugins', 'synced')), before);
});

test('a hosted marketplace lists its uninstalled plugins with their Harness state too', () => {
  const { root, market } = fixture();
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ hosted: { source: { source: 'github', repo: 'o/r' }, installLocation: market } }));
  const hosted = marketplaceHealth(root).find(m => m.name === 'hosted')!;
  assert.deepEqual(hosted.plugins.map(p => p.name).sort(), ['design', 'marketing', 'tools']);
});
