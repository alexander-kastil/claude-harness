import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

// quota.ts imports vscode, so the guard reads the source: the plan usage item (5h / wk) was lost whenever
// no fetch had succeeded yet (reload, expired token, offline) because render() hid it on an empty reading.
const root = path.resolve(__dirname, '../../..');
const quota = fs.readFileSync(path.join(root, 'src/quota.ts'), 'utf8');
const extension = fs.readFileSync(path.join(root, 'src/extension.ts'), 'utf8');

test('the usage request identifies as claude-code, or the endpoint answers 429', () => {
  assert.match(quota, /'User-Agent': 'claude-code\//);
});

test('there is no placeholder text, only real figures', () => {
  assert.ok(!quota.includes('5h --'));
});

test('the last reading is restored from globalState', () => {
  assert.match(quota, /deps\.state\?\.get/);
  assert.match(quota, /deps\.state\?\.update/);
  assert.match(extension, /registerQuota\(\{[^}]*state: context\.globalState/);
});
