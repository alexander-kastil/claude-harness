import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { changedSince, checkpointsOf, readSnapshots, restoreFiles } from '../../src/checkpoints';

const snap = (messageId: string, timestamp: string, dir: string, files: Record<string, string | null>, update = false) => ({
  type: 'file-history-snapshot',
  messageId,
  isSnapshotUpdate: update,
  snapshot: { messageId, timestamp, trackedFileBackups: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { backupFileName: v, version: 1, backupTime: timestamp, realParentDir: dir }])) },
});
const user = (uuid: string, timestamp: string) => ({ type: 'user', uuid, timestamp });

test('a restore puts back what Claude changed after the checkpoint and removes what it created', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
  const history = path.join(root, 'history');
  fs.mkdirSync(history);
  const a = path.join(root, 'a.txt');
  const b = path.join(root, 'b.txt');
  fs.writeFileSync(path.join(history, 'a@v1'), 'a original');
  fs.writeFileSync(path.join(history, 'a@v2'), 'a after first edit');
  fs.writeFileSync(path.join(history, 'b@v1'), 'b original');
  // Prompt 1 edits a (v1 saved before the edit, b not touched yet); prompt 2 sees a at v2 and edits b; b is deleted by prompt 3.
  const records = [
    user('p1', '2026-01-01T10:00:00Z'),
    snap('p1', '2026-01-01T10:00:00Z', root, { 'a.txt': 'a@v1' }, true),
    user('p2', '2026-01-01T10:10:00Z'),
    snap('p2', '2026-01-01T10:10:00Z', root, { 'a.txt': 'a@v2', 'b.txt': 'b@v1' }),
    user('p3', '2026-01-01T10:20:00Z'),
    snap('p3', '2026-01-01T10:20:00Z', root, { 'a.txt': 'a@v2', 'b.txt': 'b@v1', 'c.txt': null }),
  ];
  const snaps = readSnapshots(records);
  assert.deepEqual(checkpointsOf(snaps).map(c => c.id), ['p1', 'p2', 'p3']);
  fs.writeFileSync(a, 'a latest');
  fs.writeFileSync(b, 'b latest');
  fs.writeFileSync(path.join(root, 'c.txt'), 'created by Claude');

  const fromP1 = changedSince(snaps, 'p1', history);
  assert.deepEqual(fromP1.map(f => [path.basename(f.path), f.action]), [['a.txt', 'overwrite'], ['b.txt', 'overwrite'], ['c.txt', 'remove']]);
  const fromP3 = changedSince(snaps, 'p3', history);
  assert.deepEqual(fromP3.map(f => path.basename(f.path)), ['a.txt', 'b.txt', 'c.txt']);

  const done = restoreFiles(fromP1);
  assert.equal(done.restored, 3);
  assert.equal(fs.readFileSync(a, 'utf8'), 'a original');
  assert.equal(fs.readFileSync(b, 'utf8'), 'b original');
  assert.equal(fs.existsSync(path.join(root, 'c.txt')), false);
  assert.deepEqual(changedSince(snaps, 'p1', history), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a session that edited nothing has no checkpoints', () => {
  const snaps = readSnapshots([user('p1', '2026-01-01T10:00:00Z'), snap('p1', '2026-01-01T10:00:00Z', 'D:/x', {})]);
  assert.deepEqual(checkpointsOf(snaps), []);
});
