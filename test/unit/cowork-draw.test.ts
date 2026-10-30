import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { CHAT_PREFIX, TASK_PREFIX, connectorSource, coworkSource, forgetCoworkDraws, taskText } from '../../src/cowork-draw';
import { drawPrompt, processPrompt } from '../../src/drawing';
import type { ScheduledTask } from '../../src/cowork-scheduled';

const fixtureRoot = (): string => {
  for (const up of ['../..', '../../..']) {
    const p = path.join(__dirname, up, 'test', 'fixtures', 'cowork-desktop');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('cowork-desktop fixture not found');
};

const task = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: 'task-1',
  name: 'Fixture weekly digest',
  status: 'Active',
  statusKind: 'ok',
  cron: '0 9 * * 1',
  repeats: 'Weekly on Monday at 09:00',
  lastRunStatus: '',
  runsOn: 'Cloud',
  connectors: 1,
  connectorNames: ['Fixture Search'],
  pluginNames: ['fixture-plugin'],
  marketplaceNames: [],
  permissions: 'Ask before acting',
  source: 'Cowork',
  instructions: 'SYNTHETIC-INSTRUCTIONS: collect the fixture items and write the digest.',
  ...over,
});

test('a scheduled task is drawn from its schedule, instructions, connectors and plugins', () => {
  const src = coworkSource(`${TASK_PREFIX}task-1`, [task()]);
  assert.ok(src);
  assert.equal(src.kind, 'task');
  assert.equal(src.name, 'Fixture weekly digest');
  assert.match(src.text, /Repeats: Weekly on Monday/);
  assert.match(src.text, /### Connectors\n- Fixture Search/);
  assert.match(src.text, /### Plugins\n- fixture-plugin/);
  assert.match(src.text, /SYNTHETIC-INSTRUCTIONS/);
  assert.equal(coworkSource(`${TASK_PREFIX}missing`, [task()]), undefined);
  assert.equal(coworkSource(`${TASK_PREFIX}task-1`, undefined), undefined);
  assert.equal(taskText(task({ instructions: 'x'.repeat(9000) })).length < 9000, true, 'long instructions are cut');
});

test('a chat is drawn from its conversation and the files it produced and was given', () => {
  process.env.CLAUDE_HARNESS_LOCALAPPDATA = fixtureRoot();
  forgetCoworkDraws();
  const src = coworkSource(`${CHAT_PREFIX}local_cccc0001`, undefined);
  assert.ok(src);
  assert.equal(src.kind, 'chat');
  assert.match(src.text, /### Files given to the chat\n- fixture-brief.txt/);
  assert.match(src.text, /### Files the chat produced\n- charts\/chart.txt[\s\S]*- report.md/);
  assert.match(src.text, /You: .*fixture topic/);
  assert.doesNotMatch(src.text, /tool_use/);
});

test('a connector is drawn from the tasks, projects and skills that use it', () => {
  process.env.CLAUDE_HARNESS_LOCALAPPDATA = fixtureRoot();
  forgetCoworkDraws();
  const skill = path.join(os.tmpdir(), `cowork-draw-skill-${process.pid}.md`);
  fs.writeFileSync(skill, 'Search with Fixture Connector first.');
  try {
    const src = connectorSource('Fixture Connector', [task({ connectorNames: ['Fixture Connector'] }), task({ id: 'task-2', name: 'Other', connectorNames: ['Elsewhere'] })], [{ name: 'fixture-skill', file: skill }, { name: 'quiet-skill', file: skill + '.missing' }]);
    assert.equal(src.kind, 'connector');
    assert.match(src.text, /### Scheduled tasks that use it\n- Fixture weekly digest/);
    assert.doesNotMatch(src.text, /Other/);
    assert.match(src.text, /### Projects whose sessions called it\n- Fixture Alpha: \d+ calls/);
    assert.match(src.text, /### Skills that name it\n- fixture-skill/);
    assert.doesNotMatch(src.text, /quiet-skill/);
  } finally {
    fs.rmSync(skill, { force: true });
  }
});

test('every Cowork kind has a harness and a process prompt that carries the source', () => {
  for (const kind of ['connector', 'task', 'chat'] as const) {
    assert.match(drawPrompt(kind, 'Fixture', 'SOURCE-TEXT'), /SOURCE-TEXT/);
    assert.match(processPrompt(kind, 'Fixture', 'SOURCE-TEXT'), /as a process|numbered|process/);
  }
});
