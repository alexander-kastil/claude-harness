import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { compareVersions, projectSlug, renameInSettings } from '../../src/fleet';
import {
  closest,
  deadPointers,
  effectiveHarness,
  globalScope,
  globToRegExp,
  importsOf,
  layoutOf,
  linkCopies,
  memoryTree,
  pointerTokens,
  repoScope,
  retireAsset,
  retireBlock,
  scan,
} from '../../src/harness';
import { findingCode, initArgs, parseCheckJson, parseCheckText, parseFixOutput, parseInitOutput, problemsOf } from '../../src/standard';

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const writer = (root: string) => (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

test('parseCheckJson reads the JSON line and parseCheckText the text lines', () => {
  const json = parseCheckJson('{"repo": "r", "kind": "product", "fail": 1, "review": 1, "findings": [{"level": "FAIL", "text": "FAIL pointer not found: docs/x.md", "locations": [{"file": "CLAUDE.md", "line": 8, "token": "docs/x.md"}]}]}\n');
  assert.equal(json?.fail, 1);
  assert.equal(json?.findings[0].locations[0].line, 8);
  assert.equal(parseCheckJson('usage: error'), undefined);
  const text = parseCheckText(
    'FAIL .claude/settings.json repeats marketplace claude-mods\nREVIEW line 7 restates house rule \'commit or push\'\nFAIL pointer not found: docs/x.md\nrepo=r kind=class fail=2 review=1\n'
  );
  assert.equal(text.kind, 'class');
  assert.deepEqual(
    text.findings.map(f => f.locations[0]),
    [{ file: '.claude/settings.json', line: null }, { file: 'CLAUDE.md', line: 7 }, { file: 'CLAUDE.md', line: null, token: 'docs/x.md' }]
  );
});

test('problemsOf places a finding on its file and line, searching for a token without a line', () => {
  const result = parseCheckText('FAIL pointer not found: docs/x.md\nREVIEW line 3 restates house rule \'no docs\'\nFAIL lines=130 cap=120\nrepo=r kind=product fail=2 review=1\n');
  const problems = problemsOf(result, 'D:\\r', (_f, token) => (token === 'docs/x.md' ? 5 : undefined));
  assert.deepEqual(
    problems.map(p => [path.basename(p.file), p.line, p.code]),
    [
      ['CLAUDE.md', 4, 'pointer'],
      ['CLAUDE.md', 2, 'restated'],
      ['CLAUDE.md', 0, 'lines'],
    ]
  );
  assert.equal(findingCode("REVIEW line 10 boilerplate section 'Delegation'"), 'boilerplate');
});

test('fix and init output parse into change lines and files', () => {
  assert.deepEqual(parseFixOutput('settings.json: drop a@m (enabled globally)\ndelete .claude/hooks/steer.sh\nrepo=r changes=2 dry-run\n'), {
    changes: ['settings.json: drop a@m (enabled globally)', 'delete .claude/hooks/steer.sh'],
    count: 2,
  });
  assert.deepEqual(parseInitOutput('create CLAUDE.md\nskip   .gitignore\ncreated=1 skipped=1 dry-run\n'), {
    files: [
      { action: 'create', rel: 'CLAUDE.md' },
      { action: 'skip', rel: '.gitignore' },
    ],
    summary: 'created=1 skipped=1 dry-run',
  });
  assert.deepEqual(initArgs('D:\\r', { summary: ' An API. ', areas: [{ name: 'api', globs: 'src/api/**, src/shared/**', owner: 'dotnet-expert' }, { name: '', globs: '', owner: '' }], rules: ['Port 5000', ''] }, true), [
    '--root',
    'D:\\r',
    '--summary',
    'An API.',
    '--area',
    'api=src/api/**,src/shared/**:dotnet-expert',
    '--rule',
    'Port 5000',
    '--apply',
  ]);
});

test('globToRegExp matches paths: globs the way rules files use them', () => {
  const re = (g: string) => globToRegExp(g);
  assert.ok(re('src/api/**').test('src/api/a/b.cs'));
  assert.ok(re('**/*.ts').test('a/b/c.ts'));
  assert.ok(re('**/*.ts').test('c.ts'));
  assert.ok(!re('src/*.ts').test('src/a/b.ts'));
  assert.ok(re('src/{api,web}/**').test('src/web/x.html'));
  assert.ok(re('./docs/*.md').test('docs/a.md'));
});

test('imports expand recursively outside code, and the effective harness merges plugins', () => {
  const root = tmp('harness-eff-');
  const w = writer(root);
  w('repo/CLAUDE.md', '# R\n\nSee @docs/a.md and `@not/this.md`.\n\n```\n@docs/b.md\n```\n');
  w('repo/docs/a.md', 'Then @./c.md\n');
  w('repo/docs/c.md', 'leaf\n');
  w('repo/.claude/rules/api.md', '---\npaths:\n  - "src/api/**"\n---\n\n# api\n\n- Owner agent: `dotnet-expert`.\n');
  w('repo/.claude/rules/deploy.md', '# deploy\n');
  w('repo/src/api/x.cs', '');
  w('repo/.claude/settings.json', '{ "enabledPlugins": { "a@m": true, "b@m": false } }');
  w('home/settings.json', '{ "enabledPlugins": { "a@m": true, "b@m": true }, "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "x.sh" }] }] } }');
  w('home/CLAUDE.md', '# Global\n');
  assert.deepEqual(importsOf('a @x.md\n`@y.md`\n```\n@z.md\n```\n'), ['x.md']);
  const tree = memoryTree(path.join(root, 'repo', 'CLAUDE.md'), 'CLAUDE.md');
  assert.deepEqual([tree.imports[0].label, tree.imports[0].imports[0].label], ['docs/a.md', './c.md']);
  const e = effectiveHarness({ ...globalScope(path.join(root, 'home')) }, repoScope(path.join(root, 'repo')));
  assert.deepEqual(e.memory.map(m => m.label), ['~/.claude/CLAUDE.md', 'CLAUDE.md']);
  assert.deepEqual(e.rules.map(r => [r.name, r.always, r.total]), [
    ['api', false, 1],
    ['deploy', true, 0],
  ]);
  assert.deepEqual(e.plugins.map(p => [p.key, p.enabled, p.duplicate]), [
    ['a@m', true, true],
    ['b@m', false, false],
  ]);
  assert.deepEqual(e.hooks.map(h => [h.event, h.command]), [['Stop', 'x.sh']]);
});

test('pointerTokens classifies paths, skills and agents; deadPointers checks them', () => {
  const root = tmp('harness-ptr-');
  writer(root)('docs/real.md', '');
  const text = ['- Owner agent: `dotnet-expert`.', '- Use the `hugo-expert` skill and `docs/real.md`, not `docs/gone.md`.', '- The `ghost-agent` agent writes docs.', '```', '`skipped-agent` agent', '```'].join('\n');
  assert.deepEqual(
    pointerTokens(text).map(t => [t.token, t.kind]),
    [
      ['dotnet-expert', 'agent'],
      ['hugo-expert', 'skill'],
      ['docs/real.md', 'path'],
      ['docs/gone.md', 'path'],
      ['ghost-agent', 'agent'],
    ]
  );
  const roster = { skills: new Set(['hugo-expert']), agents: new Set(['dotnet-expert', 'ghost-agnt']) };
  assert.deepEqual(
    deadPointers(text, root, roster).map(t => t.token),
    ['docs/gone.md', 'ghost-agent']
  );
  assert.deepEqual(closest('ghost-agent', roster.agents), ['ghost-agnt']);
});

test('layoutOf tells router, old template, class boilerplate, other and none apart', () => {
  const mk = (files: Record<string, string>) => {
    const dir = tmp('harness-lay-');
    for (const [rel, text] of Object.entries(files)) writer(dir)(rel, text);
    return dir;
  };
  assert.equal(layoutOf(mk({})), 'none');
  assert.equal(layoutOf(mk({ 'CLAUDE.md': '## Project\n\n## Harness\n' })), 'router');
  assert.equal(layoutOf(mk({ 'CLAUDE.md': '## Workflow Orchestration\n' })), 'old template');
  assert.equal(layoutOf(mk({ 'CLAUDE.md': '## Layout\n', 'demos/x': '', 'labs/y': '' })), 'class boilerplate');
  assert.equal(layoutOf(mk({ 'CLAUDE.md': '# Notes\n' })), 'other');
});

test('linkCopies marks hook scripts and plugin copies; Retire backs up a clean repo copy', () => {
  const home = tmp('harness-home-');
  writer(home)('skills/hugo/SKILL.md', '---\nname: hugo\nversion: 1\n---\nBody\n');
  const repo = tmp('harness-repo-');
  const w = writer(repo);
  w('CLAUDE.md', '# Repo\n');
  w('.claude/skills/hugo/SKILL.md', '---\nname: hugo\nversion: 1\n---\nBody\n');
  w('.claude/agents/writer.md', '---\nname: writer\nversion: 2\n---\nWrite  well.\n');
  w('.claude/hooks/guard.sh', 'echo hi\n');
  const other = tmp('harness-other-');
  writer(other)('.claude/hooks/guard.sh', 'echo bye\n');
  const plugin = tmp('harness-plugin-');
  writer(plugin)('agents/writer.md', '---\nname: writer\nversion: 3\n---\nWrite well.\n');
  const views = [globalScope(home), repoScope(repo), repoScope(other)].map(s => ({ id: s.id, label: s.label, path: s.base, categories: scan(s) }));
  const pluginView = { id: 'plugin:p@m', label: 'plugin p@m', path: plugin, categories: [{ ...scan(globalScope(plugin))[2], items: scan({ ...globalScope(plugin), id: 'plugin:p@m' }).find(c => c.kind === 'agent')!.items }] };
  linkCopies(views, [pluginView]);
  const item = (v: number, kind: string, name: string) => views[v].categories.find(c => c.kind === kind)!.items.find(a => a.name === name)!;
  assert.deepEqual(item(1, 'hookScript', 'guard.sh').copies!.map(c => c.same), [false]);
  assert.deepEqual(item(1, 'agent', 'writer').copies!.map(c => [c.scope, c.same, c.near]), [['plugin:p@m', false, true]]);
  const skill = item(1, 'skill', 'hugo');
  assert.equal(retireBlock(skill, repo), undefined);
  assert.match(retireBlock(item(1, 'agent', 'writer'), repo)!, /no identical/);
  const dest = retireAsset(skill, repo, path.join(home, 'repo-sync-backups'), '20261020-120000');
  assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(repo, '.claude', 'skills', 'hugo')));
  writer(repo)('demos/a', '');
  writer(repo)('labs/b', '');
  assert.match(retireBlock(skill, repo)!, /class repo/);
});

test('renameInSettings rewrites @old plugin ids and the marketplace key, nothing else', () => {
  const dir = tmp('harness-ren-');
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{\n  "model": "opus",\n  "enabledPlugins": {\n    "a@old": true,\n    "b@other": false\n  },\n  "extraKnownMarketplaces": {\n    "old": { "source": { "source": "directory", "path": "D:/m" } }\n  }\n}\n');
  const edit = renameInSettings(file, 'old', 'new')!;
  const after = JSON.parse(edit.after);
  assert.deepEqual(after.enabledPlugins, { 'b@other': false, 'a@new': true });
  assert.deepEqual(Object.keys(after.extraKnownMarketplaces), ['new']);
  assert.equal(after.model, 'opus');
  assert.equal(fs.readFileSync(file, 'utf8').includes('a@old'), true);
  assert.equal(renameInSettings(file, 'none', 'x'), undefined);
});

test('compareVersions and projectSlug', () => {
  assert.ok(compareVersions('0.1.10', '0.1.9') > 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(projectSlug('D:\\git-projects\\claude-harness'), 'D--git-projects-claude-harness');
});
