import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { AGENTS_SKILL_READERS, agentsMdLoad, agentsVariants, globalScope, otherAgentsMd, repoScope, scan, skillAssets, specProblems } from '../../src/harness';
import { lockMissing, originsOf } from '../../src/skill-lock';
import { specIssues } from '../../src/skill-spec';
import { checkViaCli, cwdOf, restoreArgs, updateArgs } from '../../src/skills-cli';

// Temp folders only: the owner's home, repos and skills are never named, and no skills CLI runs.

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const skill = (dir: string, name: string, extra = '') => write(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: The ${name} skill\n${extra}---\nBody.\n`);
const GLOBAL_LOCK = (names: string[]) =>
  JSON.stringify({ version: 3, skills: Object.fromEntries(names.map(n => [n, { source: 'owner/skills', sourceType: 'github', sourceUrl: 'https://github.com/owner/skills.git', skillPath: `skills/${n}/SKILL.md`, skillFolderHash: 'a'.repeat(40), installMode: 'copy' }])) });

function home() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-compat-'));
  const claude = path.join(base, '.claude');
  // loop-me: copied to both folders, with a Codex file; find-skills: only in .agents.
  skill(path.join(claude, 'skills'), 'loop-me', 'disable-model-invocation: true\n');
  skill(path.join(base, '.agents', 'skills'), 'loop-me');
  write(path.join(claude, 'skills', 'loop-me', 'agents', 'openai.yaml'), 'interface:\n  display_name: "Loop Me"\npolicy:\n  allow_implicit_invocation: false\n');
  skill(path.join(base, '.agents', 'skills'), 'find-skills');
  write(path.join(base, '.agents', '.skill-lock.json'), GLOBAL_LOCK(['loop-me', 'find-skills']));
  return { base, claude };
}

test('a global skill the skills CLI put in both folders shows once, with its source and who loads it', () => {
  const { claude } = home();
  const found = skillAssets(globalScope(claude), path.join(claude, 'skills')).filter(a => a.name === 'loop-me');
  assert.equal(found.length, 1);
  assert.equal(found[0].origin?.source, 'owner/skills');
  assert.equal(found[0].origin?.lock, 'global');
  assert.equal(found[0].agents?.claude, true);
  assert.deepEqual(found[0].agents?.loadedBy, AGENTS_SKILL_READERS);
});

test('a skill only in .agents/skills shows once as not loaded by Claude Code, with its source', () => {
  const { claude } = home();
  const found = skillAssets(globalScope(claude), path.join(claude, 'skills')).filter(a => a.name === 'find-skills');
  assert.equal(found.length, 1);
  assert.equal(found[0].agents?.claude, false);
  assert.equal(found[0].origin?.source, 'owner/skills');
  assert.equal(found[0].id, 'global|skill:find-skills');
});

test('a repo shows its .agents-only skills, reads skills-lock.json, and lists a missing one as restorable', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-repo-'));
  skill(path.join(repo, '.claude', 'skills'), 'a-skill');
  skill(path.join(repo, '.agents', 'skills'), 'a-skill');
  skill(path.join(repo, '.agents', 'skills'), 'b-skill');
  const entry = (n: string) => ({ source: 'o/r', sourceType: 'github', skillPath: `skills/${n}/SKILL.md`, computedHash: 'b'.repeat(64) });
  write(path.join(repo, 'skills-lock.json'), JSON.stringify({ version: 1, skills: { 'a-skill': entry('a-skill'), 'b-skill': entry('b-skill'), 'gone-skill': entry('gone-skill') } }));
  const assets = skillAssets(repoScope(repo), path.join(repo, '.claude', 'skills'));
  assert.deepEqual(assets.map(a => a.name).sort(), ['a-skill', 'b-skill']);
  assert.equal(assets.find(a => a.name === 'b-skill')?.agents?.claude, false);
  assert.equal(assets.find(a => a.name === 'a-skill')?.origin?.lock, 'project');
  assert.deepEqual(lockMissing(repo), ['gone-skill']);
  assert.equal(originsOf(path.join(repo, '.claude')).has('gone-skill'), true);
});

test('agents/openai.yaml is read: allow_implicit_invocation false is the Codex counterpart of manual only', () => {
  const { claude } = home();
  const loop = skillAssets(globalScope(claude), path.join(claude, 'skills')).find(a => a.name === 'loop-me')!;
  assert.equal(loop.codex?.implicit, false);
  assert.match(loop.codex!.text, /Loop Me/);
  assert.equal(loop.meta?.manual, true);
  assert.equal(skillAssets(globalScope(claude), path.join(claude, 'skills')).find(a => a.name === 'find-skills')?.codex, undefined);
});

test('the spec check: name and description are required, the name is lowercase hyphenated, short and equals the folder', () => {
  assert.deepEqual(specIssues('ok-1', { name: 'ok-1', description: 'Fine' }), []);
  assert.equal(specIssues('x', {}).length, 2);
  assert.match(specIssues('x', { name: 'Bad_Name', description: 'd' }).map(i => i.message).join('|'), /lowercase/);
  assert.match(specIssues('a', { name: 'b', description: 'd' })[0].message, /must match the folder/);
  assert.equal(specIssues('a--b', { name: 'a--b', description: 'd' }).length, 1);
  assert.equal(specIssues('-a', { name: '-a', description: 'd' }).length, 1);
  assert.match(specIssues('n', { name: 'n', description: 'x'.repeat(1025) })[0].message, /1024/);
  assert.match(specIssues('n'.repeat(65), { name: 'n'.repeat(65), description: 'd' })[0].message, /64/);
  assert.match(specIssues('n', { name: 'n', description: 'd', compatibility: 'c'.repeat(501) })[0].message, /500/);
  assert.match(specIssues('n', { name: 'n', description: 'd', metadata: { a: 1 } })[0].message, /metadata/);
  assert.deepEqual(specIssues('n', { name: 'n', description: 'd', license: 'MIT', metadata: { a: 'b' }, 'allowed-tools': 'Read Bash' }), []);
});

test('the spec problems of a SKILL.md come with the line of the field, and only a skill file has any', () => {
  const text = '---\nname: wrong\ndescription: d\n---\nBody\n';
  assert.deepEqual(specProblems('/r/.agents/skills/right/SKILL.md', text).map(p => [p.line, p.field]), [[1, 'name']]);
  assert.equal(specProblems('/r/notes/SKILL.md', text).length, 0);
  assert.equal(specProblems('/r/skills/right/other.md', text).length, 0);
  assert.equal(specProblems('/r/skills/x/SKILL.md', '---\nname: x\n---\n')[0].line, 0);
  const { claude } = home();
  assert.deepEqual(skillAssets(globalScope(claude), path.join(claude, 'skills')).find(a => a.name === 'loop-me')?.spec, []);
});

test('npx skills check: a skill the output says has an update is newer whatever the exit code, a failed or silent run is an error', async () => {
  const run = (code: number | null, out: string) => async () => ({ code, out });
  const found = '↑ loop-me has an update\n1 skill(s) can be updated; run npx skills update to install';
  assert.deepEqual(await checkViaCli(['loop-me', 'other'], '/h', run(1, found)), { 'loop-me': { state: 'newer' }, other: { state: 'current' } });
  assert.equal((await checkViaCli(['loop-me'], '/h', run(3221226505, found)))['loop-me'].state, 'newer');
  assert.deepEqual(await checkViaCli(['loop-me'], '/h', run(0, '✓ All global skills are up to date')), { 'loop-me': { state: 'current' } });
  assert.deepEqual(await checkViaCli(['loop'], '/h', run(1, found)), { loop: { state: 'current' } });
  assert.equal((await checkViaCli(['x'], '/h', run(null, 'spawn npx ENOENT'))).x.state, 'error');
  assert.equal((await checkViaCli(['x'], '/h', run(0, ''))).x.state, 'error');
});

test('npx skills update takes -g for the global lock and -p for a repo, and restore is experimental_install', () => {
  assert.deepEqual(updateArgs(['loop-me'], 'global'), ['update', '-g', '-y', 'loop-me']);
  assert.deepEqual(updateArgs(['a', 'b'], 'project'), ['update', '-p', '-y', 'a', 'b']);
  assert.deepEqual(restoreArgs(), ['experimental_install']);
  assert.equal(cwdOf('repo:/work/r', '/h/.claude'), '/work/r');
  assert.equal(cwdOf('global', path.join('/h', '.claude')), os.tmpdir());
});

test('AGENTS.override.md and AGENTS.local.md are listed and not read by Claude Code; the home AGENTS.md files other agents read are listed', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-variants-'));
  write(path.join(repo, 'AGENTS.md'), 'a');
  write(path.join(repo, 'AGENTS.override.md'), 'o');
  write(path.join(repo, 'pkg', 'AGENTS.local.md'), 'l');
  assert.deepEqual(agentsVariants(repo), ['AGENTS.override.md', 'pkg/AGENTS.local.md']);
  assert.equal(agentsMdLoad(repo, 'AGENTS.override.md')?.state, 'not loaded');
  assert.match(agentsMdLoad(repo, 'AGENTS.override.md')!.why, /Codex/);
  assert.equal(agentsMdLoad(repo, 'pkg/AGENTS.local.md')?.state, 'not loaded');
  const names = scan(repoScope(repo)).find(c => c.kind === 'memory')!.items.map(a => a.name);
  assert.ok(names.includes('AGENTS.override.md') && names.includes('pkg/AGENTS.local.md'));

  const { base, claude } = home();
  write(path.join(base, '.codex', 'AGENTS.md'), 'codex');
  write(path.join(base, '.agents', 'AGENTS.md'), 'cline');
  assert.deepEqual(otherAgentsMd(base).map(o => o.name), ['~/.agents/AGENTS.md', '~/.codex/AGENTS.md']);
  write(path.join(claude, 'CLAUDE.md'), 'c');
  const global = scan(globalScope(claude)).find(c => c.kind === 'memory')!.items;
  assert.deepEqual(global.map(a => a.name).sort(), ['CLAUDE.md', '~/.agents/AGENTS.md', '~/.codex/AGENTS.md']);
  assert.equal(global.find(a => a.name === '~/.codex/AGENTS.md')?.load?.state, 'not loaded');
  assert.equal(global.find(a => a.name === 'CLAUDE.md')?.load, undefined);
});
