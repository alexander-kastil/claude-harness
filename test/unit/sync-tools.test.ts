import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { cursorRule, planSyncTools, syncToolsData, writeSyncTools } from '../../src/sync-tools';

const scratch = () => fs.mkdtempSync(path.join(process.env.SYNC_TOOLS_TMP || os.tmpdir(), 'sync-tools-'));
const put = (file: string, text: string) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, text));

test('a repo plan lists AGENTS.md, the Cursor rule and Copilot instructions with their state', () => {
  const dir = scratch();
  put(path.join(dir, 'CLAUDE.md'), '# Rules\r\nBe brief.  \r\n');
  put(path.join(dir, 'AGENTS.md'), '# Rules\nBe brief.\n');
  put(path.join(dir, '.github', 'copilot-instructions.md'), 'something else\n');
  const plan = planSyncTools('r', dir, os.homedir(), path.join(dir, 'none'));
  assert.deepEqual(plan.targets.map(t => [t.id, t.state]), [['AGENTS.md', 'same'], ['.cursor/rules/claude.mdc', 'missing'], ['.github/copilot-instructions.md', 'differs']]);
  assert.equal(plan.source.label, 'CLAUDE.md');
  // The AGENTS.md row reuses harness.ts: a CLAUDE.md in the folder means Claude Code does not load AGENTS.md.
  assert.equal(plan.targets[0].load?.state, 'not loaded');
  assert.equal(plan.targets[1].load, undefined);
});

test('the Cursor rule is an always-applied .mdc with frontmatter', () => {
  const rule = cursorRule('# A\r\nB\r\n');
  assert.match(rule, /^---\ndescription: .*\nglobs:\nalwaysApply: true\n---\n\n# A\nB\n$/);
});

test('without a CLAUDE.md there are no targets; .claude/CLAUDE.md is the fallback source', () => {
  const dir = scratch();
  assert.equal(planSyncTools('r', dir, os.homedir(), dir).targets.length, 0);
  put(path.join(dir, '.claude', 'CLAUDE.md'), 'x\n');
  const plan = planSyncTools('r', dir, os.homedir(), dir);
  assert.equal(plan.source.label, '.claude/CLAUDE.md');
  assert.equal(plan.targets.length, 3);
});

test('the global plan reads ~/.claude/CLAUDE.md and targets the tools global files', () => {
  const home = scratch();
  put(path.join(home, '.claude', 'CLAUDE.md'), 'global\n');
  put(path.join(home, '.codex', 'AGENTS.md'), 'global\n');
  const plan = planSyncTools('global', undefined, home, path.join(home, '.claude'));
  assert.deepEqual(plan.targets.map(t => [t.id, t.state]), [['~/.agents/AGENTS.md', 'missing'], ['~/.codex/AGENTS.md', 'same'], ['~/.gemini/GEMINI.md', 'missing'], ['~/.copilot/copilot-instructions.md', 'missing']]);
});

test('write backs up what it overwrites, creates folders, skips targets in sync and the others', () => {
  const dir = scratch();
  const backup = scratch();
  put(path.join(dir, 'CLAUDE.md'), 'src\n');
  put(path.join(dir, 'AGENTS.md'), 'old\n');
  put(path.join(dir, '.github', 'copilot-instructions.md'), 'untouched\n');
  const plan = planSyncTools('r', dir, os.homedir(), dir);
  const done = writeSyncTools(plan, ['AGENTS.md', '.cursor/rules/claude.mdc'], backup);
  assert.deepEqual(done, ['AGENTS.md', '.cursor/rules/claude.mdc']);
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'src\n');
  assert.match(fs.readFileSync(path.join(dir, '.cursor', 'rules', 'claude.mdc'), 'utf8'), /alwaysApply: true/);
  assert.equal(fs.readFileSync(path.join(dir, '.github', 'copilot-instructions.md'), 'utf8'), 'untouched\n');
  assert.equal(fs.readFileSync(path.join(backup, 'AGENTS.md'), 'utf8'), 'old\n');
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'src\n');
  assert.ok(!('expected' in syncToolsData(plan).targets[0]));
});
