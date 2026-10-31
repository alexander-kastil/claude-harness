import * as assert from 'assert';
import test from 'node:test';
import { BROWSER_HUNT_SYSTEM, applyCard, chatPrompt, howSentence, keepOf, leafGoal, leafRel, leafText, parseProcedures, procedureDesc, parseTurn, withRow, withTrigger } from '../../src/browser-hunt';
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

test('the system prompt holds the rules: the four keeps, the manual cases and the JSON-only answer; the chat prompt only the data and the shape', () => {
  for (const keep of ['"api"', '"cli"', '"guided"', '"tool"']) assert.ok(BROWSER_HUNT_SYSTEM.includes(keep), keep);
  for (const manual of ['sign-in', 'MFA', 'granting a desktop app access', 'accepting an invite']) assert.ok(BROWSER_HUNT_SYSTEM.includes(manual), manual);
  assert.match(BROWSER_HUNT_SYSTEM, /^You are the Automation Hunter\./);
  assert.match(BROWSER_HUNT_SYSTEM, /\n## How it is kept\n/);
  assert.match(BROWSER_HUNT_SYSTEM, /Answer with one JSON object only\.$/);
  const text = chatPrompt('go', SKILL, undefined, []);
  assert.match(text, /^The owner is developing a procedure with you\. Follow the rules of your system prompt\./);
  assert.ok(!/"manual" is true only|"stage" is "prototype"/.test(text));
  assert.match(text, /"reply":"at most two short sentences","card":/);
  assert.ok(!text.includes('Sessions with browser or desktop use'), 'no sessions without the words');
  assert.match(BROWSER_HUNT_SYSTEM, /\n## How it is kept\n[\s\S]*\n## Hunting sessions\n\nWhen the message carries a "Sessions with browser or desktop use" section[\s\S]*so the owner can ask for the next one\.\n\n## How you talk\n/);
  const withSessions = chatPrompt('hunt last week', SKILL, undefined, [], '## Sessions with browser or desktop use (last week)\n\n| Date |');
  assert.ok(withSessions.indexOf('## Sessions with browser or desktop use (last week)') > withSessions.indexOf('## The skill that keeps their procedures'));
  assert.ok(withSessions.indexOf('## Sessions with') < withSessions.indexOf('## The procedure card as it stands now'));
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
  assert.match(leaf, /Stage: Prototype on desktop\nKept as: Guided run/);
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

test('withTrigger adds the card name to the description triggers once', () => {
  const skill = '---\nname: browser-automations\ndescription: Procedures. Triggers on "ionos dns", "registrar nameservers".\n---\n\n# demo\n';
  const added = withTrigger(skill, card({ name: 'desktop-app-signature' }));
  assert.match(added, /\ndescription: Procedures\. Triggers on "ionos dns", "registrar nameservers", "desktop app signature"\.\n/);
  assert.equal(withTrigger(added, card({ name: 'Desktop-App-Signature' })), added);
  // No "Triggers on" stays as it is; CRLF stays CRLF.
  const plain = '---\nname: x\ndescription: Procedures.\n---\n';
  assert.equal(withTrigger(plain, card()), plain);
  assert.ok(!/[^\r]\n/.test(withTrigger(skill.replace(/\n/g, '\r\n'), card({ name: 'a-b' }))));
});

test('the hover text is the leaf goal, then the how as a sentence without links or the steps tail', () => {
  assert.equal(howSentence('a guided browser run (the account has no DNS Pro, so no DNS API)'), 'A guided browser run (the account has no DNS Pro, so no DNS API).');
  assert.equal(howSentence('a guided run with the saved click path; steps in [references/x.md](references/x.md)'), 'A guided run with the saved click path.');
  assert.equal(howSentence('see [the guide](references/g.md) first.'), 'See the guide first.');
  const how = 'a guided run with the saved click path; steps in [references/x.md](references/x.md)';
  assert.equal(leafRel({ name: 'ionos-dns', how }), 'references/x.md');
  assert.equal(leafRel({ name: 'IONOS DNS records', how: 'a script' }), 'references/ionos-dns-records.md');
  const goal = leafGoal('# x\n\nSet the DNS records of a [domain](a.md)\nat IONOS.\n\nStage: Prototype on desktop\n');
  assert.equal(goal, 'Set the DNS records of a domain at IONOS.');
  assert.equal(procedureDesc({ how }, goal), 'Set the DNS records of a domain at IONOS.\nA guided run with the saved click path.');
  assert.equal(procedureDesc({ how: 'stay command line' }), 'Stay command line.');
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
