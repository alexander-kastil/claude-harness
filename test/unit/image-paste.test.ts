import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import { test } from 'node:test';
import { imageFileName, imageFolder, mentionText, pathText } from '../../src/image-paste';

test('imageFileName stamps local time as img_yyyyMMdd_HHmmss.png with zero padding', () => {
  assert.equal(imageFileName(new Date(2026, 0, 5, 3, 4, 9)), 'img_20260105_030409.png');
  assert.equal(imageFileName(new Date(2026, 9, 25, 23, 59, 58)), 'img_20261025_235958.png');
});

test('pathText quotes the path and ends in one space, never a newline', () => {
  assert.equal(pathText('C:\\Users\\a b\\x.png'), '"C:\\Users\\a b\\x.png" ');
});

test('imageFolder lives under the temp dir', () => {
  assert.equal(imageFolder(), path.join(os.tmpdir(), 'claude-harness-images'));
});

test('mentionText types one @ mention per path, quoting paths with spaces', () => {
  assert.equal(mentionText(['C:\\a\\src']), '@C:\\a\\src ');
  assert.equal(mentionText(['C:\\a b\\x.ts', 'C:\\a\\y.ts']), '@"C:\\a b\\x.ts" @C:\\a\\y.ts ');
});
