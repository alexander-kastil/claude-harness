// UI test of the Permissions page, run in a real, isolated VS Code (see harness.mjs). The settings files are the fixture home's and a
// scratch repo's; the transcript that holds the permission prompts is written into the fixture's projects folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';
import { createRequire } from 'node:module';
import { repoRoot } from './fixture.mjs';

const { projectSlug } = createRequire(import.meta.url)(path.join(repoRoot, 'out', 'src', 'repos-overview.js'));
const s = new Session();
s.waitMs = 20000;
const T = { timeout: 240000 };
const SHOTS = process.env.PERMISSIONS_SHOTS;
const managedFile = path.join(s.root, 'managed-settings.json');
process.env.CLAUDE_HARNESS_MANAGED_SETTINGS = managedFile;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const text = (sel = '.main-body') => s.ev((D, sel) => D.querySelector(sel)?.innerText || '', sel);
const labels = sel => s.ev((D, sel) => [...D.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(e => (e.textContent || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()), sel);
let userFile;
let repo;
let repoLocal;

const use = (id, name, input, at) => JSON.stringify({ type: 'assistant', timestamp: at.toISOString(), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const answer = (id, source, at) => JSON.stringify({ type: 'user', timestamp: at.toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: source === 'user_reject' ? "The user doesn't want to proceed with this tool use." : 'ok', is_error: source === 'user_reject' }] }, permissionDecision: { decision: source === 'user_reject' ? 'reject' : 'accept', source } });

before(async () => {
  fs.mkdirSync(s.root, { recursive: true });
  fs.writeFileSync(managedFile,JSON.stringify({ permissions: { deny: ['WebFetch(domain:blocked.example)'], defaultMode: 'default' } }));
  await s.start();
  userFile = path.join(s.fixture.claude, 'settings.json');
  repo = s.fixture.repoDirs['shop-api'];
  repoLocal = path.join(repo, '.claude', 'settings.local.json');
  const user = readJson(userFile);
  fs.writeFileSync(userFile, JSON.stringify({ ...user, permissions: { allow: ['Bash(npm test *)', 'Read'], deny: ['Read(./.env)'], defaultMode: 'acceptEdits' } }, null, 2));
  const projectFile = path.join(repo, '.claude', 'settings.json');
  fs.writeFileSync(projectFile, JSON.stringify({ ...readJson(projectFile), permissions: { ask: ['Bash(git push *)'], additionalDirectories: ['../shared'] } }, null, 2));
  const now = Date.now();
  const lines = [];
  const ask = (n, name, input, source, ago) => {
    const at = new Date(now - ago);
    lines.push(use(`toolu_p${n}`, name, input, at), answer(`toolu_p${n}`, source, at));
  };
  ask(1, 'Bash', { command: 'git push origin main' }, 'user_temporary', 3600_000);
  ask(2, 'Bash', { command: 'git push --force origin main' }, 'user_reject', 7200_000);
  ask(3, 'Bash', { command: 'cd x && git push origin dev' }, 'user_temporary', 9000_000);
  ask(4, 'Bash', { command: 'npm test' }, 'user_temporary', 10000_000);
  ask(5, 'WebFetch', { url: 'https://docs.example.com/a' }, 'user_permanent', 20000_000);
  ask(6, 'Bash', { command: 'docker ps' }, 'user_temporary', 40 * 86400_000);
  ask(7, 'Bash', { command: 'ls' }, 'config', 3000_000);
  const folder = path.join(s.fixture.claude, 'projects', projectSlug(repo));
  fs.writeFileSync(path.join(folder, 'permission-prompts.jsonl'), lines.join('\n') + '\n');
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.resize(1280);
});

after(async () => {
  await s.stop();
});

/** The confirm card: its title, and a real press on its primary or Cancel button. */
const card = () => s.waitFor(D => D.querySelector('.cf .cf-title')?.textContent || '');
// A card button press, then the card gone: under the full suite's load the closing card is still there for the next step.
const press = async label => {
  await s.mouse('.cf button', label);
  await s.waitFor(D => !D.querySelector('.cf'));
};
const type = (selector, value) =>
  s.ev(
    (D, selector, value) => {
      const field = D.querySelector(selector);
      field.focus();
      field.value = value;
      field.dispatchEvent(new D.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    },
    selector,
    value
  );
const shoot = async file => {
  if (!SHOTS) return;
  const open = await s.pageEv(() => !!document.querySelector('.part.sidebar') && document.querySelector('.part.sidebar').getClientRects().length > 0);
  if (open) await s.chord('b', { ctrl: true });
  await s.move();
  await s.ev(D => D.querySelectorAll('.tl-hover').forEach(n => n.remove()));
  await new Promise(r => setTimeout(r, 500));
  const box = await s.ev(D => {
    const r = D.querySelector('.main').getBoundingClientRect();
    const f = D.defaultView.frameElement.getBoundingClientRect();
    return { x: r.left + f.left, y: r.top + f.top, width: r.width, height: r.height };
  });
  const outer = await s.pageEv(() => {
    const f = [...document.querySelectorAll('iframe.webview')].find(e => e.getClientRects().length).getBoundingClientRect();
    return { x: f.left, y: f.top };
  });
  const shot = await s.page.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x + outer.x, y: box.y + outer.y, width: box.width, height: box.height, scale: 1 } });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
};

test('Settings in the nav lists a Permissions row that opens the page with its two tabs', T, async () => {
  await s.mouse('.sidebar .section-head', 'Settings');
  await s.mouse('.sidebar .row', 'Permissions');
  await s.waitFor(D => D.querySelector('.main-head h1')?.textContent.trim() === 'Permissions');
  assert.deepEqual(await labels('.main .view-tabs [role=tab]'), ['Rules', 'Prompted in']);
  assert.equal(await s.ev(D => D.querySelectorAll('.main .ai-group').length), 0);
});

test('Rules shows the user scope: every mode as a chip with the saved one selected, and the rules as rows', T, async () => {
  await s.mouse('.main .permissions-chips button', 'shop-api');
  await s.waitFor(D => D.querySelector('.main .permissions-row'));
  const modes = await labels('.main [aria-label="Default mode"].permissions-chips button');
  assert.deepEqual(modes, ['Not set', 'Default', 'Accept edits', 'Plan', 'Auto', "Don't ask", 'Bypass']);
  assert.equal(await s.ev(D => D.querySelector('.main [data-mode].active')?.dataset.mode), 'acceptEdits');
  const rules = await labels('.main .permissions-row');
  assert.deepEqual(rules, ['Bash(npm test *)', 'Read', 'Read(./.env)']);
  assert.deepEqual(await labels('.main .permissions-chips[aria-label=Scope] button'), ['User', 'Project', 'Local', 'Managed']);
  await shoot(path.join(SHOTS || '', 'permissions-rules.png'));
});

test('adding a rule asks first: Cancel writes nothing, Add writes it and keeps every other key', T, async () => {
  const before = readJson(userFile);
  await type('.main .permissions-block[aria-label=Allow] .permissions-input', 'Bash(git status *)');
  assert.match(await card(), /Add this entry/);
  assert.match(await text('.cf'), /Bash\(git status \*\)/);
  await shoot(path.join(SHOTS || '', 'permissions-confirm.png'));
  await press('Cancel');
  await new Promise(r => setTimeout(r, 400));
  assert.deepEqual(readJson(userFile), before);
  await type('.main .permissions-block[aria-label=Allow] .permissions-input', 'Bash(git status *)');
  await card();
  await press('Add');
  await s.waitFor(D => [...D.querySelectorAll('.main .permissions-row')].some(r => r.textContent.includes('Bash(git status *)')));
  const after = readJson(userFile);
  assert.deepEqual(after.permissions.allow, ['Bash(npm test *)', 'Read', 'Bash(git status *)']);
  assert.deepEqual({ ...after, permissions: undefined }, { ...before, permissions: undefined });
});

test('removing a rule asks first and takes out only that entry', T, async () => {
  await s.mouse('.main .permissions-row[data-rule="Bash(git status *)"] button');
  assert.match(await card(), /Remove this entry/);
  await press('Remove');
  await s.waitFor(D => ![...D.querySelectorAll('.main .permissions-row')].some(r => r.textContent.includes('Bash(git status *)')));
  assert.deepEqual(readJson(userFile).permissions.allow, ['Bash(npm test *)', 'Read']);
});

test('a mode chip asks first and sets the default mode, auto included', T, async () => {
  await s.mouse('.main [data-mode=auto]');
  assert.match(await card(), /Change the default mode/);
  assert.match(await text('.cf'), /auto/);
  await press('Change');
  await s.waitFor(D => D.querySelector('.main [data-mode].active')?.dataset.mode === 'auto');
  assert.equal(readJson(userFile).permissions.defaultMode, 'auto');
});

test('the project scope shows its rules and extra directories, the local scope is empty until a change creates the file', T, async () => {
  await s.mouse('.main .permissions-chips[aria-label=Scope] button', 'Project');
  await s.waitFor(D => [...D.querySelectorAll('.main .permissions-row')].some(r => r.textContent.includes('Bash(git push *)')));
  assert.deepEqual(await labels('.main .permissions-row'), ['Bash(git push *)', '../shared']);
  await s.mouse('.main .permissions-chips[aria-label=Scope] button', 'Local');
  await s.waitFor(D => /not created yet/.test(D.querySelector('.main-body')?.innerText || ''));
  assert.equal(fs.existsSync(repoLocal), false);
  await type('.main .permissions-block[aria-label="Additional directories"] .permissions-input', '../docs');
  await card();
  await press('Add');
  await s.waitFor(D => [...D.querySelectorAll('.main .permissions-row')].some(r => r.textContent.includes('../docs')));
  assert.deepEqual(readJson(repoLocal).permissions.additionalDirectories, ['../docs']);
});

test('the managed scope is read only: rules show, no field and no remove button', T, async () => {
  await s.mouse('.main .permissions-chips[aria-label=Scope] button', 'Managed');
  await s.waitFor(D => [...D.querySelectorAll('.main .permissions-row')].some(r => r.textContent.includes('blocked.example')));
  assert.equal(await s.ev(D => D.querySelectorAll('.main .permissions-input, .main .permissions-row button').length), 0);
  assert.match(await text(), /read only/);
  assert.equal(await s.ev(D => [...D.querySelectorAll('.main [data-mode]')].every(b => b.disabled)), true);
});

test('Prompted in counts the prompts per rule pattern, newest period first, and Allow adds the rule to the scope picked', T, async () => {
  await s.mouse('.main .view-tab', 'Prompted in');
  await s.waitFor(D => D.querySelectorAll('.main .asset-table .at-row:not(.at-head)').length >= 2);
  const head = await labels('.main .asset-table .at-head > span');
  // A narrow panel drops the low columns (Tool, Last) first, as every asset table does.
  const compact = await s.ev(D => D.querySelector('.main .asset-table').classList.contains('at-compact2'));
  assert.deepEqual(head, compact ? ['Rule', 'Prompts', 'Answer', 'Allow'] : ['Rule', 'Tool', 'Prompts', 'Answer', 'Last', 'Allow']);
  const rows = await s.ev(D => [...D.querySelectorAll('.main .asset-table .at-row:not(.at-head)')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  // 7 days: git push (3 prompts, one denied), npm test (already allowed), docs.example.com; docker ps is 40 days old, ls was not a prompt.
  assert.equal(rows.length, 3, rows.join(' | '));
  assert.match(rows[0], /Bash\(git push \*\).*3.*Mixed/);
  assert.ok(rows.some(r => /Bash\(npm test \*\).*In rules/.test(r)), rows.join(' | '));
  assert.ok(!rows.some(r => /docker/.test(r)));
  await shoot(path.join(SHOTS || '', 'permissions-prompted.png'));
  // Allow in User (the default).
  await s.mouse('.main .asset-table .at-row:nth-child(2) button.permissions-allow');
  assert.match(await card(), /Add this entry/);
  assert.match(await text('.cf'), /Bash\(git push \*\)/);
  await press('Add');
  await s.waitFor(D => /Bash\(git push \*\).*In rules/.test(D.querySelector('.main .asset-table')?.innerText.replace(/\s+/g, ' ') || ''));
  assert.ok(readJson(userFile).permissions.allow.includes('Bash(git push *)'));
  assert.equal(readJson(userFile).permissions.defaultMode, 'auto');
  // Allow in Local: the scope chip decides which file is written.
  await s.mouse('.main .permissions-chips[aria-label="Allow in"] button', 'Local');
  await s.mouse('.main .asset-table .at-row button.permissions-allow');
  await card();
  await press('Add');
  await s.waitFor(D => !D.querySelector('.cf') && /In rules/.test(D.querySelector('.main .asset-table')?.innerText || ''));
  assert.ok(readJson(repoLocal).permissions.allow.length === 1, JSON.stringify(readJson(repoLocal)));
  assert.deepEqual(readJson(repoLocal).permissions.additionalDirectories, ['../docs']);
  // A longer period brings the 40 day old prompt.
  await s.mouse('.main .permissions-chips[aria-label=Period] button', 'All');
  await s.waitFor(D => /docker ps/.test(D.querySelector('.main .asset-table')?.innerText || '') || /Bash\(docker ps \*\)/.test(D.querySelector('.main .asset-table')?.innerText || ''));
});
