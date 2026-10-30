// The Cowork toggle in a window whose configuration registry predates claudeHarness.cowork.show (an update applied without a reload):
// VS Code refuses to write an unregistered setting, so the toggle keeps its choice in the extension's state and shows no error.
// The window loads a copy of the extension whose manifest lacks the setting; its code is the working tree's.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session } from './harness.mjs';
import { repoRoot } from './fixture.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };

before(async () => {
  const dir = path.join(s.root, 'ext-old-manifest');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'node_modules', '@vscode'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  for (const group of manifest.contributes.configuration) delete group.properties['claudeHarness.cowork.show'];
  // The scratch root may sit on another drive than the repo, where no relative path exists: a one-line entry file requires the built code.
  manifest.main = './extension.js';
  fs.writeFileSync(path.join(dir, 'extension.js'), `module.exports = require(${JSON.stringify(path.join(repoRoot, 'out', 'src', 'extension.js'))});\n`);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  fs.cpSync(path.join(repoRoot, 'media'), path.join(dir, 'media'), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'node_modules', '@vscode', 'codicons'), path.join(dir, 'node_modules', '@vscode', 'codicons'), { recursive: true });
  s.extensionPath = dir;
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.sidebar .cowork-region'));
});

after(() => s.stop());

const press = label => s.pageEv(label => { const a = [...document.querySelectorAll('.editor-actions .action-label')].find(x => (x.getAttribute('aria-label') || '').startsWith(label)); a?.click(); return !!a; }, label);
const errors = () => s.pageEv(() => [...document.querySelectorAll('.notifications-toasts .notification-list-item')].map(n => n.textContent.trim()));

test('the eye toggle hides and shows the Cowork region when the setting is not registered, without an error', T, async () => {
  assert.ok(await press('Hide Cowork View'), 'the toggle is in the tab bar');
  await s.waitFor(D => !D.querySelector('.sidebar .cowork-region') && D.querySelector('.sidebar .list'));
  assert.deepEqual(await errors(), [], 'no error toast');
  assert.ok(await press('Show Cowork View'), 'the toggle now offers Show');
  await s.waitFor(D => D.querySelector('.sidebar .cowork-region'));
  assert.deepEqual(await errors(), [], 'no error toast');
});
