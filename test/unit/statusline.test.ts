import * as assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { SCRIPT_NAME, buildScript, fieldsOfScript, readStatusline, removeStatusline, saveStatusline } from '../../src/statusline';
import { statuslineText } from '../../src/shared/statusline-fields';

// Scratch lives on the code drive, never under the C: temp folder.
const scratch = fs.mkdtempSync('D:/claude-scratch/statusline/unit-');
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const ALL = ['model', 'context', 'fiveHour', 'weekly', 'cost', 'branch', 'folder'];

// The JSON Claude Code passes on stdin, trimmed to what the docs list for these fields.
const INPUT = {
  model: { id: 'claude-opus-4-1', display_name: 'Opus' },
  workspace: { current_dir: '/work/my-repo' },
  cost: { total_cost_usd: 1.234 },
  context_window: { used_percentage: 41.6 },
  rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } },
  worktree: { branch: 'worktree-my-feature' },
};

function run(script: string, input: unknown, env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('node', [script], { env: { ...process.env, ...env }, encoding: 'utf8' }, (err, out) => (err ? reject(err) : resolve(out)));
    child.stdin?.end(JSON.stringify(input));
  });
}

test('the generated script prints the line the preview shows, for a sample status line input', async () => {
  const file = path.join(scratch, 'all', SCRIPT_NAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buildScript(ALL));
  const out = await run(file, INPUT);
  assert.equal(out, 'Opus | ctx 42% | 5h 24% | wk 41% | $1.23 | worktree-my-feature | my-repo');
  assert.equal(out, statuslineText(ALL, INPUT, 'worktree-my-feature'));
});

test('the script keeps the order of the fields and leaves out the ones that are off', async () => {
  const file = path.join(scratch, 'order', SCRIPT_NAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buildScript(['cost', 'model', 'folder']));
  assert.equal(await run(file, INPUT), '$1.23 | Opus | my-repo');
});

test('the script reads the git branch of the folder when the session is not in a worktree', async () => {
  const repo = path.join(scratch, 'git-repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'trunk', repo]);
  const file = path.join(scratch, 'git', SCRIPT_NAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buildScript(['branch', 'folder']));
  assert.equal(await run(file, { workspace: { current_dir: repo.replace(/\\/g, '/') } }), 'trunk | git-repo');
});

test('without rate_limits in the input the script asks the usage endpoint like quota.ts and keeps the answer', async () => {
  let hits = 0;
  let seen: http.IncomingHttpHeaders = {};
  const server = http.createServer((req, res) => {
    hits++;
    seen = req.headers;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ limits: [{ kind: 'session', percent: 12.4 }, { kind: 'weekly_all', percent: 60 }] }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const home = path.join(scratch, 'claude-home');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: Date.now() + 3600_000 } }));
    const file = path.join(scratch, 'usage', SCRIPT_NAME);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buildScript(['fiveHour', 'weekly']));
    const env = { CLAUDE_CONFIG_DIR: home, HARNESS_STATUSLINE_USAGE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}/usage` };
    const noLimits = { model: { display_name: 'Opus' } };
    assert.equal(await run(file, noLimits, env), '5h 12% | wk 60%');
    assert.equal(seen.authorization, 'Bearer tok');
    assert.match(String(seen['user-agent']), /^claude-code\//);
    // The second line is served from the cache beside the script.
    assert.equal(await run(file, noLimits, env), '5h 12% | wk 60%');
    assert.equal(hits, 1);
    // A limit Claude Code does send wins and the endpoint is not asked.
    assert.equal(await run(file, INPUT, env), '5h 24% | wk 41%');
  } finally {
    server.close();
  }
});

test('the fields are read back from the script that was written', () => {
  assert.deepEqual(fieldsOfScript(buildScript(['cost', 'model'])), ['cost', 'model']);
  assert.deepEqual(fieldsOfScript('console.log(1)'), []);
});

const roots = (name: string) => {
  const base = path.join(scratch, name);
  fs.mkdirSync(path.join(base, 'user'), { recursive: true });
  fs.mkdirSync(path.join(base, 'repo'), { recursive: true });
  return { userRoot: path.join(base, 'user'), projectDir: path.join(base, 'repo') };
};

test('Save keeps the rest of the settings file and Remove puts back the statusLine that was there before', () => {
  const r = roots('roundtrip');
  const file = path.join(r.userRoot, 'settings.json');
  const before = '{\r\n  // my model\r\n  "model": "opus",\r\n  "statusLine": { "type": "command", "command": "echo mine" },\r\n  "env": { "A": "1" }\r\n}\r\n';
  fs.writeFileSync(file, before);
  const saved = saveStatusline('user', ['model', 'cost'], r);
  assert.equal(saved.installed, true);
  assert.deepEqual(saved.fields, ['model', 'cost']);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /\/\/ my model/);
  assert.match(text, /"env": \{ "A": "1" \}/);
  assert.match(text, new RegExp(`"command": "node \\\\"[^"]*${SCRIPT_NAME.replace('.', '\\.')}\\\\""`));
  assert.ok(!text.replace(/\r\n/g, '').includes('\n'), 'line endings stay CRLF');
  const removed = removeStatusline('user', r);
  assert.equal(removed.installed, false);
  const after = fs.readFileSync(file, 'utf8');
  assert.deepEqual(JSON.parse(after.replace(/\/\/.*\r\n/, '')).statusLine, { type: 'command', command: 'echo mine' });
  assert.match(after, /\/\/ my model\r\n  "model": "opus",/);
  assert.match(after, /"env": \{ "A": "1" \}\r\n\}\r\n$/);
  assert.ok(!fs.existsSync(path.join(r.userRoot, SCRIPT_NAME)));
});

test('saving twice keeps the first value for Remove, and with none before, Remove deletes the key', () => {
  const r = roots('twice');
  const file = path.join(r.projectDir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{\n  "model": "sonnet",\n  "statusLine": { "type": "command", "command": "echo mine" }\n}\n');
  saveStatusline('project', ['model'], r);
  saveStatusline('project', ['model', 'folder'], r);
  assert.deepEqual(readStatusline('project', r).fields, ['model', 'folder']);
  removeStatusline('project', r);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).statusLine, { type: 'command', command: 'echo mine' });

  const r2 = roots('none');
  saveStatusline('user', ['model'], r2);
  removeStatusline('user', r2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(r2.userRoot, 'settings.json'), 'utf8')).statusLine, undefined);
});

test('Remove leaves a status line the owner set after the builder wrote its own', () => {
  const r = roots('theirs');
  saveStatusline('user', ['model'], r);
  const file = path.join(r.userRoot, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ statusLine: { type: 'command', command: 'echo theirs' } }));
  removeStatusline('user', r);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).statusLine.command, 'echo theirs');
});

test('the project scope is unavailable without a folder', () => {
  assert.equal(readStatusline('project', { userRoot: scratch }).available, false);
});
