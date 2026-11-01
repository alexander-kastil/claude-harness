// Draw with Claude on a skill, run end to end in a real, isolated VS Code with a slow `claude` stub on PATH: both perspectives run at
// once and finish, the page shows the run's real state after a page change (still running, the drawing, or the failure), and no
// stub process is left behind. The stub replies like `claude -p --output-format json`; nothing leaves the machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session, sleep } from './harness.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
let stub;
const log = () => (fs.existsSync(path.join(stub, 'runs.log')) ? fs.readFileSync(path.join(stub, 'runs.log'), 'utf8').split('\n').filter(Boolean) : []);

before(async () => {
  stub = path.join(s.root, 'claude-stub-draw');
  fs.rmSync(stub, { recursive: true, force: true });
  fs.mkdirSync(stub, { recursive: true });
  // Reads the prompt on stdin, waits, answers with an svg (or fails when mode.txt says so), and logs its start and end.
  fs.writeFileSync(
    path.join(stub, 'stub.mjs'),
    `import fs from 'node:fs'; import path from 'node:path';
const dir = import.meta.dirname;
// Only the drawing runs count: the extension also calls claude for other things (a connector list).
const note = t => process.argv.includes('--system-prompt') && fs.appendFileSync(path.join(dir, 'runs.log'), t + ' ' + process.pid + '\\n');
let input = ''; process.stdin.on('data', d => (input += d));
process.stdin.on('end', () => { note('start'); setTimeout(() => {
  const mode = fs.existsSync(path.join(dir, 'mode.txt')) ? fs.readFileSync(path.join(dir, 'mode.txt'), 'utf8').trim() : 'ok';
  note('end');
  if (mode === 'fail') console.log(JSON.stringify({ is_error: true, result: 'Stub: the model is overloaded' }));
  else console.log(JSON.stringify({ result: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 240"><rect x="20" y="20" width="240" height="60" fill="none" stroke="currentColor"/><text x="36" y="56" fill="currentColor">stub drawing</text></svg>', total_cost_usd: 0 }));
}, 8000); });
`
  );
  fs.writeFileSync(path.join(stub, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0stub.mjs" %*\r\n`);
  process.env.PATH = `${stub}${path.delimiter}${process.env.PATH}`;
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
});

after(() => s.stop());

const open = async name => {
  await s.mouse('.sidebar-head [aria-label="Overview"]');
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.mouse('.main .overview .tile', 'Skills');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent === 'Skills');
  await s.mouse('.main [role=row]', name);
  await s.waitFor((D, n) => D.querySelector('.main-head h1')?.textContent.startsWith(n), name);
  await sleep(800);
};
const draw = async () => {
  await s.mouse('.main .cmd-bar button', 'Draw');
  await s.waitFor(D => !!D.querySelector('.cf'));
  await s.mouse('.cf button', 'Draw');
};
const state = () =>
  s.ev(D => ({
    button: [...D.querySelectorAll('.main .cmd-bar .ai-group button')].map(b => b.textContent.trim()).find(t => /Draw/.test(t)),
    figure: D.querySelector('.main .dv-draw svg')?.textContent || '',
    note: D.querySelector('.main .dv-draw .dv-empty')?.textContent || '',
    busy: !!D.querySelector('.main-head.busy'),
  }));

test('Draw on a skill runs both perspectives at once, a page change keeps the run in view, and the drawing arrives', T, async () => {
  await open('api-design');
  await draw();
  await s.waitFor(D => [...D.querySelectorAll('.main .cmd-bar .ai-group button')].some(b => b.textContent.trim() === 'Drawing...'));
  // Away to the overview and back while Claude is still working: the page says so.
  await open('commit-helper');
  await open('api-design');
  const back = await state();
  assert.equal(back.button, 'Drawing...', 'the run is still shown as running after the page change');
  assert.equal(back.busy, true);
  const done = await s.waitFor(async D => {
    const b = [...D.querySelectorAll('.main .cmd-bar .ai-group button')].map(x => x.textContent.trim());
    const svg = D.querySelector('.main .dv-draw svg')?.textContent;
    return b.includes('Redraw') && svg ? { b, svg } : false;
  });
  assert.equal(done.svg, 'stub drawing');
  const runs = log();
  assert.equal(runs.filter(l => l.startsWith('start')).length, 2, 'one claude run per perspective');
  assert.equal(runs.filter(l => l.startsWith('end')).length, 2);
  // Both started before either ended: the two perspectives run at once.
  assert.deepEqual(runs.slice(0, 2).map(l => l.split(' ')[0]), ['start', 'start']);
});

test('a failed run says so on the page, also after a page change', T, async () => {
  fs.writeFileSync(path.join(stub, 'mode.txt'), 'fail');
  await open('db-migrate');
  await draw();
  await open('commit-helper');
  await open('db-migrate');
  const failed = await s.waitFor(async D => {
    const note = D.querySelector('.main .dv-draw .dv-empty')?.textContent;
    return note ? { note, button: [...D.querySelectorAll('.main .cmd-bar .ai-group button')].map(x => x.textContent.trim()).find(t => /Draw/.test(t)) } : false;
  });
  assert.match(failed.note, /last drawing failed/);
  assert.equal(await s.ev(D => D.querySelector('.main .dv-draw .dv-empty')?.getAttribute('title')), 'Stub: the model is overloaded', 'the reason is in the hover');
  assert.equal(failed.button, 'Draw');
  // A page change after the end still shows it.
  await open('commit-helper');
  await open('db-migrate');
  assert.match((await state()).note, /last drawing failed/);
  fs.rmSync(path.join(stub, 'mode.txt'));
});

test('no stub process is left behind after the runs end', T, async () => {
  const { execSync } = await import('node:child_process');
  const ids = log().map(l => l.split(' ')[1]);
  assert.ok(ids.length >= 4);
  const alive = ids.filter(pid => {
    try {
      return execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8' }).includes(pid);
    } catch {
      return false;
    }
  });
  assert.deepEqual(alive, []);
});
