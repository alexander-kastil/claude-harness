import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { READ_TOOLS, artifactUrl, fetchDesignSystems, parseInstance, parseProject, type Fetcher } from '../../src/cowork-design';

/** Synthetic answers shaped like the two servers: the types, the instances of the Design System type, the standalone projects. */
export const TYPES = { types: [{ slug: 'type-docs', title: 'Docs', description: 'Docs.' }, { slug: 'type-ds', title: 'Design System', description: 'Design systems: a brand\'s README, tokens, components and assets.' }] };
export const INSTANCES = {
  default: 'sys-1',
  instances: [
    { slug: 'sys-1', url: 'https://claude.ai/artifact/AbC123', title: 'Acme', favicon: '🧩', created_at: '2026-09-18T07:35:53Z', published_at: '2026-10-28T22:05:59Z', audience: 'owner', rel: 'mine', current_type_version: '1793205115-a85c' },
    { slug: 'sys-2', url: 'https://claude.ai/artifact/DeF456', title: 'Shared kit', favicon: '', created_at: '2026-10-01T10:00:00Z', published_at: '2026-10-02T10:00:00Z', audience: 'org', rel: 'shared' },
  ],
};
export const PROJECTS = { projects: [{ id: 'proj-1', name: 'Broadsheet', updated_at: '2026-09-01T00:00:00Z' }] };

const rpc = (result: unknown, status = 200) => ({ status, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: result } }) });
/** A Claude config folder with the sign-in, and the separate Claude Design sign-in (`designOauth`, written by /design-login) when given. */
const root = (creds?: object, designOauth?: object) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-'));
  if (creds) fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: creds, ...(designOauth && { designOauth }) }));
  return dir;
};
const DESIGN_LOGIN = { accessToken: 'design-tok', expiresAt: Date.now() + 1e6 };
/** What the Claude Design server answers: the design systems, a project's sharing and url, and its files (directories among them). */
const DESIGN_SYSTEMS = [{ id: 'proj-1', name: 'Broadsheet', is_default: false }];
const PROJECT = { id: 'proj-1', name: 'Broadsheet', type: 'PROJECT_TYPE_DESIGN_SYSTEM', url: 'https://claude.ai/design/p/proj-1', sharing: { link_permission: 'none', scope: 'private', view_mode: 'x' } };
const FILES = [{ path: 'README.md', type: 'file' }, { path: 'tokens', type: 'dir' }, { path: 'tokens/colors.json', type: 'file' }];
const designAnswer = (name: string) => (name === 'list_design_systems' ? rpc(DESIGN_SYSTEMS) : name === 'get_project' ? rpc(PROJECT) : rpc(FILES));

/** A fetcher that records each call and answers by tool; `design` answers the Claude Design server. */
const server = (design: (name: string) => { status: number; text(): Promise<string> }) => {
  const calls: { url: string; tool: string; auth: string; meta: unknown }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    const params = JSON.parse(init.body).params;
    calls.push({ url, tool: params.name, auth: init.headers.Authorization, meta: params._meta });
    if (/design\/mcp/.test(url)) return design(params.name);
    return rpc(params.name === 'list_types' ? TYPES : INSTANCES);
  };
  return { calls, fetcher };
};

test('the list names every design system with who can use it, when it was published and whether it is standalone', async () => {
  const s = server(designAnswer);
  const list = await fetchDesignSystems(root({ accessToken: 'tok', expiresAt: Date.now() + 1e6 }, DESIGN_LOGIN), { fetcher: s.fetcher });
  assert.equal(list.state, 'ok');
  assert.deepEqual(list.systems.map(d => [d.name, d.usableBy, d.standalone, d.isDefault, d.mine]), [
    ['Acme', 'Just you', false, true, true],
    ['Shared kit', 'Your organization', false, false, false],
    ['Broadsheet', 'Just you', true, false, true],
  ]);
  assert.equal(list.systems[0].publishedAt, Date.parse('2026-10-28T22:05:59Z'));
  assert.deepEqual(list.systems[2].files, ['README.md', 'tokens/colors.json'], 'directories are not files');
  assert.equal(list.systems[2].url, 'https://claude.ai/design/p/proj-1');
  assert.match(list.holds, /README, tokens, components/);
  assert.equal(list.standalone.state, 'ok');
});

test('only list and read tools are ever called, with the login as the bearer token', async () => {
  const s = server(designAnswer);
  await fetchDesignSystems(root({ accessToken: 'tok' }, DESIGN_LOGIN), { fetcher: s.fetcher });
  assert.deepEqual([...new Set(s.calls.map(c => c.tool))].sort(), ['get_project', 'list_artifacts', 'list_design_systems', 'list_files', 'list_types']);
  for (const c of s.calls) assert.ok(READ_TOOLS.has(c.tool), c.tool);
  // The Claude Design server gets the design login's token, the artifact server the Claude Code one.
  assert.ok(s.calls.filter(c => /design\/mcp/.test(c.url)).every(c => c.auth === 'Bearer design-tok'));
  assert.ok(s.calls.filter(c => !/design\/mcp/.test(c.url)).every(c => c.auth === 'Bearer tok'));
  // The artifact server takes its route marker in _meta; the design server none.
  assert.deepEqual(s.calls.filter(c => !/design\/mcp/.test(c.url)).map(c => c.meta), [{ 'anthropic.com/artifact-route': {} }, { 'anthropic.com/artifact-route': {} }]);
  assert.ok(![...READ_TOOLS].some(t => /create|publish|pin|write|delete|register|finalize/.test(t)));
});

test('without a Claude Design login, with an expired one, or with one the server refuses, the list says run /design-login and keeps the artifact list', async () => {
  const none = server(designAnswer);
  const a = await fetchDesignSystems(root({ accessToken: 'tok' }), { fetcher: none.fetcher });
  assert.equal(a.systems.length, 2);
  assert.equal(a.standalone.state, 'needsScopes');
  assert.match(a.standalone.note, /\/design-login/);
  assert.deepEqual(none.calls.filter(c => /design\/mcp/.test(c.url)), [], 'the design server is not asked without its login');
  const expired = server(designAnswer);
  assert.equal((await fetchDesignSystems(root({ accessToken: 'tok' }, { accessToken: 'd', expiresAt: 5 }), { fetcher: expired.fetcher, now: 10 })).standalone.state, 'needsScopes');
  assert.deepEqual(expired.calls.filter(c => /design\/mcp/.test(c.url)), []);
  const refused = server(() => ({ status: 403, text: async () => JSON.stringify({ error: 'needs_design_scopes', prompt: 'run /design-login' }) }));
  const b = await fetchDesignSystems(root({ accessToken: 'tok' }, DESIGN_LOGIN), { fetcher: refused.fetcher });
  assert.equal(b.standalone.state, 'needsScopes');
  assert.deepEqual(refused.calls.filter(c => /design\/mcp/.test(c.url)).map(c => c.tool), ['list_design_systems'], 'no retry, no other call');
});

test('no login, an expired login and a refused one each give one line and ask nobody', async () => {
  const never: Fetcher = async () => assert.fail('no request without a usable login');
  assert.equal((await fetchDesignSystems(root(), { fetcher: never })).state, 'noLogin');
  assert.equal((await fetchDesignSystems(root({}), { fetcher: never })).state, 'noLogin');
  assert.equal((await fetchDesignSystems(root({ accessToken: 't', expiresAt: 5 }), { fetcher: never, now: 10 })).state, 'expired');
  const refused = (status: number): Fetcher => async () => ({ status, text: async () => 'no' });
  assert.equal((await fetchDesignSystems(root({ accessToken: 't' }), { fetcher: refused(401) })).state, 'expired');
  assert.equal((await fetchDesignSystems(root({ accessToken: 't' }), { fetcher: refused(403) })).state, 'denied');
  assert.equal((await fetchDesignSystems(root({ accessToken: 't' }), { fetcher: refused(500) })).state, 'error');
  const down: Fetcher = async () => {
    throw new Error('offline');
  };
  assert.equal((await fetchDesignSystems(root({ accessToken: 't' }), { fetcher: down })).state, 'error');
});

test('the token is not in anything the list returns', async () => {
  const s = server(designAnswer);
  const list = await fetchDesignSystems(root({ accessToken: 'secret-token-123' }, { accessToken: 'secret-design-456', expiresAt: Date.now() + 1e6 }), { fetcher: s.fetcher });
  assert.ok(!JSON.stringify(list).includes('secret-token-123') && !JSON.stringify(list).includes('secret-design-456'));
});

test('parsers: an instance without a slug is dropped, a link off claude.ai is rebuilt, a project reads id or project_id', () => {
  assert.equal(parseInstance({ title: 'x' }), undefined);
  assert.equal(parseInstance({ slug: 'a-b', url: 'https://evil.test/x', title: 'x' })?.url, artifactUrl('a-b'));
  assert.equal(artifactUrl('bad slug/../'), 'https://claude.ai/new#settings/design-systems');
  assert.equal(parseProject({ project_id: 'p9', title: 'T', shared: true })?.usableBy, 'People you shared it with');
  assert.equal(parseProject({ name: 'no id' }), undefined);
});
