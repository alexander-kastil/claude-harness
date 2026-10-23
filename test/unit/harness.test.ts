import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { applyMcpState, parseMcpList, mcpToolPrefix, setMcpEnabled } from '../../src/harness';
import { createAsset, duplicateAsset, expandRepoFolders, fromFields, globalScope, knownRepos, linkCopies, readMarkdown, renameAsset, repoScope, scan, serializeMarkdown, setFrontmatterList, setPluginEnabled, toFields } from '../../src/harness';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write('CLAUDE.md', '# Rules\n');
  write('agents/dotnet-expert.md', '---\nname: dotnet-expert\ndescription: >-\n  .NET work\n  in any repo.\ntools: Read, Write\n---\n\nBody\n');
  write('skills/hugo/SKILL.md', '---\nname: hugo\ndescription: Hugo engine\n---\n\n# Hugo\n');
  write('skills/hugo/references/traps.md', '# Traps\n');
  write('commands/git/push.md', '---\ndescription: Push\n---\n\nDo it\n');
  write('workflows/scaffold.js', "export const meta = {\n  name: 'scaffold',\n  description: 'Scaffold a portal',\n}\n");
  write('settings.json', '{\n  "enabledPlugins": {\n    "a@m": true,\n    "b@m": false\n  },\n  "hooks": {\n    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "guard.sh" }] }]\n  }\n}\n');
  const userConfig = path.join(root, 'user.json');
  fs.writeFileSync(userConfig, JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://x' } } }));
  return { ...globalScope(root), mcpFile: userConfig };
}

test('linkCopies marks same-name assets across scopes as identical or differing', () => {
  const global = fixture();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-repo-'));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  write('.claude/skills/hugo/SKILL.md', '---\r\nname: hugo\r\ndescription: Hugo engine\r\n---\r\n\r\n# Hugo\r\n');
  write('.claude/skills/hugo/references/traps.md', '# Traps\r\n');
  write('.claude/agents/dotnet-expert.md', '---\nname: dotnet-expert\nmetadata:\n  version: "2.0.0"\n---\n');
  const views = [global, repoScope(repo)].map(s => ({ id: s.id, label: s.label, path: s.base, categories: scan(s) }));
  linkCopies(views);
  const item = (view: number, kind: string, name: string) => views[view].categories.find(c => c.kind === kind)!.items.find(a => a.name === name)!;
  assert.deepEqual(item(0, 'skill', 'hugo').copies!.map(c => c.same), [true]);
  assert.deepEqual(item(1, 'agent', 'dotnet-expert').copies!.map(c => c.same), [false]);
  assert.equal(item(1, 'agent', 'dotnet-expert').version, '2.0.0');
  assert.equal(item(0, 'command', 'git:push').copies, undefined);
});

test('scan finds every kind', () => {
  const paths = fixture();
  const byKind = Object.fromEntries(scan(paths).map(c => [c.kind, c.items]));
  assert.equal(byKind.memory.length, 1);
  assert.equal(byKind.agent[0].description, '.NET work in any repo.');
  assert.deepEqual(byKind.skill[0].files, ['references/traps.md', 'SKILL.md']);
  assert.equal(byKind.command[0].name, 'git:push');
  assert.equal(byKind.workflow[0].description, 'Scaffold a portal');
  assert.equal(byKind.hook[0].name, 'PreToolUse · Bash');
  assert.equal(byKind.mcp[0].name, 'github');
  assert.deepEqual(byKind.plugin.map((p: { enabled?: boolean }) => p.enabled), [true, false]);
  assert.equal(byKind.settings.length, 1);
});

test('unchanged frontmatter keeps its folded style', () => {
  const original = '---\nname: x\ndescription: >-\n  long\n  text\n---\n\nBody\n';
  const doc = readMarkdownFromText(original);
  assert.equal(serializeMarkdown(original, doc.data, doc.body), original);
  const edited = serializeMarkdown(original, { ...doc.data, model: 'opus' }, doc.body);
  assert.match(edited, /description: >-\n {2}long text\nmodel: opus\n---/);
});

test('crlf files stay crlf', () => {
  const original = '---\r\nname: x\r\n---\r\n\r\nBody\r\n';
  const out = serializeMarkdown(original, { name: 'y' }, '\nBody 2\n');
  assert.equal(out, '---\r\nname: y\r\n---\r\n\r\nBody 2\r\n');
});

test('fields round trip', () => {
  const data = { name: 'a', description: 'b', tools: ['Read', 'Write'], 'user-invocable': false, hooks: { PreToolUse: [{ matcher: 'x' }] } };
  assert.deepEqual(fromFields(toFields(data)), data);
});

test('create, rename and duplicate update names', () => {
  const paths = fixture();
  const file = createAsset(paths, 'agent', 'new-agent');
  assert.equal(readMarkdown(file).data.name, 'new-agent');
  const skill = scan(paths).find(c => c.kind === 'skill')!.items[0];
  const renamed = renameAsset(paths, skill, 'hugo-engine');
  assert.equal(readMarkdown(renamed).data.name, 'hugo-engine');
  assert.ok(fs.existsSync(path.join(paths.root, 'skills', 'hugo-engine', 'references', 'traps.md')));
  assert.ok(!fs.existsSync(path.join(paths.root, 'skills', 'hugo')));
  const wf = scan(paths).find(c => c.kind === 'workflow')!.items[0];
  const copy = duplicateAsset(paths, wf, 'scaffold-two');
  assert.match(fs.readFileSync(copy, 'utf8'), /name: 'scaffold-two'/);
  assert.throws(() => createAsset(paths, 'agent', 'new-agent'));
});

test('plugin toggle edits only that key', () => {
  const paths = fixture();
  setPluginEnabled(paths, 'b@m', true);
  const text = fs.readFileSync(path.join(paths.root, 'settings.json'), 'utf8');
  assert.match(text, /"b@m": true/);
  assert.match(text, /"hooks"/);
});

function readMarkdownFromText(text: string) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'md-')), 'x.md');
  fs.writeFileSync(file, text);
  return readMarkdown(file);
}

test('unquoted colons in a description still parse and save as valid yaml', () => {
  const original = '---\nname: maf\ndescription: Expert in X. Example tasks: "a", "b"\ntools:\n  - Read\n  - Bash\n---\n\nBody\n';
  const doc = readMarkdownFromText(original);
  assert.equal(doc.data.description, 'Expert in X. Example tasks: "a", "b"');
  assert.deepEqual(doc.data.tools, ['Read', 'Bash']);
  assert.equal(serializeMarkdown(original, doc.data, doc.body), original);
  const edited = serializeMarkdown(original, { ...doc.data, model: 'opus' }, doc.body);
  assert.equal(readMarkdownFromText(edited).data.description, 'Expert in X. Example tasks: "a", "b"');
  assert.equal(readMarkdownFromText(edited).data.model, 'opus');
});

test('repo scope reads project memory, .claude assets and .mcp.json', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Repo\n');
  fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'agents', 'local.md'), '---\nname: local\ndescription: Local agent\n---\n');
  fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'node', args: ['db.js'] } } }));
  const scope = repoScope(repo);
  const byKind = Object.fromEntries(scan(scope).map(c => [c.kind, c.items]));
  assert.equal(byKind.memory[0].name, 'CLAUDE.md');
  assert.equal(byKind.agent[0].id, `repo:${repo}|agent:local`);
  assert.equal(byKind.mcp[0].description, 'stdio · node db.js');
  const file = createAsset(scope, 'skill', 'repo-skill');
  assert.equal(file, path.join(repo, '.claude', 'skills', 'repo-skill', 'SKILL.md'));
});

test('workspace folders with a local harness are listed even under the temp folder', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'local-'));
  fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-'));
  fs.writeFileSync(path.join(scratch, 'CLAUDE.md'), '# x\n');
  const config = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), 'user.json');
  fs.writeFileSync(config, JSON.stringify({ projects: { [scratch]: {} } }));
  const repos = knownRepos([repo], config).map(r => r.toLowerCase());
  assert.ok(repos.includes(path.resolve(repo).toLowerCase()));
  assert.ok(!repos.includes(path.resolve(scratch).toLowerCase()));
});

test('tools keep their yaml shape: string, flow list, multi-line block list', () => {
  assert.equal(setFrontmatterList('---\nname: a\ntools: Read, Write\n---\nBody\n', 'tools', ['Read', 'Bash']), '---\nname: a\ntools: Read, Bash\n---\nBody\n');
  assert.equal(setFrontmatterList('---\ntools: [Read, Write]\nmodel: opus\n---\n', 'tools', ['Read', 'mcp__x__*']), '---\ntools: [ Read, mcp__x__* ]\nmodel: opus\n---\n');
  assert.equal(
    setFrontmatterList('---\ntools:\n  - Read\n  - Write\nmodel: opus\n---\nBody\n', 'tools', ['Read', 'Grep', 'Glob']),
    '---\ntools:\n  - Read\n  - Grep\n  - Glob\nmodel: opus\n---\nBody\n'
  );
  assert.equal(setFrontmatterList('---\r\ntools:\r\n  - Read\r\n---\r\nBody\r\n', 'tools', ['Edit']), '---\r\ntools:\r\n  - Edit\r\n---\r\nBody\r\n');
  assert.deepEqual(fromFields([{ key: 'tools', type: 'list', value: 'Read,\nWrite, Bash\n' }]), { tools: ['Read', 'Write', 'Bash'] });
});

test('add repo takes a repo folder or a parent folder of repos', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'customers-'));
  fs.mkdirSync(path.join(parent, 'shop', '.claude'), { recursive: true });
  fs.mkdirSync(path.join(parent, 'portal'), { recursive: true });
  fs.writeFileSync(path.join(parent, 'portal', 'CLAUDE.md'), '# Portal\n');
  fs.mkdirSync(path.join(parent, 'notes'), { recursive: true });
  const userConfig = path.join(parent, 'user.json');
  fs.writeFileSync(userConfig, '{}');
  const names = (folders: string[]) => knownRepos(expandRepoFolders(folders), userConfig).map(p => path.basename(p));
  assert.deepEqual(names([parent]), ['portal', 'shop']);
  assert.deepEqual(names([path.join(parent, 'shop')]), ['shop']);
  assert.deepEqual(names([path.join(parent, 'missing')]), []);
});

test('global mcp servers from claude mcp list, with tool prefixes', () => {
  const out = 'Checking MCP server health…\n\nclaude.ai Microsoft Learn: https://learn.microsoft.com/api/mcp - ✔ Connected\nplugin:design:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication\nplugin:design:gmail:  (HTTP) - - Not configured\n';
  assert.deepEqual(parseMcpList(out), [
    { name: 'claude.ai Microsoft Learn', target: 'https://learn.microsoft.com/api/mcp', status: 'Connected' },
    { name: 'plugin:design:slack', target: 'https://mcp.slack.com/mcp (HTTP)', status: 'Needs authentication' },
    { name: 'plugin:design:gmail', target: '(HTTP)', status: 'Not configured' },
  ]);
  assert.equal(mcpToolPrefix('claude.ai Microsoft Learn'), 'mcp__claude_ai_Microsoft_Learn__');
  assert.equal(mcpToolPrefix('plugin:design:slack'), 'mcp__plugin_design_slack__');
});

test('mcp servers switch on and off per repo and in every folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  const repo = path.join(dir, 'shop');
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'db-mcp' } } }));
  const userConfig = path.join(dir, 'user.json');
  const repoKey = repo.replace(/\\/g, '/');
  fs.writeFileSync(userConfig, JSON.stringify({ projects: { [repoKey]: { mcpServers: { search: { type: 'http', url: 'https://s' } } }, '/other': {} }, oauthAccount: { x: 1 } }, null, 2));

  const scope = repoScope(repo, userConfig);
  const repoMcp = scan(scope).find(c => c.kind === 'mcp')!;
  assert.deepEqual(repoMcp.items.map(a => [a.name, a.source]), [['db', 'project'], ['search', 'local']]);

  const global = { id: 'global', label: 'Global', path: '', categories: [{ ...repoMcp, items: [{ ...repoMcp.items[1], id: 'global|mcp:claude.ai Learn', scope: 'global', name: 'claude.ai Learn', source: 'claude.ai' as const, file: '' }] }] };
  const views = () => [global, { id: scope.id, label: 'shop', path: repo, categories: [repoMcp] }];
  setMcpEnabled(userConfig, repoMcp.items[0], repo, false);
  setMcpEnabled(userConfig, repoMcp.items[1], repo, false);
  setMcpEnabled(userConfig, global.categories[0].items[0], undefined, false);
  const data = JSON.parse(fs.readFileSync(userConfig, 'utf8'));
  assert.deepEqual(data.projects[repoKey].disabledMcpjsonServers, ['db']);
  assert.deepEqual(data.projects[repoKey].disabledMcpServers, ['search', 'claude.ai Learn']);
  assert.deepEqual(data.projects['/other'].disabledMcpServers, ['claude.ai Learn']);
  assert.deepEqual(data.oauthAccount, { x: 1 });

  const v = views();
  applyMcpState(v, userConfig);
  assert.equal(v[0].categories[0].items[0].enabled, false);
  assert.equal(v[0].categories[0].items[0].offIn, 2);
  assert.deepEqual(v[1].categories[0].items.map(a => a.enabled), [false, false]);

  setMcpEnabled(userConfig, repoMcp.items[0], repo, true);
  setMcpEnabled(userConfig, global.categories[0].items[0], undefined, true);
  const after = JSON.parse(fs.readFileSync(userConfig, 'utf8'));
  assert.deepEqual(after.projects[repoKey].disabledMcpjsonServers, []);
  assert.deepEqual(after.projects[repoKey].enabledMcpjsonServers, ['db']);
  assert.deepEqual(after.projects['/other'].disabledMcpServers, []);
});

test('a hex color is written quoted, so YAML does not read it as a comment, and reads back as the code', () => {
  const original = '---\nname: a\nmodel: opus\n---\nBody\n';
  const doc = readMarkdown(writeTemp(original));
  const fields = [...toFields(doc.data), { key: 'color', type: 'string' as const, value: '#ff8800' }];
  const out = serializeMarkdown(original, fromFields(fields), doc.body);
  assert.match(out, /^color: ["']#ff8800["']$/m);
  const back = readMarkdown(writeTemp(out));
  assert.equal(back.data.color, '#ff8800');
  assert.equal(back.data.name, 'a');
  // Changing a stored code and swapping it for a name keep the file valid; removing it leaves no color line.
  const again = serializeMarkdown(out, { ...back.data, color: '#abc' }, back.body);
  assert.equal(readMarkdown(writeTemp(again)).data.color, '#abc');
  const named = serializeMarkdown(again, { ...back.data, color: 'pink' }, back.body);
  assert.match(named, /^color: ["']?pink["']?$/m);
  const { color: _gone, ...rest } = back.data;
  assert.doesNotMatch(serializeMarkdown(out, rest, back.body), /color/);
});

function writeTemp(text: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-color-')), 'agent.md');
  fs.writeFileSync(file, text);
  return file;
}
