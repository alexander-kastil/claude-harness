import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogAddress, parseCatalog, searchCatalog } from '../../src/skills-catalog';
import type { CatalogFetch } from '../../src/skills-catalog';

// The search source is stubbed: no request leaves the machine.
const answer = (body: unknown, status = 200): CatalogFetch => async () => ({ ok: status < 400, status, json: async () => body });

const BODY = {
  skills: [
    { id: 'anthropics/skills/pdf', source: 'anthropics/skills', skillId: 'pdf', name: 'pdf', installs: 227931 },
    { id: 'vercel-labs/json-render/react-pdf', source: 'vercel-labs/json-render', skillId: 'react-pdf', name: 'react-pdf', installs: 2376 },
    { id: 'x/y/z', source: 'x/y', name: 'z' },
    { id: 'broken' },
  ],
};

test('a registry answer becomes rows with name, repository and install count', () => {
  const rows = parseCatalog(BODY);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { id: 'anthropics/skills/pdf', name: 'pdf', source: 'anthropics/skills', skill: 'pdf', installs: 227931, description: undefined });
  assert.equal(rows[2].skill, 'z', 'the skill falls back to the id tail');
  assert.equal(rows[2].installs, undefined);
});

test('the search sends one request with the query and returns the rows', async () => {
  const urls: string[] = [];
  const r = await searchCatalog(' pdf tools ', async url => (urls.push(url), answer(BODY)(url)));
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/api\/search\?q=pdf\+tools$/);
  assert.equal(r.skills.length, 3);
  assert.equal(r.error, undefined);
});

test('an empty query asks nobody', async () => {
  let called = false;
  const r = await searchCatalog('   ', async url => ((called = true), answer(BODY)(url)));
  assert.equal(called, false);
  assert.deepEqual(r.skills, []);
});

test('a refusal or a network failure is an error line, never a throw', async () => {
  assert.match((await searchCatalog('pdf', answer({}, 500))).error!, /500/);
  const down = await searchCatalog('pdf', async () => {
    throw new Error('offline');
  });
  assert.match(down.error!, /offline/);
  assert.deepEqual(down.skills, []);
});

test('a body without a skills list is no rows', () => {
  assert.deepEqual(parseCatalog(undefined), []);
  assert.deepEqual(parseCatalog({ skills: 'x' }), []);
});

test('an install goes through the address Add from skills.sh takes', () => {
  assert.equal(catalogAddress({ source: 'anthropics/skills', skill: 'pdf' }), 'anthropics/skills/pdf');
});
