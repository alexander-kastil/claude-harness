import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { lineFlags, loadedFiles, sessionFlags } from '../../src/session-flags';
import { failureText, failuresByHook, notLoaded } from '../../src/shared/harness-trace';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hook-trace-'));
const jsonl = (...records: unknown[]) => `${records.map(r => JSON.stringify(r)).join('\n')}\n`;
const attach = (attachment: Record<string, unknown>) => ({ type: 'attachment', timestamp: '2026-10-23T09:00:00.000Z', attachment });
const denial = (content: string) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content, is_error: true }] } });

test('lineFlags reads a failed hook and a denied tool from the raw line, and nothing a prompt merely mentions', () => {
  assert.deepEqual(lineFlags(JSON.stringify(attach({ type: 'hook_non_blocking_error', exitCode: 1 }))), { hookFailed: true });
  assert.deepEqual(lineFlags(JSON.stringify(attach({ type: 'hook_blocking_error' }))), { hookFailed: true });
  assert.deepEqual(lineFlags(JSON.stringify(denial('<tool_use_error>guard-mod: 4 lookups this turn.</tool_use_error>'))), { modDenied: true });
  assert.deepEqual(lineFlags(JSON.stringify(denial('PreToolUse:Edit hook error: frozen'))), { modDenied: true });
  assert.deepEqual(lineFlags(JSON.stringify(attach({ type: 'hook_success' }))), {});
  assert.deepEqual(lineFlags(JSON.stringify(denial('<tool_use_error>File has not been read yet.</tool_use_error>'))), {});
  assert.deepEqual(lineFlags(JSON.stringify({ type: 'user', message: { content: 'the attachment type is hook_non_blocking_error' } })), {});
});

test('sessionFlags covers the subagents and reads only what a transcript grew by', () => {
  const dir = tmp();
  const file = path.join(dir, 's1.jsonl');
  fs.writeFileSync(file, jsonl(attach({ type: 'hook_success' })));
  assert.deepEqual(sessionFlags(file), { hookFailed: false, modDenied: false });
  fs.appendFileSync(file, jsonl(denial('<tool_use_error>guard-mod: no.</tool_use_error>')));
  assert.deepEqual(sessionFlags(file), { hookFailed: false, modDenied: true });
  fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-a1.jsonl'), jsonl(attach({ type: 'hook_non_blocking_error' })));
  assert.deepEqual(sessionFlags(file), { hookFailed: true, modDenied: true });
  assert.deepEqual(sessionFlags(path.join(dir, 'gone.jsonl')), { hookFailed: false, modDenied: false });
});

test('loadedFiles returns the paths of the first instructions attachment and no contents', () => {
  const dir = tmp();
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(
    file,
    jsonl({ type: 'user', message: { content: 'hi' } }, attach({ type: 'instructions', files: [{ path: 'C:\\Users\\a\\.claude\\CLAUDE.md', type: 'User', content: 'secret' }, { path: 'D:\\r\\CLAUDE.md', type: 'Project', content: 'x' }] }), attach({ type: 'instructions', files: [{ path: 'later.md' }] }))
  );
  assert.deepEqual(loadedFiles(file), ['C:\\Users\\a\\.claude\\CLAUDE.md', 'D:\\r\\CLAUDE.md']);
  fs.writeFileSync(file, jsonl({ type: 'user', message: { content: 'no attachment' } }));
  assert.equal(loadedFiles(file), undefined);
  assert.equal(loadedFiles(path.join(dir, 'gone.jsonl')), undefined);
});

test('failuresByHook prefers the command a failure ran, then the event and matcher', () => {
  const hooks = [
    { event: 'PreToolUse', matcher: 'Edit|Write', command: 'bash a.sh' },
    { event: 'PreToolUse', matcher: 'Bash', command: 'bash b.sh' },
    { event: 'Stop', matcher: '', command: 'node stop.js' },
  ];
  const byCommand = failuresByHook(hooks, [{ hook: 'PreToolUse:Edit', count: 2, exitCode: 127, command: 'bash b.sh' }]);
  assert.deepEqual([...byCommand.keys()], [1]);
  const byMatcher = failuresByHook(hooks, [{ hook: 'PreToolUse:Write', count: 1 }, { hook: 'Stop', count: 4, exitCode: 2 }]);
  assert.deepEqual([...byMatcher].map(([i, f]) => [i, f.map(x => x.hook)]), [[0, ['PreToolUse:Write']], [2, ['Stop']]]);
  assert.equal(failureText([{ hook: 'Stop', count: 1, exitCode: 2 }, { hook: 'PreToolUse:Edit', count: 12 }]), 'Stop failed 1 time, exit 2\nPreToolUse:Edit failed 12 times');
  assert.equal(failuresByHook(hooks, [{ hook: 'SessionStart', count: 1 }]).size, 0);
});

test('notLoaded compares paths by slash and case', () => {
  const missing = notLoaded(['D:/r/CLAUDE.md', 'D:\\r\\.claude\\rules\\a.md', 'D:\\r\\.claude\\rules\\b.md'], ['d:\\r\\claude.md', 'D:/r/.claude/rules/a.md']);
  assert.deepEqual([...missing], ['D:\\r\\.claude\\rules\\b.md']);
});
