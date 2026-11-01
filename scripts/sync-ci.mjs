// Copies the product's CI (its logos and the final cut of each film) into the integrations.at CI folder on OneDrive,
// named by that folder's convention {slug}-{channel}-{asset}-{variant}-{WxH}.{ext}.
// Run after a logo changes or a film gets a new cut: `npm run sync:ci [-- --target <dir>] [-- --dry-run]`.
// A film's final cut is its highest `<name>-v<N>.mp4` in assets/films/<film>/media/output, with its `-silent` twin.
// Files already there with the same size are left alone; nothing in the target is removed.
// --dry-run prints the table with `would copy` and writes nothing. Exit 0 done, 2 bad arguments.
import { readFileSync, readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
let target = 'E:/Onedrive/OneDrive - Integrations IT Solutions/Business/CI/claude-harness';
let dryRun = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') dryRun = true;
  else if (args[i] === '--target' && args[i + 1]) target = args[++i];
  else if (args[i] === '--help') { console.log('usage: node scripts/sync-ci.mjs [--target <dir>] [--dry-run]'); process.exit(0); }
  else { console.error(`unknown argument: ${args[i]}`); process.exit(2); }
}
const slug = 'claude-harness';

const pngSize = (p) => { const b = readFileSync(p); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };
const svgSize = (p) => { const m = /viewBox="0 0 (\d+) (\d+)"/.exec(readFileSync(p, 'utf8')); return m ? `${m[1]}x${m[2]}` : 'any'; };
const videoSize = (p) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', p], { encoding: 'utf8' }).trim();

const items = [];
const logo = (src, asset, size) => items.push({ src, dest: `01-logo/${slug}-vscode-${asset}-${size(join(repo, src))}${src.slice(src.lastIndexOf('.'))}` });
logo('media/icon.png', 'icon', pngSize);
logo('media/harness.svg', 'mark-mono', svgSize);
logo('media/harness-tab.svg', 'mark-accent', svgSize);
logo('assets/images/marketplace/media/marketplace-header.png', 'marketplace-header', pngSize);

const film = (src, asset) => items.push({ src, dest: `06-motion/${slug}-motion-${asset}-${videoSize(join(repo, src))}.mp4` });
for (const name of readdirSync(join(repo, 'assets/films'))) {
  const out = join(repo, 'assets/films', name, 'media/output');
  if (!existsSync(out)) continue;
  const latest = new Map();
  for (const f of readdirSync(out)) {
    const m = /^(.+)-v(\d+)\.mp4$/.exec(f);
    if (m && Number(m[2]) > (latest.get(m[1]) ?? 0)) latest.set(m[1], Number(m[2]));
  }
  for (const [base, v] of latest) {
    film(`assets/films/${name}/media/output/${base}-v${v}.mp4`, `${base}-v${v}`);
    const silent = `${base}-v${v}-silent.mp4`;
    if (existsSync(join(out, silent))) film(`assets/films/${name}/media/output/${silent}`, `${base}-v${v}-silent`);
  }
}
film('docs/images/harness-demo.mp4', 'product-demo');

const rows = items.map(({ src, dest }) => {
  const to = join(target, dest);
  const same = existsSync(to) && statSync(to).size === statSync(join(repo, src)).size;
  if (!same && !dryRun) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(repo, src), to); }
  return [same ? 'unchanged' : dryRun ? 'would copy' : 'copied', src, dest];
});
const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length), ['State', 'Source', 'CI file'][i].length));
const line = (r) => `| ${r.map((c, i) => c.padEnd(w[i])).join(' | ')} |`;
const changed = rows.filter((r) => r[0] !== 'unchanged').length;
console.log(`**CI of claude-harness: ${changed} ${dryRun ? 'to copy' : 'copied'}, ${rows.length} files, ${target}**\n`);
console.log([line(['State', 'Source', 'CI file']), line(w.map((n) => '-'.repeat(n))), ...rows.map(line)].join('\n'));
