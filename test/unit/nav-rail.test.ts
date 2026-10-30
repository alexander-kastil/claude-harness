import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeEntry, railCount, railEntries, railFromSaved, revealEntry } from '../../src/shared/nav-rail';
import type { RailInput } from '../../src/shared/nav-rail';

const input: RailInput = {
  code: { label: 'Claude Code', count: 7, groups: [{ id: 'global|skill', label: 'Skills', glyph: 'tools', count: 4 }, { id: 'markets', label: 'Marketplaces', glyph: 'package', count: 2 }] },
  cowork: { label: 'Cowork', count: 3, groups: [{ id: 'cowork|skill', label: 'Skills', glyph: 'tools', count: 3 }] },
  repos: { label: 'Repositories', count: 2, repos: [{ id: 'shop-api', label: 'shop-api', count: 5 }, { id: 'shop-web', label: 'shop-web', count: 0 }] },
};

test('the nav is expanded unless the stored state says collapsed', () => {
  assert.equal(railFromSaved(undefined), false);
  assert.equal(railFromSaved({}), false);
  assert.equal(railFromSaved({ navRail: false }), false);
  assert.equal(railFromSaved({ navRail: true }), true);
});

test('the rail has a button per region and group, in nav order, with the counts of the nav', () => {
  const rows = railEntries(input).map(e => `${e.level}:${e.id}:${e.count}`);
  assert.deepEqual(rows, ['0:region:code:7', '1:global|skill:4', '1:markets:2', '0:region:cowork:3', '1:cowork|skill:3', '0:region:repos:2', '1:repo:shop-api:5', '1:repo:shop-web:0']);
});

test('a hidden Cowork region has no rail buttons', () => {
  const rows = railEntries({ ...input, cowork: undefined }).map(e => e.id);
  assert.ok(!rows.some(id => id.includes('cowork')));
});

test('only the group of the open page is active', () => {
  assert.deepEqual(railEntries({ ...input, active: 'global|skill' }).filter(e => e.active).map(e => e.id), ['global|skill']);
  assert.deepEqual(railEntries({ ...input, active: 'repo:shop-web' }).filter(e => e.active).map(e => e.id), ['repo:shop-web']);
  assert.deepEqual(railEntries(input).filter(e => e.active), []);
});

test('the open page maps to its group', () => {
  assert.equal(activeEntry({ kind: 'skill', scope: 'global' }), 'global|skill');
  assert.equal(activeEntry({ kind: 'skill', scope: 'cowork' }), 'cowork|skill');
  assert.equal(activeEntry({ kind: 'skill', scope: 'shop-api' }), 'repo:shop-api');
  assert.equal(activeEntry({ market: true }), 'markets');
  assert.equal(activeEntry({ scope: 'shop-web' }), 'repo:shop-web');
  assert.equal(activeEntry({ repo: 'shop-web' }), 'repo:shop-web');
  assert.equal(activeEntry({}), undefined);
});

test('pressing a rail button opens its region and group and closes nothing', () => {
  const folds = { expanded: new Set(['global|agent']), openRepos: new Set(['shop-web']), foldedGroups: new Set(['region|code', 'region|repos', 'global|skill|where']) };
  const skills = railEntries(input).find(e => e.id === 'global|skill')!;
  assert.equal(revealEntry(skills, folds), 's|global|skill');
  assert.deepEqual([...folds.expanded].sort(), ['global|agent', 'global|skill']);
  assert.ok(!folds.foldedGroups.has('region|code'));
  assert.ok(folds.foldedGroups.has('region|repos') && folds.foldedGroups.has('global|skill|where'), 'other regions and groups keep their fold');
  const repo = railEntries(input).find(e => e.id === 'repo:shop-api')!;
  assert.equal(revealEntry(repo, folds), 'p|shop-api');
  assert.deepEqual([...folds.openRepos].sort(), ['shop-api', 'shop-web']);
  assert.ok(!folds.foldedGroups.has('region|repos'));
  const markets = railEntries(input).find(e => e.id === 'markets')!;
  assert.equal(revealEntry(markets, folds), 's|markets');
  assert.ok(folds.expanded.has('markets'));
  assert.equal(revealEntry(railEntries(input)[0], folds), 'r|code');
});

test('a count wider than two digits is capped for the 48px rail', () => {
  assert.equal(railCount(0), '0');
  assert.equal(railCount(99), '99');
  assert.equal(railCount(100), '99+');
});
