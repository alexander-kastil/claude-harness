import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { EVENTS_MANIFEST, eventLayers, eventLogPath, eventSourceAt, findEventSources, readEventLog } from '../../src/events';
import { bindEvents, chipText, promptLine, promptParts, toneOfAll } from '../../src/shared/event-layers';
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
    [['at first', 'gone agent', 'end of first'], ['at second'], ['after last']]
  );
  assert.deepEqual(
    bound.agents.a1.map(e => e.hook),
    ['agent', 'late agent']
  );
  assert.equal(bound.agents.a2, undefined);
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
