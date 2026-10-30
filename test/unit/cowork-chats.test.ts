import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { findDataRoot } from '../../src/cowork-desktop';
import { chatById, fetchCloudSessions, insideData, loadChat, loadChats, parseSessions } from '../../src/cowork-chats';

const fixtureRoot = (): string => {
  if (process.env.COWORK_DESKTOP_FIXTURE) return process.env.COWORK_DESKTOP_FIXTURE;
  for (const up of ['../..', '../../..']) {
    const p = path.join(__dirname, up, 'test', 'fixtures', 'cowork-desktop');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('cowork-desktop fixture not found');
};
const data = () => findDataRoot(fixtureRoot());

test('chats list every local session with the files counted on disk', () => {
  const list = loadChats(data());
  assert.equal(list.found, true);
  const c = list.chats.find(x => x.title === 'Fixture research chat');
  assert.ok(c);
  assert.equal(c.produced, 2);
  assert.equal(c.uploaded, 1);
  assert.deepEqual(list.artifacts.filter(a => a.chatId === c.id).map(a => a.name).sort(), ['charts/chart.txt', 'report.md']);
});

test('no data folder gives no chats', () => {
  assert.deepEqual(loadChats(null), { found: false, chats: [], artifacts: [] });
});

test('a chat holds what was written and answered, not tool calls or results', () => {
  const chat = chatById('local_cccc0001', data());
  assert.ok(chat);
  const c = loadChat(chat);
  assert.deepEqual(c.messages.map(m => m.role), ['you', 'claude', 'you', 'claude']);
  assert.match(c.messages[0].text, /fixture topic/);
  assert.equal(c.files.length, 3);
});

test('only paths inside the data folder may be opened', () => {
  const root = data()!;
  assert.equal(insideData(path.join(root, 'local-agent-mode-sessions', 'x.txt'), root), true);
  assert.equal(insideData(path.join(root, '..', 'secret.txt'), root), false);
  assert.equal(insideData(root, root), false);
});

test('sessions of claude.ai are parsed from a list body, whatever wraps it', () => {
  const body = { data: [{ id: 'cse_1', title: 'Weekly research', status: 'idle', user_message_count: '4', updated_at: '2026-10-29T10:00:00Z' }, { nothing: true }] };
  const list = parseSessions(body);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].title, list[0].status, list[0].messages], ['Weekly research', 'idle', 4]);
  assert.equal(list[0].url, 'https://claude.ai/cowork/cse_1');
});

test('the cloud read maps the login states without a request when there is no login', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-'));
  let called = 0;
  const fetcher = async () => (called++, { status: 200, json: async () => ({}) });
  assert.equal((await fetchCloudSessions(empty, { fetcher })).state, 'noLogin');
  fs.writeFileSync(path.join(empty, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 't', expiresAt: 1 } }));
  assert.equal((await fetchCloudSessions(empty, { fetcher, now: 5 })).state, 'expired');
  assert.equal(called, 0);
  fs.writeFileSync(path.join(empty, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 't' } }));
  assert.equal((await fetchCloudSessions(empty, { fetcher: async () => ({ status: 401, json: async () => ({}) }) })).state, 'expired');
  assert.equal((await fetchCloudSessions(empty, { fetcher: async () => ({ status: 200, json: async () => ({ data: [{ id: 'a' }] }) }) })).sessions.length, 1);
});
