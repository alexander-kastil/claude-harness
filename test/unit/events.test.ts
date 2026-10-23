import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { EVENTS_MANIFEST, UNNAMED_MOD, eventLayers, eventLogPath, eventSourceAt, findEventSources, readEventLog, transcriptHooks, transcriptLayers } from '../../src/events';
import { bindEvents, chipText, modsOf, promptLine, promptParts, toneOfAll } from '../../src/shared/event-layers';
import type { ModEvent } from '../../src/shared/messages';

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const manifest = (dir: string, body: string) => write(path.join(dir, EVENTS_MANIFEST), body);

test('a plugin with an events manifest is an event source; one per plugin name, the directory source first', () => {
  const plain = tmp('events-plain-');
  write(path.join(plain, '.claude-plugin', 'plugin.json'), '{ "name": "plain" }');
  const cached = tmp('events-cache-');
  manifest(cached, '{ "label": "Old layer", "events": "{sessionDir}/old.jsonl" }');
  const source = tmp('events-src-');
  manifest(source, '{ "label": "Demo layer", "events": "{sessionDir}/demo-events.jsonl" }');
  const other = tmp('events-other-');
  manifest(other, '// a comment\n{ "label": "Second layer", "events": "{home}/logs/{sessionId}.jsonl", "extra": 1 }');
  const half = tmp('events-half-');
  manifest(half, '{ "label": "No template" }');

  assert.equal(eventSourceAt(plain), undefined);
  assert.equal(eventSourceAt(half), undefined);
  const found = findEventSources([
    { dir: plain, installed: true, plugin: 'plain' },
    { dir: cached, installed: true, plugin: 'demo' },
    { dir: source, installed: false, plugin: 'demo' },
    { dir: other, installed: true, plugin: 'other' },
    { dir: half, installed: false, plugin: 'half' },
  ]);
  assert.deepEqual(
    found.map(s => [s.plugin, s.label, s.dir]),
    [
      ['demo', 'Demo layer', source],
      ['other', 'Second layer', other],
    ]
  );
  assert.deepEqual(findEventSources([]), []);
});

test('eventLogPath fills the session folder, id and home into the template', () => {
  const plugin = tmp('events-plugin-');
  const transcript = path.join(os.tmpdir(), 'projects', 'D--repo', '1234-abcd.jsonl');
  const home = path.join(os.tmpdir(), 'home');
  const at = (events: string) => eventLogPath({ plugin: 'p', dir: plugin, label: 'L', events }, transcript, '1234-abcd', home);
  assert.equal(at('{sessionDir}/demo-events.jsonl'), path.join(os.tmpdir(), 'projects', 'D--repo', '1234-abcd', 'demo-events.jsonl'));
  assert.equal(at('{home}/logs/{sessionId}.jsonl'), path.join(home, 'logs', '1234-abcd.jsonl'));
  assert.equal(at('logs/{sessionId}.jsonl'), path.join(plugin, 'logs', '1234-abcd.jsonl'));
});

test('readEventLog keeps the well-formed events in time order and skips malformed lines', () => {
  const dir = tmp('events-log-');
  const file = path.join(dir, 'log.jsonl');
  write(
    file,
    [
      '﻿{"at":"2026-10-23T09:00:05Z","hook":"agent.spawn","text":"Added a hint.","label":"+300","agentId":"a1","detail":"line one\\nline two","extra":true}',
      'not json',
      '',
      '{"at":"2026-10-23T09:00:01Z","hook":"prompt.submit","text":"Looked, did nothing.","tone":"quiet"}',
      '{"hook":"tool.call","text":"no time"}',
      '{"at":"yesterday","hook":"tool.call","text":"bad time"}',
      '{"at":"2026-10-23T09:00:09Z","hook":"tool.call","text":"Denied a read.","tone":"loud","label":"denied"}',
      '[1, 2]',
      '{"at":"2026-10-23T09:00:03Z","hook":"turn.complete"}',
    ].join('\r\n')
  );
  const events = readEventLog(file);
  assert.deepEqual(
    events.map(e => e.hook),
    ['prompt.submit', 'agent.spawn', 'tool.call']
  );
  assert.deepEqual(events[1], { at: '2026-10-23T09:00:05Z', hook: 'agent.spawn', text: 'Added a hint.', label: '+300', agentId: 'a1', detail: 'line one\nline two' });
  assert.equal(events[0].tone, 'quiet');
  assert.equal(events[2].tone, undefined, 'an unknown tone is dropped, so the event reads as act');
  assert.deepEqual(readEventLog(path.join(dir, 'missing.jsonl')), []);
});

test('eventLayers adds a layer only for a log that exists and holds events', () => {
  const projects = tmp('events-projects-');
  const transcript = path.join(projects, 'sess-1.jsonl');
  write(transcript, '');
  const withLog = { plugin: 'a', dir: tmp('events-a-'), label: 'A layer', events: '{sessionDir}/a.jsonl' };
  const emptyLog = { plugin: 'b', dir: tmp('events-b-'), label: 'B layer', events: '{sessionDir}/b.jsonl' };
  const noLog = { plugin: 'c', dir: tmp('events-c-'), label: 'C layer', events: '{sessionDir}/c.jsonl' };
  write(path.join(projects, 'sess-1', 'a.jsonl'), '{"at":"2026-10-23T09:00:00Z","hook":"prompt.submit","text":"Did a thing."}\n');
  write(path.join(projects, 'sess-1', 'b.jsonl'), 'garbage\n');
  const layers = eventLayers([withLog, emptyLog, noLog], transcript, 'sess-1');
  assert.deepEqual(
    layers.map(l => [l.label, l.events.length]),
    [['A layer', 1]]
  );
  assert.deepEqual(eventLayers([], transcript, 'sess-1'), []);
});

test('transcriptHooks reads every hook attachment and the tool calls a hook denied, and nothing else', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 23, 9, 0, s)).toISOString();
  const hook = (s: number, attachment: Record<string, unknown>) => ({ type: 'attachment', timestamp: at(s), attachment });
  const result = (s: number, id: string, content: string, isError = true) => ({ type: 'user', timestamp: at(s), message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
  const records = [
    { type: 'assistant', timestamp: at(1), message: { content: [{ type: 'tool_use', id: 'toolu_a', name: 'Read' }, { type: 'tool_use', id: 'toolu_b', name: 'Bash' }, { type: 'tool_use', id: 'toolu_c', name: 'Edit' }] } },
    hook(2, { type: 'hook_additional_context', content: ['format-mod: readme.md breaks the teaching format:'], hookName: 'tool.call', toolUseID: 'toolu_a-context', hookEvent: 'PostToolUse' }),
    hook(3, { type: 'hook_additional_context', content: 'Agents for this prompt: `css-agent`.', hookName: 'prompt.submit', toolUseID: 'hook-1', hookEvent: 'UserPromptSubmit' }),
    hook(4, { type: 'hook_success', hookName: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit', content: '[Routing check]', stdout: '[Routing check]', exitCode: 0 }),
    hook(5, { type: 'hook_non_blocking_error', hookName: 'PreToolUse:Edit', hookEvent: 'PreToolUse', toolUseID: 'toolu_c', stderr: 'No such file', stdout: '', exitCode: 127, content: '' }),
    hook(6, { type: 'hook_blocking_error', hookName: 'PostToolUse:Edit', hookEvent: 'PostToolUse', toolUseID: 'toolu_c', blockingError: { blockingError: '[bash guard.sh]: bullets over 6 words', command: 'bash guard.sh' } }),
    hook(7, { type: 'hook_system_message', content: 'cost-mod: the cache lapsed.', hookName: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit' }),
    hook(8, { type: 'hook_cancelled', hookName: 'Stop', hookEvent: 'Stop' }),
    result(9, 'toolu_b', '<tool_use_error>guard-plugin: 4 lookups on the main thread this turn.</tool_use_error>'),
    result(10, 'toolu_c', 'PreToolUse:Edit hook error: src/pricing.ts is frozen'),
    // Not hook denials: an ordinary error, output that happens to start like a prefix, a wrapped error without one.
    result(11, 'toolu_b', 'files: 10\r\nISSUES: 25'),
    result(12, 'toolu_c', '<tool_use_error>File has not been read yet.</tool_use_error>'),
    result(13, 'toolu_b', '<tool_use_error>root: fine</tool_use_error>', false),
    { type: 'attachment', attachment: { type: 'hook_success', content: 'no time' } },
    { type: 'attachment', timestamp: at(14), attachment: { type: 'output_style', style: 'x' } },
  ];
  const hooks = transcriptHooks(records);
  assert.deepEqual(
    hooks.map(h => [h.mod, h.event.hook, h.event.text, h.event.label, h.event.tone]),
    [
      ['format-mod', 'tool.call', 'Added context after Read.', 'context', undefined],
      [undefined, 'prompt.submit', 'Added context on the prompt.', 'context', undefined],
      [undefined, 'UserPromptSubmit', 'Wrote output on the prompt.', 'output', undefined],
      [undefined, 'PreToolUse:Edit', 'Failed before Edit, exit code 127.', 'failed', 'warn'],
      [undefined, 'PostToolUse:Edit', 'Sent a blocking error after Edit.', 'blocked', 'warn'],
      ['cost-mod', 'UserPromptSubmit', 'Showed a message on the prompt.', 'message', undefined],
      [undefined, 'Stop', 'Cancelled.', 'cancelled', undefined],
      ['guard-plugin', 'Bash', 'Denied Bash.', 'denied', 'warn'],
      [undefined, 'PreToolUse:Edit', 'Denied Edit.', 'denied', 'warn'],
    ]
  );
  assert.equal(hooks[0].event.detail, 'format-mod: readme.md breaks the teaching format:');
  assert.equal(hooks[3].event.detail, 'No such file');
  assert.equal(hooks[4].event.detail, '[bash guard.sh]: bullets over 6 words');
  assert.equal(hooks[6].event.detail, undefined);
  assert.equal(hooks[7].event.detail, 'guard-plugin: 4 lookups on the main thread this turn.');
  assert.equal(hooks[8].event.detail, 'src/pricing.ts is frozen');
  assert.equal(hooks[0].event.at, at(2));
  assert.ok(hooks.every(h => h.event.agentId === undefined));
  assert.deepEqual(
    transcriptHooks(records.slice(0, 2), 'a1').map(h => h.event.agentId),
    ['a1']
  );
});

test('transcriptLayers groups the traces by mod, joins a manifest plugin to its label and drops what a log already shows', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 23, 9, 0, s)).toISOString();
  const trace = (s: number, detail: string, mod?: string) => ({ mod, event: { at: at(s), hook: 'tool.call', text: 'Added context.', label: 'context', detail } });
  const logs = [{ label: 'Guard mod', events: [{ at: at(1), hook: 'tool.call', text: 'Denied Bash.', detail: 'guard-plugin: 4 lookups.' }] }];
  const sources = [{ plugin: 'guard-plugin', dir: '/p', label: 'Guard mod', events: '{sessionDir}/e.jsonl' }];
  const layers = transcriptLayers(
    [
      trace(9, 'guard-plugin: 4 lookups.', 'guard-plugin'),
      trace(8, 'guard-plugin: 5 lookups.', 'guard-plugin'),
      trace(7, 'format-mod: b', 'format-mod'),
      trace(3, 'format-mod: a', 'format-mod'),
      trace(5, '[Routing check]'),
      trace(6, 'x'.repeat(2500)),
    ],
    logs,
    sources
  );
  assert.deepEqual(
    layers.map(l => [l.label, l.events.map(e => e.at)]),
    [
      ['Guard mod', [at(8)]],
      ['format-mod', [at(3), at(7)]],
      [UNNAMED_MOD, [at(5), at(6)]],
    ]
  );
  assert.equal(layers[2].events[1].detail?.length, 2004, 'a long detail is cut to 2000 characters and an ellipsis line');
  assert.deepEqual(transcriptLayers([], logs, sources), []);
});

test('bindEvents puts an agent event on its row and any other event on the prompt whose window holds it', () => {
  const t = (s: number) => new Date(Date.UTC(2026, 9, 23, 9, 0, s)).toISOString();
  const ev = (s: number, hook: string, extra: Partial<ModEvent> = {}): ModEvent => ({ at: t(s), hook, text: hook, ...extra });
  const prompts = [Date.parse(t(10)), Date.parse(t(20)), Date.parse(t(30))];
  const bound = bindEvents(
    [ev(25, 'late agent', { agentId: 'a1' }), ev(5, 'before first'), ev(10, 'at first'), ev(19, 'end of first'), ev(20, 'at second'), ev(12, 'gone agent', { agentId: 'zz' }), ev(99, 'after last'), ev(15, 'agent', { agentId: 'a1' })],
    prompts,
    ['a1', 'a2']
  );
  assert.deepEqual(
    bound.steps.map(list => list.map(e => e.hook)),
    [['before first', 'at first', 'gone agent', 'end of first'], ['at second'], ['after last']]
  );
  assert.deepEqual(
    bound.agents.a1.map(e => e.hook),
    ['agent', 'late agent']
  );
  assert.equal(bound.agents.a2, undefined);
});

test('modsOf merges the layers of one label into one mod in time order, in the order the labels first appear', () => {
  const ev = (s: number, hook: string): ModEvent => ({ at: new Date(Date.UTC(2026, 9, 23, 9, 0, s)).toISOString(), hook, text: hook });
  const mods = modsOf([
    { label: 'B mod', events: [ev(5, 'b5')] },
    { label: 'A mod', events: [ev(9, 'a9'), ev(1, 'a1')] },
    { label: 'Empty', events: [] },
    { label: 'B mod', events: [ev(2, 'b2'), ev(5, 'b5 again')] },
  ]);
  assert.deepEqual(
    mods.map(m => [m.label, m.events.map(e => e.hook)]),
    [
      ['B mod', ['b2', 'b5', 'b5 again']],
      ['A mod', ['a1', 'a9']],
    ]
  );
  assert.deepEqual(modsOf(undefined), []);
});

test('chipText lists the distinct labels of the events that acted, three at most, and toneOfAll picks the strongest tone', () => {
  const ev = (s: number, label: string | undefined, tone?: ModEvent['tone'], hook = 'tool.call'): ModEvent => ({ at: new Date(Date.UTC(2026, 9, 23, 9, 0, s)).toISOString(), hook, text: 'x', label, tone });
  assert.equal(chipText([ev(3, 'denied', 'warn'), ev(1, '+300'), ev(2, '+300'), ev(4, 'filed', 'quiet')]), '+300 · denied');
  assert.equal(chipText([ev(1, 'a'), ev(2, 'b'), ev(3, 'c'), ev(4, 'd'), ev(5, 'e')]), 'a · b · c · +2');
  // An event without a label shows only in the card, never as its hook name.
  assert.equal(chipText([ev(1, '+300', 'act', 'agent.spawn'), ev(2, undefined, 'quiet', 'agent.spawn'), ev(3, undefined, 'act', 'turn.complete')]), '+300');
  assert.equal(chipText([ev(1, '+1799'), ev(1, '+300'), ev(2, undefined, 'quiet'), ev(5, undefined, 'act', 'turn.complete'), ev(9, undefined, 'act', 'turn.complete')]), '+1799 · +300');
  // No acting event with a label: the chip counts the events.
  assert.equal(chipText([ev(1, undefined), ev(2, undefined, 'warn')]), '2 events');
  assert.equal(chipText([ev(1, 'ok', 'quiet'), ev(2, undefined, 'quiet')]), '2 events');
  assert.equal(chipText([ev(1, undefined, 'act', 'turn.complete')]), '1 event');
  assert.equal(toneOfAll([ev(1, 'a'), ev(2, 'b', 'warn')]), 'warn');
  assert.equal(toneOfAll([ev(1, 'a', 'quiet'), ev(2, 'b')]), 'act');
  assert.equal(toneOfAll([ev(1, 'a', 'quiet')]), 'quiet');
});

test('promptLine takes the first line without pasted blocks, and is empty when only pasted text is left', () => {
  assert.equal(promptLine('fix the build\nthen run the tests'), 'fix the build');
  assert.equal(promptLine('for this we still need details <pasted_content id="9527"> ## Module 1 - Intro </pasted_content> keep it'), 'for this we still need details');
  assert.equal(promptLine('<pasted_content id="1">\nall of it\n</pasted_content>\n\n  and then this'), 'and then this');
  assert.equal(promptLine('<pasted_content id="1">only pasted</pasted_content id="1">'), '');
  assert.equal(promptLine('see this <pasted_content id="2"> cut off by the reader at 600 characters'), 'see this');
  assert.equal(promptLine('  spaced    out   words  '), 'spaced out words');
  assert.equal(promptLine(''), '');
});

test('promptParts splits a prompt into the user words and each pasted block, a block cut off by the length cap included', () => {
  assert.deepEqual(promptParts('for this we still do not want to lose too much details <pasted_content id="9527"> ## Module 1: Fundamentals - Setup </pasted_content id="9527"> keep it short'), [
    { kind: 'text', text: 'for this we still do not want to lose too much details' },
    { kind: 'pasted', text: '## Module 1: Fundamentals - Setup' },
    { kind: 'text', text: 'keep it short' },
  ]);
  assert.deepEqual(promptParts('<pasted_content id="1">a</pasted_content><pasted_content id="2">b</pasted_content>'), [
    { kind: 'pasted', text: 'a' },
    { kind: 'pasted', text: 'b' },
  ]);
  assert.deepEqual(promptParts('see this <pasted_content id="2"> cut off by the reader at 600 characters'), [
    { kind: 'text', text: 'see this' },
    { kind: 'pasted', text: 'cut off by the reader at 600 characters' },
  ]);
  assert.deepEqual(promptParts('just words'), [{ kind: 'text', text: 'just words' }]);
  assert.deepEqual(promptParts(''), []);
});
