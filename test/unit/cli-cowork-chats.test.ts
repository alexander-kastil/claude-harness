import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';

const fixtureRoot = (): string => {
  if (process.env.COWORK_DESKTOP_FIXTURE) return process.env.COWORK_DESKTOP_FIXTURE;
  for (const up of ['../..', '../../..']) {
    const p = path.join(__dirname, up, 'test', 'fixtures', 'cowork-desktop');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('cowork-desktop fixture not found');
};

/** An empty Claude root (no sign-in, so no claude.ai call), the desktop fixture and a Downloads folder with one file. */
function world() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-cowork-chats-'));
  const root = path.join(home, '.claude');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(home, '.claude.json'), '{}');
  const downloads = path.join(home, 'Downloads');
  fs.mkdirSync(downloads);
  fs.writeFileSync(path.join(downloads, 'notes.md'), '# notes\n');
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  return { home, root, downloads, repo, userConfig: path.join(home, '.claude.json') };
}

async function cli(w: ReturnType<typeof world>, argv: string[]) {
  process.env.CLAUDE_HARNESS_LOCALAPPDATA = fixtureRoot();
  process.env.CLAUDE_HARNESS_DOWNLOADS = w.downloads;
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...argv, '--root', w.root, '--user-config', w.userConfig], { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('cowork chats lists the chats as a table and says why claude.ai sessions are missing', async () => {
  const r = await cli(world(), ['cowork', 'chats']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^\*\*Cowork chats on this PC: \d+\*\*/);
  assert.match(r.out, /\| Id +\| Chat +\| Model +\| +Out \| +In \| Last activity +\|/);
  assert.match(r.out, /Fixture research chat/);
  assert.match(r.out, /Sign in to Claude Code/);
});

test('cowork chats --json carries the chats and the sessions state; --query and --limit narrow it', async () => {
  const w = world();
  const o = JSON.parse((await cli(w, ['cowork', 'chats', '--json', '--query', 'fixture research'])).out);
  assert.equal(o.found, true);
  assert.deepEqual(o.chats.map((c: { title: string }) => c.title), ['Fixture research chat']);
  assert.equal(o.sessions.state, 'noLogin');
  const none = JSON.parse((await cli(w, ['cowork', 'chats', '--json', '--limit', '0'])).out);
  assert.equal(none.chats.length, 0);
  assert.equal((await cli(w, ['cowork', 'chats', '--limit', 'x'])).code, 2);
});

test('cowork chat shows details, files and the conversation by id, id start or title', async () => {
  const w = world();
  const r = await cli(w, ['cowork', 'chat', 'local_cccc0001']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^\*\*Cowork chat Fixture research chat\*\*/);
  assert.match(r.out, /\*\*Files: 3\*\*/);
  assert.match(r.out, /\*\*You\*\*\n.*fixture topic/);
  const byTitle = JSON.parse((await cli(w, ['cowork', 'chat', 'Fixture research chat', '--json'])).out);
  assert.equal(byTitle.chat.id, 'local_cccc0001');
  assert.equal(byTitle.messages.length, 4);
  const capped = JSON.parse((await cli(w, ['cowork', 'chat', 'local_cccc', '--json', '--limit', '1'])).out);
  assert.equal(capped.messages.length, 1);
  assert.equal(capped.more, 3);
  assert.equal((await cli(w, ['cowork', 'chat', 'nope'])).code, 1);
  assert.equal((await cli(w, ['cowork', 'chat'])).code, 2);
});

test('cowork artifacts lists the produced files with their chat', async () => {
  const w = world();
  const r = await cli(w, ['cowork', 'artifacts']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\| File +\| Chat +\| +Size \| Updated +\| Path +\|/);
  assert.match(r.out, /report\.md/);
  const o = JSON.parse((await cli(w, ['cowork', 'artifacts', '--json', '--query', 'chart'])).out);
  assert.deepEqual(o.artifacts.map((a: { name: string }) => a.name), ['charts/chart.txt']);
});

test('cowork handover sources lists chats, sessions and Downloads files', async () => {
  const r = await cli(world(), ['cowork', 'handover', 'sources']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Desktop chats/);
  assert.match(r.out, /notes\.md/);
});

test('cowork handover plan writes nothing; create writes CONTEXT.md and the ticked files', async () => {
  const w = world();
  const base = ['cowork', 'handover', '--source', 'chat', '--id', 'local_cccc0001', '--repo', w.repo, '--task', 'Continue the research', '--rule', 'keep the charts', '--skip', 'uploads/fixture-brief.txt'];
  const plan = await cli(w, ['cowork', 'handover', 'plan', ...base.slice(2), '--json']);
  assert.equal(plan.code, 0, plan.err);
  const p = JSON.parse(plan.out);
  assert.equal(p.applied, false);
  assert.deepEqual(p.problems, []);
  assert.equal(fs.existsSync(path.join(w.repo, 'handover')), false);
  const names: string[] = p.files.map((f: { name: string }) => f.name);
  assert.ok(names.some(n => n.endsWith('report.md')));
  assert.equal(names.length, 2);

  const dry = await cli(w, ['cowork', 'handover', 'create', ...base.slice(2), '--dry-run']);
  assert.match(dry.out, /^\*\*\[dry-run\] Handover/);
  assert.equal(fs.existsSync(path.join(w.repo, 'handover')), false);

  const made = await cli(w, ['cowork', 'handover', 'create', ...base.slice(2), '--json']);
  assert.equal(made.code, 0, made.err);
  const o = JSON.parse(made.out);
  assert.equal(o.applied, true);
  const context = fs.readFileSync(path.join(o.folder, 'CONTEXT.md'), 'utf8');
  assert.match(context, /Continue the research/);
  assert.match(context, /- keep the charts/);
  assert.ok(fs.existsSync(path.join(o.folder, 'files', 'outputs', 'report.md')));
});

test('cowork handover refuses a missing repo and a bad link', async () => {
  const w = world();
  const noRepo = await cli(w, ['cowork', 'handover', 'create', '--source', 'chat', '--id', 'local_cccc0001', '--repo', path.join(w.home, 'nowhere')]);
  assert.equal(noRepo.code, 1);
  assert.match(noRepo.err, /Pick a repository/);
  assert.equal((await cli(w, ['cowork', 'handover', 'plan', '--source', 'link', '--link', 'nope', '--repo', w.repo])).code, 2);
  assert.equal((await cli(w, ['cowork', 'handover', 'plan', '--repo', w.repo])).code, 2);
  const link = JSON.parse((await cli(w, ['cowork', 'handover', 'plan', '--source', 'link', '--link', 'https://claude.ai/artifacts/abc', '--repo', w.repo, '--json'])).out);
  assert.equal(link.source, 'link');
});

test('cowork handover from a Downloads file copies it', async () => {
  const w = world();
  const o = JSON.parse((await cli(w, ['cowork', 'handover', 'create', '--source', 'download', '--id', 'notes.md', '--repo', w.repo, '--json'])).out);
  assert.ok(fs.existsSync(path.join(o.folder, 'files', 'notes.md')));
});
