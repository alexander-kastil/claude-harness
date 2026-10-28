import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { addLine, hasLine, pathWith, pathWithout, profileLine, psProfileFiles, removeLine, shimDir, shimFiles } from '../../src/cli-install';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `install-${what}-`));
const ID = 'integrations-at.claude-harness';

/** A fake extension folder with the command line's entry point, which prints the arguments it received. */
function fakeExtension(root: string, folder: string) {
  const cli = path.join(root, folder, 'out', 'src', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
}

/** Runs the written locator with a scratch home, so the real ~/.vscode is never read. */
function runLocator(home: string, args: string[]) {
  const bin = path.join(home, 'bin');
  const [mjs] = shimFiles(bin);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(mjs.file, mjs.text);
  return spawnSync(process.execPath, [mjs.file, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
}

test('shimFiles writes the locator, the cmd shim and the sh shim into the folder', () => {
  const files = shimFiles('D:/bin');
  assert.deepEqual(files.map(f => path.basename(f.file)), ['harness.mjs', 'harness.cmd', 'harness']);
  assert.equal(path.dirname(files[0].file), path.join('D:/bin'));
});

test('the cmd shim calls the locator next to it with the arguments passed through', () => {
  const cmd = shimFiles('D:/bin')[1].text;
  assert.equal(cmd, '@node "%~dp0harness.mjs" %*\r\n');
});

test('the sh shim execs node on the locator next to it', () => {
  const sh = shimFiles('D:/bin')[2].text;
  assert.match(sh, /^#!\/bin\/sh\n/);
  assert.ok(sh.includes('exec node "$(dirname "$0")/harness.mjs" "$@"'));
  assert.ok(!sh.includes('\r'));
});

test('the locator names the extension it looks for and runs its cli.js with the node executable', () => {
  const mjs = shimFiles('D:/bin')[0].text;
  assert.ok(mjs.includes(`const ID = '${ID}';`));
  assert.ok(mjs.includes('process.execPath'));
  assert.ok(mjs.includes("join(dir, 'out', 'src', 'cli.js')"));
});

test('the locator runs the newest installed version when no extensions.json registers it', () => {
  const home = tmp('newest');
  fakeExtension(path.join(home, '.vscode', 'extensions'), `${ID}-0.7.1`);
  fakeExtension(path.join(home, '.vscode', 'extensions'), `${ID}-0.8.0`);
  const run = runLocator(home, ['complete', '--json']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), '["complete","--json"]');
  assert.ok(fs.readFileSync(path.join(home, '.vscode', 'extensions', `${ID}-0.8.0`, 'out', 'src', 'cli.js'), 'utf8').length > 0);
});

test('the locator prefers the version the extensions registry names over a newer folder on disk', () => {
  const home = tmp('registered');
  const extensions = path.join(home, '.vscode-insiders', 'extensions');
  fakeExtension(extensions, `${ID}-0.9.0`);
  fakeExtension(extensions, `${ID}-0.8.0`);
  fs.writeFileSync(path.join(extensions, 'extensions.json'), JSON.stringify([{ identifier: { id: ID }, relativeLocation: `${ID}-0.8.0` }]));
  const run = runLocator(home, ['harness-check']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), '["harness-check"]');
});

test('the locator exits 1 with a message when the extension is not installed', () => {
  const run = runLocator(tmp('none'), ['complete']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not installed/);
});

test('profileLine is the PowerShell and the Git Bash line', () => {
  assert.equal(profileLine('powershell'), 'harness completion powershell | Out-String | Invoke-Expression');
  assert.equal(profileLine('bash'), 'eval "$(harness completion bash)"');
});

test('hasLine finds the line with surrounding spaces and CRLF endings, not a commented copy', () => {
  const line = profileLine('bash');
  assert.equal(hasLine(`export A=1\r\n  ${line}  \r\n`, line), true);
  assert.equal(hasLine(`# ${line}\n`, line), false);
  assert.equal(hasLine('', line), false);
});

test('addLine appends the line once and a second call changes nothing', () => {
  const line = profileLine('bash');
  const once = addLine('export A=1\n', line);
  assert.equal(once, `export A=1\n${line}\n`);
  assert.equal(addLine(once, line), once);
});

test('addLine adds the missing newline and keeps CRLF endings', () => {
  const line = profileLine('powershell');
  assert.equal(addLine('Set-Alias x y', line), `Set-Alias x y\n${line}\n`);
  assert.equal(addLine('Set-Alias x y\r\n', line), `Set-Alias x y\r\n${line}\r\n`);
  assert.equal(addLine('', line), `${line}\n`);
});

test('removeLine drops only the exact line and keeps the others', () => {
  const line = profileLine('bash');
  assert.equal(removeLine(`a\r\n${line}\r\nb\r\n`, line), 'a\r\nb\r\n');
  assert.equal(removeLine(`a\n# ${line}\n`, line), `a\n# ${line}\n`);
});

test('psProfileFiles picks the profile that exists and creates the 5.1 one when neither does', () => {
  const docs = 'C:\\Users\\me\\Documents';
  const v51 = path.win32.join(docs, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
  const v7 = path.win32.join(docs, 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
  assert.deepEqual(psProfileFiles(docs, () => false), [v51]);
  assert.deepEqual(psProfileFiles(docs, f => f === v7), [v7]);
  assert.deepEqual(psProfileFiles(docs, () => true), [v51, v7]);
});

test('shimDir is %LOCALAPPDATA%\\claude-harness\\bin on Windows and ~/.local/bin elsewhere', () => {
  assert.equal(shimDir('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'C:\\Users\\me'), 'C:\\Users\\me\\AppData\\Local\\claude-harness\\bin');
  assert.equal(shimDir('win32', {}, 'C:\\Users\\me'), 'C:\\Users\\me\\AppData\\Local\\claude-harness\\bin');
  assert.equal(shimDir('linux', {}, '/home/me'), '/home/me/.local/bin');
});

test('pathWith appends the folder once, ignoring case and a trailing backslash', () => {
  assert.equal(pathWith('C:\\Tools;C:\\Git', 'C:\\bin'), 'C:\\Tools;C:\\Git;C:\\bin');
  assert.equal(pathWith('C:\\Tools;C:\\Git;C:\\bin', 'C:\\BIN'), undefined);
  assert.equal(pathWith('C:\\Tools\\', 'C:\\Tools'), undefined);
  assert.equal(pathWith('C:\\Tools;', 'C:\\bin'), 'C:\\Tools;C:\\bin');
  assert.equal(pathWith('', 'C:\\bin'), 'C:\\bin');
});

test('pathWithout removes only the folder and keeps the order of the others', () => {
  assert.equal(pathWithout('C:\\Tools;C:\\bin;C:\\Git', 'c:\\BIN\\'), 'C:\\Tools;C:\\Git');
  assert.equal(pathWithout('C:\\Tools', 'C:\\bin'), 'C:\\Tools');
});
