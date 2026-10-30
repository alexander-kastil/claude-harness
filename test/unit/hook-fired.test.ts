import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { projectSlug } from '../../src/repos-overview';
import type { Asset, ScopeView } from '../../src/harness';
import { IndexData, USAGE_VERSION, UsageIndex } from '../../src/usage';
import type { FileEntry } from '../../src/usage';
import { hookRows, hookTarget, runsScript } from '../../src/usage-hooks';
import { usageRows } from '../../src/usage-rows';
import { ScanState, scanLines } from '../../src/usage-scan';

const line = (r: unknown) => `${JSON.stringify(r)}\n`;
const at = (hms: string) => `2026-10-20T${hms}.000Z`;
const ms = (hms: string) => Date.parse(at(hms));
const fresh = (main = true): ScanState => ({ hits: [], offset: 0, parsed: 0, main });

const run = (hms: string, hookName: string, command: string, extra: Record<string, unknown> = {}, type = 'hook_success') => ({
  type: 'attachment',
  timestamp: at(hms),
  attachment: { type, hookName, hookEvent: hookName.split(':')[0], command, durationMs: 100, exitCode: 0, stdout: '', ...extra },
});

const GUARD = 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh"';
const LINT = 'bash .claude/hooks/lint.sh';

test('a scan counts hook runs per hook and command, never one entry per run, and keeps the failures and the time', () => {
  const s = fresh();
  const records = [
    run('10:00:00', 'PostToolUse:Edit', GUARD, { durationMs: 100 }),
    run('10:00:01', 'PostToolUse:Edit', GUARD, { durationMs: 300 }),
    run('10:00:02', 'PostToolUse:Edit', GUARD, { exitCode: 1, durationMs: 200 }, 'hook_non_blocking_error'),
    run('10:00:03', 'PostToolUse:Write', GUARD, { durationMs: 50 }),
    // A blocking error names its command inside blockingError and has no duration.
    { type: 'attachment', timestamp: at('10:00:04'), attachment: { type: 'hook_blocking_error', hookName: 'PostToolUse:Edit', hookEvent: 'PostToolUse', blockingError: { command: GUARD, blockingError: 'no' } } },
    // Not runs: a hook's added context, and a line that only mentions the type.
    { type: 'attachment', timestamp: at('10:00:05'), attachment: { type: 'hook_additional_context', hookName: 'PostToolUse:Edit', content: 'x' } },
    { type: 'assistant', timestamp: at('10:00:06'), message: { content: [{ type: 'text', text: '"attachment":{"type":"hook_success"' }] } },
  ];
  scanLines(Buffer.from(records.map(line).join('')), 0, s);
  const edit = s.hooks?.find(h => h.hook === 'PostToolUse:Edit');
  assert.deepEqual(edit, { hook: 'PostToolUse:Edit', command: GUARD, runs: 4, failed: 2, ms: 600, timed: 3, exit: 1, last: ms('10:00:04') });
  assert.equal(s.hooks?.length, 2, 'one entry for each hook name and command');
  assert.equal(s.hooks?.find(h => h.hook === 'PostToolUse:Write')?.runs, 1);
});

test('a hook count goes on from an earlier scan of the same file', () => {
  const s = fresh();
  scanLines(Buffer.from(line(run('10:00:00', 'Stop', LINT))), 0, s);
  scanLines(Buffer.from(line(run('10:01:00', 'Stop', LINT, { exitCode: 2 }, 'hook_non_blocking_error'))), 100, s);
  assert.deepEqual(s.hooks?.map(h => [h.runs, h.failed, h.exit]), [[2, 1, 2]]);
});

test('denied tool calls are counted in an agent transcript only, once per record', () => {
  const denial = (id: string) => ({
    type: 'user',
    timestamp: at('10:00:00'),
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: '<tool_use_error>delegation: do not read on the main thread</tool_use_error>' }] },
  });
  const plain = { type: 'user', timestamp: at('10:00:01'), message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: 'File not found' }] } };
  const native = { type: 'user', timestamp: at('10:00:02'), message: { content: [{ type: 'tool_result', tool_use_id: 'y', is_error: true, content: 'PreToolUse:Write hook error: [bash x.sh]: blocked' }] } };
  const text = [denial('a'), plain, native, denial('b')].map(line).join('');
  const agent = fresh(false);
  scanLines(Buffer.from(text), 0, agent);
  assert.equal(agent.denied, 3);
  const main = fresh(true);
  scanLines(Buffer.from(text), 0, main);
  assert.equal(main.denied, undefined);
});

test('a script is run by a command that names it inside a hooks folder, not by a longer name', () => {
  assert.equal(runsScript('bash "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh"', 'guard.sh'), true);
  assert.equal(runsScript('bash ~\\.claude\\hooks\\GUARD.sh --fast', 'guard.sh'), true);
  assert.equal(runsScript('bash .claude/hooks/guard.sh.bak', 'guard.sh'), false);
  assert.equal(runsScript('bash .claude/hooks/sub/guard.sh', 'guard.sh'), false);
  assert.equal(runsScript('bash .claude/hooks/sub/guard.sh', 'sub/guard.sh'), true);
});

const entry = (over: Partial<FileEntry> = {}): FileEntry => ({ size: 1, mtime: 1, ino: 0, birth: 0, offset: 1, hits: [], ...over });
const stat = (hook: string, command: string | undefined, runs: number, failed: number, msTotal: number, last: string, exit?: number) => ({
  hook,
  ...(command ? { command } : {}),
  runs,
  failed,
  ms: msTotal,
  timed: runs,
  ...(exit !== undefined ? { exit } : {}),
  last: ms(last),
});

test('hook rows match a run by command first, then by event and matcher, and count a session once with its subagents', () => {
  const tmp = path.join(os.tmpdir(), 'harness-fired');
  const projects = path.join(tmp, '.claude', 'projects');
  const a = path.join(tmp, 'a');
  const b = path.join(tmp, 'b');
  const mainA = path.join(projects, projectSlug(a), 'aaaaaaaa-1111-2222-3333-444444444444.jsonl');
  const mainB = path.join(projects, projectSlug(b), 'bbbbbbbb-1111-2222-3333-444444444444.jsonl');
  const files: Record<string, FileEntry> = {
    [mainA]: entry({ cwd: a, title: 'in a', hooks: [stat('PostToolUse:Edit', GUARD, 4, 1, 400, '10:00:00', 1), stat('Stop', LINT, 2, 0, 20, '10:05:00')] }),
    // The agent transcript of session a adds to the same row.
    [path.join(projects, projectSlug(a), 'aaaaaaaa-1111-2222-3333-444444444444', 'subagents', 'agent-1.jsonl')]: entry({ main: mainA, hooks: [stat('PostToolUse:Edit', GUARD, 2, 0, 600, '10:30:00')] }),
    [mainB]: entry({ cwd: b, title: 'in b', hooks: [stat('PostToolUse:Write', GUARD, 1, 0, 100, '09:00:00'), stat('PostToolUse:Edit', undefined, 3, 3, 0, '11:00:00', 127)] }),
  };
  const data: IndexData = { version: USAGE_VERSION, files };
  const repos = [
    { id: 'repo:a', label: 'a', path: a },
    { id: 'repo:b', label: 'b', path: b },
  ];
  const declared = [
    { event: 'PostToolUse', matcher: 'Edit|Write', command: GUARD },
    { event: 'PostToolUse', matcher: 'Edit', command: 'bash other.sh' },
    { event: 'Stop', matcher: '', command: LINT },
  ];
  const rows = hookRows(data, { declared, mine: new Set([0]) }, repos, []);
  assert.deepEqual(
    rows.map(r => [r.title, r.fired]),
    [
      // b: the guard ran once on Write; the run without a command belongs to every PostToolUse hook whose matcher takes Edit.
      ['in b', { runs: 4, failed: 3, avgMs: 25, exit: 127 }],
      // a: 4 + 2 runs by command, one session, the time averaged over all six.
      ['in a', { runs: 6, failed: 1, avgMs: 167, exit: 1 }],
    ]
  );
  assert.equal(rows[0].last, ms('11:00:00'));
  assert.equal(rows[1].last, ms('10:30:00'));
  assert.equal(rows[1].scope, 'repo:a');
  // The other command only takes the run that names no command; the Stop hook takes only its own.
  assert.deepEqual(hookRows(data, { declared, mine: new Set([1]) }, repos, []).map(r => [r.title, r.fired?.runs]), [['in b', 3]]);
  assert.deepEqual(hookRows(data, { declared, mine: new Set([2]) }, repos, []).map(r => [r.title, r.fired?.runs]), [['in a', 2]]);
  // A hook declared in repo a counts the sessions inside a only; no declared hook, no row.
  assert.deepEqual(hookRows(data, { declared, mine: new Set([0]), inside: a }, repos, []).map(r => r.title), ['in a']);
  assert.deepEqual(hookRows(data, { declared, mine: new Set() }, repos, []), []);
});

test('a failed run of a command no declared hook has is not handed to a settings hook of the same event and matcher', () => {
  const tmp = path.join(os.tmpdir(), 'harness-fired-foreign');
  const a = path.join(tmp, 'a');
  const main = path.join(tmp, '.claude', 'projects', projectSlug(a), 'aaaaaaaa-1111-2222-3333-444444444444.jsonl');
  const data: IndexData = {
    version: USAGE_VERSION,
    files: { [main]: entry({ cwd: a, title: 'in a', hooks: [stat('PreToolUse:Bash', GUARD, 2, 0, 20, '10:00:00'), stat('PreToolUse:Bash', 'node plugin-guard.js', 3, 3, 30, '10:01:00', 2)] }) },
  };
  const declared = [{ event: 'PreToolUse', matcher: 'Bash', command: GUARD }];
  const rows = hookRows(data, { declared, mine: new Set([0]) }, [{ id: 'repo:a', label: 'a', path: a }], []);
  assert.deepEqual(rows.map(r => r.fired), [{ runs: 2, failed: 0, avgMs: 10 }]);
});

test('a hook page and a hook script page read the hooks of the settings files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fired-settings-'));
  const settings = path.join(tmp, 'settings.json');
  fs.writeFileSync(
    settings,
    JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: GUARD }, { type: 'command', command: 'bash x.sh' }] }], Stop: [{ hooks: [{ type: 'command', command: LINT }] }] } })
  );
  const asset = (kind: Asset['kind'], id: string, name: string, over: Partial<Asset> = {}): Asset => ({ id, scope: 'global', kind, name, description: '', file: settings, mtime: 1, ...over });
  const hooks = [asset('hook', 'PostToolUse:0', 'PostToolUse · Edit', { jsonPath: ['hooks', 'PostToolUse', 0] }), asset('hook', 'Stop:0', 'Stop', { jsonPath: ['hooks', 'Stop', 0] })];
  const script = asset('hookScript', 'hs', 'guard.sh', { file: path.join(tmp, 'hooks', 'guard.sh') });
  const views = [{ id: 'global', label: 'Global', path: tmp, local: false, categories: [{ kind: 'hook', items: hooks }] }] as unknown as ScopeView[];
  const first = hookTarget(hooks[0], views);
  assert.deepEqual(first?.declared, [
    { event: 'PostToolUse', matcher: 'Edit', command: GUARD },
    { event: 'PostToolUse', matcher: 'Edit', command: 'bash x.sh' },
    { event: 'Stop', matcher: '', command: LINT },
  ]);
  assert.deepEqual([...(first?.mine ?? [])], [0, 1]);
  assert.equal(first?.inside, undefined);
  assert.deepEqual([...(hookTarget(hooks[1], views)?.mine ?? [])], [2]);
  // The script page counts the hooks whose command runs the file.
  assert.deepEqual([...(hookTarget(script, views)?.mine ?? [])], [0]);
  assert.equal(hookTarget(asset('agent', 'x', 'x'), views), undefined);
});

test('an agent row shows what hooks and mods did in that agent\'s own transcripts of the session', () => {
  const tmp = path.join(os.tmpdir(), 'harness-agent-hooks');
  const projects = path.join(tmp, '.claude', 'projects');
  const main = path.join(projects, 'a', 'aaaaaaaa-1111-2222-3333-444444444444.jsonl');
  const other = path.join(projects, 'a', 'bbbbbbbb-1111-2222-3333-444444444444.jsonl');
  const sub = (id: string, over: Partial<FileEntry>) => path.join(projects, 'a', id, 'subagents', `agent-${over.agent}-${over.denied}.jsonl`);
  const entries: [string, FileEntry][] = [
    [main, entry({ cwd: tmp, title: 'one', hits: [{ kind: 'agent', name: 'worker', key: 'k1', at: ms('10:00:00') }] })],
    [other, entry({ cwd: tmp, title: 'two', hits: [{ kind: 'agent', name: 'worker', key: 'k2', at: ms('11:00:00') }] })],
  ];
  const own = [
    { main, agent: 'worker', denied: 2, hooks: [stat('PreToolUse:Bash', LINT, 3, 1, 30, '10:01:00', 1)] },
    { main, agent: 'worker', denied: 1 },
    // Another agent type in the same session is not this agent's.
    { main, agent: 'helper', denied: 9 },
  ].map(o => [sub('x', o), entry(o)] as [string, FileEntry]);
  const data: IndexData = { version: USAGE_VERSION, files: Object.fromEntries([...entries, ...own]) };
  const rows = usageRows(data, { kind: 'agent', name: 'worker', outside: [] }, [], []);
  assert.deepEqual(
    rows.map(r => [r.title, r.hooks]),
    [
      ['two', undefined],
      ['one', { denied: 3, failed: 1 }],
    ]
  );
  // A skill row carries no hook column.
  assert.equal(usageRows(data, { kind: 'skill', name: 'worker', outside: [] }, [], []).every(r => r.hooks === undefined), true);
});

test('the index keeps the hook counts and the agent type, and an append adds to them', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fired-index-'));
  const root = path.join(tmp, '.claude');
  const folder = path.join(root, 'projects', 'slug');
  const id = '11111111-2222-3333-4444-555555555555';
  const sub = path.join(folder, id, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const mainFile = path.join(folder, `${id}.jsonl`);
  const subFile = path.join(sub, 'agent-aa.jsonl');
  fs.writeFileSync(mainFile, line(run('10:00:00', 'Stop', LINT)) + line(run('10:00:01', 'Stop', LINT)));
  fs.writeFileSync(subFile, line(run('10:00:02', 'Stop', LINT)));
  fs.writeFileSync(path.join(sub, 'agent-aa.meta.json'), JSON.stringify({ agentType: 'worker', customAgentType: 'plug:worker' }));
  const index = new UsageIndex(path.join(tmp, 'index.json'));
  const first = await index.refresh([root]);
  assert.equal(first.files[mainFile].hooks?.[0].runs, 2);
  assert.equal(first.files[subFile].agent, 'plug:worker');
  assert.equal(first.files[subFile].hooks?.[0].runs, 1);
  assert.equal(first.files[mainFile].agent, undefined);
  // The file grows: only the new record is read, and the total moves.
  fs.appendFileSync(mainFile, line(run('10:05:00', 'Stop', LINT, { exitCode: 3 }, 'hook_non_blocking_error')));
  const second = await new UsageIndex(path.join(tmp, 'index.json')).refresh([root]);
  assert.deepEqual(second.files[mainFile].hooks?.map(h => [h.runs, h.failed, h.exit]), [[3, 1, 3]]);
  // It was written out, so a new index object starts from it.
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'index.json'), 'utf8')).files[mainFile].hooks[0].runs, 3);
});
