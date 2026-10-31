import * as assert from 'assert';
import test from 'node:test';
import { CARD_PREFIX, cardSource } from '../../src/browser-hunt-draw';
import { drawPrompt, processPrompt } from '../../src/drawing';
import type { BrowserCard } from '../../src/shared/browser-hunt';

const card: BrowserCard = {
  id: 'bh-a',
  prompt: '',
  created: 1,
  name: 'registrar-nameservers',
  goal: 'Point a domain at the hosting provider nameservers.',
  keep: 'guided',
  stage: 'prototype',
  steps: [
    { text: 'Sign in to the registrar admin page', manual: true },
    { text: 'Open the nameserver settings at registrar.example.test/ns', manual: false },
    { text: 'Confirm the change and wait for the success banner', manual: false },
  ],
};

test('a procedure card is drawn from its leaf text, found by its id', () => {
  const source = cardSource(`${CARD_PREFIX}bh-a`, [card]);
  assert.equal(source?.kind, 'procedure');
  assert.equal(source?.name, 'registrar-nameservers');
  assert.match(source?.text ?? '', /Kept as: Guided run/);
  assert.match(source?.text ?? '', /1\. Sign in to the registrar admin page \(manual\)/);
  assert.equal(cardSource(`${CARD_PREFIX}other`, [card]), undefined);
  assert.equal(cardSource('cowork-task:bh-a', [card]), undefined);
  // A card with no step has nothing to draw.
  assert.equal(cardSource(`${CARD_PREFIX}bh-a`, [{ ...card, steps: [{ text: ' ', manual: false }] }]), undefined);
});

test('the two perspectives of a procedure ask for its sites and its steps in order, manual ones marked', () => {
  const text = cardSource(`${CARD_PREFIX}bh-a`, [card])!.text;
  const harness = drawPrompt('procedure', 'registrar-nameservers', text);
  assert.match(harness, /sites and apps its steps touch/);
  assert.match(harness, /Kept as/);
  assert.match(harness, /## Procedure card\n# registrar-nameservers/);
  const process = processPrompt('procedure', 'registrar-nameservers', text);
  assert.match(process, /steps in the order they run, across the pages and apps/);
  assert.match(process, /\(manual\) is drawn with a dashed outline/);
  assert.match(process, /final check/);
  assert.match(process, /\(manual\)\n2\. Open the nameserver settings/);
});
