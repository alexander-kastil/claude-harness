import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { fetchRoutines, parseRoutines, readLocalTasks, repositoryOf, routineBody, updateLocalTask, updateRoutine, type Fetcher } from '../../src/routines';

const body = {
  data: [
    {
      id: 'trig_code', name: 'Nightly triage', enabled: true, cron_expression: '0 3 * * *', created_kind: 'ROUTINE_CREATED_KIND_UNSPECIFIED',
      next_run_at: '2026-11-13T03:00:00Z', last_run: { fired_at: '2026-11-12T03:00:00Z', session_id: 'cse_1', status: 'ROUTINE_RUN_STATUS_SUCCEEDED' },
      derived_state: { prompt: 'Triage the issues.' }, job_config: { ccr: { session_context: { sources: [{ type: 'git_repository', url: 'https://github.com/acme/widgets.git' }] } } },
    },
    { id: 'trig_cowork', name: 'Weekly digest', enabled: true, cron_expression: '0 5 * * 1', created_kind: 'cowork_task', derived_state: { prompt: 'x' }, job_config: { ccr: { tags: ['cowork-remote'] } } },
  ],
};

const home = (credentials?: object) => {
  const root = fs.mkdtempSync(path.join(process.env.ROUTINES_TMP ?? os.tmpdir(), 'routines-'));
  if (credentials) fs.writeFileSync(path.join(root, '.credentials.json'), JSON.stringify(credentials));
  return root;
};

const repo = (tasks: object[]) => {
  const dir = fs.mkdtempSync(path.join(process.env.ROUTINES_TMP ?? os.tmpdir(), 'routines-repo-'));
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'scheduled_tasks.json'), JSON.stringify({ tasks, extra: 1 }));
  return dir;
};

test('only the Code routines are listed, with their repository', () => {
  const list = parseRoutines(body);
  assert.deepEqual(list.map(r => r.id), ['trig_code']);
  assert.equal(list[0].repository, 'acme/widgets');
  assert.equal(list[0].instructions, 'Triage the issues.');
  assert.equal(repositoryOf({}), '');
});

test('durable tasks are read from the repo file and malformed ones skipped', () => {
  const dir = repo([
    { id: 'a1', cron: '*/5 * * * *', prompt: 'check build', createdAt: 1, lastFiredAt: 2, recurring: true, permanent: true },
    { id: 'bad', cron: '*/5 * * * *' },
  ]);
  const tasks = readLocalTasks(dir);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].repeats, 'Every 5 minutes');
  assert.equal(tasks[0].permanent, true);
  assert.deepEqual(readLocalTasks(path.join(dir, 'nowhere')), []);
});

test('without a login the local tasks still list and the note says what is missing', async () => {
  const dir = repo([{ id: 'a1', cron: '0 * * * *', prompt: 'p' }]);
  let called = false;
  const list = await fetchRoutines(home(), [dir], { fetcher: async () => ((called = true), { status: 200, json: async () => body }) });
  assert.equal(list.cloud, 'noLogin');
  assert.match(list.note, /Sign in to Claude Code/);
  assert.equal(list.local.length, 1);
  assert.equal(called, false);
});

test('with a login one GET reads the routines', async () => {
  const seen: { method: string; auth?: string }[] = [];
  const fetcher: Fetcher = async (_u, init) => (seen.push({ method: init.method, auth: init.headers.Authorization }), { status: 200, json: async () => body });
  const list = await fetchRoutines(home({ claudeAiOauth: { accessToken: 't', expiresAt: Date.now() + 1e6 } }), [], { fetcher });
  assert.equal(list.cloud, 'ok');
  assert.equal(list.routines.length, 1);
  assert.deepEqual(seen, [{ method: 'GET', auth: 'Bearer t' }]);
  const denied = await fetchRoutines(home({ claudeAiOauth: { accessToken: 't' } }), [], { fetcher: async () => ({ status: 403, json: async () => ({}) }) });
  assert.equal(denied.cloud, 'denied');
});

test('a cloud change is a partial POST with only the named fields', async () => {
  assert.deepEqual(routineBody({ enabled: false }), { body: { enabled: false } });
  assert.deepEqual(routineBody({ name: ' A ', cron: '0 5 * * 1' }), { body: { name: 'A', cron_expression: '0 5 * * 1' } });
  assert.ok('error' in routineBody({ cron: 'nope' }));
  assert.ok('error' in routineBody({}));
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetcher: Fetcher = async (url, init) => (calls.push({ url, method: init.method, body: init.body }), { status: 200, json: async () => ({}) });
  const root = home({ claudeAiOauth: { accessToken: 't' } });
  assert.deepEqual(await updateRoutine(root, 'trig_code', { enabled: false }, { fetcher }), { ok: true });
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/v1\/code\/triggers\/trig_code$/);
  assert.equal(calls[0].body, '{"enabled":false}');
  assert.equal((await updateRoutine(root, '../x', { enabled: true }, { fetcher })).ok, false);
  assert.equal(calls.length, 1);
  assert.equal((await updateRoutine(root, 'trig_code', { enabled: true }, { fetcher: async () => ({ status: 500, json: async () => ({}) }) })).ok, false);
});

test('editing a durable task rewrites only its prompt and schedule', () => {
  const dir = repo([
    { id: 'a1', cron: '*/5 * * * *', prompt: 'old', createdAt: 1, recurring: true },
    { id: 'b2', cron: '0 * * * *', prompt: 'other' },
  ]);
  assert.deepEqual(updateLocalTask(dir, 'a1', { prompt: 'new', cron: '*/10 * * * *' }), { ok: true });
  const doc = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'scheduled_tasks.json'), 'utf8'));
  assert.equal(doc.extra, 1);
  assert.deepEqual(doc.tasks[0], { id: 'a1', cron: '*/10 * * * *', prompt: 'new', createdAt: 1, recurring: true });
  assert.equal(doc.tasks[1].prompt, 'other');
  assert.equal(updateLocalTask(dir, 'a1', { cron: 'x' }).ok, false);
  assert.equal(updateLocalTask(dir, 'a1', { prompt: '  ' }).ok, false);
  assert.equal(updateLocalTask(dir, 'zz', { prompt: 'p' }).ok, false);
});
