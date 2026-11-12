import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { remoteCommand } from '../../src/remote';
import { lineFlags, sessionFlags } from '../../src/session-flags';

const bridge = { type: 'system', subtype: 'bridge_status', content: '/remote-control is active', url: 'https://claude.ai/code/session_1', isMeta: false };

test('remoteCommand resumes the session with --remote-control after the configured command', () => {
  assert.equal(remoteCommand(rest => `claude ${rest}`, 'abc-123'), 'claude --resume abc-123 --remote-control');
});

test('lineFlags marks a bridge_status system line as Remote and nothing that only mentions it', () => {
  assert.deepEqual(lineFlags(JSON.stringify(bridge)), { remote: true });
  assert.deepEqual(lineFlags(JSON.stringify({ type: 'user', message: { content: 'what is "subtype":"bridge_status"?' } })), {});
  assert.deepEqual(lineFlags(JSON.stringify({ type: 'system', subtype: 'turn_duration' })), {});
});

test('sessionFlags reports remote for a transcript that holds the marker, and not for one without', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-'));
  try {
    const on = path.join(dir, 'on.jsonl');
    const off = path.join(dir, 'off.jsonl');
    fs.writeFileSync(on, `${JSON.stringify({ type: 'user', message: { content: 'hi' } })}\n${JSON.stringify(bridge)}\n`);
    fs.writeFileSync(off, `${JSON.stringify({ type: 'user', message: { content: 'hi' } })}\n`);
    assert.equal(sessionFlags(on).remote, true);
    assert.equal(sessionFlags(off).remote, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
