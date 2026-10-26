import * as assert from 'assert';
import test from 'node:test';
import type { Asset, ScopeView } from '../../src/harness';
import { buildCatalog, inventoryText, reconcile } from '../../src/hunt-catalog';
import { chatPrompt, shortReply } from '../../src/hunt';
import { mergePrompt } from '../../src/consolidate';
import { sessionTitle } from '../../src/sessions';
import { stylePrompt } from '../../src/style';

const asset = (kind: 'skill' | 'agent', name: string, scope: string): Asset =>
  ({ id: `${scope}:${kind}:${name}`, scope, kind, name, description: `${name} does things`, file: `/${scope}/${kind}s/${name}/SKILL.md`, dir: `/${scope}/${kind}s/${name}`, mtime: 0 }) as Asset;

const view = (id: string, label: string, path: string, items: Asset[]): ScopeView => ({
  id,
  label,
  path,
  categories: (['skill', 'agent'] as const).map(kind => ({ kind, items: items.filter(a => a.kind === kind) }) as any),
});

test('the inventory Claude gets lists the same elements as the catalog, repos that are not open included', () => {
  const views = [
    view('global', 'Global', '/home/.claude', [asset('skill', 'a', 'global')]),
    view('repo:one', 'one', '/r/one', [asset('skill', 'a', 'one'), asset('skill', 'b', 'one')]),
    view('repo:two', 'two', '/r/two', [asset('agent', 'c', 'two')]),
  ];
  const plugins = [view('plugin:p@m', 'p', '/p', [asset('skill', 'only-in-plugin', 'p'), asset('skill', 'b', 'p')])];
  const lines = inventoryText(views, plugins, ['/r/one']).split('\n');
  assert.strictEqual(lines.length, buildCatalog(views, plugins).length);
  assert.ok(lines.some(l => l.startsWith('- skill a [global, one]')));
  assert.ok(lines.some(l => l.includes('agent c [two]')));
  assert.ok(lines.some(l => l.includes('skill b [one; shipped by plugin p]')));
  assert.ok(!lines.some(l => l.includes('only-in-plugin')));
});

test('a created card keeps every element it holds after the retired copies left the disk', () => {
  const card = { id: 'c1', prompt: '', created: 1, name: 'kit', description: '', category: '', assets: [{ kind: 'skill' as const, name: 'gone', include: true, why: '', global: { path: '/g', retire: true }, repos: [] }] };
  const open = reconcile([card], [], {});
  assert.strictEqual(open[0].assets[0].include, false);
  const done = reconcile([card], [], { c1: 'Created and installed kit@m.' });
  assert.strictEqual(done[0].assets[0].include, true);
  assert.strictEqual(done[0].assets[0].global?.retire, true);
});

test('the prompt asks for a reply of at most two short sentences and no element list', () => {
  const p = chatPrompt('search all dotnet related harness elements', '- skill a [global]', undefined, []);
  assert.ok(p.includes('"reply":"at most two short sentences"'));
  assert.ok(p.includes('Never list the elements'));
});

test('a reply is cut to two sentences and 240 characters', () => {
  assert.strictEqual(shortReply('Found 9.\n\nCore: a, b. Third one here.'), 'Found 9. Core: a, b.');
  assert.ok(shortReply('x'.repeat(500)).length <= 240);
});

test('a session name is one short line, and the style and merge prompts ask for short answers', () => {
  const name = sessionTitle({ aiTitle: `${'long '.repeat(60)}\nsecond line` }, undefined, 'abcdef123');
  assert.ok(name.length <= 100 && !name.includes('\n') && name.endsWith('...'));
  assert.strictEqual(sessionTitle({}, undefined, 'abcdef123'), 'abcdef12');
  const scan: any = { active: [], prompts: 1, interrupts: 0, replies: { count: 1, medianWords: 1, longest: 1, headings: 0, tables: 0, lists: 0 }, corrections: [] };
  assert.ok(stylePrompt(scan).includes('at most eight one-line rules'));
  const asset: any = { name: 'x', dir: '/a' };
  assert.ok(mergePrompt(asset, { label: 'Global', dir: '/b' } as any).includes('one short sentence'));
});
