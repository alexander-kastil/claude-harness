import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import type { RepoOverviewLine, ReposOut } from '../../src/cli-repos';
import { standardText } from '../../src/cli-repos';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `repos-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const agent = (name: string) => `---\nname: ${name}\ndescription: ${name} agent.\n---\n\nBody\n`;

/**
 * A fake Claude folder with Global holding one agent, and two repos: alpha has a CLAUDE.md of three lines,
 * a copy of the global agent and no plugins; beta has a two-line CLAUDE.md and two enabled plugins.
 * No harness standard provider is installed, so the Standard columns are left out.
 */
function fixture() {
  const top = tmp('top');
  const root = path.join(top, '.claude');
  const alpha = path.join(top, 'alpha');
  const beta = path.join(top, 'beta');
  write(root, 'agents/shared.md', agent('shared'));
  write(root, 'settings.json', JSON.stringify({ enabledPlugins: { 'a@m': true, 'b@m': false } }));
  write(alpha, 'CLAUDE.md', '# alpha\none\ntwo\n');
  write(alpha, '.claude/agents/shared.md', agent('shared'));
  write(beta, 'CLAUDE.md', '# beta\nthree\n');
  write(beta, '.claude/settings.json', JSON.stringify({ enabledPlugins: { 'c@m': true, 'd@m': true } }));
  const base = ['--root', root, '--user-config', path.join(top, 'missing.json'), '--repo', alpha, '--repo', beta];
  return { root, alpha, beta, base, top };
}

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('repos --json has one row per repo, never the global scope, with the file counts', async () => {
  const f = fixture();
  const r = await cli(['repos', ...f.base, '--json']);
  assert.equal(r.code, 0);
  const data = JSON.parse(r.out) as ReposOut & { applied: boolean };
  assert.equal(data.applied, false);
  assert.equal(data.standard, null);
  assert.deepEqual(data.rows.map(x => path.basename(x.path)).sort(), ['alpha', 'beta']);
  const alpha = data.rows.find(x => x.path === f.alpha)!;
  const beta = data.rows.find(x => x.path === f.beta)!;
  assert.equal(alpha.lines, 3);
  assert.equal(beta.lines, 2);
  assert.equal(alpha.copies, 1);
  assert.equal(beta.copies, 0);
  assert.deepEqual(alpha.plugins, []);
  assert.deepEqual(beta.plugins, ['c@m', 'd@m']);
  assert.equal(alpha.checkState, 'no-plugin');
  assert.deepEqual(data.counts, { repos: 2, pass: 0, review: 0, fail: 0, error: 0 });
});

test('the text form is a headline, then one table row per repo without the Standard columns', async () => {
  const f = fixture();
  const r = await cli(['repos', ...f.base]);
  const lines = r.out.split('\n');
  assert.equal(lines[0], '**Repos · 2 · no standard provider**');
  assert.ok(lines[2].startsWith('| Repo'));
  assert.ok(!lines[2].includes('Standard'));
  assert.ok(lines.some(l => /^\| alpha\s+\|/.test(l)));
  assert.ok(lines.some(l => /^\| beta\s+\|/.test(l)));
});

test('no repos prints a (none) row', async () => {
  const top = tmp('empty');
  const root = path.join(top, '.claude');
  write(root, 'agents/shared.md', agent('shared'));
  const r = await cli(['repos', '--root', root, '--user-config', path.join(top, 'missing.json'), '--json']);
  const data = JSON.parse(r.out) as ReposOut;
  assert.deepEqual(data.rows, []);
  assert.equal(data.counts.repos, 0);
  const text = await cli(['repos', '--root', root, '--user-config', path.join(top, 'missing.json')]);
  assert.ok(text.out.includes('| (none)'));
});

test('a check error reads as its message, on one line', () => {
  const row = { checkState: 'error', error: 'first line\nsecond line' } as RepoOverviewLine;
  assert.equal(standardText(row), 'first line second line');
});

test('a failing check reads as fail with its count, and a review as review with its count', () => {
  const base = { checkState: 'fail', check: { fail: 3, review: 2, kind: 'x' } } as unknown as RepoOverviewLine;
  assert.equal(standardText(base), 'fail 3 · review 2');
  const review = { checkState: 'review', check: { fail: 0, review: 4, kind: 'x' } } as unknown as RepoOverviewLine;
  assert.equal(standardText(review), 'review 4');
  assert.equal(standardText({ checkState: 'pass' } as RepoOverviewLine), 'pass');
});
