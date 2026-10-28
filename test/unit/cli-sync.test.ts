import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import type { SyncApplyCopy, SyncCopy } from '../../src/cli-sync';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `sync-cli-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`;

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/**
 * A Global folder with a skill `tool` and an agent `maker`; repo alpha holds a differing `tool`, an identical `maker`
 * and a repo-only `solo`; repo beta holds an identical `tool`. A plugin market holds `p` at 0.2.0.
 */
function fixture() {
  const home = tmp('home');
  const root = path.join(home, '.claude');
  const alpha = path.join(tmp('alpha'), 'alpha');
  const beta = path.join(tmp('beta'), 'beta');
  const market = tmp('market');
  const userConfig = path.join(home, '.claude.json');
  write(home, '.claude.json', '{}');
  write(root, 'skills/tool/SKILL.md', skill('tool', 'Global text'));
  write(root, 'skills/tool/references/new.md', '# New\n');
  write(root, 'agents/maker.md', '---\nname: maker\ndescription: makes\n---\n\nBody\n');
  write(alpha, '.claude/skills/tool/SKILL.md', skill('tool', 'Alpha text'));
  write(alpha, '.claude/agents/maker.md', '---\nname: maker\ndescription: makes\n---\n\nBody\n');
  write(alpha, '.claude/skills/solo/SKILL.md', skill('solo', 'Only here'));
  write(beta, '.claude/skills/tool/SKILL.md', skill('tool', 'Global text'));
  write(beta, '.claude/skills/tool/references/new.md', '# New\n');
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'm', plugins: [{ name: 'p', source: './plugins/p', version: '0.2.0' }] }));
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ m: { source: { source: 'directory', path: market }, installLocation: market } }));
  write(root, 'plugins/installed_plugins.json', JSON.stringify({ plugins: { 'p@m': [{ scope: 'user', version: '0.1.0' }] } }));
  const base = ['--root', root, '--user-config', userConfig];
  return { root, alpha, beta, base, repos: ['--repo', alpha, '--repo', beta] };
}

const backups = (root: string) => (fs.existsSync(path.join(root, 'repo-sync-backups')) ? fs.readdirSync(path.join(root, 'repo-sync-backups')) : []);

test('sync lists only the repo copies that differ from Global, with their state', async () => {
  const f = fixture();
  const r = await cli(['sync', '--json', ...f.base, ...f.repos]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as { copies: SyncCopy[]; applied: boolean };
  assert.equal(o.applied, false);
  assert.equal(o.copies.length, 1);
  assert.equal(path.basename(o.copies[0].repo), 'alpha');
  assert.deepEqual(
    { kind: o.copies[0].kind, name: o.copies[0].name, state: o.copies[0].state, files: o.copies[0].files },
    { kind: 'skill', name: 'tool', state: 'differs', files: { replaced: ['SKILL.md'], added: ['references/new.md'], deleted: [] } },
  );
});

test('sync text is a bold headline and a table, with (none) when nothing differs', async () => {
  const f = fixture();
  const r = await cli(['sync', ...f.base, ...f.repos]);
  assert.match(r.out, /^\*\*Sync · 1 copy differs from Global\*\*/);
  assert.match(r.out, /^\| Repo /m);
  assert.match(r.out, /\| tool +\| differs +\| +1 \| +1 \| +0 \|/);
  const none = await cli(['sync', ...f.base, '--repo', f.beta]);
  assert.match(none.out, /\*\*Sync · 0 copies differ from Global\*\*/);
  assert.match(none.out, /\| \(none\)/);
});

test('sync apply --dry-run prints each copy it would sync and writes nothing', async () => {
  const f = fixture();
  const r = await cli(['sync', 'apply', '--dry-run', ...f.base, ...f.repos]);
  assert.equal(r.code, 0);
  assert.match(r.out, /\[dry-run\] sync skill tool in .*alpha: 1 replaced, 1 added, 0 deleted\./);
  assert.equal(read(f.alpha, '.claude/skills/tool/SKILL.md'), skill('tool', 'Alpha text'));
  assert.deepEqual(backups(f.root), []);
  const j = JSON.parse((await cli(['sync', 'apply', '--dry-run', '--json', ...f.base, ...f.repos])).out) as { copies: SyncApplyCopy[]; applied: boolean };
  assert.equal(j.applied, false);
  assert.equal(j.copies[0].backup, null);
});

test('sync apply replaces the differing copy with Global after backing it up', async () => {
  const f = fixture();
  const r = await cli(['sync', 'apply', '--name', 'tool', '--json', ...f.base, ...f.repos]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as { copies: SyncApplyCopy[]; applied: boolean };
  assert.equal(o.applied, true);
  assert.equal(o.copies.length, 1);
  assert.ok(o.copies[0].backup && fs.existsSync(path.join(o.copies[0].backup, 'SKILL.md')));
  assert.equal(read(o.copies[0].backup!, 'SKILL.md'), skill('tool', 'Alpha text'));
  assert.equal(read(f.alpha, '.claude/skills/tool/SKILL.md'), skill('tool', 'Global text'));
  assert.ok(fs.existsSync(path.join(f.alpha, '.claude/skills/tool/references/new.md')));
  assert.equal(read(f.alpha, '.claude/skills/solo/SKILL.md'), skill('solo', 'Only here'));
  assert.match((await cli(['sync', ...f.base, ...f.repos])).out, /\*\*Sync · 0 copies differ from Global\*\*/);
});

test('sync apply with a --name that differs nowhere is an error', async () => {
  const f = fixture();
  assert.equal((await cli(['sync', 'apply', '--name', 'maker', '--dry-run', ...f.base, ...f.repos])).code, 1);
  assert.equal((await cli(['sync', 'apply', '--name', 'solo', '--dry-run', ...f.base, ...f.repos])).code, 1);
  assert.equal((await cli(['sync', 'apply', '--name', 'ghost', '--dry-run', ...f.base, ...f.repos])).code, 1);
  assert.deepEqual(backups(f.root), []);
});

test('sync plugin reports a current plugin as current and a plugin ahead of its installed copy as a dry-run update', async () => {
  const f = fixture();
  const ahead = await cli(['sync', 'plugin', '--name', 'p@m', '--dry-run', '--json', ...f.base]);
  assert.equal(ahead.code, 0);
  const o = JSON.parse(ahead.out) as { action: string; installed: string; source: string; applied: boolean };
  assert.deepEqual({ action: o.action, installed: o.installed, source: o.source, applied: o.applied }, { action: 'would update', installed: '0.1.0', source: '0.2.0', applied: false });
  assert.match((await cli(['sync', 'plugin', '--name', 'p@m', '--dry-run', ...f.base])).out, /\[dry-run\] claude plugin marketplace update m, then claude plugin update p@m\./);
  write(f.root, 'plugins/installed_plugins.json', JSON.stringify({ plugins: { 'p@m': [{ scope: 'user', version: '0.2.0' }] } }));
  const current = JSON.parse((await cli(['sync', 'plugin', '--name', 'p@m', '--dry-run', '--json', ...f.base])).out) as { action: string; applied: boolean };
  assert.deepEqual(current, { plugin: 'p@m', market: 'm', installed: '0.2.0', source: '0.2.0', action: 'current', applied: false });
});

test('sync plugin needs a plugin@market name that a marketplace holds', async () => {
  const f = fixture();
  assert.equal((await cli(['sync', 'plugin', ...f.base])).code, 2);
  assert.equal((await cli(['sync', 'plugin', '--name', 'plain', ...f.base])).code, 2);
  assert.equal((await cli(['sync', 'plugin', '--name', 'nope@m', '--dry-run', ...f.base])).code, 1);
});

test('sync needs apply or plugin when given a word', async () => {
  const f = fixture();
  assert.equal((await cli(['sync', 'frobnicate', ...f.base])).code, 2);
});
