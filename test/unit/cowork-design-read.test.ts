import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { READ_MODEL, READ_TOOL, designReadPrompt, isStale, parseDesignRead } from '../../src/cowork-design-read';

const ANSWER = {
  readme: '# Acme\nBrand rules.',
  tokens: [{ group: 'colors', name: 'brand', value: '#0a84ff' }, { group: 'spacing', name: 'gap', value: 8 }, { name: '', value: 'dropped' }],
  components: [{ name: 'Button', description: 'Primary action' }, 'Card'],
  files: ['README.md', { path: 'tokens.json' }, ''],
};

test('the prompt names the artifact, allows only reads and fixes the answer shape', () => {
  const p = designReadPrompt('https://claude.ai/artifact/AbC123', 'Acme');
  assert.match(p, /https:\/\/claude\.ai\/artifact\/AbC123/);
  assert.match(p, /Do not call create, publish, pin, unpin, write or delete/);
  assert.match(p, /"readme".*"tokens".*"components".*"files"/s);
  assert.equal(READ_MODEL, 'haiku');
  assert.equal(READ_TOOL, 'Artifact');
});

test('a fenced answer, or one with a sentence around it, parses into README, tokens, components and files', () => {
  for (const text of [JSON.stringify(ANSWER), '```json\n' + JSON.stringify(ANSWER) + '\n```', 'Here it is: ' + JSON.stringify(ANSWER) + ' Done.']) {
    const r = parseDesignRead(text, 'v1', 5, 0.01);
    assert.ok(!('error' in r), text.slice(0, 20));
    if ('error' in r) return;
    assert.equal(r.version, 'v1');
    assert.equal(r.readAt, 5);
    assert.equal(r.cost, 0.01);
    assert.equal(r.readme, '# Acme\nBrand rules.');
    assert.deepEqual(r.tokens, [{ group: 'colors', name: 'brand', value: '#0a84ff' }, { group: 'spacing', name: 'gap', value: '8' }]);
    assert.deepEqual(r.components, [{ name: 'Button', description: 'Primary action' }, { name: 'Card', description: '' }]);
    assert.deepEqual(r.files, ['README.md', 'tokens.json']);
  }
});

test('an answer that is not JSON, or that reports an error, is an error and no read', () => {
  assert.deepEqual(parseDesignRead('no json here', 'v1'), { error: 'Claude did not answer with the design system as JSON.' });
  assert.deepEqual(parseDesignRead('{"error": "no such artifact"}', 'v1'), { error: 'no such artifact' });
});

test('sizes are capped, so a huge answer does not fill the extension storage', () => {
  const r = parseDesignRead(JSON.stringify({ readme: 'x'.repeat(20000), tokens: Array.from({ length: 500 }, (_, i) => ({ name: `t${i}`, value: 'v' })), components: [], files: Array.from({ length: 900 }, (_, i) => `f${i}`) }), 'v1');
  if ('error' in r) return assert.fail(r.error);
  assert.equal(r.readme.length, 6000);
  assert.equal(r.tokens.length, 120);
  assert.equal(r.files.length, 300);
});

test('a read is stale when the artifact is on another version, never when the version is unknown', () => {
  const r = parseDesignRead(JSON.stringify(ANSWER), 'v1');
  if ('error' in r) return assert.fail(r.error);
  assert.equal(isStale(r, 'v1'), false);
  assert.equal(isStale(r, 'v2'), true);
  assert.equal(isStale(r, ''), false);
});
