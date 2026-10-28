import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { Io, Stop, parse } from '../../src/cli-core';
import { modsCommand } from '../../src/cli-mods';
import { projectSlug } from '../../src/fleet';

const NOW = Date.now();
/** A timestamp this many minutes before now. */
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60000).toISOString();
const SID = '11111111-2222-3333-4444-555555555555';
const SID2 = '66666666-7777-8888-9999-000000000000';

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-mods-'));
  const root = path.join(tmp, '.claude');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const folder = path.join(root, 'projects', projectSlug(repo));
  const write = (file: string, records: unknown[]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  };
  const writeJson = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  };
  const base = { cwd: repo, gitBranch: 'main', entrypoint: 'cli', version: '2.1.304' };

  // A plugin with an events manifest and a log for the session: one allowed step, one denial.
  const plugin = path.join(tmp, 'write-gate');
  writeJson(path.join(plugin, '.claude-plugin', 'harness-events.json'), { label: 'Write gate', events: '{sessionDir}/write-gate-events.jsonl' });
  writeJson(path.join(root, 'plugins', 'installed_plugins.json'), { plugins: { 'write-gate@claude-harness': [{ installPath: plugin, lastUpdated: '2026-10-28' }] } });
  write(path.join(folder, SID, 'write-gate-events.jsonl'), [
    { at: at(40), hook: 'PreToolUse', text: 'Let an edit to src/a.ts through.', label: 'output', tone: 'quiet' },
    { at: at(30), hook: 'PreToolUse', text: 'Blocked an edit to a generated file.', label: 'denied', tone: 'warn', detail: 'generated/schema.ts is written by the build.' },
  ]);

  // The main transcript: a named context hook, a named hold, an unnamed allowed hook, and a native denial of an Agent call.
  write(path.join(folder, `${SID}.jsonl`), [
    { ...base, sessionId: SID, type: 'user', uuid: 'u1', timestamp: at(120), message: { role: 'user', content: 'edit the schema' } },
    {
      ...base,
      sessionId: SID,
      type: 'assistant',
      timestamp: at(118),
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          { type: 'tool_use', id: 'toolu_w1', name: 'Write', input: { file_path: 'src/b.ts' } },
          { type: 'tool_use', id: 'toolu_a1', name: 'Agent', input: { subagent_type: 'wpf-expert', description: 'Build', prompt: 'Build it' } },
        ],
      },
    },
    { ...base, sessionId: SID, type: 'attachment', timestamp: at(119), attachment: { type: 'hook_additional_context', hookName: 'intent-guard', hookEvent: 'UserPromptSubmit', content: 'intent-guard: Added the owner words to the prompt.' } },
    { ...base, sessionId: SID, type: 'attachment', timestamp: at(117), attachment: { type: 'hook_success', hookName: 'harness-guard', hookEvent: 'PreToolUse', toolUseID: 'toolu_w1', content: '', stdout: '' } },
    { ...base, sessionId: SID, type: 'attachment', timestamp: at(20), attachment: { type: 'hook_blocking_error', hookName: 'brief-check', hookEvent: 'PreToolUse', toolUseID: 'toolu_w1', blockingError: 'brief-check: The brief lacks the owner words.' } },
    {
      ...base,
      sessionId: SID,
      type: 'user',
      timestamp: at(10),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a1', is_error: true, content: 'PreToolUse:Agent hook error: Only fact-gatherer may read the repo.' }] },
    },
  ]);

  // An earlier session with no hooks at all.
  write(path.join(folder, `${SID2}.jsonl`), [{ ...base, sessionId: SID2, type: 'user', uuid: 'v1', timestamp: at(600), message: { role: 'user', content: 'an earlier prompt' } }]);
  // The list orders sessions by their last write, so the earlier session is made older than the fixture's.
  const older = new Date(NOW - 600 * 60000);
  fs.utimesSync(path.join(folder, `${SID2}.jsonl`), older, older);
  return { tmp, root, repo };
}

function capture(): Io & { text: () => string } {
  const out: string[] = [];
  return { out: t => out.push(t), err: t => out.push(t), text: () => out.join('\n') };
}

test('mods --json counts what each mod decided in the session, with its plugin', async () => {
  const { root, repo } = fixture();
  const io = capture();
  assert.equal(await modsCommand(parse(['mods', '--session', 'latest', '--repo', repo, '--root', root, '--json']), io), 0);
  const json = JSON.parse(io.text());
  assert.equal(json.applied, false);
  assert.equal(json.session, SID);
  const mods = Object.fromEntries(json.mods.map((m: { name: string }) => [m.name, m]));
  assert.equal(mods['Write gate'].plugin, 'write-gate');
  assert.equal(mods['Write gate'].events, 2);
  assert.equal(mods['Write gate'].allowed, 1);
  assert.equal(mods['Write gate'].denied, 1);
  assert.equal(mods['intent-guard'].context, 1);
  assert.equal(mods['intent-guard'].plugin, 'intent-guard');
  assert.equal(mods['brief-check'].held, 1);
  assert.equal(mods.Hooks.allowed, 1);
  assert.equal(mods.Hooks.denied, 1);
});

test('mods --json lists the denials and holds in time order with their reason', async () => {
  const { root, repo } = fixture();
  const io = capture();
  assert.equal(await modsCommand(parse(['mods', '--session', SID, '--repo', repo, '--root', root, '--json']), io), 0);
  const json = JSON.parse(io.text());
  assert.deepEqual(
    json.denials.map((d: { mod: string; decision: string }) => [d.mod, d.decision]),
    [
      ['Write gate', 'denied'],
      ['brief-check', 'held'],
      ['Hooks', 'denied'],
    ]
  );
  assert.equal(json.denials[0].reason, 'generated/schema.ts is written by the build.');
  assert.equal(json.denials[1].reason, 'brief-check: The brief lacks the owner words.');
  assert.equal(json.denials[2].hook, 'PreToolUse:Agent');
  assert.equal(json.denials[2].reason, 'Only fact-gatherer may read the repo.');
});

test('mods text output is a headline, the mod table and the denials table', async () => {
  const { root, repo } = fixture();
  const io = capture();
  assert.equal(await modsCommand(parse(['mods', '--session', 'latest', '--repo', repo, '--root', root]), io), 0);
  const lines = io.text().split('\n');
  assert.match(lines[0], /^\*\*Mods · 11111111 · 4 acted · 3 denied or held\*\*$/);
  assert.ok(lines.some(l => /^\| Mod +\| Plugin +\| Events \| Allowed \| Denied \| Held \| Context \| Failed \| Other \| Last +\|$/.test(l)), io.text());
  assert.ok(lines.some(l => /^\| Write gate +\| write-gate +\| +2 \| +1 \| +1 \|/.test(l)), io.text());
  assert.ok(lines.some(l => /^\| When +\| Mod +\| Decision \| Hook +\| Reason +\|$/.test(l)), io.text());
  assert.ok(lines.some(l => /\| Denied +\| PreToolUse:Agent \| Only fact-gatherer may read the repo\. +\|$/.test(l)), io.text());
});

test('mods for a session with no hooks shows (none) rows', async () => {
  const { root, repo } = fixture();
  const io = capture();
  assert.equal(await modsCommand(parse(['mods', '--session', SID2, '--repo', repo, '--root', root, '--json']), io), 0);
  const json = JSON.parse(io.text());
  assert.deepEqual(json.mods, []);
  assert.deepEqual(json.denials, []);
  assert.equal(await modsCommand(parse(['mods', '--session', SID2, '--repo', repo, '--root', root]), io), 0);
  assert.ok(io.text().includes('| (none) |'), io.text());
});

test('mods rejects a missing session with exit 2 and an unknown one with exit 1', async () => {
  const { root, repo } = fixture();
  await assert.rejects(modsCommand(parse(['mods', '--repo', repo, '--root', root]), capture()), (e: unknown) => e instanceof Stop && e.code === 2);
  await assert.rejects(modsCommand(parse(['mods', '--session', 'no-such-id', '--repo', repo, '--root', root]), capture()), (e: unknown) => e instanceof Stop && e.code === 1);
});
