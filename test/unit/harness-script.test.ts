import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import { test } from 'node:test';
import { checkScriptText } from '../../src/cli-build';
import { helpEntries, hoverFor, scriptCandidates } from '../../src/harness-script';

const texts = (before: string) => scriptCandidates(before).candidates.map(c => c.text);

test('a script line completes its verb, the kind, flags and values without the command line prefix', () => {
  assert.deepEqual(texts('ge'), ['generate']);
  assert.deepEqual(texts(''), ['repo', 'add', 'generate', 'g', 'new', 'update']);
  assert.deepEqual(texts('generate '), ['agent', 'rule', 'skill', 'command', 'hook', 'mcp']);
  assert.deepEqual(texts('generate agent x --model h'), ['haiku']);
  assert.ok(texts('generate agent x --').includes('--tools'));
  assert.ok(!texts('generate agent x --').includes('--json'));
  assert.ok(!texts('add x@y --').includes('--dry-run'));
  assert.deepEqual(texts('repo '), []);
});

test('the completion replaces only the word at the cursor', () => {
  const line = 'generate agent x --tools Read,G';
  const c = scriptCandidates(line);
  assert.equal(line.slice(c.start), 'Read,G');
  assert.ok(c.candidates.some(x => x.text === 'Read,Glob'));
});

test('HELP gives an entry per command and per option, and a hover finds the command and the flag', () => {
  const keys = helpEntries().map(e => e.key);
  for (const k of ['generate agent', 'generate hook', 'add', 'new', 'update', 'validate', 'run', '--dry-run']) assert.ok(keys.includes(k), k);
  const hover = hoverFor('generate agent x --dry-run', '--dry-run');
  assert.equal(hover[0].key, '--dry-run');
  assert.equal(hover[1].key, 'generate agent');
  assert.match(hover[1].text, /Make sure an agent exists/);
  assert.equal(hoverFor('g rule r', 'rule')[0].key, 'generate rule');
  assert.equal(hoverFor('repo D:/x', 'repo')[0].key, 'repo');
});

test('checkScriptText gives the problems of unsaved text with their lines, for the editor diagnostics', () => {
  const root = os.tmpdir();
  const { problems, steps } = checkScriptText('# c\ngenerate agent Bad --colour red\nnope\ngenerate rule ok\n', root, root, root);
  assert.deepEqual([...new Set(problems.map(p => p.line))], [2, 3]);
  assert.equal(steps.length, 2);
});

test('the film script has no problem on its finished lines, and none on the line being typed at any prefix', () => {
  const root = os.tmpdir();
  const line = 'generate agent storyboard --model opus --tools Read,Write --description "Checks the brief first"';
  assert.deepEqual(checkScriptText(`${line}\n`, root, root, root).problems, []);
  let flagged = 0;
  for (let i = 1; i <= line.length; i++) {
    const text = `generate agent image-maker --model opus\n${line.slice(0, i)}`;
    if (checkScriptText(text, root, root, root).problems.length) flagged++;
    assert.deepEqual(checkScriptText(text, root, root, root, [2]).problems, [], line.slice(0, i));
  }
  assert.ok(flagged > 0, 'the prefixes are problems once the cursor leaves the line');
});

test('a problem on a line the cursor is not on is still reported', () => {
  const root = os.tmpdir();
  const { problems } = checkScriptText('generate agent a --model nope\ngenerate agent b --tools Re', root, root, root, [2]);
  assert.deepEqual(problems.map(p => p.line), [1]);
});
