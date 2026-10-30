import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';
import {
  Asset,
  COWORK_EMPTY,
  COWORK_ID,
  COWORK_SETTINGS_URL,
  COWORK_URL_CAPABILITIES,
  COWORK_URL_CONNECTORS,
  COWORK_URL_PLUGINS,
  COWORK_URL_SKILLS,
  HarnessScope,
  coworkBlock,
  coworkView,
  createAsset,
  duplicateAsset,
  globalScope,
  isCoworkAsset,
  isSyncedPath,
  renameAsset,
  retireBlock,
  scan,
  setPluginEnabled,
} from '../../src/harness';

// The fixture is a ~/.claude shaped like the real layout: skills/synced/<org>_<user>/ and plugins/synced/<org>_<user>/.
const fixtureRoot = (): string => {
  // COWORK_FIXTURE names the folder when the tests run from an output folder outside the repo.
  if (process.env.COWORK_FIXTURE) return process.env.COWORK_FIXTURE;
  for (const start of [__dirname, process.cwd()]) {
    for (let dir = start, up = 0; up < 8; dir = path.dirname(dir), up++) {
      const candidate = path.join(dir, 'test', 'fixtures', 'cowork-claude');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('test/fixtures/cowork-claude not found');
};

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `cowork-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const skill = (name: string, body = 'Body') => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`;

/** A copy of the fixture, so a test that writes cannot touch the committed one. */
const copyFixture = (): string => {
  const root = tmp('root');
  fs.cpSync(fixtureRoot(), root, { recursive: true });
  return root;
};

/** One hash over every file under the synced folders: path and bytes. */
function syncedHash(root: string): string {
  const hash = crypto.createHash('sha1');
  const walk = (dir: string) => {
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)) : []) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else hash.update(path.relative(root, f) + '\0').update(fs.readFileSync(f));
    }
  };
  walk(path.join(root, 'skills', 'synced'));
  walk(path.join(root, 'plugins', 'synced'));
  return hash.digest('hex');
}

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const items = (view: ReturnType<typeof coworkView>, kind: string): Asset[] => view.categories.find(c => c.kind === kind)!.items;

test('the Cowork loader reads the synced skills as read-only assets with their owner', () => {
  const view = coworkView(fixtureRoot());
  assert.equal(view.id, COWORK_ID);
  assert.equal(view.label, 'Cowork');
  const skills = items(view, 'skill');
  assert.deepEqual(skills.map(s => s.name), ['brand-notes', 'docs', 'review-contract']);
  assert.ok(skills.every(s => s.scope === COWORK_ID && isCoworkAsset(s) && s.id === `cowork|skill:${s.name}`));
  const by = Object.fromEntries(skills.map(s => [s.name, s]));
  assert.equal(by.docs.owner, 'Anthropic');
  assert.equal(by['brand-notes'].owner, 'Your account');
  assert.equal(by['review-contract'].owner, 'marketing plugin');
  assert.equal(by.docs.description, 'Editable docs people share and comment on.');
  assert.ok(by['brand-notes'].files!.includes('references/voice.md'));
  assert.equal(by.docs.mtime, Date.parse('2026-09-30T00:33:27.599727Z'));
});

test('the Cowork loader reads the synced plugins with name, version and owner from the meta files', () => {
  const view = coworkView(fixtureRoot());
  const plugins = items(view, 'plugin');
  assert.deepEqual(plugins.map(p => p.name), ['design', 'marketing']);
  const [design, marketing] = plugins;
  assert.equal(design.id, 'cowork|plugin:design');
  // The manifest entry (a meta file) says 0040; the plugin's own plugin.json says 1.2.0 and comes last.
  assert.equal(design.version, '0040');
  assert.equal(design.owner, 'knowledge-work-plugins');
  assert.equal(design.about, 'Anthropic catalog');
  assert.equal(design.status, 'available');
  // The ~g2 folder name is an escape: the name comes from the manifest, the version falls back to the manifest's.
  assert.ok(marketing.dir!.endsWith('marketing~g2'));
  assert.equal(marketing.version, '0041');
  assert.equal(marketing.owner, 'org-uploads');
  assert.equal(marketing.about, 'account_upload');
  assert.equal(marketing.status, 'installed');
  assert.ok(plugins.every(p => p.scope === COWORK_ID && p.enabled === undefined));
});

test('claude.ai connectors move under the Cowork scope, other servers stay out', () => {
  const server = (name: string, source: Asset['source']): Asset => ({ id: `global|mcp:${name}`, scope: 'global', kind: 'mcp', name, description: '', file: '', mtime: 0, source });
  const view = coworkView(fixtureRoot(), [server('claude.ai Gamma', 'claude.ai'), server('mine', 'user'), server('plugin:x:y', 'plugin')]);
  const mcp = items(view, 'mcp');
  assert.deepEqual(mcp.map(m => [m.id, m.scope, m.source]), [['cowork|mcp:claude.ai Gamma', COWORK_ID, 'claude.ai']]);
});

test('without synced items the Cowork scope is empty and says why in one line', () => {
  const root = tmp('empty');
  const view = coworkView(root);
  assert.equal(view.categories.reduce((n, c) => n + c.items.length, 0), 0);
  assert.equal(view.cowork!.empty, COWORK_EMPTY);
  assert.match(COWORK_EMPTY, /^Nothing from Claude\.ai is on this PC/);
  assert.equal(view.cowork!.settingsUrl, COWORK_SETTINGS_URL);
  // Each claude.ai page the extension opens, verified on a fresh load; none of them is the old /settings/capabilities.
  assert.deepEqual([COWORK_URL_SKILLS, COWORK_URL_PLUGINS, COWORK_URL_CONNECTORS, COWORK_URL_CAPABILITIES], ['https://claude.ai/new#customize/skills/yours', 'https://claude.ai/new#customize/plugins/yours', 'https://claude.ai/new#customize/connectors/yours', 'https://claude.ai/new#settings/capabilities']);
  const full = coworkView(fixtureRoot());
  assert.equal(full.cowork!.empty, undefined);
});

test('a broken manifest or a folder without meta files still loads what is readable', () => {
  const root = tmp('broken');
  write(root, 'skills/synced/o_u/manifest.json', '{ not json');
  write(root, 'skills/synced/o_u/plain/SKILL.md', skill('plain'));
  write(root, 'plugins/synced/o_u/manifest.json', '');
  write(root, 'plugins/synced/o_u/lone/.claude-plugin/plugin.json', JSON.stringify({ name: 'lone', version: '3' }));
  const view = coworkView(root);
  assert.deepEqual(items(view, 'skill').map(s => [s.name, s.owner]), [['plain', 'Your account']]);
  assert.deepEqual(items(view, 'plugin').map(p => [p.name, p.version, p.owner]), [['lone', '3', undefined]]);
});

test('Global does not list the synced skills or plugins as its own', () => {
  const root = copyFixture();
  const scope = globalScope(root);
  const cats = scan(scope);
  assert.deepEqual(cats.find(c => c.kind === 'skill')!.items, []);
  assert.deepEqual(cats.find(c => c.kind === 'plugin')!.items, []);
});

test('isSyncedPath names the folders Claude.ai syncs and nothing beside them', () => {
  const root = path.join(os.tmpdir(), 'claude-root');
  assert.ok(isSyncedPath(root, path.join(root, 'skills', 'synced', 'o_u', 'docs', 'SKILL.md')));
  assert.ok(isSyncedPath(root, path.join(root, 'plugins', 'synced')));
  assert.ok(!isSyncedPath(root, path.join(root, 'skills', 'synced-not', 'x')));
  assert.ok(!isSyncedPath(root, path.join(root, 'skills', 'mine', 'SKILL.md')));
});

test('every write to the Cowork scope is refused with "Managed by Claude.ai"', () => {
  const root = copyFixture();
  const before = syncedHash(root);
  const view = coworkView(root);
  const docs = items(view, 'skill').find(s => s.name === 'docs')!;
  const design = items(view, 'plugin').find(p => p.name === 'design')!;
  const scope: HarnessScope = { ...globalScope(root), id: COWORK_ID, label: 'Cowork', base: root };
  const refused = /Managed by Claude\.ai: Claude\.ai overwrites it on every sync/;
  assert.match(coworkBlock(COWORK_ID, 'renamed')!, refused);
  assert.equal(coworkBlock('global'), undefined);
  assert.equal(coworkBlock('repo:/x'), undefined);
  assert.throws(() => createAsset(scope, 'skill', 'new-one'), refused);
  assert.throws(() => renameAsset(scope, docs, 'docs2'), refused);
  // Called with the Global scope but a Cowork asset, which is what a stale click could do.
  assert.throws(() => renameAsset(globalScope(root), docs, 'docs2'), refused);
  assert.throws(() => duplicateAsset(globalScope(root), docs, 'docs-copy'), refused);
  assert.throws(() => duplicateAsset(scope, docs, 'docs-copy'), refused);
  assert.throws(() => setPluginEnabled(scope, 'design@knowledge-work-plugins', true), refused);
  assert.match(retireBlock(docs, root)!, refused);
  assert.match(retireBlock(design, root)!, /^Only skills and agents are retired\./);
  assert.ok(!fs.existsSync(path.join(root, 'settings.json')));
  assert.ok(!fs.existsSync(path.join(root, 'skills', 'docs2')) && !fs.existsSync(path.join(root, 'skills', 'new-one')));
  assert.equal(syncedHash(root), before);
});

/** A Claude folder with the synced fixture, a skill of the owner's that names a synced skill, and a marketplace of the owner's. */
function world() {
  const root = copyFixture();
  const market = tmp('market');
  write(root, 'skills/media/SKILL.md', skill('media', 'Uses the docs skill and brand-notes/references/voice.md.'));
  write(root, 'skills/film/SKILL.md', skill('film', 'Needs media and docs.'));
  write(market, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'own', plugins: [] }));
  write(market, 'plugins/other/skills/x/SKILL.md', skill('x', 'Read the docs skill.'));
  write(root, 'plugins/known_marketplaces.json', JSON.stringify({ own: { source: { source: 'directory', path: market }, installLocation: market } }));
  // No repos known: the owner's real ~/.claude.json is never read.
  write(root, 'user-config.json', '{}');
  return { root, market, base: ['--root', root, '--market', market, '--user-config', path.join(root, 'user-config.json')] };
}

test('skills repoint, rename and fix-paths never touch the synced folders, even when a synced skill is named', async () => {
  const w = world();
  const before = syncedHash(w.root);
  // The synced voice file and skill mention the name being repointed; they are not ours to rewrite.
  const repoint = await cli(['skills', 'repoint', '--from', 'docs', '--to', 'documents', ...w.base]);
  assert.equal(repoint.code, 0, repoint.err);
  assert.equal(syncedHash(w.root), before);
  assert.match(fs.readFileSync(path.join(w.root, 'skills/synced/org-1111_user-2222/brand-notes/references/voice.md'), 'utf8'), /`docs` skill/);
  // A skill that exists only as a synced skill cannot be renamed.
  const rename = await cli(['skills', 'rename', '--from', 'docs', '--to', 'documents', ...w.base]);
  assert.equal(rename.code, 1);
  assert.ok(fs.existsSync(path.join(w.root, 'skills/synced/org-1111_user-2222/docs/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(w.root, 'skills/synced/org-1111_user-2222/documents')));
  // Renaming a skill of the owner's that a synced skill mentions leaves the synced mention.
  const own = await cli(['skills', 'rename', '--from', 'media', '--to', 'pictures', ...w.base]);
  assert.equal(own.code, 0, own.err);
  assert.equal(syncedHash(w.root), before);
  const fix = await cli(['skills', 'fix-paths', ...w.base]);
  assert.equal(fix.code, 0, fix.err);
  assert.equal(syncedHash(w.root), before);
});

test('skills rename and remove refuse the synced folder itself', async () => {
  const w = world();
  const before = syncedHash(w.root);
  const rename = await cli(['skills', 'rename', '--from', 'synced', '--to', 'mine', ...w.base]);
  assert.equal(rename.code, 2);
  assert.match(rename.err, /managed by Claude\.ai/);
  const remove = await cli(['skills', 'remove', '--name', 'synced', ...w.base]);
  assert.equal(remove.code, 2);
  assert.ok(fs.existsSync(path.join(w.root, 'skills', 'synced')));
  assert.equal(syncedHash(w.root), before);
});

test('hunt create --retire plans nothing in the synced folders, and a synced skill cannot be put into a plugin', async () => {
  const w = world();
  const before = syncedHash(w.root);
  const catalog = JSON.parse((await cli(['hunt', 'catalog', '--json', ...w.base])).out) as { catalog: { asset: { name: string } }[]; strays?: { path?: string; name?: string }[] };
  assert.deepEqual(catalog.catalog.map(c => c.asset.name).sort(), ['film', 'media']);
  assert.ok(!JSON.stringify(catalog).includes('synced'));
  const plan = JSON.parse((await cli(['hunt', 'create', '--dry-run', '--name', 'tools', '--category', 'misc', '--skills', 'media', '--retire', '--json', ...w.base])).out) as { files: string[]; retired: string[] };
  assert.ok(![...plan.files, ...plan.retired].some(x => /synced/.test(x)));
  const synced = await cli(['hunt', 'create', '--dry-run', '--name', 'tools', '--category', 'misc', '--skills', 'docs', '--retire', ...w.base]);
  assert.equal(synced.code, 1);
  assert.equal(syncedHash(w.root), before);
  assert.ok(!fs.existsSync(path.join(w.market, 'plugins', 'tools')));
});

test('inventory --cowork lists the synced items of --root, with owner and version, and writes nothing', async () => {
  const root = copyFixture();
  const before = syncedHash(root);
  const r = await cli(['inventory', '--cowork', '--json', '--root', root]);
  assert.equal(r.code, 0, r.err);
  const o = JSON.parse(r.out) as { scope: { id: string }; categories: { kind: string; count: number; items: { name: string; owner?: string; version?: string }[] }[] };
  assert.equal(o.scope.id, COWORK_ID);
  const count = (kind: string) => o.categories.find(c => c.kind === kind)!.count;
  assert.deepEqual([count('skill'), count('plugin'), count('mcp')], [3, 2, 0]);
  assert.deepEqual(o.categories.find(c => c.kind === 'plugin')!.items.map(p => [p.name, p.version, p.owner]), [['design', '0040', 'knowledge-work-plugins'], ['marketing', '0041', 'org-uploads']]);
  assert.equal(syncedHash(root), before);
  const global = JSON.parse((await cli(['inventory', '--json', '--root', root])).out) as { scope: { id: string } };
  assert.equal(global.scope.id, 'global');
});
