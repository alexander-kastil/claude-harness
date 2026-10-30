import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import { run } from '../../src/cli';
import { ORIGINS_FILE, coworkDrift, renderTaskSkill } from '../../src/cli-cowork';
import { parseTask } from '../../src/cowork-scheduled';

// Pull to Code of a scheduled task and of a project. The triggers API is a server on this PC with a synthetic body and the desktop
// app's data folder is the synthetic fixture; nothing real is read.
const fixture = (name: string): string => {
  for (const start of [__dirname, process.cwd()]) {
    for (let dir = start, up = 0; up < 8; dir = path.dirname(dir), up++) {
      const candidate = path.join(dir, 'test', 'fixtures', name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`test/fixtures/${name} not found`);
};

let tasks: any[] = [];
const server = http.createServer((_, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ data: tasks }));
});
const task = (prompt: string) => ({
  id: 'trig_1', name: 'Weekly digest', enabled: true, cron_expression: '0 5 * * 1', derived_state: { prompt },
  mcp_connections: [{ name: 'Mail' }, { name: 'Calendar' }], enabled_plugins: ['plugin-a'], extra_marketplaces: [],
});

before(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  process.env.CLAUDE_HARNESS_TRIGGERS_URL = `http://127.0.0.1:${(server.address() as any).port}/v1/code/triggers`;
  process.env.CLAUDE_HARNESS_LOCALAPPDATA = fixture('cowork-desktop');
});
after(() => server.close());

function world() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-pull-more-'));
  const root = path.join(home, '.claude');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic', expiresAt: Date.now() + 3600_000 } }));
  fs.writeFileSync(path.join(home, '.claude.json'), '{}');
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  return { home, root, repo, userConfig: path.join(home, '.claude.json') };
}

async function cli(w: ReturnType<typeof world>, argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run([...argv, '--root', w.root, '--user-config', w.userConfig], { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('a task pulled to Global becomes a skill with its instructions and what it uses', async () => {
  tasks = [task('Summarise the week.\nKeep it short.')];
  const w = world();
  const r = await cli(w, ['cowork', 'pull', 'Weekly digest', '--kind', 'task']);
  assert.equal(r.code, 0, r.err);
  const text = fs.readFileSync(path.join(w.root, 'skills', 'weekly-digest', 'SKILL.md'), 'utf8');
  assert.match(text, /^---\nname: weekly-digest\ndescription: "Summarise the week\."\n---/);
  assert.match(text, /Keep it short\./);
  assert.match(text, /- Connectors: Mail, Calendar/);
  assert.match(text, /- Plugins: plugin-a/);
  const origins = JSON.parse(fs.readFileSync(path.join(w.root, ORIGINS_FILE), 'utf8'));
  assert.equal(origins['skills/weekly-digest'].kind, 'task');
  assert.equal(origins['skills/weekly-digest'].from, 'scheduled-task:trig_1');
});

test('a task dry run writes nothing, a second pull backs up the first, and --repo targets the repo', async () => {
  tasks = [task('One.')];
  const w = world();
  const dry = await cli(w, ['cowork', 'pull', 'trig_1', '--dry-run', '--json']);
  assert.equal(JSON.parse(dry.out).applied, false);
  assert.equal(fs.existsSync(path.join(w.root, 'skills')), false);
  await cli(w, ['cowork', 'pull', 'Weekly digest']);
  tasks = [task('Two.')];
  const again = JSON.parse((await cli(w, ['cowork', 'pull', 'Weekly digest', '--json'])).out);
  assert.equal(again.rows[0].action, 'replace');
  assert.match(fs.readFileSync(again.rows[0].backup, 'utf8'), /One\./);
  const inRepo = await cli(w, ['cowork', 'pull', 'Weekly digest', '--repo', w.repo]);
  assert.equal(inRepo.code, 0, inRepo.err);
  assert.ok(fs.existsSync(path.join(w.repo, '.claude', 'skills', 'weekly-digest', 'SKILL.md')));
});

test('drift: Cowork changing the task or the copy being edited both show as differs, a vanished task as gone', async () => {
  tasks = [task('One.')];
  const w = world();
  await cli(w, ['cowork', 'pull', 'Weekly digest']);
  const live = tasks.map(parseTask);
  assert.equal(coworkDrift(w.root, live)[0].state, 'same');
  const changed = [parseTask(task('Changed.'))];
  const d = coworkDrift(w.root, changed)[0];
  assert.equal(d.state, 'differs');
  assert.match(d.current!, /Changed\./);
  assert.equal(coworkDrift(w.root, [])[0].state, 'gone');
  fs.appendFileSync(path.join(w.root, 'skills', 'weekly-digest', 'SKILL.md'), 'my edit\n');
  assert.equal(coworkDrift(w.root, live)[0].state, 'differs');
  assert.equal(renderTaskSkill(live[0]).includes('Uses'), true);
});

test('a task without a login or instructions stops with a line', async () => {
  tasks = [task('')];
  const w = world();
  const none = await cli(w, ['cowork', 'pull', 'Weekly digest', '--kind', 'task']);
  assert.notEqual(none.code, 0);
  assert.match(none.err, /no instructions/);
  fs.rmSync(path.join(w.root, '.credentials.json'));
  const nologin = await cli(w, ['cowork', 'pull', 'Weekly digest', '--kind', 'task']);
  assert.notEqual(nologin.code, 0);
  assert.match(nologin.err, /Sign in/);
});

test('a project pulled to a repo becomes a rules file, and with --into claude-md a section that a second pull replaces', async () => {
  tasks = [];
  const w = world();
  const r = await cli(w, ['cowork', 'pull', 'Fixture Alpha', '--kind', 'project', '--repo', w.repo]);
  assert.equal(r.code, 0, r.err);
  const rules = fs.readFileSync(path.join(w.repo, '.claude', 'rules', 'fixture-alpha.md'), 'utf8');
  assert.match(rules, /^# Cowork project: Fixture Alpha/);
  assert.match(rules, /Fixture instructions/);
  fs.writeFileSync(path.join(w.repo, 'CLAUDE.md'), '# Repo\n\nExisting line.\n');
  const first = JSON.parse((await cli(w, ['cowork', 'pull', 'Fixture Alpha', '--kind', 'project', '--into', 'claude-md', '--repo', w.repo, '--json'])).out);
  assert.match(fs.readFileSync(first.rows[0].backup, 'utf8'), /^# Repo\n\nExisting line\.\n$/);
  const merged = fs.readFileSync(path.join(w.repo, 'CLAUDE.md'), 'utf8');
  assert.match(merged, /Existing line\./);
  assert.match(merged, /<!-- cowork-pull:fixture-alpha -->[\s\S]*Fixture instructions[\s\S]*<!-- \/cowork-pull:fixture-alpha -->/);
  await cli(w, ['cowork', 'pull', 'Fixture Alpha', '--kind', 'project', '--into', 'claude-md', '--repo', w.repo]);
  assert.equal(fs.readFileSync(path.join(w.repo, 'CLAUDE.md'), 'utf8').split('cowork-pull:fixture-alpha -->').length, 3, 'one section, not two');
  const drift = coworkDrift(path.join(w.repo, '.claude'));
  assert.deepEqual(drift.map(d => d.state), ['same', 'same']);
});

test('a project without a CLAUDE.md on this PC is not pulled', async () => {
  const w = world();
  const r = await cli(w, ['cowork', 'pull', 'Fixture Beta', '--kind', 'project']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /no CLAUDE\.md on this PC/);
});

test('the desktop app data and the task list are unchanged by a pull', async () => {
  tasks = [task('One.')];
  const before = fs.readdirSync(fixture('cowork-desktop'), { recursive: true }).join('|');
  const w = world();
  await cli(w, ['cowork', 'pull', 'Fixture Alpha', '--kind', 'project']);
  assert.equal(fs.readdirSync(fixture('cowork-desktop'), { recursive: true }).join('|'), before);
});
