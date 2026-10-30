import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { cronWords, fetchScheduled, parseTriggers, runUrl, taskUrl, type Fetcher } from '../../src/cowork-scheduled';

const mcp = (n: number) => Array.from({ length: n }, (_, i) => ({ connector_uuid: `uuid-${i}`, name: `Connector ${i}`, transport_type: 'http', url: `https://example.test/${i}` }));

/** Synthetic body shaped like GET /v1/code/triggers: three tasks, one active, one waiting for the desktop, one auto-disabled. */
export const fixture = () => ({
  has_more: false,
  data: [
    {
      id: 'trig_active', name: 'Weekly digest', enabled: true, cron_expression: '0 5 * * 1', chat_project_id: 'proj-1',
      created_kind: 'cowork_task', created_via: 'meta_mcp', created_surface: 'ROUTINE_CREATED_SURFACE_UNSPECIFIED',
      suspension_reason: '', ended_reason: '', next_run_at: '2026-11-02T05:00:00Z', last_fired_at: '2026-10-26T05:00:00Z',
      last_run: { fired_at: '2026-10-26T05:00:00Z', session_id: 'cse_run1', status: 'ROUTINE_RUN_STATUS_ABANDONED', failure_reason: 'ROUTINE_RUN_FAILURE_REASON_UNSPECIFIED' },
      derived_state: { files: [], folders: [], folders_state: 'FOLDERS_STATE_NONE', model: 'model-a', prompt: 'Summarise the week.\nKeep it short.' },
      job_config: { ccr: { tags: ['cowork-remote'], session_context: { allowed_tools: ['a', 'b', 'c'] } } },
      mcp_connections: mcp(10), enabled_plugins: ['plugin-a', { name: 'plugin-b' }, 'plugin-a'], extra_marketplaces: [{ id: 'market-a' }],
    },
    {
      id: 'trig_wait', name: 'Daily sweep', enabled: true, cron_expression: '0 0 * * *', chat_project_id: '',
      created_kind: 'ROUTINE_CREATED_KIND_UNSPECIFIED', created_via: 'meta_mcp',
      suspension_reason: 'device_absent', ended_reason: '', next_run_at: '2026-11-01T00:00:00Z', last_fired_at: '2026-10-31T00:00:00Z',
      last_run: { fired_at: '2026-10-31T00:00:00Z', finished_at: '2026-10-31T00:05:00Z', session_id: 'cse_run2', status: 'ROUTINE_RUN_STATUS_SUCCEEDED' },
      derived_state: { prompt: 'Sweep.' }, job_config: { ccr: { tags: ['cowork-remote', 'cowork-scheduled'] } }, mcp_connections: mcp(2),
    },
    {
      id: 'trig_off', name: 'Nightly check', enabled: false, cron_expression: '0 7 * * *', chat_project_id: '',
      created_kind: 'ROUTINE_CREATED_KIND_UNSPECIFIED', created_via: 'http_api',
      suspension_reason: '', ended_reason: 'auto_disabled_repo_access', next_run_at: '2026-11-01T07:00:00Z',
      derived_state: { prompt: 'Check.' }, job_config: { ccr: {} }, mcp_connections: [],
    },
  ],
});

test('cronWords reads common schedules at the given UTC offset', () => {
  assert.equal(cronWords('0 5 * * 1', 60), 'Every Monday at 06:00');
  assert.equal(cronWords('0 0 * * *', 0), 'Every day at 00:00');
  assert.equal(cronWords('30 23 * * 1,3', 120), 'Every Tuesday, Thursday at 01:30');
  assert.equal(cronWords('*/15 * * * *', 0), 'Every 15 minutes');
  assert.equal(cronWords('0 * * * *', 0), 'Every hour');
  assert.equal(cronWords('0 9 15 * *', 0), 'Day 15 of every month at 09:00');
  assert.equal(cronWords('0 9 1-5 * *', 0), '0 9 1-5 * *');
  assert.equal(cronWords('nonsense', 0), 'nonsense');
});

test('parseTriggers: status, source and details of the three fixture tasks', () => {
  const [a, w, o] = parseTriggers(fixture());
  assert.equal(a.status, 'Active');
  assert.equal(a.source, 'Cowork');
  assert.equal(a.instructions, 'Summarise the week.\nKeep it short.');
  assert.equal(a.lastRunStatus, 'abandoned');
  assert.equal(a.lastRunSessionId, 'cse_run1');
  assert.equal(a.projectId, 'proj-1');
  assert.equal(a.connectors, 10);
  assert.equal(a.connectorNames.length, 10);
  assert.equal(a.connectorNames[0], 'Connector 0');
  assert.deepEqual(a.pluginNames, ['plugin-a', 'plugin-b']);
  assert.deepEqual(a.marketplaceNames, ['market-a']);
  assert.deepEqual(parseTriggers(fixture())[1].pluginNames, []);
  assert.equal(a.permissions, 'Manual, 3 tools always allowed');
  assert.equal(a.runsOn, 'Cloud');
  assert.equal(a.nextRunAt, Date.parse('2026-11-02T05:00:00Z'));
  assert.equal(w.status, 'Waiting for Claude Desktop');
  assert.equal(w.statusKind, 'wait');
  assert.equal(w.runsOn, 'This PC (Claude Desktop)');
  assert.equal(w.projectId, undefined);
  assert.equal(w.lastRunStatus, 'succeeded');
  assert.equal(w.permissions, 'Manual');
  assert.equal(o.status, 'Auto-disabled, lost access to its repository');
  assert.equal(o.statusKind, 'off');
  assert.equal(o.source, 'Code');
  assert.equal(o.nextRunAt, undefined);
  assert.equal(o.lastRunSessionId, undefined);
  assert.equal(taskUrl('trig_x'), 'https://claude.ai/scheduled-task/trig_x');
  assert.equal(runUrl('cse_1'), 'https://claude.ai/cowork/cse_1');
});

test('parseTriggers tolerates garbage', () => {
  assert.deepEqual(parseTriggers(undefined), []);
  assert.deepEqual(parseTriggers({ data: [null, 3, { name: 'no id' }] }), []);
});

const rootWith = (oauth: unknown) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
  if (oauth !== undefined) fs.writeFileSync(path.join(root, '.credentials.json'), JSON.stringify({ claudeAiOauth: oauth }));
  return root;
};
const reply = (status: number, body: unknown = {}): { calls: { url: string; init: any }[]; fetcher: Fetcher } => {
  const calls: { url: string; init: any }[] = [];
  return { calls, fetcher: async (url, init) => (calls.push({ url, init }), { status, json: async () => body }) };
};

test('fetchScheduled: one GET with the beta headers and the bearer token', async () => {
  const r = reply(200, fixture());
  const out = await fetchScheduled(rootWith({ accessToken: 'tok-synthetic', expiresAt: Date.now() + 3600_000 }), { fetcher: r.fetcher });
  assert.equal(out.state, 'ok');
  assert.equal(out.tasks.length, 3);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].init.method, 'GET');
  assert.equal(r.calls[0].url, 'https://api.anthropic.com/v1/code/triggers');
  assert.equal(r.calls[0].init.headers.Authorization, 'Bearer tok-synthetic');
  assert.equal(r.calls[0].init.headers['anthropic-beta'], 'ccr-triggers-2026-01-30');
});

test('fetchScheduled: no login, expired token and error statuses give a note and no call', async () => {
  const none = reply(200, fixture());
  assert.equal((await fetchScheduled(rootWith(undefined), { fetcher: none.fetcher })).state, 'noLogin');
  assert.equal((await fetchScheduled(rootWith({}), { fetcher: none.fetcher })).state, 'noLogin');
  const exp = await fetchScheduled(rootWith({ accessToken: 't', expiresAt: 1000 }), { fetcher: none.fetcher });
  assert.equal(exp.state, 'expired');
  assert.ok(exp.note.length > 0 && exp.tasks.length === 0);
  assert.equal(none.calls.length, 0);
  const live = rootWith({ accessToken: 't' });
  assert.equal((await fetchScheduled(live, { fetcher: reply(401).fetcher })).state, 'expired');
  assert.equal((await fetchScheduled(live, { fetcher: reply(403).fetcher })).state, 'denied');
  assert.equal((await fetchScheduled(live, { fetcher: reply(500).fetcher })).state, 'error');
  assert.equal((await fetchScheduled(live, { fetcher: async () => { throw new Error('offline'); } })).state, 'error');
});
