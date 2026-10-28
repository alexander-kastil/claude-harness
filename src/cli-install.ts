import * as path from 'path';

// The 'harness' command line the extension installs: three shims in one folder, the folder on the Windows user PATH, and the profile lines that turn on type-ahead.
// Pure functions: paths, environment and file contents come in as arguments, nothing here reads or writes a file. No vscode import.

export type Shell = 'powershell' | 'bash';

export interface ShimFile {
  file: string;
  text: string;
}

const ID = 'integrations-at.claude-harness';

// The locator is the logic of harness-plugin's harness.mjs, copied (no shared package): the registered extension first, then the newest folder on disk.
const LOCATOR = `#!/usr/bin/env node
// Runs the Claude Harness command line from the VS Code extension the user has installed.
// Usage: harness <command> [options]   (all arguments are passed through to cli.js)
// The registered version wins: older or uninstalled folders can stay on disk under ~/.vscode/extensions.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ID = 'integrations-at.claude-harness';
const roots = ['.vscode', '.vscode-insiders'].map(d => join(homedir(), d, 'extensions'));

function registered(root) {
  const file = join(root, 'extensions.json');
  if (!existsSync(file)) return null;
  try {
    const list = JSON.parse(readFileSync(file, 'utf8'));
    const hit = list.find(e => e?.identifier?.id?.toLowerCase() === ID);
    if (!hit) return null;
    const dir = hit.relativeLocation ? join(root, hit.relativeLocation) : hit.location?.fsPath;
    return dir && existsSync(join(dir, 'out', 'src', 'cli.js')) ? join(dir, 'out', 'src', 'cli.js') : null;
  } catch { return null; }
}

function newestOnDisk(root) {
  if (!existsSync(root)) return null;
  const ver = s => s.slice(ID.length + 1).split('.').map(n => parseInt(n, 10) || 0);
  const dirs = readdirSync(root)
    .filter(d => d.toLowerCase().startsWith(ID + '-') && existsSync(join(root, d, 'out', 'src', 'cli.js')))
    .sort((a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
  return dirs.length ? join(root, dirs[0], 'out', 'src', 'cli.js') : null;
}

const cli = roots.map(registered).find(Boolean) ?? roots.map(newestOnDisk).find(Boolean);
if (!cli) {
  console.error('The Claude Harness extension (' + ID + ') with its command line is not installed. Install version 0.7.1 or later.');
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--no-deprecation', cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
`;

const CMD = '@node "%~dp0harness.mjs" %*\r\n';

const SH = `#!/bin/sh
exec node "$(dirname "$0")/harness.mjs" "$@"
`;

/** The folder the shims are written to: %LOCALAPPDATA%\claude-harness\bin on Windows, ~/.local/bin elsewhere. */
export function shimDir(platform: string, env: { LOCALAPPDATA?: string }, home: string): string {
  return platform === 'win32' ? path.win32.join(env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local'), 'claude-harness', 'bin') : path.posix.join(home, '.local', 'bin');
}

/** The three files a 'harness' command needs in one folder: the locator, the Windows command shim and the Git Bash / sh shim. */
export function shimFiles(binDir: string): ShimFile[] {
  return [
    { file: path.join(binDir, 'harness.mjs'), text: LOCATOR },
    { file: path.join(binDir, 'harness.cmd'), text: CMD },
    { file: path.join(binDir, 'harness'), text: SH },
  ];
}

/** The one line that turns on type-ahead in a shell profile. */
export function profileLine(shell: Shell): string {
  return shell === 'powershell' ? 'harness completion powershell | Out-String | Invoke-Expression' : 'eval "$(harness completion bash)"';
}

/** The PowerShell profile files of Windows PowerShell 5.1 and PowerShell 7 under Documents; the 5.1 file when neither exists yet. */
export function psProfileFiles(documents: string, exists: (file: string) => boolean): string[] {
  const files = ['WindowsPowerShell', 'PowerShell'].map(folder => path.win32.join(documents, folder, 'Microsoft.PowerShell_profile.ps1'));
  const found = files.filter(exists);
  return found.length ? found : [files[0]];
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');
const sameLine = (a: string, b: string) => a.trim() === b.trim();

/** Whether a line of the text is the line, ignoring surrounding spaces and the line ending. */
export function hasLine(text: string, line: string): boolean {
  return text.split(/\r?\n/).some(l => sameLine(l, line));
}

/** The text with the line appended, keeping its line endings; unchanged when the line is already there. */
export function addLine(text: string, line: string): string {
  if (hasLine(text, line)) return text;
  const eol = eolOf(text);
  return text === '' || text.endsWith('\n') ? `${text}${line}${eol}` : `${text}${eol}${line}${eol}`;
}

/** The text without every line that is the line; the other lines and their endings stay. */
export function removeLine(text: string, line: string): string {
  return text.split(/\r?\n/).filter(l => !sameLine(l, line)).join(eolOf(text));
}

const pathKey = (p: string) => p.trim().replace(/[\\/]+$/, '').toLowerCase();

/** The user PATH with the folder appended, or undefined when the folder is already on it. */
export function pathWith(current: string, dir: string): string | undefined {
  if (current.split(';').some(p => pathKey(p) === pathKey(dir))) return undefined;
  const base = current.replace(/;+$/, '');
  return base ? `${base};${dir}` : dir;
}

/** The user PATH without the folder; the other entries keep their order. */
export function pathWithout(current: string, dir: string): string {
  return current
    .split(';')
    .filter(p => pathKey(p) !== pathKey(dir))
    .join(';');
}
