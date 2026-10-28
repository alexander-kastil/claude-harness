import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { fmtCount, fmtPct, fmtUsd, headline, parse, table, winPath } from '../../src/cli-core';

const win = process.platform === 'win32';

test('a Git Bash path becomes a drive path on Windows; any other value is left alone', () => {
  assert.equal(winPath('/c/Users/x/hooks.json'), win ? 'c:/Users/x/hooks.json' : '/c/Users/x/hooks.json');
  assert.equal(winPath('C:/Users/x'), 'C:/Users/x');
  assert.equal(winPath('skills'), 'skills');
});

test('the path flags are normalized as they are parsed, and a name flag is not', () => {
  assert.deepEqual(parse(['--repo', '/d/a']).flags.get('repo'), [win ? 'd:/a' : '/d/a']);
  assert.deepEqual(parse(['--repos', '/d/a,/e/b']).flags.get('repos'), [win ? 'd:/a,e:/b' : '/d/a,/e/b']);
  assert.deepEqual(parse(['--files', '/c/Users/x/hooks.json=hooks/hooks.json']).flags.get('files'), [win ? 'c:/Users/x/hooks.json=hooks/hooks.json' : '/c/Users/x/hooks.json=hooks/hooks.json']);
  assert.deepEqual(parse(['--name', '/c/x']).flags.get('name'), ['/c/x']);
});

test('table pads every cell to its column and right-aligns the numeric columns', () => {
  assert.deepEqual(table(['Model', 'Tokens'], [['opus', 436000], ['haiku', 8800000]], [false, true]), [
    '| Model |  Tokens |',
    '| ----- | ------: |',
    '| opus  |  436000 |',
    '| haiku | 8800000 |',
  ]);
});

test('table escapes a pipe in a cell and fills a short row with empty cells', () => {
  const lines = table(['Name', 'Note'], [['a|b', 'x'], ['c']]);
  assert.equal(lines[2], '| a\\|b | x    |');
  assert.equal(lines[3], '| c    |      |');
});

test('headline is a bold line', () => {
  assert.equal(headline('Skills (2)'), '**Skills (2)**');
});

test('fmtCount keeps small numbers, rounds thousands to K, and keeps one decimal to ten million', () => {
  assert.equal(fmtCount(0), '0');
  assert.equal(fmtCount(999), '999');
  assert.equal(fmtCount(436000), '436K');
  assert.equal(fmtCount(8800000), '8.8M');
  assert.equal(fmtCount(8000000), '8M');
  assert.equal(fmtCount(12000000), '12M');
});

test('fmtUsd has two decimals, and fmtPct has none by default', () => {
  assert.equal(fmtUsd(0.42), '$0.42');
  assert.equal(fmtUsd(12.3), '$12.30');
  assert.equal(fmtPct(0.123), '12%');
  assert.equal(fmtPct(0.123, 3), '12.300%');
});
