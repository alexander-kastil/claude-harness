import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { countdown } from '../../src/countdown';

const min = 60_000;

test('the 5-hour countdown is hh:mm, zero-padded', () => {
  assert.equal(countdown(0, true), '00:00');
  assert.equal(countdown(7 * min, true), '00:07');
  assert.equal(countdown((4 * 60 + 44) * min, true), '04:44');
  assert.equal(countdown(-5 * min, true), '00:00');
});

test('the weekly countdown is dd:hh:mm, zero-padded', () => {
  assert.equal(countdown(0, false), '00:00:00');
  assert.equal(countdown(59 * min, false), '00:00:59');
  assert.equal(countdown(((3 * 24 + 4) * 60 + 12) * min, false), '03:04:12');
  assert.equal(countdown(((10 * 24 + 23) * 60 + 1) * min, false), '10:23:01');
});
