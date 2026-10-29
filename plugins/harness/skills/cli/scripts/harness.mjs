#!/usr/bin/env node
// Runs the Claude Harness command line (preview) from the VS Code extension the user has installed.
// Usage: node harness.mjs <command> [options]   (all arguments are passed through to cli.js)
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
  console.error(`The Claude Harness extension (${ID}) with its command line is not installed. Install version 0.9.0 or later.`);
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--no-deprecation', cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
