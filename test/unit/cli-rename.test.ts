import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import type { SkillsOut } from '../../src/cli-skills';
import type { PluginRenameOut } from '../../src/cli-plugins';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `rename-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const has = (root: string, rel: string) => fs.existsSync(path.join(root, rel));

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function skillFixture() {
  const root = tmp('skill-root');
  write(root, 'skills/old-skill/SKILL.md', '---\nname: old-skill\ndescription: Old skill\n---\n\nSee old-skill/references/a.md.\n');
  write(root, 'skills/old-skill/references/a.md', '# A\n');
  write(root, 'skills/user/SKILL.md', '---\nname: user\ndescription: u\n---\n\nUse old-skill, or plug:old-skill, but not old-skills.\n');
  write(root, 'agents/maker.md', '---\nname: maker\n---\n\nThe old-skill skill.\n');
  return root;
}

test('skills rename --dry-run lists the changes and writes nothing', async () => {
  const root = skillFixture();
  const r = await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'new-skill', '--dry-run', '--json', '--root', root]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as SkillsOut & { applied: boolean };
  assert.equal(o.op, 'rename');
  assert.equal(o.applied, false);
  assert.equal(o.backup, null);
  assert.ok(o.changes.some(c => c.action === 'rename'));
  assert.ok(has(root, 'skills/old-skill/SKILL.md') && !has(root, 'skills/new-skill'));
  assert.match(read(root, 'agents/maker.md'), /old-skill/);
  assert.ok(!has(root, 'repo-sync-backups'));
});

test('skills rename renames the folder and the name line, repoints mentions, backs up, and a second run exits 1', async () => {
  const root = skillFixture();
  const r = await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'new-skill', '--json', '--root', root]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as SkillsOut & { applied: boolean };
  assert.equal(o.applied, true);
  assert.ok(o.backup);
  assert.ok(!has(root, 'skills/old-skill') && has(root, 'skills/new-skill/references/a.md'));
  assert.match(read(root, 'skills/new-skill/SKILL.md'), /^---\nname: new-skill\n/);
  assert.match(read(root, 'skills/new-skill/SKILL.md'), /new-skill\/references\/a\.md/);
  // Only reference forms change: plug:old-skill does, the bare word does not and comes back as a check row.
  assert.match(read(root, 'skills/user/SKILL.md'), /Use old-skill, or plug:new-skill, but not old-skills\./);
  assert.ok(o.changes.some(c => c.action === 'check' && c.file === 'skills/user/SKILL.md' && /line 6 still names it: Use old-skill/.test(c.detail)));
  assert.match(read(root, 'agents/maker.md'), /The new-skill skill/);
  assert.match(fs.readFileSync(path.join(o.backup!, 'agents/maker.md'), 'utf8'), /old-skill/);
  assert.equal((await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'other', '--root', root])).code, 1);
});

test('skills rename leaves a plugin prefix alone: x-conventions:x-conventions becomes x-conventions:x', async () => {
  const root = tmp('skill-prefix');
  write(root, 'skills/x-conventions/SKILL.md', '---\nname: x-conventions\ndescription: x\n---\n\nBody\n');
  write(root, 'agents/a.md', 'Use x-conventions:x-conventions and the x-conventions skill.\n');
  const r = await cli(['skills', 'rename', '--from', 'x-conventions', '--to', 'x', '--root', root]);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(root, 'agents/a.md'), 'Use x-conventions:x and the x skill.\n');
  assert.match(read(root, 'skills/x/SKILL.md'), /name: x\n/);
});

test('skills rename stops when the new name exists, and finds a skill in the market', async () => {
  const root = skillFixture();
  assert.equal((await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'user', '--root', root])).code, 1);
  const market = tmp('skill-market');
  write(market, 'plugins/p/skills/inner/SKILL.md', '---\nname: inner\ndescription: i\n---\n\nBody\n');
  const r = await cli(['skills', 'rename', '--from', 'inner', '--to', 'core', '--market', market, '--root', root]);
  assert.equal(r.code, 0);
  assert.match(read(market, 'plugins/p/skills/core/SKILL.md'), /name: core/);
  assert.ok(!has(market, 'plugins/p/skills/inner'));
});

test('skills rename troubleshooting rewrites only its reference forms, never the plain word or an anchor', async () => {
  const root = tmp('skill-word');
  write(root, 'skills/troubleshooting/SKILL.md', '---\nname: troubleshooting\ndescription: Fix the dev tools\n---\n\nSee troubleshooting/references/a.md.\n');
  write(root, 'skills/troubleshooting/references/a.md', '# A\n');
  const other = [
    '## Troubleshooting',
    'For troubleshooting tips load the `troubleshooting` skill or [the guide](../troubleshooting/SKILL.md).',
    'Jump to [the section](#troubleshooting) or run ~/.claude/skills/troubleshooting/scripts/fix.sh.',
    'Plain troubleshooting stays.',
    '',
  ];
  write(root, 'skills/other/SKILL.md', `---\nname: other\ndescription: o\n---\n\n${other.join('\n')}`);
  const r = await cli(['skills', 'rename', '--from', 'troubleshooting', '--to', 'devtools-troubleshooting', '--json', '--root', root]);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out) as SkillsOut;
  assert.equal(
    read(root, 'skills/other/SKILL.md'),
    `---\nname: other\ndescription: o\n---\n\n${[
      '## Troubleshooting',
      'For troubleshooting tips load the `devtools-troubleshooting` skill or [the guide](../devtools-troubleshooting/SKILL.md).',
      'Jump to [the section](#troubleshooting) or run ~/.claude/skills/devtools-troubleshooting/scripts/fix.sh.',
      'Plain troubleshooting stays.',
      '',
    ].join('\n')}`
  );
  assert.equal(read(root, 'skills/devtools-troubleshooting/SKILL.md'), '---\nname: devtools-troubleshooting\ndescription: Fix the dev tools\n---\n\nSee devtools-troubleshooting/references/a.md.\n');
  // Every line that still has the word comes back to be looked at.
  assert.deepEqual(o.changes.filter(c => c.action === 'check').map(c => c.detail.slice(0, 7)), ['line 7 ', 'line 8 ', 'line 9 ']);
});

test('skills rename of the skill hugo-expert leaves the agent hugo-expert and its subagent_type alone', async () => {
  const root = tmp('skill-agent');
  const market = tmp('skill-agent-market');
  write(market, 'plugins/agentic-web/skills/hugo-expert/SKILL.md', '---\nname: hugo-expert\ndescription: Hugo\n---\n\nRead hugo-expert/references/layouts.md.\n');
  write(market, 'plugins/agentic-web/agents/hugo-expert.md', '---\nname: hugo-expert\ndescription: Hugo agent\n---\n\nLoad the hugo-expert skill.\n');
  const lines = [
    'Delegate to the hugo-expert agent: subagent_type `agentic-web:hugo-expert`.',
    'Load the `hugo-expert` skill and read hugo-expert/references/layouts.md.',
    'The agent lives in agents/hugo-expert.md; ask the `agentic-web:hugo-expert` agent.',
    'The plugin skill agentic-web:hugo-expert skill.',
    'Use `hugo-expert` for layouts.',
    '',
  ];
  write(root, 'agents/site.md', `---\nname: site\n---\n\n${lines.join('\n')}`);
  const r = await cli(['skills', 'rename', '--from', 'agentic-web:hugo-expert', '--to', 'hugo-authoring', '--market', market, '--json', '--root', root]);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out) as SkillsOut;
  assert.equal(
    read(root, 'agents/site.md'),
    `---\nname: site\n---\n\n${[
      lines[0],
      'Load the `hugo-authoring` skill and read hugo-authoring/references/layouts.md.',
      lines[2],
      'The plugin skill agentic-web:hugo-authoring skill.',
      lines[4],
      '',
    ].join('\n')}`
  );
  assert.ok(has(market, 'plugins/agentic-web/skills/hugo-authoring/SKILL.md') && !has(market, 'plugins/agentic-web/skills/hugo-expert'));
  assert.match(read(market, 'plugins/agentic-web/skills/hugo-authoring/SKILL.md'), /^---\nname: hugo-authoring\n[\s\S]*Read hugo-authoring\/references\/layouts\.md/);
  // The agent keeps its name; its file only gets the skill phrase.
  assert.equal(read(market, 'plugins/agentic-web/agents/hugo-expert.md'), '---\nname: hugo-expert\ndescription: Hugo agent\n---\n\nLoad the hugo-authoring skill.\n');
  const checks = o.changes.filter(c => c.action === 'check' && c.file === 'agents/site.md').map(c => c.detail.slice(0, 7));
  assert.deepEqual(checks, ['line 5 ', 'line 7 ', 'line 9 ']);
});

function pluginFixture() {
  const root = tmp('plugin-root');
  const market = tmp('plugin-market');
  const repo = tmp('plugin-repo');
  const userConfig = path.join(tmp('plugin-cfg'), 'claude.json');
  fs.writeFileSync(userConfig, '{}');
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins: [{ name: 'old-plug', source: './plugins/old-plug' }, { name: 'dep', source: './plugins/dep' }] }, null, 2));
  write(market, 'plugins/old-plug/.claude-plugin/plugin.json', JSON.stringify({ name: 'old-plug', version: '1.0.0' }, null, 2));
  write(market, 'plugins/old-plug/skills/s/SKILL.md', '---\nname: s\n---\n\nRun old-plug:s.\n');
  write(market, 'plugins/dep/.claude-plugin/plugin.json', JSON.stringify({ name: 'dep', dependencies: ['old-plug', 'keep'] }, null, 2));
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ own: { source: { source: 'directory', path: market }, installLocation: market } }));
  write(root, 'settings.json', JSON.stringify({ enabledPlugins: { 'old-plug@own': true, 'other@own': true } }, null, 2));
  write(root, 'CLAUDE.md', 'Use old-plug:s, install old-plug@own, see plugins/old-plug/hooks and the old-plug plugin.\n');
  write(root, 'rules/r.md', 'Rule for old-plug:s.\n');
  write(repo, 'CLAUDE.md', 'Repo uses old-plug@own.\n');
  write(repo, '.claude/settings.local.json', JSON.stringify({ enabledPlugins: { 'old-plug@own': false } }, null, 2));
  write(repo, '.claude/rules/x.md', 'Mentions old-plug:s and old-plug-extra.\n');
  const base = ['--root', root, '--repo', repo, '--user-config', userConfig];
  return { root, market, repo, base };
}

const renameArgs = ['plugins', 'rename', '--from', 'old-plug@own', '--to', 'new-plug'];

test('plugins rename --dry-run lists the changes and writes nothing', async () => {
  const f = pluginFixture();
  const r = await cli([...renameArgs, '--dry-run', '--json', ...f.base]);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out) as PluginRenameOut & { applied: boolean };
  assert.equal(o.applied, false);
  assert.equal(o.backup, null);
  assert.equal(o.commands.length, 4);
  assert.match(o.commands[3], /claude plugin install new-plug@own/);
  assert.ok(o.changes.some(c => c.action === 'rename'));
  assert.ok(has(f.market, 'plugins/old-plug') && !has(f.market, 'plugins/new-plug'));
  assert.match(read(f.root, 'CLAUDE.md'), /old-plug:s/);
  assert.ok(!has(f.root, 'repo-sync-backups'));
});

test('plugins rename leaves a YAML key and a JS key named like the plugin alone and rewrites only a real reference', async () => {
  const f = pluginFixture();
  write(f.root, 'rules/keys.md', 'services:\n  old-plug:\n    image: x\n\n```js\nconst o = {\n  old-plug: {\n    a: 1,\n  },\n};\n```\n\nRun old-plug:s now.\n');
  const r = await cli([...renameArgs, '--json', ...f.base]);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(f.root, 'rules/keys.md'), 'services:\n  old-plug:\n    image: x\n\n```js\nconst o = {\n  old-plug: {\n    a: 1,\n  },\n};\n```\n\nRun new-plug:s now.\n');
});

test('plugins rename moves the folder, edits manifests, catalog, dependents and settings, rewrites namespace, id and path, reports bare mentions, and backs up', async () => {
  const f = pluginFixture();
  const r = await cli([...renameArgs, '--json', ...f.base]);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out) as PluginRenameOut & { applied: boolean };
  assert.equal(o.applied, true);
  assert.ok(o.backup);
  assert.ok(!has(f.market, 'plugins/old-plug') && has(f.market, 'plugins/new-plug/skills/s/SKILL.md'));
  assert.equal(JSON.parse(read(f.market, 'plugins/new-plug/.claude-plugin/plugin.json')).name, 'new-plug');
  const catalog = JSON.parse(read(f.market, '.claude-plugin/marketplace.json')).plugins;
  assert.deepEqual(catalog[0], { name: 'new-plug', source: './plugins/new-plug' });
  assert.deepEqual(JSON.parse(read(f.market, 'plugins/dep/.claude-plugin/plugin.json')).dependencies, ['new-plug', 'keep']);
  assert.deepEqual(JSON.parse(read(f.root, 'settings.json')).enabledPlugins, { 'other@own': true, 'new-plug@own': true });
  assert.deepEqual(JSON.parse(read(f.repo, '.claude/settings.local.json')).enabledPlugins, { 'new-plug@own': false });
  assert.equal(read(f.root, 'CLAUDE.md'), 'Use new-plug:s, install new-plug@own, see plugins/new-plug/hooks and the old-plug plugin.\n');
  assert.equal(read(f.root, 'rules/r.md'), 'Rule for new-plug:s.\n');
  assert.equal(read(f.repo, 'CLAUDE.md'), 'Repo uses new-plug@own.\n');
  assert.match(read(f.market, 'plugins/new-plug/skills/s/SKILL.md'), /Run new-plug:s\./);
  // Bare mentions are listed, a longer name that starts with the old one is not a mention.
  const checks = o.changes.filter(c => c.action === 'check');
  assert.ok(checks.some(c => /CLAUDE\.md$/.test(c.file) && /old-plug 1 time/.test(c.detail)));
  assert.ok(!checks.some(c => /x\.md$/.test(c.file)));
  assert.match(fs.readFileSync(path.join(o.backup!, 'settings.json'), 'utf8'), /old-plug@own/);
  assert.ok(fs.readdirSync(o.backup!, { recursive: true }).some(p => String(p).endsWith('marketplace.json')));
});

test('plugins rename rewrites the plugin\'s own code and data files and the plugin list\'s link, lists the rest by line, and a second run finishes what is left', async () => {
  const f = pluginFixture();
  write(f.market, 'plugins/old-plug/config/pipeline.default.json', '{\n  "skills": ["old-plug:s"]\n}\n');
  write(f.market, 'plugins/old-plug/hooks/conductor.mjs', "const skill = 'old-plug:s';\n// the old-plug plugin\n");
  write(f.market, 'plugins/old-plug/tests/conductor.test.ts', "expect('old-plug:s');\n");
  write(f.market, 'plugins/README.md', '| Plugin | What |\n| --- | --- |\n| [old-plug](old-plug) | films |\n| [keep](keep) | x |\n');
  write(f.market, 'plugins/dep/skills/y/SKILL.md', '---\nname: y\n---\n\nPublish with the old-plug plugin.\n');
  const r = await cli([...renameArgs, '--json', ...f.base]);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out) as PluginRenameOut;
  assert.equal(read(f.market, 'plugins/new-plug/config/pipeline.default.json'), '{\n  "skills": ["new-plug:s"]\n}\n');
  assert.equal(read(f.market, 'plugins/new-plug/hooks/conductor.mjs'), "const skill = 'new-plug:s';\n// the old-plug plugin\n");
  assert.equal(read(f.market, 'plugins/new-plug/tests/conductor.test.ts'), "expect('new-plug:s');\n");
  assert.equal(read(f.market, 'plugins/README.md'), '| Plugin | What |\n| --- | --- |\n| [new-plug](new-plug) | films |\n| [keep](keep) | x |\n');
  const checks = o.changes.filter(c => c.action === 'check');
  assert.ok(checks.some(c => c.file.endsWith('plugins/dep/skills/y/SKILL.md') && c.detail === 'still mentions old-plug 1 time, line 5'));
  assert.ok(checks.some(c => c.file.endsWith('hooks/conductor.mjs') && /line 2$/.test(c.detail)));
  // Text the first run did not reach (a file that came later) is finished by a second run; nothing else moves.
  write(f.market, 'plugins/new-plug/hooks/late.mjs', "export const id = 'old-plug@own';\n");
  const again = await cli([...renameArgs, '--json', ...f.base]);
  assert.equal(again.code, 0, again.err);
  const second = JSON.parse(again.out) as PluginRenameOut;
  assert.deepEqual(second.changes.filter(c => c.action !== 'check').map(c => [c.action, path.basename(c.file)]), [['rewrite', 'late.mjs']]);
  assert.equal(read(f.market, 'plugins/new-plug/hooks/late.mjs'), "export const id = 'new-plug@own';\n");
  assert.ok(has(f.market, 'plugins/new-plug') && !has(f.market, 'plugins/old-plug'));
});

test('plugins rename rewrites the quoted name and the MCP tool id in the plugin\'s own code, not in its prose', async () => {
  const f = pluginFixture();
  write(f.market, 'plugins/old-plug/hooks/mod.mjs', "const PLUGIN = \"old-plug\";\nref({ plugin: 'old-plug', key: 'asks' });\nconst t = 'mcp__old-plug__ledger';\n// the \"old-plug\" plugin\n");
  write(f.market, 'plugins/old-plug/types/index.d.ts', 'interface S {\n  "old-plug": { a: 1 };\n  "old-plug-extra": 2;\n}\n');
  write(f.market, 'plugins/dep/hooks/other.mjs', "const PLUGIN = 'old-plug';\n");
  const r = await cli([...renameArgs, '--json', ...f.base]);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(f.market, 'plugins/new-plug/hooks/mod.mjs'), "const PLUGIN = \"new-plug\";\nref({ plugin: 'new-plug', key: 'asks' });\nconst t = 'mcp__new-plug__ledger';\n// the \"new-plug\" plugin\n");
  assert.equal(read(f.market, 'plugins/new-plug/types/index.d.ts'), 'interface S {\n  "new-plug": { a: 1 };\n  "old-plug-extra": 2;\n}\n');
  // Another plugin's quoted literal is not this plugin's identifier.
  assert.equal(read(f.market, 'plugins/dep/hooks/other.mjs'), "const PLUGIN = 'old-plug';\n");
});

test('plugins rename rewrites the namespace and id forms in the other plugins\' code files, not their manifests\' other keys', async () => {
  const f = pluginFixture();
  write(f.market, 'plugins/old-plug/agents/fact-gatherer.md', '---\nname: fact-gatherer\n---\n');
  write(f.market, 'plugins/dep/config/flow.default.json', '{\n  "agent": "old-plug:fact-gatherer",\n  "id": "old-plug@own"\n}\n');
  write(f.market, 'plugins/dep/scripts/test_flow.py', 'assert x == "old-plug:fact-gatherer"\n');
  const r = await cli([...renameArgs, '--json', ...f.base]);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(f.market, 'plugins/dep/config/flow.default.json'), '{\n  "agent": "new-plug:fact-gatherer",\n  "id": "new-plug@own"\n}\n');
  assert.equal(read(f.market, 'plugins/dep/scripts/test_flow.py'), 'assert x == "new-plug:fact-gatherer"\n');
  assert.deepEqual(JSON.parse(read(f.market, 'plugins/dep/.claude-plugin/plugin.json')).dependencies, ['new-plug', 'keep']);
});

test('plugins rename rewrites the label of a root README row that links plugins/<name>', async () => {
  const f = pluginFixture();
  write(f.market, 'README.md', '| Plugin | What |\n| --- | --- |\n| [old-plug](plugins/old-plug) | films |\n| [keep](plugins/keep) | x |\n');
  const r = await cli([...renameArgs, '--json', ...f.base]);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(f.market, 'README.md'), '| Plugin | What |\n| --- | --- |\n| [new-plug](plugins/new-plug) | films |\n| [keep](plugins/keep) | x |\n');
});

test('plugins rename exits 1 when the plugin is gone or the new name exists, 2 without --from', async () => {
  const f = pluginFixture();
  assert.equal((await cli([...renameArgs, ...f.base])).code, 0);
  // A second run finishes leftovers instead of stopping; an unknown plugin still stops.
  assert.equal((await cli([...renameArgs, ...f.base])).code, 0);
  assert.equal((await cli(['plugins', 'rename', '--from', 'gone@own', '--to', 'x', ...f.base])).code, 1);
  assert.equal((await cli(['plugins', 'rename', '--from', 'dep@own', '--to', 'new-plug', ...f.base])).code, 1);
  assert.equal((await cli(['plugins', 'rename', '--from', 'dep@nowhere', '--to', 'x', ...f.base])).code, 1);
  assert.equal((await cli(['plugins', 'rename', '--to', 'x', ...f.base])).code, 2);
});

test('a failing backup writes nothing, for repoint, skills rename and plugins rename', async () => {
  const root = skillFixture();
  // A file where the backup folder belongs makes every backup fail.
  fs.writeFileSync(path.join(root, 'repo-sync-backups'), 'not a folder');
  const agent = read(root, 'agents/maker.md');
  assert.equal((await cli(['skills', 'repoint', '--from', 'old-skill', '--to', 'new-skill', '--root', root])).code, 1);
  assert.equal((await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'new-skill', '--root', root])).code, 1);
  assert.equal(read(root, 'agents/maker.md'), agent);
  assert.match(read(root, 'skills/user/SKILL.md'), /Use old-skill/);
  assert.ok(has(root, 'skills/old-skill/SKILL.md'));
  const f = pluginFixture();
  fs.writeFileSync(path.join(f.root, 'repo-sync-backups'), 'not a folder');
  const claude = read(f.root, 'CLAUDE.md');
  assert.equal((await cli([...renameArgs, ...f.base])).code, 1);
  assert.equal(read(f.root, 'CLAUDE.md'), claude);
  assert.equal(JSON.parse(read(f.market, 'plugins/old-plug/.claude-plugin/plugin.json')).name, 'old-plug');
  assert.ok(has(f.market, 'plugins/old-plug'));
});

test('a market on another drive is backed up under outside/<drive>/', async (t) => {
  const other = ['D', 'E', 'F'].find(d => !path.resolve(os.tmpdir()).toUpperCase().startsWith(`${d}:`) && fs.existsSync(`${d}:\\`));
  if (process.platform !== 'win32' || !other) return t.skip('needs a second drive');
  let market: string;
  try {
    market = fs.mkdtempSync(`${other}:/rename-xdrive-`);
  } catch {
    return t.skip('second drive not writable');
  }
  try {
    const root = skillFixture();
    write(market, 'plugins/p/skills/x/SKILL.md', '---\nname: x\ndescription: x\n---\n\nUse the old-skill skill.\n');
    const r = await cli(['skills', 'repoint', '--from', 'old-skill', '--to', 'new-skill', '--market', market, '--json', '--root', root]);
    assert.equal(r.code, 0, r.err);
    const o = JSON.parse(r.out) as SkillsOut;
    assert.ok(fs.existsSync(path.join(o.backup!, 'outside', other, path.basename(market), 'plugins/p/skills/x/SKILL.md')));
    assert.match(read(market, 'plugins/p/skills/x/SKILL.md'), /new-skill/);
  } finally {
    fs.rmSync(market, { recursive: true, force: true });
  }
});

test('skills rename keeps a bare `name` that is the sibling skill\'s own leaf file as a check row', async () => {
  const root = tmp('skill-leaf');
  write(root, 'skills/copilot-cli/SKILL.md', '---\nname: copilot-cli\ndescription: c\n---\n\nBody\n');
  write(root, 'skills/byok/SKILL.md', '---\nname: byok\ndescription: b\n---\n\nLeaf `copilot-cli` covers the CLI. Run github-copilot:copilot-cli.\n');
  write(root, 'skills/byok/references/copilot-cli.md', '# Leaf\n');
  write(root, 'skills/other/SKILL.md', '---\nname: other\ndescription: o\n---\n\nUse `copilot-cli`.\n');
  const r = await cli(['skills', 'rename', '--from', 'copilot-cli', '--to', 'gh-copilot-cli', '--json', '--root', root]);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out) as SkillsOut;
  assert.match(read(root, 'skills/byok/SKILL.md'), /Leaf `copilot-cli` covers the CLI\. Run github-copilot:gh-copilot-cli\./);
  assert.match(read(root, 'skills/other/SKILL.md'), /Use `gh-copilot-cli`\./);
  assert.ok(o.changes.some(c => c.action === 'check' && c.file === 'skills/byok/SKILL.md' && /Leaf `copilot-cli`/.test(c.detail)));
});

test('skills rename never rewrites a changelog, a task log or a backup folder, and lists the changelog and task log', async () => {
  const root = skillFixture();
  write(root, 'skills/user/CHANGELOG.md', 'Added old-skill/references/a.md.\n');
  write(root, 'skills/user/tasks/log.md', 'Ran plug:old-skill.\n');
  write(root, 'skills/.skill-sync-backups/2026/skills/user/SKILL.md', 'plug:old-skill\n');
  write(root, 'skills/repo-sync-backups/x/SKILL.md', 'plug:old-skill\n');
  const r = await cli(['skills', 'rename', '--from', 'old-skill', '--to', 'new-skill', '--json', '--root', root]);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out) as SkillsOut;
  assert.equal(read(root, 'skills/user/CHANGELOG.md'), 'Added old-skill/references/a.md.\n');
  assert.equal(read(root, 'skills/user/tasks/log.md'), 'Ran plug:old-skill.\n');
  assert.equal(read(root, 'skills/.skill-sync-backups/2026/skills/user/SKILL.md'), 'plug:old-skill\n');
  assert.equal(read(root, 'skills/repo-sync-backups/x/SKILL.md'), 'plug:old-skill\n');
  assert.ok(o.changes.some(c => c.action === 'check' && c.file === 'skills/user/CHANGELOG.md'));
  assert.ok(o.changes.some(c => c.action === 'check' && c.file === 'skills/user/tasks/log.md'));
  assert.ok(!o.changes.some(c => /backups/.test(c.file)));
});

test('plugins rename never rewrites a changelog, a task log or a skill-sync backup, and lists the changelog and task log', async () => {
  const f = pluginFixture();
  write(f.root, 'skills/CHANGELOG.md', 'Used old-plug:s.\n');
  write(f.root, 'skills/x/tasks/t.md', 'Used old-plug:s.\n');
  write(f.root, 'skills/.skill-sync-backups/b/SKILL.md', 'Used old-plug:s.\n');
  const r = await cli([...renameArgs, '--json', ...f.base]);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out) as PluginRenameOut;
  assert.equal(read(f.root, 'skills/CHANGELOG.md'), 'Used old-plug:s.\n');
  assert.equal(read(f.root, 'skills/x/tasks/t.md'), 'Used old-plug:s.\n');
  assert.equal(read(f.root, 'skills/.skill-sync-backups/b/SKILL.md'), 'Used old-plug:s.\n');
  assert.ok(o.changes.some(c => c.action === 'check' && c.file.endsWith('CHANGELOG.md')));
  assert.ok(o.changes.some(c => c.action === 'check' && /tasks/.test(c.file)));
  assert.ok(!o.changes.some(c => /skill-sync-backups/.test(c.file)));
});

test('plugins rename rewrites old:name only for a skill, agent or command the plugin ships; another plugin of the same name keeps its own', async () => {
  const f = pluginFixture();
  write(f.market, 'plugins/old-plug/agents/helper.md', '---\nname: helper\n---\n');
  write(f.market, 'plugins/old-plug/commands/go.md', 'Go\n');
  write(f.root, 'rules/mix.md', 'Use old-plug:s, old-plug:helper, /old-plug:go and old-plug:lookup-schema, /old-plug:validate.\n');
  const r = await cli([...renameArgs, '--json', ...f.base]);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out) as PluginRenameOut;
  assert.equal(read(f.root, 'rules/mix.md'), 'Use new-plug:s, new-plug:helper, /new-plug:go and old-plug:lookup-schema, /old-plug:validate.\n');
  assert.ok(o.changes.some(c => c.action === 'check' && c.file.endsWith('mix.md')));
});
