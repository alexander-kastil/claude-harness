import * as assert from 'assert';
import test from 'node:test';
import { applyCard, chatPrompt, keepOf, leafText, parseProcedures, parseTurn, withRow } from '../../src/browser-hunt';
import type { BrowserCard } from '../../src/shared/browser-hunt';

const SKILL = [
  '# demo',
  '',
  '| Procedure | Keep as |',
  '|---|---|',
  '| Registrar records | a script against the registrar API, only on the pro plan; otherwise a guided browser run |',
  '| Registrar nameservers | a guided browser run with the saved click path (no API covers it) |',
  '| Roles | stay command line (az, Graph) |',
  '| Slides | the slide tools instead of the browser |',
].join('\n');

const card = (over: Partial<BrowserCard> = {}): BrowserCard => ({ id: 'c1', prompt: 'p', created: 1, name: 'registrar-dns', goal: 'Set the records.', keep: 'guided', stage: 'prototype', steps: [{ text: 'Open the page', manual: false }], ...over });

test('parseProcedures reads the table rows and classifies how each is kept', () => {
  const list = parseProcedures(SKILL);
  assert.deepEqual(list.map(p => [p.name, p.keep]), [['Registrar records', 'api'], ['Registrar nameservers', 'guided'], ['Roles', 'cli'], ['Slides', 'tool']]);
  assert.equal(keepOf('something else'), 'guided');
});

test('chatPrompt carries the skill, the card and the message', () => {
  const text = chatPrompt('make it an API script', SKILL, card(), [{ role: 'owner', text: 'hi', at: 1 }]);
  assert.match(text, /Registrar nameservers/);
  assert.match(text, /"name":"registrar-dns"/);
  assert.match(text, /Owner: hi/);
  assert.match(text, /make it an API script/);
});

test('parseTurn reads the JSON answer and falls back to plain text', () => {
  const t = parseTurn('{"reply":"Done.","card":{"name":"A B","goal":"g","keep":"api","stage":"prototype","steps":[{"text":"Sign in","manual":true},"Open the page",{"text":""}]}}');
  assert.equal(t.reply, 'Done.');
  assert.deepEqual(t.card?.steps, [{ text: 'Sign in', manual: true }, { text: 'Open the page', manual: false }]);
  assert.deepEqual(parseTurn('just words'), { reply: 'just words' });
});

test('leafText lists the steps with the manual ones marked, and withRow adds or replaces the skill row', () => {
  const c = card({ steps: [{ text: 'Sign in', manual: true }, { text: '', manual: false }, { text: 'Save', manual: false }] });
  const leaf = leafText(c);
  assert.match(leaf, /Stage: Prototype on desktop\nKept as: Guided browser run/);
  assert.match(leaf, /1\. Sign in \(manual\)\n2\. Save\n/);
  const added = withRow(SKILL, c);
  assert.equal(parseProcedures(added).length, 5);
  assert.equal(parseProcedures(added)[4].name, 'registrar-dns');
  // The same procedure again replaces its row.
  assert.equal(parseProcedures(withRow(added, card({ keep: 'cli' }))).filter(p => p.name === 'registrar-dns').length, 1);
  assert.equal(parseProcedures(withRow(added, card({ keep: 'cli' })))[4].keep, 'cli');
  // CRLF stays CRLF.
  assert.ok(!/[^\r]\n/.test(withRow(SKILL.replace(/\n/g, '\r\n'), c)));
});

test('applyCard makes a card, and updates only what Claude changed from what it was sent', () => {
  const answer = { name: 'Registrar DNS', goal: 'Set the records.', keep: 'api', stage: 'optimized', steps: [{ text: 'Call the API', manual: false }] };
  const fresh = applyCard(undefined, answer, 'msg', 'n1', 5);
  assert.equal(fresh.name, 'registrar-dns');
  assert.equal(fresh.keep, 'api');
  assert.equal(fresh.steps.length, 1);
  // The owner renamed the card while Claude answered; Claude echoed the old name back.
  const sent = card({ name: 'old', keep: 'guided' });
  const live = card({ name: 'mine', keep: 'guided' });
  const next = applyCard(live, { ...answer, name: 'old' }, 'msg', 'c1', 6, sent);
  assert.equal(next.name, 'mine');
  assert.equal(next.keep, 'api');
  assert.equal(next.stage, 'optimized');
  // No steps from Claude keep the card's own.
  assert.equal(applyCard(live, { ...answer, steps: [] }, 'msg', 'c1', 6, sent).steps.length, 1);
});
