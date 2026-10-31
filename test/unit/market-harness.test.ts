import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { marketplaceHealth } from '../../src/repos-overview';

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

test('reading the marketplaces writes nothing under the synced folders', () => {
  const { root } = fixture();
  const list = (dir: string): string[] => fs.readdirSync(dir, { recursive: true, withFileTypes: false }).map(String).sort();
  const before = list(path.join(root, 'plugins', 'synced'));
  marketplaceHealth(root);
  assert.deepEqual(list(path.join(root, 'plugins', 'synced')), before);
});

test('a hosted marketplace lists its uninstalled plugins too', () => {
  const { root, market } = fixture();
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ hosted: { source: { source: 'github', repo: 'o/r' }, installLocation: market } }));
  const hosted = marketplaceHealth(root).find(m => m.name === 'hosted')!;
  assert.deepEqual(hosted.plugins.map(p => p.name).sort(), ['design', 'marketing', 'tools']);
});
