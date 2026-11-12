import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { PERMISSION_MODES, applyPermissionsChange, permissionsWrite, readPermissions, rulePattern, scanPrompted, writePermissionsChange } from '../../src/permissions';

const tmp = (what: string) => fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), `permissions-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
process.env.CLAUDE_HARNESS_MANAGED_SETTINGS = path.join(tmp('managed'), 'managed-settings.json');

test('the modes are the six Claude Code accepts, auto among them', () => {
  assert.deepEqual(PERMISSION_MODES.map(m => m.id).sort(), ['acceptEdits', 'auto', 'bypassPermissions', 'default', 'dontAsk', 'plan']);
});

test('reading collects the rules of the user, project and local files, and the managed file only when it exists', () => {
  const root = tmp('read');
  const repo = tmp('repo');
  write(root, 'settings.json', JSON.stringify({ permissions: { allow: ['Bash(npm test *)'], deny: ['Read(.env)'], defaultMode: 'auto', additionalDirectories: ['../shared'] }, model: 'opus' }));
  write(repo, '.claude/settings.json', '{ // shared\n  "permissions": { "ask": ["Bash(git push *)"] } }');
  const data = readPermissions(root, repo);
  assert.deepEqual(data.files.map(f => f.scope), ['user', 'project', 'local']);
  const [user, project, local] = data.files;
  assert.deepEqual(user.allow, ['Bash(npm test *)']);
  assert.equal(user.defaultMode, 'auto');
  assert.deepEqual(user.additionalDirectories, ['../shared']);
  assert.deepEqual(project.ask, ['Bash(git push *)']);
  assert.equal(local.exists, false);
  fs.writeFileSync(process.env.CLAUDE_HARNESS_MANAGED_SETTINGS!, JSON.stringify({ permissions: { deny: ['WebFetch'] } }));
  const withManaged = readPermissions(root, repo).files.at(-1)!;
  assert.equal(withManaged.scope, 'managed');
  assert.equal(withManaged.readOnly, true);
  assert.deepEqual(withManaged.deny, ['WebFetch']);
  fs.rmSync(process.env.CLAUDE_HARNESS_MANAGED_SETTINGS!);
});

test('a change keeps every other key, the comments and the line endings', () => {
  const text = '{\r\n  // keep me\r\n  "model": "opus",\r\n  "permissions": {\r\n    "allow": ["Read"]\r\n  }\r\n}\r\n';
  const added = applyPermissionsChange(text, { op: 'add', list: 'allow', value: 'Bash(git status *)' });
  assert.ok(added.includes('// keep me') && added.includes('"model": "opus"'));
  assert.ok(!/[^\r]\n/.test(added), 'every line ends with CRLF');
  assert.deepEqual(JSON.parse(added.replace(/\/\/.*\r\n/, '')).permissions.allow, ['Read', 'Bash(git status *)']);
  const removed = applyPermissionsChange(added, { op: 'remove', list: 'allow', value: 'Read' });
  assert.deepEqual(JSON.parse(removed.replace(/\/\/.*\r\n/, '')).permissions.allow, ['Bash(git status *)']);
});

test('adding twice adds once, a missing block is created, and the mode can be set and cleared', () => {
  let text = '{"theme":"dark"}';
  text = applyPermissionsChange(text, { op: 'add', list: 'deny', value: 'Read(.env)' });
  text = applyPermissionsChange(text, { op: 'add', list: 'deny', value: 'Read(.env)' });
  text = applyPermissionsChange(text, { op: 'mode', value: 'plan' });
  let json = JSON.parse(text);
  assert.deepEqual(json.permissions.deny, ['Read(.env)']);
  assert.equal(json.permissions.defaultMode, 'plan');
  assert.equal(json.theme, 'dark');
  text = applyPermissionsChange(text, { op: 'mode', value: '' });
  json = JSON.parse(text);
  assert.equal('defaultMode' in json.permissions, false);
});

test('a file that is not JSON is refused, not rewritten', () => {
  assert.throws(() => applyPermissionsChange('not json at all', { op: 'add', list: 'allow', value: 'Read' }), /not valid JSON/);
});

test('a write creates the file and its folder', () => {
  const repo = tmp('create');
  const file = path.join(repo, '.claude', 'settings.local.json');
  writePermissionsChange(file, { op: 'add', list: 'allow', value: 'Bash(ls *)' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).permissions.allow, ['Bash(ls *)']);
});

test('permissionsWrite writes only after the card is confirmed', async () => {
  const root = tmp('confirm');
  write(root, 'settings.json', '{"permissions":{"allow":["Read"]}}');
  const change = { op: 'add' as const, list: 'allow' as const, value: 'Bash(git log *)' };
  let card: any;
  const cancelled = await permissionsWrite(root, { scope: 'user', change }, c => ((card = c), Promise.resolve('cancel')));
  assert.deepEqual(cancelled.files[0].allow, ['Read']);
  assert.match(card.facts.join(' '), /Bash\(git log \*\)/);
  const done = await permissionsWrite(root, { scope: 'user', change }, () => Promise.resolve('ok'));
  assert.deepEqual(done.files[0].allow, ['Read', 'Bash(git log *)']);
  const noRepo = await permissionsWrite(root, { scope: 'project', change }, () => Promise.resolve('ok'));
  assert.match(noRepo.note ?? '', /repository/);
});

test('a rule pattern names the program and its verb, a domain, or the tool', () => {
  assert.equal(rulePattern('Bash', { command: 'git push --force origin main' }), 'Bash(git push *)');
  assert.equal(rulePattern('Bash', { command: 'cd /x && npm test 2>&1 | tail -3' }), 'Bash(npm test *)');
  assert.equal(rulePattern('Bash', { command: 'rm -rf build' }), 'Bash(rm *)');
  assert.equal(rulePattern('Bash', { command: 'git -C x status' }), 'Bash(git *)');
  assert.equal(rulePattern('WebFetch', { url: 'https://docs.example.com/a/b' }), 'WebFetch(domain:docs.example.com)');
  assert.equal(rulePattern('Edit', { file_path: '/a/b' }), 'Edit');
  assert.equal(rulePattern('mcp__srv__tool', {}), 'mcp__srv__tool');
});

const use = (id: string, name: string, input: unknown) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id: string, source: string, text = 'ok', extra: object = {}, at = new Date()) => JSON.stringify({ type: 'user', timestamp: at.toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: source === 'user_reject' }] }, permissionDecision: { decision: source === 'user_reject' ? 'reject' : 'accept', source }, ...extra });

test('Prompted in counts the tool uses the user was asked about, per rule pattern, inside the period', async () => {
  const root = tmp('scan');
  const day = 86400_000;
  write(
    root,
    'projects/p1/a.jsonl',
    [
      use('toolu_1', 'Bash', { command: 'git push origin main' }),
      result('toolu_1', 'user_temporary'),
      use('toolu_2', 'Bash', { command: 'git push --force' }),
      result('toolu_2', 'user_reject', 'The user doesn\'t want to proceed'),
      use('toolu_3', 'Bash', { command: 'ls' }),
      result('toolu_3', 'config'),
      use('toolu_4', 'WebFetch', { url: 'https://example.com/x' }),
      result('toolu_4', 'user_permanent'),
      // The same record repeated as an API blob is not a second prompt.
      JSON.stringify({ type: 'api-request-blob', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: "Claude requested permissions to use Bash, but you haven't granted it yet.", is_error: true }] } }),
      use('toolu_5', 'Bash', { command: 'npm test' }),
      result('toolu_5', 'user_temporary', 'ok', {}, new Date(Date.now() - 40 * day)),
    ].join('\n') + '\n'
  );
  const week = await scanPrompted(root, 7);
  assert.deepEqual(week.rows.map(r => [r.pattern, r.count]).sort(), [['Bash(git push *)', 2], ['WebFetch(domain:example.com)', 1]]);
  const push = week.rows.find(r => r.pattern === 'Bash(git push *)')!;
  assert.deepEqual([push.once, push.always, push.denied], [1, 0, 1]);
  assert.equal(week.sessions, 1);
  const all = await scanPrompted(root, 0);
  assert.equal(all.rows.find(r => r.pattern === 'Bash(npm test *)')?.count, 1);
});
