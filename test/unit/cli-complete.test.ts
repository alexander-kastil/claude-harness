import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { COMMANDS, candidates } from '../../src/cli-complete';
import { run } from '../../src/cli';
import { projectSlug } from '../../src/repos-overview';

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const skill = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\nBody\n`;

/** A fake Claude folder with two skills and an agent in Global, a repo that copies one skill, film and images folders, and one session. */
function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-complete-'));
  const root = path.join(tmp, '.claude');
  const repo = path.join(tmp, 'repo');
  write(path.join(root, 'skills/same/SKILL.md'), skill('same'));
  write(path.join(root, 'skills/moved/SKILL.md'), skill('moved'));
  write(path.join(root, 'agents/helper.md'), '---\nname: helper\ndescription: helps\n---\n\nHi\n');
  write(path.join(repo, 'CLAUDE.md'), '# repo\n');
  write(path.join(repo, '.claude/skills/same/SKILL.md'), skill('same'));
  for (const d of ['assets/films/alpha', 'assets/films/beta', 'assets/images/gamma']) fs.mkdirSync(path.join(repo, d), { recursive: true });
  write(path.join(repo, 'assets/films/notes.md'), 'not a folder\n');
  const sid = '11111111-2222-3333-4444-555555555555';
  const prompt = { type: 'user', uuid: 'u1', timestamp: '2026-10-27T10:00:00.000Z', sessionId: sid, cwd: repo, message: { role: 'user', content: 'build the thing' } };
  write(path.join(root, 'projects', projectSlug(repo), `${sid}.jsonl`), `${JSON.stringify(prompt)}\n`);
  const at = (...args: string[]) => args.map(a => `"${a}"`).join(' ');
  return { root, repo, sid, base: `--root ${at(root)} --repo ${at(repo)}` };
}

const texts = (line: string) => candidates(line).map(c => c.text);

test('HELP and the command table name the same commands', async () => {
  const out: string[] = [];
  assert.equal(await run(['--help'], { out: t => out.push(t), err: () => undefined }), 0);
  const documented = out.join('\n').split('\n').flatMap(line => {
    const words: string[] = [];
    for (const t of line.slice(2).split(/\s+/)) {
      if (!/^[a-z][a-z-]*$/.test(t)) break;
      words.push(t);
    }
    return line.startsWith('  ') && words.length ? [words.join(' ')] : [];
  });
  assert.deepEqual([...new Set(documented)].sort(), COMMANDS.map(c => c.path).sort());
});

test('a command prefix completes to the command', () => {
  assert.deepEqual(texts('harness con'), ['consolidate']);
  assert.deepEqual(texts('harness com'), ['complete', 'completion']);
});

test('--kind completes skill and agent', () => {
  assert.deepEqual(texts('harness consolidate retire --kind '), ['skill', 'agent']);
});

test('agents completes its subcommands', () => {
  assert.deepEqual(texts('harness agents '), ['list', 'route']);
});

test('cowork and browser-hunt complete their subcommands and --source', () => {
  assert.deepEqual(texts('harness cowork handover '), ['sources', 'plan', 'create']);
  assert.ok(texts('harness cowork ').includes('chats'));
  assert.deepEqual(texts('harness browser-hunt '), ['procedures', 'sessions', 'plan', 'create']);
  assert.deepEqual(texts('harness cowork handover plan --source '), ['chat', 'download', 'cloud', 'link']);
});

test('--session completes latest, previous, then the repo sessions with their first prompt', () => {
  const f = fixture();
  const found = candidates(`harness usage ${f.base} --session `);
  assert.deepEqual(found.slice(0, 2).map(c => c.text), ['latest', 'previous']);
  const session = found.find(c => c.text === f.sid);
  assert.ok(session);
  assert.match(session.description, /build the thing/);
});

test('media doctor completes the film and images folders of the repo', () => {
  const f = fixture();
  const values = candidates(`harness media doctor --repo "${f.repo}" `).filter(c => c.kind === 'value').map(c => c.text.replace(/"/g, ''));
  assert.deepEqual(values, [
    path.join(f.repo, 'assets/films/alpha'),
    path.join(f.repo, 'assets/films/beta'),
    path.join(f.repo, 'assets/images/gamma'),
  ]);
});

test('--name narrows to agents when --kind agent is given', () => {
  const f = fixture();
  const agents = texts(`harness consolidate retire ${f.base} --kind agent --name `);
  assert.ok(agents.includes('helper'));
  assert.ok(!agents.includes('same'));
  assert.ok(texts(`harness consolidate ${f.base} --name `).includes('same'));
});

test('--skills completes the item after the last comma and leaves the typed ones out', () => {
  const f = fixture();
  const found = texts(`harness hunt plan ${f.base} --skills same,`);
  assert.ok(found.includes('same,moved'));
  assert.ok(found.every(t => t.startsWith('same,') && t !== 'same,same'));
});

test('a flag already used is not offered again; a repeatable one is', () => {
  const f = fixture();
  const flags = texts(`harness usage ${f.base} --session latest --`);
  assert.ok(!flags.includes('--session'));
  assert.ok(flags.includes('--week'));
  assert.ok(texts(`harness usage --session latest --repo ${f.repo} --`).includes('--repo'));
});

test('a missing folder or an unknown command answers nothing, and never throws', () => {
  assert.deepEqual(texts('harness nonsense '), []);
  assert.deepEqual(candidates(''), []);
  assert.deepEqual(
    candidates('harness usage --root "/no/such/claude/folder" --repo "/no/such/repo" --session ').map(c => c.text),
    ['latest', 'previous'],
  );
});

test('complete answers one candidate per line, or a JSON array with --json', async () => {
  const out: string[] = [];
  const code = await run(['complete', '--line', 'harness con'], { out: t => out.push(t), err: () => undefined });
  assert.equal(code, 0);
  assert.equal(out.join('\n'), 'consolidate');
  const json: string[] = [];
  await run(['complete', '--json', '--line', 'harness consolidate '], { out: t => json.push(t), err: () => undefined });
  const found = JSON.parse(json.join('\n')) as { text: string; kind: string; description: string }[];
  assert.ok(found.some(c => c.text === 'retire' && c.kind === 'command'));
  assert.ok(found.some(c => c.text === '--name' && c.kind === 'flag'));
});

test('completion prints the PowerShell completer that calls complete', async () => {
  const out: string[] = [];
  assert.equal(await run(['completion', 'powershell'], { out: t => out.push(t), err: () => undefined }), 0);
  const script = out.join('\n');
  assert.ok(script.includes('Register-ArgumentCompleter -Native -CommandName harness'));
  assert.ok(script.includes('harness complete --line $line --position $position'));
  assert.ok(script.includes('CompletionResult'));
});

test('completion prints the bash completer that calls complete', async () => {
  const out: string[] = [];
  assert.equal(await run(['completion', 'bash'], { out: t => out.push(t), err: () => undefined }), 0);
  const script = out.join('\n');
  assert.ok(script.includes('complete -F _harness_complete harness'));
  assert.ok(script.includes('harness complete --line "$COMP_LINE" --position "$COMP_POINT"'));
});

test('completion with another shell exits 2 with the usage', async () => {
  const err: string[] = [];
  assert.equal(await run(['completion', 'zsh'], { out: () => undefined, err: t => err.push(t) }), 2);
  assert.equal(err.join('\n'), 'Usage: harness completion powershell|bash');
  assert.equal(await run(['completion'], { out: () => undefined, err: () => undefined }), 2);
  assert.deepEqual(texts('harness completion ').slice(0, 2), ['powershell', 'bash']);
});

test('complete stays fast on the fixture root', () => {
  const f = fixture();
  const started = Date.now();
  candidates(`harness usage ${f.base} --session `);
  candidates(`harness consolidate retire ${f.base} --kind skill --name `);
  assert.ok(Date.now() - started < 150, `took ${Date.now() - started} ms`);
});
