import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { DRAW_SYSTEM, PROCESS_SYSTEM, contentHash, drawPrompt, drawSource, drawable, marketProcessPrompt, marketProcessText, marketText, processPrompt, processSource, processText, readDrawing, writeDrawing } from '../../src/drawing';
import type { Asset } from '../../src/harness';

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const asset = (kind: Asset['kind'], name: string, rest: Partial<Asset> = {}): Asset => ({ id: `global|${kind}:${name}`, scope: 'global', kind, name, description: '', file: '', mtime: 0, ...rest });

test('a skill is drawn from SKILL.md as it is on disk, so a drawing stored before stays valid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-skill-'));
  const file = path.join(dir, 'SKILL.md');
  const text = '---\r\nname: deploy\r\ndescription: Ships it\r\n---\r\n\r\n1. Build.\r\n';
  write(file, text);
  const store = path.join(dir, 'drawings');
  // How the skill-only Draw with Claude keyed its drawing: the hash of the file's text.
  writeDrawing(store, 'global|skill:deploy', contentHash(fs.readFileSync(file, 'utf8')), '<svg/>');
  const source = drawSource(asset('skill', 'deploy', { file }));
  assert.equal(source?.text, text);
  assert.equal(source?.from, 'SKILL.md');
  assert.equal(readDrawing(store, 'global|skill:deploy', contentHash(source!.text)), '<svg/>');
  write(file, `${text}2. Ship.\n`);
  assert.equal(readDrawing(store, 'global|skill:deploy', contentHash(drawSource(asset('skill', 'deploy', { file }))!.text)), undefined, 'an edit drops it');
});

test('a plugin is drawn from its manifest, the names and descriptions of its parts, and its hook and server configs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-plugin-'));
  write(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'team-tools', hooks: './hooks/hooks.json' }));
  write(path.join(dir, 'skills', 'lint-fix', 'SKILL.md'), '---\nname: lint-fix\ndescription: Fixes lint\n---\n\nThe whole body.\n');
  write(path.join(dir, 'agents', 'qa.md'), '---\nname: qa\ndescription: Tests the build\n---\n\nYou are qa.\n');
  write(path.join(dir, 'commands', 'ship.md'), '---\ndescription: Ships a release\n---\n\nShip it.\n');
  write(path.join(dir, 'hooks', 'hooks.json'), '{ "hooks": { "Stop": [] } }');
  write(path.join(dir, '.mcp.json'), '{ "mcpServers": { "db": { "command": "db-mcp" } } }');
  const plugin = asset('plugin', 'team-tools@acme', { file: path.join(dir, 'settings.json') });
  const source = drawSource(plugin, dir)!;
  for (const part of ['"name":"team-tools"', '### Skills\n- lint-fix: Fixes lint', '### Agents\n- qa: Tests the build', '### Commands\n- ship: Ships a release', '"Stop"', '"db-mcp"']) assert.ok(source.text.includes(part), `${part} in ${source.text}`);
  assert.ok(!source.text.includes('The whole body'), 'the bodies stay out');
  assert.match(source.from, /manifest/);
  const before = contentHash(source.text);
  write(path.join(dir, 'agents', 'qa.md'), '---\nname: qa\ndescription: Tests and signs off the build\n---\n\nYou are qa.\n');
  assert.notEqual(contentHash(drawSource(plugin, dir)!.text), before, 'a changed part changes the key');
  assert.equal(drawSource(plugin, undefined), undefined, 'no folder, nothing to draw from');
  assert.equal(drawSource(plugin, path.join(dir, 'gone')), undefined);
});

test('a hook and a configured server are drawn from their own entry; a listed server from its name and address', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-entry-'));
  const settings = path.join(dir, 'settings.json');
  write(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node stop.js' }] }] }, model: 'opus' }));
  const hook = asset('hook', 'Stop', { file: settings, jsonPath: ['hooks', 'Stop', 0] });
  const first = drawSource(hook)!;
  assert.match(first.text, /node stop\.js/);
  assert.doesNotMatch(first.text, /opus/);
  write(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node stop.js' }] }] }, model: 'sonnet' }));
  assert.equal(drawSource(hook)!.text, first.text, 'another key of the file leaves the drawing');
  const listed = drawSource(asset('mcp', 'claude.ai Gmail', { source: 'claude.ai', target: 'https://gmail.example/mcp', status: 'Connected' }))!;
  assert.match(listed.text, /gmail\.example/);
  assert.doesNotMatch(listed.text, /Connected/, 'the status is not part of the source');
});

test('skills, agents, commands, workflows, plugins, hooks and MCP servers are drawn: rules, styles, memory and settings have no source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-kinds-'));
  const file = path.join(dir, 'x.md');
  write(file, 'text');
  for (const kind of ['skill', 'agent', 'command', 'workflow', 'plugin', 'mod', 'hook', 'mcp'] as const) assert.ok(drawable(kind), kind);
  for (const kind of ['rule', 'outputStyle', 'memory', 'hookScript', 'settings'] as const) {
    assert.ok(!drawable(kind), kind);
    assert.equal(drawSource(asset(kind, 'x', { file })), undefined, kind);
  }
  assert.equal(drawSource(asset('workflow', 'fan-out', { file }))?.text, 'text');
});

test('every drawable kind gets its own prompt, with the drawing rules and the source under its heading', () => {
  const skill = drawPrompt('skill', 'deploy', 'BODY');
  assert.match(skill, /^Draw what the skill "deploy" does, from its SKILL\.md below/);
  assert.match(skill, /## SKILL\.md\nBODY$/);
  const plugin = drawPrompt('plugin', 'team-tools@acme', 'PARTS');
  assert.match(plugin, /plugin "team-tools@acme"/);
  assert.match(plugin, /the parts it has \(skills, agents, commands, MCP servers, hooks\)/);
  assert.match(plugin, /## Plugin\nPARTS$/);
  for (const kind of ['skill', 'agent', 'command', 'workflow', 'plugin', 'mod', 'hook', 'mcp'] as const) {
    const p = drawPrompt(kind, 'x', 'S');
    assert.match(p, /viewBox 1400 wide and only as tall as the content needs/, kind);
    assert.match(p, /never one tall column of boxes/, kind);
    assert.match(p, /\nS$/, kind);
    // Labels only, nothing for an absent part, and lines that neither cross nor run through a box.
    assert.match(p, /No sentences, no captions, no notes/, kind);
    assert.match(p, /no box, label or placeholder for a part that is absent/, kind);
    assert.match(p, /No line crosses another line, and no line passes through or behind a box/, kind);
    assert.match(p, /merge into one line/, kind);
  }
  assert.match(DRAW_SYSTEM, /never a sentence\. No line crosses another line or passes through a box/);
  assert.match(drawPrompt('skill', 'big', 'y'.repeat(30001)), /\[cut\]$/);
});

test('every drawable kind and a marketplace get a Process prompt of their own, and no prompt asks for a vertical stack', () => {
  const opening: Record<string, RegExp> = {
    skill: /^Draw the skill "x" as a process, from its SKILL\.md below/,
    agent: /^Draw the agent "x" as a process/,
    command: /^Draw the slash command "\/x" as a process/,
    workflow: /^Draw the workflow "x" as a process/,
    plugin: /^Draw the plugin "x" as a process/,
    mod: /^Draw the plugin "x" as a process/,
    hook: /^Draw the hook "x" as a process/,
    mcp: /^Draw the MCP server "x" as a process/,
    market: /^Draw the plugin marketplace "x" as a process/,
  };
  for (const kind of ['skill', 'agent', 'command', 'workflow', 'plugin', 'mod', 'hook', 'mcp', 'market'] as const) {
    const p = processPrompt(kind, 'x', 'S');
    assert.match(p, opening[kind], kind);
    assert.match(p, /viewBox 1400 wide/, kind);
    assert.match(p, /A sequence runs left to right and wraps into the next row/, kind);
    assert.match(p, /\nS$/, kind);
    for (const text of [p, drawPrompt(kind, 'x', 'S')]) assert.doesNotMatch(text, /vertical|stack of|as tall as the (stack|lane)/i, kind);
  }
  assert.equal(marketProcessPrompt('x', 'S'), processPrompt('market', 'x', 'S'));
  assert.match(processPrompt('skill', 'big', 'y'.repeat(30001)), /\[cut\]$/);
  for (const system of [DRAW_SYSTEM, PROCESS_SYSTEM]) assert.match(system, /width/);
});

test("an element's Process drawing is read from its harness source under its own id; a plugin's adds its hook modules", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-process-'));
  const file = path.join(dir, 'SKILL.md');
  write(file, '---\nname: deploy\n---\n\n1. Build.\n');
  const skill = asset('skill', 'deploy', { file });
  assert.deepEqual(processSource(skill), drawSource(skill));
  const store = path.join(dir, 'drawings');
  writeDrawing(store, 'global|skill:deploy', contentHash(drawSource(skill)!.text), '<svg>harness</svg>');
  writeDrawing(store, 'global|skill:deploy#process', contentHash(processSource(skill)!.text), '<svg>process</svg>');
  assert.equal(readDrawing(store, 'global|skill:deploy', contentHash(drawSource(skill)!.text)), '<svg>harness</svg>');
  assert.equal(readDrawing(store, 'global|skill:deploy#process', contentHash(processSource(skill)!.text)), '<svg>process</svg>');
  const plugin = path.join(dir, 'kit');
  write(path.join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"kit"}');
  write(path.join(plugin, 'hooks', 'guard.mjs'), 'export const GUARD = 1;');
  const kit = asset('plugin', 'kit@acme');
  assert.equal(processSource(kit, plugin)?.text, processText(plugin));
  assert.match(processSource(kit, plugin)!.from, /hook modules/);
  assert.equal(processSource(kit, undefined), undefined);
});

test('the process text reads the hook modules a plugin lists relative to hooks/, and the files beside them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-mods-'));
  write(path.join(dir, '.claude-plugin', 'plugin.json'), '{"name":"p"}');
  write(path.join(dir, 'hooks', 'hooks.json'), '{"modules":["../mods/orchestration/register.ts"]}');
  write(path.join(dir, 'mods', 'orchestration', 'register.ts'), 'export const REGISTER = 1;');
  write(path.join(dir, 'mods', 'orchestration', 'route.mjs'), 'export const GATED = /x/;');
  write(path.join(dir, 'hooks', 'legacy.mjs'), 'export const LEGACY = 1;');
  const text = processText(dir);
  assert.match(text, /### Mod mods\/orchestration\/register\.ts\nexport const REGISTER/);
  assert.match(text, /### Mod mods\/orchestration\/route\.mjs\nexport const GATED/);
  assert.match(text, /### Mod hooks\/legacy\.mjs/);
});

test('the process text of a plugin lists the lines where one of its parts names another, so parts without a run order still connect', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-parts-'));
  write(path.join(dir, '.claude-plugin', 'plugin.json'), '{"name":"kit"}');
  write(path.join(dir, 'skills', 'lint-fix', 'SKILL.md'), '---\nname: lint-fix\n---\n');
  write(path.join(dir, 'skills', 'release', 'SKILL.md'), '---\nname: release\n---\n');
  write(path.join(dir, 'skills', 'release', 'references', 'notes.md'), 'The qa-lead agent once ran lint-fix twice.\n');
  write(path.join(dir, 'agents', 'qa-lead.md'), '---\nname: qa-lead\n---\n\nPlan the release first.\nRun the lint-fix skill before every review.\nThen the `release` skill.\n');
  const text = processText(dir);
  assert.match(text, /### Links between parts\n- qa-lead names lint-fix in agents\/qa-lead\.md: Run the lint-fix skill before every review\.\n- qa-lead names release in agents\/qa-lead\.md: Then the `release` skill\./, text);
  assert.doesNotMatch(text, /notes\.md/, "a skill's reference leaves stay out");
  assert.doesNotMatch(processText(path.join(dir, 'skills', 'lint-fix')), /Links between parts/);
});

test("a marketplace is drawn from the names of its plugins' parts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-market-'));
  const kit = path.join(dir, 'kit');
  write(path.join(kit, '.claude-plugin', 'plugin.json'), '{"name":"kit","description":"Ships the kit"}');
  write(path.join(kit, 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Long text that stays out\n---\n');
  write(path.join(kit, 'agents', 'reviewer.md'), '---\nname: reviewer\n---\n');
  write(path.join(kit, 'hooks', 'hooks.json'), '{"hooks":{"PreToolUse":[]},"modules":["../mods/guard/register.ts"]}');
  write(path.join(kit, 'mods', 'guard', 'register.ts'), 'export const GUARD = 1;');
  write(path.join(kit, '.mcp.json'), '{"mcpServers":{"docs":{"command":"x"}}}');
  const plugins = [{ name: 'kit', dir: kit, source: '0.2.0' }, { name: 'plain', dir: path.join(dir, 'missing'), description: 'Only skills' }];
  const text = marketText(plugins);
  assert.match(text, /### kit\nShips the kit\nSkills: deploy\nAgents: reviewer\nHook events: PreToolUse\nMods: guard\nMCP servers: docs/);
  assert.doesNotMatch(text, /0\.2\.0/, 'no versions: a version bump keeps the drawing');
  assert.equal(marketText([...plugins].reverse()), text, 'the page order (updates first) does not change the text');
  assert.equal(marketProcessText([...plugins].reverse()), marketProcessText(plugins));
  assert.doesNotMatch(text, /Long text/);
  assert.match(text, /### plain\nOnly skills/);
  assert.match(drawPrompt('market', 'acme', 'S'), /plugin marketplace "acme"[\s\S]*## Marketplace\nS$/);
  assert.match(marketProcessPrompt('acme', 'S'), /marketplace "acme" as a process[\s\S]*## Marketplace\nS$/);
});

test("a marketplace's process is read from the lines where one plugin's working files name another plugin or a part only it has", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-market-links-'));
  const at = (plugin: string, rel: string, text: string) => write(path.join(dir, plugin, rel), text);
  at('writer', '.claude-plugin/plugin.json', '{"name":"writer","description":"Writes drafts"}');
  at('writer', 'agents/draft-writer.md', '---\nname: draft-writer\n---\n');
  at('writer', 'skills/draft/SKILL.md', '---\nname: draft\n---\n\nRun deploy first.\nHand the draft to the `polish-pass` skill when it is installed.\n');
  at('polisher', '.claude-plugin/plugin.json', '{"name":"polisher"}');
  at('polisher', 'skills/polish-pass/SKILL.md', '---\nname: polish-pass\n---\n');
  at('polisher', 'skills/polish-pass/references/notes.md', 'Once the writer plugin wrote a draft twice.\n');
  at('polisher', 'skills/deploy/SKILL.md', '---\nname: deploy\n---\n');
  at('gate', '.claude-plugin/plugin.json', '{"name":"gate"}');
  at('gate', 'hooks/hooks.json', '{"hooks":{"Stop":[]},"modules":["../mods/hold/register.ts"]}');
  at('gate', 'mods/hold/register.ts', 'const WRITERS = /draft-writer/;\n');
  at('loner', '.claude-plugin/plugin.json', '{"name":"loner","description":"Alone"}');
  const plugins = ['writer', 'polisher', 'gate', 'loner'].map(name => ({ name, dir: path.join(dir, name) }));
  const proc = marketProcessText(plugins);
  assert.match(proc, /### gate\nHook events: Stop; Mods: hold\n- names writer in mods\/hold\/register\.ts: const WRITERS = \/draft-writer\/;/, 'a mod that names an agent links to its plugin');
  assert.match(proc, /### writer\nWrites drafts\n- names polisher in skills\/draft\/SKILL\.md: Hand the draft to the `polish-pass` skill/, 'a plain word such as deploy is no link');
  assert.match(proc, /### polisher(\n|$)/, 'a plugin only named by others takes part');
  assert.doesNotMatch(proc, /references\/notes\.md/, "a skill's reference leaves stay out");
  assert.match(proc, /### Plugins that name no other plugin and that no plugin names\nloner$/);
  assert.equal(marketProcessText([...plugins].reverse()), proc, 'the page order does not change the text');
});
