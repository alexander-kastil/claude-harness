import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { projectSlug } from '../../src/repos-overview';
import type { Asset, ScopeView } from '../../src/harness';
import { FileEntry, IndexData, USAGE_VERSION, UsageIndex, planOf } from '../../src/usage';
import { usageMore, usageRows, usageTarget, usageTotals } from '../../src/usage-rows';
import { Hit, ScanState, hitsOf, listTranscripts, scanFile, scanLines } from '../../src/usage-scan';

const at = (hms: string) => `2026-10-20T${hms}.000Z`;
const ms = (hms: string) => Date.parse(at(hms));
const line = (r: unknown) => `${JSON.stringify(r)}\n`;

const sid = '11111111-2222-3333-4444-555555555555';

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-usage-'));
  const root = path.join(tmp, '.claude');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const folder = path.join(root, 'projects', projectSlug(repo));
  fs.mkdirSync(folder, { recursive: true });
  const base = { cwd: repo, sessionId: sid, isSidechain: false };
  const tool = (hms: string, id: string, name: string, input: unknown) => ({ ...base, type: 'assistant', uuid: `r-${id}`, timestamp: at(hms), message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
  const records = [
    { type: 'permission-mode', permissionMode: 'default', sessionId: sid },
    { ...base, type: 'user', uuid: 'u1', timestamp: at('10:00:00'), message: { role: 'user', content: 'build the thing' } },
    tool('10:00:05', 'toolu_1', 'Agent', { subagent_type: 'fact-gatherer', description: 'Find facts', prompt: 'Read only' }),
    tool('10:00:06', 'toolu_2', 'Agent', { description: 'No type', prompt: 'x' }),
    tool('10:00:07', 'toolu_3', 'Task', { subagent_type: 'Explore', description: 'Old name', prompt: 'x' }),
    tool('10:00:08', 'toolu_4', 'Skill', { skill: 'vscode-extension' }),
    tool('10:00:09', 'toolu_5', 'Skill', { skill: 'learn-loop-plugin:claude-learn' }),
    tool('10:00:10', 'toolu_6', 'Agent', { subagent_type: 'subagent-delegation-plugin:fact-gatherer', prompt: 'x' }),
    tool('10:00:11', 'toolu_7', 'Read', { file_path: 'a.txt' }),
    { ...base, type: 'user', uuid: 'u2', timestamp: at('10:00:12'), toolUseResult: { stdout: 'ok' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_7', content: 'text with "name":"Skill" quoted' }] } },
    { ...base, type: 'assistant', uuid: 'r8', timestamp: at('10:00:13'), message: { id: 'm8', role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
    { ...base, type: 'user', uuid: 'u3', timestamp: at('10:01:00'), message: { role: 'user', content: '<command-message>report</command-message>\n<command-name>/report-plugin:report</command-name>\n<command-args>5m</command-args>' } },
  ];
  const main = path.join(folder, `${sid}.jsonl`);
  fs.writeFileSync(main, records.map(line).join(''));
  // An agent transcript: a brief that only quotes a slash command, and a fork's replay of launch toolu_1.
  const sub = path.join(folder, sid, 'subagents');
  fs.mkdirSync(path.join(sub, 'workflows', 'wf_1'), { recursive: true });
  fs.writeFileSync(
    path.join(sub, 'agent-aaa.jsonl'),
    [
      { isSidechain: true, type: 'user', uuid: 's1', timestamp: at('10:00:06'), message: { role: 'user', content: 'Record user records whose text holds <command-name>/x</command-name>.' } },
      { ...tool('10:00:05', 'toolu_1', 'Agent', { subagent_type: 'fact-gatherer', prompt: 'Read only' }), isSidechain: true },
    ]
      .map(line)
      .join('')
  );
  fs.writeFileSync(path.join(sub, 'workflows', 'wf_1', 'agent-bbb.jsonl'), line({ ...tool('10:02:00', 'toolu_9', 'Skill', { skill: 'humanizer' }), isSidechain: true }));
  // A copy under a dot folder is skipped.
  fs.mkdirSync(path.join(folder, '.conversation', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.conversation', 'raw', 'copy.jsonl'), records.map(line).join(''));
  return { tmp, root, repo, folder, main, tool };
}

const fresh = (main = true): ScanState => ({ hits: [], offset: 0, parsed: 0, main });

test('scanning a transcript finds launches, skill calls and slash commands, and parses only the lines the prefilter passes', async () => {
  const { main, repo } = fixture();
  const s = fresh();
  await scanFile(main, s, fs.statSync(main).size);
  assert.deepEqual(
    s.hits.map(h => [h.kind, h.name, h.key]),
    [
      ['agent', 'fact-gatherer', 'toolu_1'],
      ['agent', 'general-purpose', 'toolu_2'],
      ['agent', 'Explore', 'toolu_3'],
      ['skill', 'vscode-extension', 'toolu_4'],
      ['skill', 'learn-loop-plugin:claude-learn', 'toolu_5'],
      ['agent', 'subagent-delegation-plugin:fact-gatherer', 'toolu_6'],
      ['command', 'report-plugin:report', 'u3'],
    ]
  );
  assert.equal(s.hits[0].at, ms('10:00:05'));
  // Six tool lines and the command line; the prompt, the Read call, its result (an escaped quote) and the reply are never parsed.
  assert.equal(s.parsed, 7);
  assert.equal(s.offset, fs.statSync(main).size);
  assert.equal(s.title, 'build the thing');
  assert.equal(s.cwd, repo);
});

test('a brief that quotes a slash command is no use', async () => {
  const { folder } = fixture();
  const s = fresh(false);
  const file = path.join(folder, sid, 'subagents', 'agent-aaa.jsonl');
  await scanFile(file, s, fs.statSync(file).size);
  assert.equal(s.parsed, 2);
  assert.deepEqual(
    s.hits.map(h => [h.kind, h.name]),
    [['agent', 'fact-gatherer']]
  );
  assert.equal(s.title, undefined);
});

test('an append scan reads on from the stored offset, leaves a line being written, and adds only the new hits', async () => {
  const { main, tool } = fixture();
  const s = fresh();
  await scanFile(main, s, fs.statSync(main).size);
  const before = s.hits.length;
  const end = s.offset;
  const next = line(tool('10:05:00', 'toolu_10', 'Agent', { subagent_type: 'dotnet-expert', prompt: 'x' }));
  fs.appendFileSync(main, next.slice(0, 40));
  await scanFile(main, s, fs.statSync(main).size);
  assert.equal(s.offset, end, 'a partial line is not consumed');
  assert.equal(s.hits.length, before);
  fs.appendFileSync(main, next.slice(40) + line(tool('10:06:00', 'toolu_11', 'Skill', { skill: 'humanizer' })));
  s.parsed = 0;
  await scanFile(main, s, fs.statSync(main).size);
  assert.equal(s.parsed, 2);
  assert.deepEqual(
    s.hits.slice(before).map(h => [h.kind, h.name]),
    [
      ['agent', 'dotnet-expert'],
      ['skill', 'humanizer'],
    ]
  );
  assert.equal(s.hits.length, before + 2);
  assert.equal(s.offset, fs.statSync(main).size);
});

test('the transcript list holds main and agent transcripts at any depth and skips dot folders', async () => {
  const { root, main, folder } = fixture();
  const listed = await listTranscripts(root);
  const rel = (f: string) => path.relative(folder, f).split(path.sep).join('/');
  assert.deepEqual(listed.map(t => rel(t.file)).sort(), [`${sid}.jsonl`, `${sid}/subagents/agent-aaa.jsonl`, `${sid}/subagents/workflows/wf_1/agent-bbb.jsonl`]);
  assert.ok(listed.filter(t => t.file !== main).every(t => t.main === main));
});

test('the index builds once, refreshes only what grew, and rows count each use once per session', async () => {
  const { tmp, root, repo, main, tool } = fixture();
  const store = path.join(tmp, 'storage', 'usage-index.json');
  const index = new UsageIndex(store);
  assert.equal(await index.exists(), false);
  const progress: number[] = [];
  const data = await index.refresh([root], p => progress.push(p.total));
  assert.ok(fs.existsSync(store));
  assert.equal(JSON.parse(fs.readFileSync(store, 'utf8')).version, USAGE_VERSION);
  assert.equal(Object.keys(data.files).length, 3);
  assert.equal(progress[0], 3);
  assert.equal(data.files[main].title, 'build the thing');
  assert.equal(data.files[main].cwd, repo);

  const repos = [{ id: `repo:${repo}`, label: 'repo', path: repo }];
  const accounts = [{ label: 'Default', root }];
  const rows = usageRows(data, { kind: 'agent', name: 'fact-gatherer', outside: [] }, repos, accounts);
  // The fork's replay of toolu_1 counts once.
  assert.deepEqual(rows, [{ id: sid, title: 'build the thing', repo: 'repo', scope: `repo:${repo}`, last: ms('10:00:05'), count: 1 }]);
  assert.equal(usageRows(data, { kind: 'skill', name: 'report-plugin:report', outside: [] }, repos, accounts)[0].count, 1);
  assert.equal(usageRows(data, { kind: 'skill', name: 'humanizer', outside: [] }, repos, accounts)[0].last, ms('10:02:00'));
  assert.deepEqual(usageRows(data, { kind: 'agent', name: 'fact-gatherer', outside: [repo] }, repos, accounts), []);
  assert.equal(usageRows(data, { kind: 'agent', name: 'fact-gatherer', inside: repo, outside: [] }, repos, accounts).length, 1);

  // Nothing changed: no file is read again.
  const totals: number[] = [];
  await index.refresh([root], p => totals.push(p.total));
  assert.deepEqual(totals, [0]);

  fs.appendFileSync(main, line(tool('10:09:00', 'toolu_12', 'Agent', { subagent_type: 'fact-gatherer', prompt: 'again' })));
  const again = new UsageIndex(store);
  assert.equal(await again.exists(), true);
  const totalsAfter: number[] = [];
  const grown = await again.refresh([root], p => totalsAfter.push(p.total));
  assert.deepEqual(totalsAfter[0], 1);
  assert.equal(grown.files[main].hits.length, data.files[main].hits.length + 1);
  assert.equal(grown.files[main].offset, fs.statSync(main).size);
  const after = usageRows(grown, { kind: 'agent', name: 'fact-gatherer', outside: [] }, repos, accounts);
  assert.equal(after[0].count, 2);
  assert.equal(after[0].last, ms('10:09:00'));

  fs.rmSync(path.join(path.dirname(main), sid), { recursive: true });
  const dropped = await again.refresh([root]);
  assert.deepEqual(Object.keys(dropped.files), [main]);
});

test('a plugin element matches its plugin:name form; a repo copy of a global element takes the sessions inside its repo', () => {
  const asset = (scope: string, name: string, source?: 'plugin'): Asset => ({ id: `${scope}|agent:${name}`, scope, kind: 'agent', name, description: '', file: '', mtime: 0, ...(source ? { source } : {}) });
  const view = (id: string, p: string, items: Asset[]): ScopeView => ({ id, label: path.basename(p), path: p, categories: [{ kind: 'agent', label: 'Agents', icon: 'hubot', creatable: true, markdown: true, fields: [], items }] });
  const plugin = asset('plugin:subagent-delegation-plugin@market', 'fact-gatherer', 'plugin');
  const global = view('global', '/home/x/.claude', [asset('global', 'dotnet-expert'), asset('global', 'only-global'), plugin]);
  const a = view('repo:/r/a', '/r/a', [asset('repo:/r/a', 'dotnet-expert'), asset('repo:/r/a', 'only-here')]);
  const b = view('repo:/r/b', '/r/b', []);
  const views = [global, a, b];
  assert.deepEqual(usageTarget(plugin, views), { kind: 'agent', name: 'subagent-delegation-plugin:fact-gatherer', outside: [] });
  assert.deepEqual(usageTarget(global.categories[0].items[0], views), { kind: 'agent', name: 'dotnet-expert', outside: ['/r/a'] });
  assert.deepEqual(usageTarget(global.categories[0].items[1], views), { kind: 'agent', name: 'only-global', outside: [] });
  assert.deepEqual(usageTarget(a.categories[0].items[0], views), { kind: 'agent', name: 'dotnet-expert', inside: '/r/a', outside: [] });
  assert.deepEqual(usageTarget(a.categories[0].items[1], views), { kind: 'agent', name: 'only-here', inside: undefined, outside: [] });
});

test('concurrent refreshes share one run', async () => {
  const { tmp, root } = fixture();
  const index = new UsageIndex(path.join(tmp, 'store', 'usage-index.json'));
  const [a, b] = await Promise.all([index.refresh([root]), index.refresh([root])]);
  assert.equal(a, b);
});

const entry = (over: Partial<FileEntry> = {}): FileEntry => ({ size: 1, mtime: 1, ino: 0, birth: 0, offset: 1, hits: [], ...over });
const hit = (kind: Hit['kind'], name: string, key: string, hms = '10:00:00'): Hit => ({ kind, name, key, at: ms(hms) });

test('rows keep a repo copy apart from the global element, name sessions by cwd, and attribute a scratchpad run to its session repo', () => {
  const tmp = path.join(os.tmpdir(), 'harness-rows');
  const a = path.join(tmp, 'a');
  const b = path.join(tmp, 'b');
  const other = path.join(tmp, 'other');
  const projects = path.join(tmp, '.claude', 'projects');
  const mainOf = (dir: string, id: string) => path.join(projects, projectSlug(dir), `${id}.jsonl`);
  const idA = 'aaaaaaaa-1111-2222-3333-444444444444';
  const idB = 'bbbbbbbb-1111-2222-3333-444444444444';
  const idO = 'cccccccc-1111-2222-3333-444444444444';
  const idRun = 'dddddddd-1111-2222-3333-444444444444';
  const runFolder = path.join(projects, `${projectSlug(tmp)}-${idA}-scratchpad`);
  const files: Record<string, FileEntry> = {
    [mainOf(a, idA)]: entry({ cwd: a, title: 'in a', hits: [hit('agent', 'dotnet-expert', 'k1', '10:00:00')] }),
    [mainOf(b, idB)]: entry({ cwd: b, title: 'in b', hits: [hit('agent', 'dotnet-expert', 'k2', '11:00:00'), hit('agent', 'dotnet-expert', 'k3', '11:30:00')] }),
    [mainOf(other, idO)]: entry({ cwd: path.join(other, 'deep'), hits: [hit('agent', 'dotnet-expert', 'k4', '09:00:00')] }),
    // An agent transcript counts for its session; a skill hit of the same name is not an agent launch.
    [path.join(projects, projectSlug(b), idB, 'subagents', 'agent-1.jsonl')]: entry({ main: mainOf(b, idB), hits: [hit('agent', 'dotnet-expert', 'k5', '12:00:00'), hit('skill', 'dotnet-expert', 'ignored', '12:00:00')] }),
    [path.join(runFolder, `${idRun}.jsonl`)]: entry({ cwd: tmp, title: 'headless', hits: [hit('skill', 'humanizer', 's1', '13:00:00'), hit('command', 'humanizer', 'u1', '13:01:00')] }),
  };
  const data: IndexData = { version: USAGE_VERSION, files };
  const repos = [
    { id: 'repo:a', label: 'a', path: a },
    { id: 'repo:b', label: 'b', path: b },
  ];
  const accounts = [{ label: 'Default', root: path.join(tmp, '.claude') }];
  const ids = (rows: { id: string }[]) => rows.map(r => r.id);
  // The global element: every session, newest use first, with the repo each ran in; a session in no listed repo is named by its cwd.
  const all = usageRows(data, { kind: 'agent', name: 'dotnet-expert', outside: [] }, repos, accounts);
  assert.deepEqual(ids(all), [idB, idA, idO]);
  assert.deepEqual(
    all.map(r => [r.repo, r.scope, r.count]),
    [
      ['b', 'repo:b', 3],
      ['a', 'repo:a', 1],
      ['deep', undefined, 1],
    ]
  );
  assert.equal(all[2].title, 'No prompt');
  // Repo a has its own copy: the global element leaves a out, the copy takes only a.
  assert.deepEqual(ids(usageRows(data, { kind: 'agent', name: 'dotnet-expert', outside: [a] }, repos, accounts)), [idB, idO]);
  assert.deepEqual(ids(usageRows(data, { kind: 'agent', name: 'dotnet-expert', inside: a, outside: [] }, repos, accounts)), [idA]);
  // A folder that only shares a prefix is not inside.
  assert.deepEqual(ids(usageRows(data, { kind: 'agent', name: 'dotnet-expert', inside: path.join(tmp, 'ot'), outside: [] }, repos, accounts)), []);
  // A skill counts its calls and its slash command; a headless run in a scratchpad folder opens under its session's repo.
  const skill = usageRows(data, { kind: 'skill', name: 'humanizer', outside: [] }, repos, accounts);
  assert.deepEqual(
    skill.map(r => [r.id, r.repo, r.scope, r.count]),
    [[idRun, 'a', 'repo:a', 2]]
  );
  assert.equal(usageRows(data, { kind: 'skill', name: 'dotnet-expert', outside: [] }, repos, accounts)[0].count, 1);
  // Several accounts: each row names its account.
  const two = [...accounts, { label: 'Work', root: path.join(tmp, 'work') }];
  files[mainOf(a, idA)].root = path.join(tmp, 'work');
  assert.equal(usageRows(data, { kind: 'agent', name: 'dotnet-expert', outside: [] }, repos, two).find(r => r.id === idA)?.account, 'Work');
  assert.equal(usageRows(data, { kind: 'agent', name: 'dotnet-expert', outside: [] }, repos, accounts).find(r => r.id === idA)?.account, undefined);
});

test('a target exists for the elements the index knows, and a plugin element or an unlisted repo has no copy to separate', () => {
  const asset = (kind: string, scope: string, source?: string) => ({ id: 'x', scope, kind, name: 'n', description: '', file: '', mtime: 0, ...(source ? { source } : {}) }) as unknown as Asset;
  assert.equal(usageTarget(asset('hook', 'global'), []), undefined);
  assert.deepEqual(usageTarget(asset('command', 'global'), []), { kind: 'command', name: 'n', outside: [] });
  assert.deepEqual(usageTarget(asset('rule', 'global'), []), { kind: 'memory', name: '', outside: [] });
  assert.deepEqual(usageTarget(asset('plugin', 'global'), []), { kind: 'plugin', name: 'n', outside: [] });
  assert.deepEqual(usageTarget({ ...asset('mcp', 'global', 'claude.ai'), name: 'claude.ai Docs' }, []), { kind: 'mcp', name: 'mcp__claude_ai_Docs__', outside: [] });
  assert.deepEqual(usageTarget({ ...asset('mcp', 'global', 'plugin'), name: 'plugin:design:slack' }, []), { kind: 'mcp', name: 'mcp__plugin_design_slack__', outside: [] });
  // An output style is matched by its frontmatter name, not its file name.
  assert.deepEqual(usageTarget(asset('outputStyle', 'global'), [], 'Answer Only'), { kind: 'style', name: 'Answer Only', outside: [] });
  assert.deepEqual(usageTarget(asset('skill', 'plugin:p@m', 'plugin'), []), { kind: 'skill', name: 'p:n', outside: [] });
  assert.deepEqual(usageTarget(asset('skill', 'repo:/gone'), []), { kind: 'skill', name: 'n', inside: undefined, outside: [] });
});

test('hitsOf names an Agent launch without a type, keys a record without an id, and ignores a tool result that quotes a command', () => {
  const rec = (content: unknown[]) => ({ type: 'assistant', timestamp: at('10:00:00'), message: { content } });
  assert.deepEqual(hitsOf(rec([{ type: 'tool_use', name: 'Agent', input: {} }, { type: 'tool_use', name: 'Skill', input: { skill: '' } }, { type: 'tool_use', name: 'Skill', input: { skill: 'x' } }]), '7'), [
    { kind: 'agent', name: 'general-purpose', at: ms('10:00:00'), key: '7:0' },
    { kind: 'skill', name: 'x', at: ms('10:00:00'), key: '7:1' },
  ]);
  const quoted = { type: 'user', toolUseResult: {}, message: { content: '<command-name>/x</command-name>' } };
  assert.deepEqual(hitsOf(quoted, '1'), []);
  assert.deepEqual(hitsOf({ type: 'user', message: { content: [{ type: 'text', text: '<command-name>/y</command-name>' }] } }, '2'), [{ kind: 'command', name: 'y', at: 0, key: '2' }]);
});

test('the prefilter finds the old Task name, skips an api-request blob and a quoted tool name, and the title comes from the first prompt', () => {
  const base = { cwd: 'C:\\work', isSidechain: false };
  const text = [
    line({ ...base, type: 'user', uuid: 'a', message: { role: 'user', content: [{ type: 'text', text: 'first   prompt' }] } }),
    line({ ...base, type: 'assistant', uuid: 'b', timestamp: at('10:00:00'), message: { content: [{ type: 'tool_use', id: 't1', name: 'Task', input: { subagent_type: 'Explore' } }] } }),
    // A blob that lists the tool names is no record of a use.
    '{"type":"api-request","tools":[{"name":"Agent"},{"name":"Skill"}]}\n',
    // A tool name inside a string is escaped and never matches the needle.
    line({ ...base, type: 'assistant', uuid: 'c', message: { content: [{ type: 'text', text: 'the "name":"Agent" tool and "name":"Skill"' }] } }),
    line({ ...base, type: 'assistant', uuid: 'd', timestamp: at('10:00:01'), message: { content: [{ type: 'tool_use', id: 't3', name: 'Agentic', input: {} }, { type: 'tool_use', id: 't4', name: 'Skill', input: { skill: 'humanizer' } }] } }),
  ].join('');
  const s = fresh();
  scanLines(Buffer.from(text), 0, s);
  assert.deepEqual(
    s.hits.map(h => [h.kind, h.name, h.key]),
    [
      ['agent', 'Explore', 't1'],
      ['skill', 'humanizer', 't4'],
    ]
  );
  assert.equal(s.title, 'first prompt');
  assert.equal(s.cwd, 'C:\\work');
  // The Task line, the blob (which holds the needle but is rejected before it is decoded), the quoted-name line is escaped and not matched, the Skill line.
  assert.equal(s.parsed, 3);
});

test('a refresh drops a removed file, rereads a shrunk or replaced one from the start, and keeps an unchanged one', async () => {
  const { tmp, root, folder, main, tool } = fixture();
  const store = path.join(tmp, 'storage', 'usage-index.json');
  const index = new UsageIndex(store);
  const first = await index.refresh([root]);
  const agentFile = path.join(folder, sid, 'subagents', 'agent-aaa.jsonl');
  const keptEntry = first.files[agentFile];

  // Replaced by a shorter file: the old hits are gone, the new ones come from byte 0.
  fs.writeFileSync(main, line({ type: 'user', cwd: '/elsewhere', message: { role: 'user', content: 'new start' } }) + line(tool('10:20:00', 'toolu_20', 'Skill', { skill: 'only-one' })));
  const second = await index.refresh([root]);
  assert.deepEqual(
    second.files[main].hits.map(h => h.name),
    ['only-one']
  );
  assert.equal(second.files[main].title, 'new start');
  assert.equal(second.files[main].cwd, '/elsewhere');
  assert.equal(second.files[main].offset, fs.statSync(main).size);
  assert.equal(second.files[agentFile], keptEntry, 'an unchanged file is not read again');

  // Rewritten to the same size with another mtime: read again in full.
  const body = line({ type: 'user', cwd: '/elsewhere', message: { role: 'user', content: 'new start' } }) + line(tool('10:20:00', 'toolu_21', 'Skill', { skill: 'only-two' }));
  fs.writeFileSync(main, body);
  fs.utimesSync(main, new Date(), new Date(Date.now() + 60_000));
  const third = await index.refresh([root]);
  assert.deepEqual(
    third.files[main].hits.map(h => h.name),
    ['only-two']
  );

  // A removed file leaves the index and the stored copy.
  fs.rmSync(agentFile);
  const fourth = await index.refresh([root]);
  assert.equal(fourth.files[agentFile], undefined);
  assert.equal(JSON.parse(fs.readFileSync(store, 'utf8')).files[agentFile], undefined);
});

test('the index survives a restart, and an index of another format version is built again', async () => {
  const { tmp, root } = fixture();
  const store = path.join(tmp, 'storage', 'usage-index.json');
  const built = await new UsageIndex(store).refresh([root]);

  const loaded = new UsageIndex(store);
  assert.equal(await loaded.exists(), true);
  const again = await loaded.refresh([root]);
  assert.deepEqual(again, built, 'what was stored is what was built');

  const stale = JSON.parse(fs.readFileSync(store, 'utf8'));
  fs.writeFileSync(store, JSON.stringify({ ...stale, version: USAGE_VERSION + 1 }));
  const other = new UsageIndex(store);
  assert.equal(await other.exists(), false, 'another version is no index');
  const progress: number[] = [];
  const rebuilt = await other.refresh([root], p => progress.push(p.total));
  assert.equal(progress[0], 3, 'every transcript is read again');
  assert.deepEqual(rebuilt, built);
  assert.equal(JSON.parse(fs.readFileSync(store, 'utf8')).version, USAGE_VERSION);

  fs.writeFileSync(store, '{ not json');
  assert.equal(await new UsageIndex(store).exists(), false, 'a damaged file is no index');
});

test('a transcript that only grew without a use is not written out again, and a recent refresh is not repeated', async () => {
  const { tmp, root, main } = fixture();
  const store = path.join(tmp, 'storage', 'usage-index.json');
  const index = new UsageIndex(store);
  await index.refresh([root]);
  const written = fs.readFileSync(store, 'utf8');

  fs.appendFileSync(main, line({ type: 'assistant', message: { content: [{ type: 'text', text: 'more talk' }] } }));
  const grown = await index.refresh([root]);
  assert.equal(grown.files[main].offset, fs.statSync(main).size, 'in memory the offset moved on');
  assert.equal(fs.readFileSync(store, 'utf8'), written);

  // A restart reads on from the stored offset and finds the same hits.
  const restarted = await new UsageIndex(store).refresh([root]);
  assert.deepEqual(restarted.files[main].hits, grown.files[main].hits);

  // Within maxAge nothing is listed or read: a use appended now stays unseen until the age is over.
  fs.appendFileSync(main, line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'late', name: 'Skill', input: { skill: 'late-skill' } }] } }));
  const cached = await index.refresh([root], undefined, 60_000);
  assert.equal(cached.files[main].hits.some(h => h.name === 'late-skill'), false);
  const current = await index.refresh([root]);
  assert.equal(current.files[main].hits.some(h => h.name === 'late-skill'), true);
  assert.notEqual(fs.readFileSync(store, 'utf8'), written, 'a new use is written out');
});

test('the plan: unchanged is skipped, a longer same file appends, a shorter or replaced file is read in full', () => {
  const st = (over: Partial<fs.Stats>) => ({ size: 100, mtimeMs: 5, ino: 7, birthtimeMs: 1000, ...over }) as fs.Stats;
  const prev = entry({ size: 100, mtime: 5, ino: 7, birth: 1000 });
  assert.equal(planOf(undefined, st({})), 'full');
  assert.equal(planOf(prev, st({})), 'skip');
  assert.equal(planOf(prev, st({ size: 150, mtimeMs: 6 })), 'append');
  assert.equal(planOf(prev, st({ size: 50, mtimeMs: 6 })), 'full');
  assert.equal(planOf(prev, st({ size: 150, mtimeMs: 6, ino: 8 })), 'full');
  assert.equal(planOf(prev, st({ size: 150, mtimeMs: 6, birthtimeMs: 2000 })), 'full');
  assert.equal(planOf(prev, st({ size: 100, mtimeMs: 6 })), 'full');
});

const toolLine = (id: string, name: string, hms: string, input: unknown = {}) =>
  line({ type: 'assistant', uuid: `r-${id}`, timestamp: at(hms), message: { content: [{ type: 'tool_use', id, name, input }] } });

test('an MCP call is counted from its line without decoding it, and only a tool_use block counts', () => {
  const text = [
    toolLine('t1', 'mcp__chrome-devtools__click', '10:00:01', { uid: '1' }),
    // Parallel calls in one record.
    line({ type: 'assistant', uuid: 'p', timestamp: at('10:00:02'), message: { content: [{ type: 'tool_use', id: 't2', name: 'mcp__claude_ai_Docs__read', input: {} }, { type: 'tool_use', id: 't3', name: 'mcp__claude_ai_Docs__read', input: {} }] } }),
    // The same name in a deferred tool list, a tool_reference and a quoted string is no call.
    line({ type: 'user', uuid: 'u', timestamp: at('10:00:03'), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'tool_reference', tool_name: 'mcp__x__y' }, { type: 'text', text: '{"name":"mcp__x__y"}' }] }] } }),
    toolLine('t4', 'Read', '10:00:04', { file_path: 'mcp__x__y' }),
  ].join('');
  const s = fresh(false);
  scanLines(Buffer.from(text), 0, s);
  assert.deepEqual(
    s.hits.map(h => [h.kind, h.name, h.key, h.at]),
    [
      ['mcp', 'mcp__chrome-devtools__click', 't1', ms('10:00:01')],
      ['mcp', 'mcp__claude_ai_Docs__read', 't2', ms('10:00:02')],
      ['mcp', 'mcp__claude_ai_Docs__read', 't3', ms('10:00:02')],
    ]
  );
  assert.equal(s.parsed, 0);
});

test('the output style counts once per file and style, the memory files only by path, and a nested file keeps its globs', () => {
  const base = { cwd: 'C:\\work', isSidechain: false };
  const att = (a: unknown, hms: string) => line({ ...base, type: 'attachment', uuid: hms, timestamp: at(hms), attachment: a });
  const style = (name: string, hms: string) => att({ type: 'output_style', style: name }, hms);
  const text = [
    style('Answer Only', '10:00:01'),
    style('Answer Only', '10:00:02'),
    att({ type: 'output_style_instructions', content: 'x' }, '10:00:03'),
    style('Explanatory', '10:00:04'),
    att({ type: 'instructions', files: [{ path: 'C:\\Users\\me\\.claude\\CLAUDE.md', type: 'User', content: 'say "path":"C:\\\\fake" here' }, { path: 'C:\\work\\.claude\\rules\\a.md', type: 'Project', content: 'rule' }] }, '10:00:05'),
    att({ type: 'instructions', files: [{ path: 'C:\\work\\.claude\\rules\\a.md', type: 'Project', content: 'again' }] }, '10:00:06'),
    att({ type: 'nested_memory', path: 'C:\\work\\.claude\\rules\\ts.md', content: { path: 'C:\\work\\.claude\\rules\\ts.md', type: 'Project', content: 'body', globs: ['src/**/*.ts', 'lib/[a]/*.ts'], rawContent: '---' }, displayPath: 'x' }, '10:00:07'),
    att({ type: 'nested_memory', path: 'C:\\work\\sub\\CLAUDE.md', content: { path: 'C:\\work\\sub\\CLAUDE.md', type: 'Project', content: 'body' } }, '10:00:08'),
  ].join('');
  const s = fresh(false);
  scanLines(Buffer.from(text), 0, s);
  assert.deepEqual(
    s.hits.map(h => [h.kind, h.name, h.at, h.info]),
    [
      ['style', 'Answer Only', ms('10:00:01'), undefined],
      ['style', 'Explanatory', ms('10:00:04'), undefined],
      ['memory', 'C:\\Users\\me\\.claude\\CLAUDE.md', ms('10:00:05'), undefined],
      ['memory', 'C:\\work\\.claude\\rules\\a.md', ms('10:00:05'), undefined],
      ['memory', 'C:\\work\\.claude\\rules\\ts.md', ms('10:00:07'), 'src/**/*.ts, lib/[a]/*.ts'],
      ['memory', 'C:\\work\\sub\\CLAUDE.md', ms('10:00:08'), ''],
    ]
  );
  assert.equal(s.parsed, 0);
  // A later scan of the same file does not count them again.
  const more: ScanState = { ...fresh(false), hits: [...s.hits] };
  scanLines(Buffer.from(style('Answer Only', '11:00:00') + att({ type: 'instructions', files: [{ path: 'C:\\work\\.claude\\rules\\a.md', type: 'Project', content: '' }] }, '11:00:01')), 0, more);
  assert.equal(more.hits.length, s.hits.length);
});

test('rows, days, elements, tools and totals read the new hit kinds', () => {
  const tmp = path.join(os.tmpdir(), 'harness-more');
  const repo = path.join(tmp, 'r');
  const projects = path.join(tmp, '.claude', 'projects');
  const mainA = path.join(projects, projectSlug(repo), 'aaaaaaaa-1111-2222-3333-444444444444.jsonl');
  const mainB = path.join(projects, projectSlug(repo), 'bbbbbbbb-1111-2222-3333-444444444444.jsonl');
  const now = new Date(2026, 9, 24, 15, 0, 0).getTime();
  const day = (back: number, h = 9) => new Date(2026, 9, 24 - back, h).getTime();
  const h = (kind: Hit['kind'], name: string, key: string, atMs: number, info?: string): Hit => ({ kind, name, key, at: atMs, ...(info !== undefined ? { info } : {}) });
  const rule = path.join(repo, '.claude', 'rules', 'ts.md');
  const data: IndexData = {
    version: USAGE_VERSION,
    files: {
      [mainA]: entry({
        cwd: repo,
        title: 'a',
        hits: [
          h('mcp', 'mcp__srv__one', 'k1', day(0)),
          h('mcp', 'mcp__srv__one', 'k2', day(0, 10)),
          h('mcp', 'mcp__srv__two', 'k3', day(2)),
          h('mcp', 'mcp__srv__one', 'k1', day(0)),
          h('mcp', 'mcp__srv2__one', 'k4', day(1)),
          h('agent', 'plug:worker', 'a1', day(1)),
          h('skill', 'plug:look', 's1', day(3)),
          h('command', 'plug:look', 'c1', day(8)),
          h('command', 'plug:run', 'c2', day(0)),
          h('memory', rule, rule, day(5), 'src/**/*.ts'),
          h('style', 'Answer Only', 'Answer Only', day(4)),
        ],
      }),
      [mainB]: entry({ cwd: repo, title: 'b', hits: [h('skill', 'plug:look', 's2', day(6)), h('memory', rule, rule, day(9), '')] }),
    },
  };
  const repos = [{ id: 'repo:r', label: 'r', path: repo }];
  const accounts = [{ label: 'Default', root: path.join(tmp, '.claude') }];
  // A rule: the sessions that loaded it, with how.
  const loaded = usageRows(data, { kind: 'memory', name: rule, outside: [] }, repos, accounts);
  assert.deepEqual(
    loaded.map(r => [r.title, r.count, r.info]),
    [
      ['a', 1, 'src/**/*.ts'],
      ['b', 1, ''],
    ]
  );
  assert.deepEqual(usageRows(data, { kind: 'style', name: 'Answer Only', outside: [] }, repos, accounts).map(r => r.title), ['a']);
  // The server prefix ends in __, so srv does not take srv2; a replayed key counts once.
  const server = usageMore(data, { kind: 'mcp', name: 'mcp__srv__', outside: [] }, now);
  assert.equal(server.total, 3);
  assert.deepEqual(server.tools, [
    { name: 'one', count: 2, last: day(0, 10) },
    { name: 'two', count: 1, last: day(2) },
  ]);
  // The strip: 7 local days, oldest first, today last.
  assert.deepEqual(server.days.map(d => d.n), [0, 0, 0, 0, 1, 0, 2]);
  assert.equal(server.days[6].at, new Date(2026, 9, 24).getTime());
  // A plugin: its agent, and its skill and command together, per element.
  const plug = usageMore(data, { kind: 'plugin', name: 'plug', outside: [] }, now);
  assert.deepEqual(plug.elements?.map(e => [e.kind, e.name, e.count, e.sessions]), [
    ['use', 'look', 3, 2],
    ['use', 'run', 1, 1],
    ['agent', 'worker', 1, 1],
  ]);
  assert.equal(plug.days[5].n, 1);
  // Totals for a type page: every element once, a never-used one with 0.
  const totals = usageTotals(data, [
    { id: 'look', target: { kind: 'skill', name: 'plug:look', outside: [] } },
    { id: 'none', target: { kind: 'agent', name: 'nobody', outside: [] } },
    { id: 'worker', target: { kind: 'agent', name: 'plug:worker', outside: [] } },
  ]);
  assert.deepEqual(totals, { look: { count: 3, last: day(3) }, none: { count: 0, last: 0 }, worker: { count: 1, last: day(1) } });
});

test('every plugin agent of a type page gets a total, used or not, whatever its frontmatter holds', () => {
  const plugin = (name: string, meta?: Asset['meta']): Asset => ({ id: `plugin:review-kit@demo|agent:${name}`, scope: 'plugin:review-kit@demo', kind: 'agent', name, description: '', file: `/p/${name}.md`, mtime: 0, source: 'plugin', meta } as Asset);
  const views = [{ id: 'global', categories: [] }] as unknown as ScopeView[];
  const withColor = plugin('diff-reader', { color: 'cyan' });
  const bare = plugin('style-checker');
  const targets = [withColor, bare].map(a => ({ id: a.id, target: usageTarget(a, views)! }));
  assert.deepEqual(targets.map(t => t.target.name), ['review-kit:diff-reader', 'review-kit:style-checker']);
  const data: IndexData = { version: USAGE_VERSION, files: { '/m.jsonl': { size: 1, mtime: 1, hits: [{ kind: 'agent', name: 'review-kit:style-checker', at: ms('10:00:00'), key: 'k' }] } } } as unknown as IndexData;
  const totals = usageTotals(data, targets);
  assert.deepEqual(Object.keys(totals).sort(), targets.map(t => t.id).sort());
  assert.deepEqual(totals[withColor.id], { count: 0, last: 0 });
  assert.deepEqual(totals[bare.id], { count: 1, last: ms('10:00:00') });
  assert.deepEqual(usageTotals({ version: USAGE_VERSION, files: {} } as unknown as IndexData, targets)[bare.id], { count: 0, last: 0 });
});
