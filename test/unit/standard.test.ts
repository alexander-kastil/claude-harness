import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { compareVersions, projectSlug, renameInSettings } from '../../src/repos-overview';
import {
  closest,
  deadPointers,
  effectiveHarness,
  globalScope,
  globToRegExp,
  importsOf,
  linkCopies,
  memoryTree,
  pointerTokens,
  repoScope,
  retireAsset,
  retireBlock,
  ruleInfo,
  scan,
} from '../../src/harness';
import { findProvider, parseCheckJson, parseFixOutput, parseScaffoldOutput, problemsOf, providerAt, scaffoldArgs } from '../../src/standard';

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const writer = (root: string) => (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

test('a plugin with a harness-standard manifest is the provider; one without is ignored', () => {
  const plain = tmp('harness-plain-');
  writer(plain)('.claude-plugin/plugin.json', '{ "name": "plain" }');
  const prov = tmp('harness-prov-');
  writer(prov)('scripts/check.py', '');
  writer(prov)('.claude-plugin/harness-standard.json', '{ "name": "demo standard", "check": "scripts/check.py", "fix": "scripts/fix.py", "align": "/demo:align", "ownerPattern": "^Owner: (\\\\S+)" }');
  assert.equal(providerAt(plain), undefined);
  const found = findProvider([{ dir: plain, installed: true }, { dir: prov, installed: true }]);
  assert.equal(found?.name, 'demo standard');
  assert.equal(found?.check, path.join(prov, 'scripts', 'check.py'));
  assert.equal(found?.align, '/demo:align');
  assert.equal(found?.scaffold, undefined);
  writer(prov)('.claude/rules/api.md', '---\npaths: src/**\n---\nOwner: dotnet-expert\n');
  const rule = scan(repoScope(prov)).find(c => c.kind === 'rule')!.items[0];
  const roster = { skills: new Set<string>(), agents: new Set(['dotnet-expert']) };
  assert.equal(ruleInfo(rule, prov, roster, found?.ownerPattern).owner, 'dotnet-expert');
  assert.equal(ruleInfo(rule, prov, roster).owner, undefined);
});

test('parseCheckJson and problemsOf place each finding on its file and line', () => {
  const json = parseCheckJson(
    '{"repo": "r", "kind": "product", "layout": "router", "metrics": {"lines": 40, "emDashes": 1}, "fail": 1, "review": 1, "findings": [' +
      '{"level": "FAIL", "code": "pointer", "text": "FAIL pointer not found: docs/x.md", "locations": [{"file": "CLAUDE.md", "line": null, "token": "docs/x.md"}]},' +
      '{"level": "REVIEW", "code": "restated", "text": "REVIEW line 3 restates a rule", "locations": [{"file": "CLAUDE.md", "line": 3}]},' +
      '{"level": "FAIL", "text": "FAIL other", "locations": [{"file": ".claude/settings.json", "line": null}]}]}\n'
  );
  assert.equal(json?.layout, 'router');
  assert.equal(json?.metrics?.emDashes, 1);
  assert.equal(parseCheckJson('usage: error'), undefined);
  const problems = problemsOf(json!, 'D:\\r', (_f, token) => (token === 'docs/x.md' ? 5 : undefined));
  assert.deepEqual(
    problems.map(p => [path.basename(p.file), p.line, p.code]),
    [
      ['CLAUDE.md', 4, 'pointer'],
      ['CLAUDE.md', 2, 'restated'],
      ['settings.json', 0, 'standard'],
    ]
  );
});

test('fix and scaffold output parse into change lines and files', () => {
  assert.deepEqual(parseFixOutput('settings.json: drop a@m (enabled globally)\ndelete .claude/hooks/steer.sh\nrepo=r changes=2 dry-run\n'), {
    changes: ['settings.json: drop a@m (enabled globally)', 'delete .claude/hooks/steer.sh'],
    count: 2,
  });
  assert.deepEqual(parseScaffoldOutput('create CLAUDE.md\nskip   .gitignore\ncreated=1 skipped=1 dry-run\n'), {
    files: [
      { action: 'create', rel: 'CLAUDE.md' },
      { action: 'skip', rel: '.gitignore' },
    ],
    summary: 'created=1 skipped=1 dry-run',
  });
  assert.deepEqual(scaffoldArgs('D:\\r', { summary: ' An API. ', areas: [{ name: 'api', globs: 'src/api/**, src/shared/**', owner: 'dotnet-expert' }, { name: '', globs: '', owner: '' }], rules: ['Port 5000', ''] }, true), [
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
  const plugin = tmp('harness-');
  writer(plugin)('agents/writer.md', '---\nname: writer\nversion: 3\n---\nWrite well.\n');
  const views = [globalScope(home), repoScope(repo), repoScope(other)].map(s => ({ id: s.id, label: s.label, path: s.base, categories: scan(s) }));
  const pluginView = { id: 'plugin:p@m', label: 'plugin p@m', path: plugin, categories: [{ ...scan(globalScope(plugin))[2], items: scan({ ...globalScope(plugin), id: 'plugin:p@m' }).find(c => c.kind === 'agent')!.items }] };
  linkCopies(views, [pluginView]);
  const item = (v: number, kind: string, name: string) => views[v].categories.find(c => c.kind === kind)!.items.find(a => a.name === name)!;
  assert.deepEqual(item(1, 'hook', 'guard.sh').copies!.map(c => c.same), [false]);
  assert.deepEqual(item(1, 'agent', 'writer').copies!.map(c => [c.scope, c.same, c.near]), [['plugin:p@m', false, true]]);
  const skill = item(1, 'skill', 'hugo');
  assert.equal(retireBlock(skill, repo), undefined);
  assert.match(retireBlock(item(1, 'agent', 'writer'), repo)!, /no identical/);
  const dest = retireAsset(skill, repo, path.join(home, 'repo-sync-backups'), '20261020-120000');
  assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(repo, '.claude', 'skills', 'hugo')));
  writer(repo)('demos/a', '');
  writer(repo)('labs/b', '');
  assert.equal(retireBlock(skill, repo), undefined);
  assert.match(retireBlock(skill, repo, { folders: ['demos', 'labs'] })!, /keeps its copies/);
  writer(repo)('CLAUDE.md', '# Repo\n\nCopies are kept for the students.\n');
  assert.match(retireBlock(skill, repo, { claudeMdPattern: 'copies are kept' })!, /CLAUDE.md says/);
});

test('retireAsset backs a linked skill up as files and leaves the link target alone', () => {
  const root = tmp('harness-retire-link-');
  const real = path.join(root, 'agents', 'social');
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, 'SKILL.md'), '---\nname: social\n---\n');
  const skills = path.join(root, 'claude', 'skills');
  fs.mkdirSync(skills, { recursive: true });
  const link = path.join(skills, 'social');
  fs.symlinkSync(real, link, 'junction');
  const dest = retireAsset({ kind: 'skill', name: 'social', dir: link } as never, path.join(root, 'claude'), path.join(root, 'backups'), '20261029-120000');
  assert.ok(!fs.lstatSync(dest).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(dest, 'SKILL.md')));
  assert.ok(!fs.existsSync(link));
  assert.ok(fs.existsSync(path.join(real, 'SKILL.md')));
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
