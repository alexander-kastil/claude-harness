import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { findDataRoot, loadCoworkProjects, loadProjectContents } from '../../src/cowork-desktop';

// The fixture is a synthetic %LOCALAPPDATA% shaped like the desktop app's layout. COWORK_DESKTOP_FIXTURE names it when the tests run from an output folder outside the repo.
const fixtureRoot = (): string => {
  if (process.env.COWORK_DESKTOP_FIXTURE) {
    return process.env.COWORK_DESKTOP_FIXTURE;
  }
  for (const up of ['../..', '../../..']) {
    const p = path.join(__dirname, up, 'test', 'fixtures', 'cowork-desktop');
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error('cowork-desktop fixture not found');
};

test('the data folder is found by its claude_ pattern, not its literal name', () => {
  const root = findDataRoot(fixtureRoot());
  assert.ok(root && /claude_fixture$/.test(root.replace(/\\/g, '/')));
});

test('a missing data folder gives no projects and a null root', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-desktop-empty-'));
  assert.equal(findDataRoot(empty), null);
  assert.deepEqual(loadCoworkProjects(findDataRoot(empty)), { dataRoot: null, projects: [] });
  assert.equal(findDataRoot(undefined) === null || typeof findDataRoot(undefined) === 'string', true);
  fs.rmSync(empty, { recursive: true, force: true });
});

test('only spaces linked to a project are listed, newest activity first, with their sessions counted', () => {
  const d = loadCoworkProjects(findDataRoot(fixtureRoot()));
  assert.deepEqual(d.projects.map(p => p.name), ['Fixture Alpha', 'Fixture Beta']);
  const alpha = d.projects.find(p => p.id === 'space-alpha')!;
  assert.equal(alpha.projectUrl, 'https://claude.ai/project/11111111-2222-4333-8444-555555555555');
  assert.equal(alpha.sessions, 2, 'one by spaceId, one by folder, the unrelated one is left out');
  assert.equal(alpha.lastActivity, 1790020000000);
  const beta = d.projects.find(p => p.id === 'space-beta')!;
  assert.equal(beta.sessions, 0);
  assert.equal(beta.lastActivity, 1790001000000, 'falls back to the space update time');
});

test('Memory, Instructions and Grounding come from the space memory folder and the project folder', () => {
  const alpha = loadCoworkProjects(findDataRoot(fixtureRoot())).projects.find(p => p.id === 'space-alpha')!;
  const c = loadProjectContents(alpha);
  assert.deepEqual(c.sessions.map(s => [s.title, s.archived]), [['Fixture session one', false], ['Fixture session two (archived)', true]]);
  assert.equal(c.memory.index, true);
  assert.deepEqual(c.memory.entries.map(e => [e.file, e.name, e.description, e.type]), [['fixture-preference.md', 'fixture-preference', 'Synthetic memory entry for the tests', 'user']]);
  assert.ok(c.instructions && c.instructions.excerpt.startsWith('# Fixture instructions'));
  assert.ok(c.grounding);
  assert.deepEqual(c.grounding!.entries.map(e => e.name), ['docs', 'brief.txt', 'CLAUDE.md']);
  assert.equal(c.grounding!.entries[0].directory, true);
});

test('usage counts skills, connectors and tools from the tool_use records only', () => {
  const alpha = loadCoworkProjects(findDataRoot(fixtureRoot())).projects.find(p => p.id === 'space-alpha')!;
  const u = loadProjectContents(alpha).usage;
  assert.deepEqual(u.skills, [{ name: 'fixture-skill', count: 2 }, { name: 'other-skill', count: 1 }]);
  assert.deepEqual(u.tools.map(t => [t.name, t.count]), [['Skill', 3], ['Bash', 1]]);
  assert.deepEqual(u.connectors.map(c => [c.name, c.count]), [['Fixture Connector', 2], ['workspace', 1]]);
  assert.deepEqual(u.connectors[0].tools, [{ name: 'fixture_search', count: 2 }]);
});

test('a project with no data on disk reports nothing instead of failing', () => {
  const beta = loadCoworkProjects(findDataRoot(fixtureRoot())).projects.find(p => p.id === 'space-beta')!;
  const c = loadProjectContents(beta);
  assert.equal(c.memory.entries.length, 0);
  assert.equal(c.instructions, null);
  assert.equal(c.grounding, null);
  assert.equal(c.sessions.length, 0);
});
