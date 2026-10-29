// Writes the extension's version from package.json into the harness plugin's plugin.json, keeping the file's formatting.
// Runs as the npm `version` script, so every `npm version` bump (sideload.ps1 included) moves the plugin with it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const file = join(root, 'plugins', 'harness', '.claude-plugin', 'plugin.json');
const text = readFileSync(file, 'utf8');
const next = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
if (next === text && !text.includes(`"version": "${version}"`)) {
  console.error(`No "version" field found in ${file}`);
  process.exit(1);
}
if (next !== text) writeFileSync(file, next);
console.log(`harness plugin ${version}`);
