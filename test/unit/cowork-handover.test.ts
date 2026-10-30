import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { chatById, loadChat } from '../../src/cowork-chats';
import { findDataRoot } from '../../src/cowork-desktop';
import { applyHandover, draftPrompt, listDownloads, parseDraft, planHandover, seedFromChat, seedFromLink } from '../../src/cowork-handover';
import type { HandoverCard } from '../../src/cowork-handover';

const fixtureRoot = (): string => {
  if (process.env.COWORK_DESKTOP_FIXTURE) return process.env.COWORK_DESKTOP_FIXTURE;
  for (const up of ['../..', '../../..']) {
    const p = path.join(__dirname, up, 'test', 'fixtures', 'cowork-desktop');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('cowork-desktop fixture not found');
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'handover-'));

const cardOf = (repo: string): HandoverCard => {
  const chat = chatById('local_cccc0001', findDataRoot(fixtureRoot()))!;
  const seed = seedFromChat(chat, loadChat(chat));
  return { ...seed, repo, folder: '', task: 'Finish the fixture report.', rules: 'Every draft image is used\n', exists: 'report.md', todo: 'The summary', files: [...seed.files, { name: 'gone.txt', file: path.join(repo, 'nowhere.txt'), include: true }] };
};

test('a chat seeds the card with its conversation and every file ticked', () => {
  const seed = seedFromChat(chatById('local_cccc0001', findDataRoot(fixtureRoot()))!, loadChat(chatById('local_cccc0001', findDataRoot(fixtureRoot()))!));
  assert.match(seed.snapshot, /You: Please research the fixture topic/);
  assert.deepEqual(seed.files.map(f => f.name).sort(), ['outputs/charts/chart.txt', 'outputs/report.md', 'uploads/fixture-brief.txt']);
  assert.ok(seed.files.every(f => f.include));
});

test('an artifact link seeds a title and says its content cannot be read', () => {
  const seed = seedFromLink('https://claude.ai/artifacts/fixture-plan?x=1');
  assert.equal(seed.title, 'fixture-plan');
  assert.match(seed.note ?? '', /not readable/);
  assert.equal(seed.link, 'https://claude.ai/artifacts/fixture-plan?x=1');
});

test('the plan copies only ticked files, flags a missing one, and writes the card into CONTEXT.md', () => {
  const repo = tmp();
  const card = cardOf(repo);
  card.files.find(f => f.name === 'uploads/fixture-brief.txt')!.include = false;
  const plan = planHandover(card, r => r === repo, () => true);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.copy.map(c => c.name).sort(), ['files/gone.txt', 'files/outputs/charts/chart.txt', 'files/outputs/report.md']);
  assert.match(plan.prompt, /handover\/fixture-research-chat\/CONTEXT\.md/);
  assert.deepEqual(applyHandover(plan), ['files/gone.txt']);
  assert.ok(fs.existsSync(path.join(plan.folder, 'files', 'outputs', 'report.md')));
  assert.ok(!fs.existsSync(path.join(plan.folder, 'files', 'uploads')));
  const context = fs.readFileSync(path.join(plan.folder, 'CONTEXT.md'), 'utf8');
  assert.match(context, /## Rules the chat set\n\n- Every draft image is used/);
  assert.match(context, /## Still to write\n\n- The summary/);
  assert.match(context, /gone\.txt \(missing on the PC, not copied\)/);
});

test('a target outside the known repos, a folder that leaves it and a file from nowhere are refused', () => {
  const repo = tmp();
  const card = cardOf(repo);
  assert.ok(planHandover(card, () => false, () => true).problems.some(p => /repository of yours/.test(p)));
  assert.ok(planHandover({ ...card, folder: '../out' }, () => true, () => true).problems.some(p => /inside the repository/.test(p)));
  assert.ok(planHandover(card, () => true, () => false).problems.some(p => /did not come from a source/.test(p)));
});

test('Downloads lists the recent app files, newest first, and nothing else', () => {
  const dir = tmp();
  const now = Date.now();
  const put = (name: string, ageDays: number) => {
    fs.writeFileSync(path.join(dir, name), 'x');
    const t = new Date(now - ageDays * 86400000);
    fs.utimesSync(path.join(dir, name), t, t);
  };
  put('old.md', 40);
  put('new.docx', 1);
  put('newer.png', 0.1);
  put('setup.exe', 1);
  put('part.crdownload', 0.1);
  assert.deepEqual(listDownloads(dir, now).map(f => f.name), ['newer.png', 'new.docx']);
  assert.deepEqual(listDownloads(path.join(dir, 'none'), now), []);
});

test('Claude\'s draft is read into the card fields, and a plain answer becomes the task', () => {
  const d = parseDraft('{"task":"Write the summary.","rules":["Use the brief only"],"exists":["report.md"],"todo":[]}');
  assert.deepEqual(d, { task: 'Write the summary.', rules: 'Use the brief only', exists: 'report.md', todo: '' });
  assert.equal(parseDraft('Just write the summary.').task, 'Just write the summary.');
  assert.match(draftPrompt({ title: 'T', snapshot: 'S', files: [{ name: 'a.md', file: 'x', include: true }] }), /a\.md/);
});
