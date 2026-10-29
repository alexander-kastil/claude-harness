import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const root = path.join(__dirname, '..', '..', '..');

test('the harness plugin version equals the extension version', () => {
  const extension = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const plugin = JSON.parse(fs.readFileSync(path.join(root, 'plugins', 'harness', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  assert.equal(plugin, extension, 'run `npm run version` to sync plugin.json with package.json');
});
