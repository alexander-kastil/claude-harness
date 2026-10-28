import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { contentHash, drawPrompt, drawSource, drawable, readDrawing, writeDrawing } from '../../src/drawing';
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
  assert.match(plugin, /skills, agents, commands, MCP servers and hooks/);
  assert.match(plugin, /## Plugin\nPARTS$/);
  for (const kind of ['agent', 'command', 'workflow', 'mod', 'hook', 'mcp'] as const) {
    const p = drawPrompt(kind, 'x', 'S');
    assert.match(p, /viewBox of about 800 by 240/, kind);
    assert.match(p, /\nS$/, kind);
  }
  assert.match(drawPrompt('skill', 'big', 'y'.repeat(30001)), /\[cut\]$/);
});
