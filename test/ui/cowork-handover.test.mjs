// UI tests of the Handover page, run in a real, isolated VS Code (see harness.mjs): the inbox, the card Claude drafts and the owner ticks, and
// Continue in terminal with its confirm card. The desktop app's data is the synthetic test/fixtures/cowork-desktop, Downloads is a scratch
// folder (CLAUDE_HARNESS_DOWNLOADS), the sessions API a loopback server, and `claude` on the PATH is a stub that answers a fixed draft and
// records the prompt it got; the terminal starts `echo`, never a real Claude.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';

const PORT = Number(process.env.CHATS_API_PORT || 9646);
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ data: [{ id: 'cse_fixture1', title: 'Fixture cloud session', status: 'idle', user_message_count: 7, updated_at: '2026-10-29T10:00:00Z' }] }));
});
process.env.CLAUDE_HARNESS_SESSIONS_URL = `http://127.0.0.1:${PORT}/v1/code/sessions`;

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const fixtures = path.join(here, '..', 'fixtures', 'cowork-desktop');
const SHOTS = process.env.HANDOVER_SHOTS || path.join(s.root, 'shots');
const DRAFT = { task: 'Finish the fixture report.', rules: ['Every draft image is used'], exists: ['report.md'], todo: ['The summary'] };

const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const typeInto = (sel, value) =>
  s.ev(
    (D, sel, value) => {
      const i = D.querySelector(sel);
      i.value = value;
      i.dispatchEvent(new Event('input', { bubbles: true }));
    },
    sel,
    value
  );

/** A screenshot of one region of the window, the VS Code side bar closed. */
async function shoot(file, selector) {
  const open = await s.pageEv(() => !!document.querySelector('.part.sidebar') && document.querySelector('.part.sidebar').getClientRects().length > 0);
  if (open) await s.chord('b', { ctrl: true });
  await new Promise(r => setTimeout(r, 600));
  const box = await s.ev((D, selector) => {
    const r = D.querySelector(selector).getBoundingClientRect();
    const f = D.defaultView.frameElement.getBoundingClientRect();
    return { x: r.left + f.left, y: r.top + f.top, width: r.width, height: r.height };
  }, selector);
  const outer = await s.pageEv(() => {
    const f = [...document.querySelectorAll('iframe.webview')].find(e => e.getClientRects().length).getBoundingClientRect();
    return { x: f.left, y: f.top };
  });
  const shot = await s.page.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x + outer.x, y: box.y + outer.y, width: box.width, height: box.height, scale: 1 } });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
}

const downloads = path.join(s.root, 'downloads');
const stub = path.join(s.root, 'stubbin');
const promptFile = path.join(stub, 'prompt.txt');
const folder = () => path.join(s.root, 'repos', 'shop-api', 'handover', 'fixture-research-chat');

before(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const data = path.join(s.root, 'cowork-desktop-data');
  fs.rmSync(data, { recursive: true, force: true });
  fs.cpSync(fixtures, data, { recursive: true });
  process.env.CLAUDE_HARNESS_LOCALAPPDATA = data;
  fs.rmSync(downloads, { recursive: true, force: true });
  fs.mkdirSync(downloads, { recursive: true });
  fs.writeFileSync(path.join(downloads, 'fixture-notes.md'), '# Fixture notes\n');
  fs.writeFileSync(path.join(downloads, 'fixture-setup.exe'), 'x');
  process.env.CLAUDE_HARNESS_DOWNLOADS = downloads;
  fs.rmSync(stub, { recursive: true, force: true });
  fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(path.join(stub, 'stub.js'), `let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{require('fs').writeFileSync(${JSON.stringify(promptFile)},d);console.log(JSON.stringify({result:JSON.stringify(${JSON.stringify(DRAFT)})}));});\n`);
  fs.writeFileSync(path.join(stub, 'claude.cmd'), '@node "%~dp0stub.js" %*\r\n');
  process.env.PATH = `${stub}${path.delimiter}${process.env.PATH}`;
  s.settings({ 'claudeHarness.terminal.command': 'echo' });
  await s.start();
  fs.writeFileSync(path.join(s.fixture.claude, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-token', expiresAt: Date.now() + 3600_000 } }));
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.resize(1500);
});

after(async () => {
  await s.stop();
  server.close();
});

test('the Overview AI group ends with Cowork Handover after the two hunters, and it opens the page', T, async () => {
  assert.deepEqual(await labels('.overview-tabs ~ .hunt-cta button, .hunt-cta button'), ['Plugin Hunter', 'Automation Hunter', 'Cowork Handover']);
  await s.mouse('.hunt-cta button', 'Cowork Handover');
  await s.waitFor(D => D.querySelector('.main-head .dh-kind')?.textContent.trim() === 'Handover');
  await s.mouse('.sidebar-head [aria-label="Overview"]', '');
  await s.waitFor(D => D.querySelector('.hunt-cta'));
});

test('the Handover entry opens an inbox with a link box, desktop chats, Cowork sessions and the recent files of Downloads', T, async () => {
  await s.mouse('.sidebar .cowork-region .row', 'Handover');
  await s.waitFor(D => /Fixture cloud session/.test(D.querySelector('.hv-inbox')?.innerText || ''));
  await s.waitFor(D => /fixture-notes\.md/.test(D.querySelector('.hv-inbox')?.innerText || ''));
  const inbox = await text('.hv-inbox');
  assert.match(inbox, /Fixture research chat/);
  assert.match(inbox, /Fixture cloud session/);
  assert.doesNotMatch(inbox, /fixture-setup/);
  assert.equal(await s.ev(D => D.querySelector('.hv-link input').placeholder), 'Paste an artifact link, or drop it here');
  assert.match(await text('.hv-card'), /Pick a source from the inbox/);
  await typeInto('.hv-inbox input[type=search]', 'notes');
  await s.waitFor(D => !/Fixture research chat/.test(D.querySelector('.hv-inbox').innerText));
  await typeInto('.hv-inbox input[type=search]', '');
  await s.waitFor(D => /Fixture research chat/.test(D.querySelector('.hv-inbox').innerText));
});

test('an artifact link and a Cowork session are reported as unreadable, with the snapshot to paste into', T, async () => {
  await typeInto('.hv-link input', 'https://claude.ai/artifacts/fixture-plan');
  await s.mouse('.hv-link button', 'Use link');
  await s.waitFor(D => D.querySelector('.hv-source-title')?.textContent === 'fixture-plan');
  assert.match(await text('.hv-card'), /not readable from here/);
  assert.equal(await s.ev(D => D.querySelector('.hv-card details[open] textarea') !== null), true);
  await typeInto('.hv-link input', 'not a link');
  await s.mouse('.hv-link button', 'Use link');
  await s.waitFor(D => /That is not a link/.test(D.querySelector('.hv-inbox').innerText));
  await s.mouse('.hv-item', 'Fixture cloud session');
  await s.waitFor(D => D.querySelector('.hv-source-title')?.textContent === 'Fixture cloud session');
  assert.match(await text('.hv-card'), /not readable with the Claude Code sign-in/);
});

test('a chat puts its files on the card, ticked; Claude drafts the task and rules after a confirm card', T, async () => {
  await s.mouse('.hv-item', 'Fixture research chat');
  await s.waitFor(D => D.querySelector('.hv-source-title')?.textContent === 'Fixture research chat');
  assert.deepEqual((await labels('.hv-file-name')).sort(), ['outputs/charts/chart.txt', 'outputs/report.md', 'uploads/fixture-brief.txt']);
  assert.equal(await s.ev(D => D.querySelectorAll('.hv-file input:checked').length), 3);
  assert.match(await s.ev(D => D.querySelector('.hv-card select').value), /shop-api$/);
  assert.equal(await s.ev(D => D.querySelector('.hv-task').value), '');
  await s.mouse('.main .cmd-bar button', 'Draft');
  await s.waitFor(D => D.querySelector('.cf'));
  const ask = await text('.cf');
  assert.match(ask, /Draft the handover with Claude/);
  assert.match(ask, /No file contents/);
  assert.ok(!fs.existsSync(promptFile), 'Claude is not asked before the card is confirmed');
  await s.mouse('.cf button', 'Draft');
  await s.waitFor(D => D.querySelector('.hv-task')?.value === 'Finish the fixture report.');
  const sent = fs.readFileSync(promptFile, 'utf8');
  assert.match(sent, /fixture topic/);
  assert.match(sent, /outputs\/report\.md/);
  assert.doesNotMatch(sent, /Synthetic report text/, 'file contents are never sent');
  assert.deepEqual(await s.ev(D => [...D.querySelectorAll('.hv-state textarea')].map(t => t.value)), ['Every draft image is used', 'report.md', 'The summary']);
  assert.equal(await s.ev(D => D.querySelector('.hv-state').open), true, 'the folded fields open when the draft filled them');
  assert.equal(await s.ev(D => !!D.querySelector('.main .cmd-bar > .ai-group:last-child')), true);
  assert.deepEqual(await labels('.main .cmd-bar button'), ['Reload', 'Draft', 'Continue in terminal']);
  assert.equal(await s.ev(D => D.querySelectorAll('.hv-card button.primary, .hv-card .ai-group').length), 0, 'nothing stays at the card bottom');
  assert.equal(await s.ev(D => D.querySelector('.hv-card details[open] textarea').value.split('Please research the fixture topic').length - 1), 1, 'the first message is in the snapshot once');
});

test('a missing file shows with icon and text and a Locate action, and the card reads well', T, async () => {
  // The host flags a file that is gone when the source is read; the same message is posted here.
  await s.ev(D => {
    D.defaultView.postMessage({ type: 'handoverSeed', seed: { title: 'Fixture research chat', source: 'chat', snapshot: 'You: Please research the fixture topic.', files: [{ name: 'outputs/report.md', file: 'x', include: true, missing: false }, { name: 'outputs/old-chart.png', file: 'gone', include: true, missing: true }, { name: 'uploads/fixture-brief.txt', file: 'y', include: false, missing: false }] } }, '*');
  });
  await s.waitFor(D => D.querySelector('.hv-file.missing'));
  const row = await text('.hv-file.missing');
  assert.match(row, /old-chart\.png/);
  assert.match(row, /Missing on this PC/);
  assert.match(row, /Locate/);
  assert.equal(await s.ev(D => !!D.querySelector('.hv-file.missing .codicon-warning')), true);
  // The card as the owner would have it: the draft in place.
  await typeInto('.hv-task', 'Finish the fixture report.');
  await s.ev(D => {
    for (const [k, v] of [['Rules the chat set', 'Every draft image is used'], ['What exists', 'report.md'], ['Still to write', 'The summary']]) {
      const f = [...D.querySelectorAll('.hv-field')].find(x => x.querySelector('.hv-label')?.textContent === k);
      f.querySelector('textarea').value = v;
      f.querySelector('textarea').dispatchEvent(new Event('input', { bubbles: true }));
    }
    D.querySelector('.hv-state').open = true;
  });
  await shoot(path.join(SHOTS, '23-handover-card.png'), '.main');
});

test('Continue in terminal lists every file and the first prompt, copies the ticked files and opens the terminal', T, async () => {
  // Back to the real chat so the files exist; the draft is typed in again.
  await s.mouse('.hv-item', 'Fixture research chat');
  await s.waitFor(D => D.querySelectorAll('.hv-file').length === 3 && !D.querySelector('.hv-file.missing'));
  await typeInto('.hv-task', 'Finish the fixture report.');
  await s.ev(D => {
    for (const [k, v] of [['Rules the chat set', 'Every draft image is used'], ['What exists', 'report.md'], ['Still to write', 'The summary']]) {
      const f = [...D.querySelectorAll('.hv-field')].find(x => x.querySelector('.hv-label')?.textContent === k);
      f.querySelector('textarea').value = v;
      f.querySelector('textarea').dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  // The brief is left out; a file that vanishes after the card was made is flagged on the confirm card.
  await s.ev(D => {
    const box = [...D.querySelectorAll('.hv-file')].find(r => r.textContent.includes('fixture-brief')).querySelector('input');
    box.click();
  });
  const gone = path.join(s.root, 'cowork-desktop-data', 'Claude-Data', 'claude_fixture', 'local-agent-mode-sessions', 'acct-1', 'org-1', 'local_cccc0001', 'outputs', 'charts', 'chart.txt');
  const keep = fs.readFileSync(gone);
  fs.rmSync(gone);
  try {
    const before = await s.pageEv(() => document.querySelectorAll('.terminal-tab, .terminal-tabs-entry').length);
    await s.mouse('.main .cmd-bar button', 'Continue in terminal');
    await s.waitFor(D => D.querySelector('.cf'));
    const card = await text('.cf');
    assert.match(card, /Continue in a terminal/);
    assert.match(card, /CONTEXT\.md/);
    assert.match(card, /files\/outputs\/report\.md/);
    assert.match(card, /files\/outputs\/charts\/chart\.txt is missing on this PC and is not copied/);
    assert.doesNotMatch(card, /fixture-brief/);
    assert.match(card, /first prompt: Finish the fixture report\. Read handover\/fixture-research-chat\/CONTEXT\.md first/);
    assert.doesNotMatch(card, /Don't ask again/);
    assert.ok(!fs.existsSync(folder()), 'nothing is written before the card is confirmed');
    await shoot(path.join(SHOTS, '24-handover-confirm.png'), '.main');
    await s.mouse('.cf button', 'Continue in terminal');
    await s.waitFor(D => /Claude Code is open in/.test(D.querySelector('.hv-card').innerText));
    assert.match(await text('.hv-card'), /1 file was missing and not copied/);
    assert.ok(fs.existsSync(path.join(folder(), 'files', 'outputs', 'report.md')));
    assert.ok(!fs.existsSync(path.join(folder(), 'files', 'uploads')), 'an unticked file is not copied');
    const context = fs.readFileSync(path.join(folder(), 'CONTEXT.md'), 'utf8');
    assert.match(context, /## Task\n\nFinish the fixture report\./);
    assert.match(context, /## Rules the chat set\n\n- Every draft image is used/);
    assert.match(context, /## Still to write\n\n- The summary/);
    assert.match(context, /fixture topic/);
    assert.ok(fs.readFileSync(path.join(path.dirname(path.dirname(path.dirname(gone))), 'audit.jsonl'), 'utf8').includes('fixture topic'), 'the source is only read');
    await s.waitFor(() => true);
    assert.ok((await s.pageEv(() => document.querySelectorAll('.terminal-tab, .terminal-tabs-entry').length)) > before, 'a terminal opened');
  } finally {
    fs.writeFileSync(gone, keep);
  }
});
