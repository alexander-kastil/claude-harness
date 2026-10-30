import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import { projectSlug } from '../../src/repos-overview';

const NOW = Date.now();
/** A timestamp this many minutes before now. */
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60000).toISOString();
const ago = (minutesAgo: number) => new Date(NOW - minutesAgo * 60000);
const SID = '11111111-2222-3333-4444-555555555555';
const SID2 = '66666666-7777-8888-9999-000000000000';

interface Spec {
  /** Minutes ago of the first record. */
  started: number;
  /** Minutes ago of the last write, which is the file's mtime. */
  ended: number;
  prompt: string;
  /** A `/rename` record, when the session has one. */
  title?: string;
  agents?: number;
}

/** A transcript in the repo's project folder, with its subagent transcripts when it has any. */
function session(folder: string, id: string, spec: Spec) {
  const file = path.join(folder, `${id}.jsonl`);
  const records: unknown[] = [{ sessionId: id, type: 'user', uuid: `${id}-u1`, timestamp: at(spec.started), entrypoint: 'cli', message: { role: 'user', content: spec.prompt } }];
  if (spec.title) records.push({ type: 'custom-title', customTitle: spec.title, sessionId: id });
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.utimesSync(file, ago(spec.ended), ago(spec.ended));
  for (let i = 0; i < (spec.agents ?? 0); i++) {
    const sub = path.join(folder, id, 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `agent-a${i}.jsonl`), JSON.stringify({ isSidechain: true, sessionId: id, type: 'user', timestamp: at(spec.started), message: { role: 'user', content: 'work' } }) + '\n');
  }
  return file;
}

/** Two sessions of one repo: SID is the newest, and it has a /rename name and one agent. */
function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sessions-'));
  const root = path.join(tmp, '.claude');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const folder = path.join(root, 'projects', projectSlug(repo));
  const file = session(folder, SID, { started: 120, ended: 30, prompt: 'build the thing', title: 'Refactor the parser', agents: 1 });
  session(folder, SID2, { started: 600, ended: 595, prompt: 'an earlier prompt' });
  return { tmp, root, repo, folder, file };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const exec = async (argv: string[]) => {
    out.length = 0;
    err.length = 0;
    const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
    return { code, text: out.join('\n'), err: err.join('\n') };
  };
  return exec;
}

test('sessions --json lists the repo newest first, named the way /resume names them', async () => {
  const { root, repo } = fixture();
  const r = await capture()(['sessions', '--repo', repo, '--root', root, '--json']);
  assert.equal(r.code, 0);
  const json = JSON.parse(r.text);
  assert.equal(json.applied, false);
  assert.equal(json.total, 2);
  assert.deepEqual(
    json.sessions.map((s: { id: string }) => s.id),
    [SID, SID2],
  );
  assert.equal(json.sessions[0].title, 'Refactor the parser');
  assert.equal(json.sessions[1].title, 'an earlier prompt');
  assert.equal(json.sessions[0].minutes, 90);
  assert.equal(json.sessions[0].agents, 1);
  assert.equal(json.sessions[0].live, null);
  assert.match(json.sessions[0].started, /^\d{4}-\d{2}-\d{2}T/);
});

test('sessions caps the rows at 20 by default, --limit moves the cap, and the total counts every session', async () => {
  const { root, repo, folder } = fixture();
  for (let i = 0; i < 20; i++) session(folder, `session-${i}`, { started: 700 + i, ended: 700 + i, prompt: `prompt ${i}` });
  const dflt = JSON.parse((await capture()(['sessions', '--repo', repo, '--root', root, '--json'])).text);
  assert.equal(dflt.total, 22);
  assert.equal(dflt.sessions.length, 20);
  const one = JSON.parse((await capture()(['sessions', '--repo', repo, '--root', root, '--limit', '1', '--json'])).text);
  assert.equal(one.sessions.length, 1);
  assert.equal(one.total, 22);
  assert.equal(one.sessions[0].id, SID);
});

test('a bad --limit or an unknown word stops with code 2', async () => {
  const { root, repo } = fixture();
  const exec = capture();
  assert.equal((await exec(['sessions', '--repo', repo, '--root', root, '--limit', '0'])).code, 2);
  assert.equal((await exec(['sessions', '--repo', repo, '--root', root, '--limit', 'many'])).code, 2);
  assert.equal((await exec(['sessions', 'frobnicate', '--repo', repo, '--root', root])).code, 2);
});

test('a repo with no sessions reads a (none) row and a total of 0', async () => {
  const { root, tmp } = fixture();
  const empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty, { recursive: true });
  const r = await capture()(['sessions', '--repo', empty, '--root', root]);
  assert.equal(r.code, 0);
  assert.ok(r.text.startsWith('**Sessions · 0 of 0 · '));
  assert.match(r.text, /\| \(none\)/);
  assert.equal(JSON.parse((await capture()(['sessions', '--repo', empty, '--root', root, '--json'])).text).total, 0);
});

test('sessions text is a headline and a table with the Minutes and Agents columns right-aligned', async () => {
  const { root, repo } = fixture();
  const r = await capture()(['sessions', '--repo', repo, '--root', root]);
  assert.ok(r.text.startsWith('**Sessions · 2 of 2 · '));
  assert.ok(r.text.includes('| Session'));
  assert.ok(r.text.includes('Refactor the parser'));
  assert.ok(r.text.includes('an earlier prompt'));
  assert.match(r.text, /-: \|/);
});

test('rename --dry-run writes nothing and prints what it would append and write', async () => {
  const { root, repo, folder, file } = fixture();
  const before = fs.readFileSync(file, 'utf8');
  const r = await capture()(['sessions', 'rename', '--session', SID, '--title', 'Parser rewrite', '--repo', repo, '--root', root, '--dry-run']);
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(folder, SID, 'custom-title.json')));
  assert.match(r.text, /^\*\*Rename · 11111111 · dry run\*\*/);
  assert.match(r.text, /\[dry-run\] append the name to /);
  assert.match(r.text, /\[dry-run\] write .*custom-title\.json/);
  const j = JSON.parse((await capture()(['sessions', 'rename', '--session', SID, '--title', 'Parser rewrite', '--repo', repo, '--root', root, '--dry-run', '--json'])).text);
  assert.equal(j.applied, false);
  assert.equal(j.from, 'Refactor the parser');
  assert.equal(j.to, 'Parser rewrite');
});

test('rename appends a custom-title record and writes the sidecar, and the list shows the new name', async () => {
  const { root, repo, folder, file } = fixture();
  const r = await capture()(['sessions', 'rename', '--session', SID, '--title', 'Parser rewrite', '--repo', repo, '--root', root, '--json']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.text).applied, true);
  const last = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').at(-1)!);
  assert.deepEqual(last, { type: 'custom-title', customTitle: 'Parser rewrite', sessionId: SID });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, SID, 'custom-title.json'), 'utf8')), { customTitle: 'Parser rewrite' });
  const listed = JSON.parse((await capture()(['sessions', '--repo', repo, '--root', root, '--json'])).text);
  assert.equal(listed.sessions[0].title, 'Parser rewrite');
});

test('rename --session previous and latest resolve the way usage --session does', async () => {
  const { root, repo } = fixture();
  const exec = capture();
  const prev = JSON.parse((await exec(['sessions', 'rename', '--session', 'previous', '--title', 'Older', '--repo', repo, '--root', root, '--dry-run', '--json'])).text);
  assert.equal(prev.session, SID2);
  assert.equal(prev.from, 'an earlier prompt');
  const latest = JSON.parse((await exec(['sessions', 'rename', '--session', 'latest', '--title', 'Newer', '--repo', repo, '--root', root, '--dry-run', '--json'])).text);
  assert.equal(latest.session, SID);
});

test('rename to the name a session has already is unchanged and writes nothing', async () => {
  const { root, repo, file } = fixture();
  const before = fs.readFileSync(file, 'utf8');
  const r = await capture()(['sessions', 'rename', '--session', SID, '--title', 'Refactor the parser', '--repo', repo, '--root', root, '--json']);
  assert.equal(JSON.parse(r.text).applied, false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a running session gets the note that Claude Code writes its own name again', async () => {
  const { root, repo } = fixture();
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SID, status: 'busy' }));
  const r = await capture()(['sessions', 'rename', '--session', SID, '--title', 'Parser rewrite', '--repo', repo, '--root', root, '--dry-run']);
  assert.match(r.text, /This session is running\. Claude Code writes its own name again/);
});

test('rename stops with code 2 without a session or a title, and code 1 for an unknown session', async () => {
  const { root, repo } = fixture();
  const exec = capture();
  assert.equal((await exec(['sessions', 'rename', '--title', 'x', '--repo', repo, '--root', root])).code, 2);
  assert.equal((await exec(['sessions', 'rename', '--session', SID, '--repo', repo, '--root', root])).code, 2);
  assert.equal((await exec(['sessions', 'rename', '--session', SID, '--title', '   ', '--repo', repo, '--root', root])).code, 2);
  assert.equal((await exec(['sessions', 'rename', '--session', 'nope', '--title', 'x', '--repo', repo, '--root', root])).code, 1);
});
