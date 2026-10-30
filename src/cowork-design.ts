import * as fs from 'fs';
import * as path from 'path';
import type { DesignReads } from './cowork-design-read';

/**
 * The Cowork design systems, read from claude.ai with the Claude Code login: the artifacts of the "Design System" type (Claude Code's
 * artifact server, `/api/artifacts/mcp`) and the standalone Claude Design projects (`/v1/design/mcp`). Only list and read calls are
 * ever sent (`READ_TOOLS`); nothing is created, published, pinned, written or deleted, and the token is never written or logged.
 */
export const DESIGN_SYSTEMS_URL = 'https://claude.ai/new#settings/design-systems';
export const DESIGN_STANDALONE_URL = 'https://claude.ai/design';
const ARTIFACTS_ENDPOINT = 'https://api.anthropic.com/api/artifacts/mcp';
const DESIGN_ENDPOINT = 'https://api.anthropic.com/v1/design/mcp';
// Same reasoning as the quota endpoint: the API answers only a claude-code/* client.
const HEADERS = { 'anthropic-version': '2023-06-01', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'User-Agent': 'claude-code/2.1.0' };
/** The artifact server wants this member in `_meta` of a call; its value holds the route's flags, and a read needs none. */
const ARTIFACT_ROUTE = 'anthropic.com/artifact-route';

/** The only tools the extension ever calls on either server: they list and read. */
export const READ_TOOLS: ReadonlySet<string> = new Set(['list_types', 'list_artifacts', 'list_design_systems', 'list_projects', 'get_project', 'list_files', 'get_file', 'read_file']);

/** The UI tests point each read at a server on this PC; the token never goes to any other address than the API. */
const loopback = (own: string | undefined, fallback: string): string => (own && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(own) ? own : fallback);
const artifactsEndpoint = (): string => loopback(process.env.CLAUDE_HARNESS_ARTIFACTS_URL, ARTIFACTS_ENDPOINT);
const designEndpoint = (): string => loopback(process.env.CLAUDE_HARNESS_DESIGN_URL, DESIGN_ENDPOINT);

/** A design system's page on claude.ai; only a plain id reaches a URL. */
export const artifactUrl = (id: string): string => (/^[\w-]+$/.test(id) ? `https://claude.ai/artifact/${id}` : DESIGN_SYSTEMS_URL);

export interface DesignSystem {
  /** The artifact slug, or the project id of a standalone project. */
  id: string;
  name: string;
  /** The emoji the artifact carries, if any. */
  glyph: string;
  /** Standalone: a Claude Design project, which closes on 2026-12-14; otherwise an artifact of the Design System type. */
  standalone: boolean;
  /** Who can use it, in words: Just you, Your organization, People you shared it with, Anyone with the link. */
  usableBy: string;
  /** The raw audience word, kept for the tooltip. */
  audience: string;
  /** Yours, or shared with you. */
  mine: boolean;
  /** Artifacts only: the one the account marks as its default. */
  isDefault: boolean;
  createdAt?: number;
  publishedAt?: number;
  /** The version the artifact type is on. */
  version: string;
  url: string;
  /** Standalone only: the file paths the project holds, when the server listed them. */
  files: string[];
}

export type DesignState = 'ok' | 'noLogin' | 'expired' | 'denied' | 'error';
export interface DesignList {
  state: DesignState;
  /** One short line why the list is empty, for every state but ok. */
  note: string;
  systems: DesignSystem[];
  /** What the Design System type says a design system holds, as the artifact server describes it. */
  holds: string;
  /** The standalone side: its own state, because it needs a sign-in scope the artifact side does not. */
  standalone: { state: 'ok' | 'needsScopes' | 'denied' | 'error'; note: string };
  fetchedAt: number;
  /** What Claude read of each design system, kept in the extension's storage per artifact; the host adds it, the fetch never does. */
  reads?: DesignReads;
}

type Raw = Record<string, any>;

const NOTES: Record<Exclude<DesignState, 'ok'>, string> = {
  noLogin: 'Sign in to Claude Code with your claude.ai account to list the design systems here.',
  expired: 'The Claude Code sign-in has expired; start Claude Code once to renew it.',
  denied: 'claude.ai did not accept the sign-in, so the design systems are not listed here.',
  error: 'claude.ai could not be reached, so the design systems are not listed here.',
};

const AUDIENCE: Record<string, string> = { owner: 'Just you', private: 'Just you', only_me: 'Just you', org: 'Your organization', organization: 'Your organization', users: 'People you shared it with', public: 'Anyone with the link', link: 'Anyone with the link' };
const time = (v: unknown): number | undefined => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : undefined;
};
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** One instance of the Design System type as the list shows it. */
export function parseInstance(i: Raw, defaultId?: string): DesignSystem | undefined {
  const id = text(i.slug);
  if (!id) return undefined;
  const audience = text(i.audience);
  return {
    id,
    name: text(i.title) || '(unnamed)',
    glyph: text(i.favicon),
    standalone: false,
    usableBy: AUDIENCE[audience] ?? (audience || 'Unknown'),
    audience,
    mine: i.rel === undefined || i.rel === 'mine',
    isDefault: !!defaultId && defaultId === id,
    createdAt: time(i.created_at),
    publishedAt: time(i.published_at),
    version: text(i.current_type_version),
    url: text(i.url) && /^https:\/\/claude\.ai\//.test(text(i.url)) ? text(i.url) : artifactUrl(id),
    files: [],
  };
}

/**
 * A standalone design system: a row of `list_design_systems` (id, name, is_default) with what `get_project` adds (sharing, url) and the
 * paths `list_files` returned. Field names are read leniently (id or project_id, name or title).
 */
export function parseProject(p: Raw, files: string[] = [], info: Raw = {}): DesignSystem | undefined {
  const id = text(p.id) || text(p.project_id) || text(p.uuid);
  if (!id) return undefined;
  const sharing = (info.sharing ?? p.sharing ?? {}) as Raw;
  const audience = text(sharing.scope) || text(p.audience) || text(p.visibility) || (p.shared === true ? 'users' : 'owner');
  const url = text(info.url) || text(p.url);
  return {
    id,
    name: text(p.name) || text(p.title) || text(info.name) || '(unnamed)',
    glyph: '',
    standalone: true,
    usableBy: AUDIENCE[audience] ?? (audience || 'Unknown'),
    audience,
    mine: true,
    isDefault: p.is_default === true,
    createdAt: time(p.created_at ?? p.createdAt),
    publishedAt: time(p.updated_at ?? p.updatedAt),
    version: '',
    url: /^https:\/\/claude\.ai\//.test(url) ? url : DESIGN_STANDALONE_URL,
    files,
  };
}

export type Fetcher = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

/** One JSON-RPC `tools/call`, refused here unless the tool is a read. The body may be a JSON answer or a server-sent `data:` line. */
async function call(get: Fetcher, url: string, token: string, name: string, args: Raw, meta?: Raw): Promise<{ status: number; body: Raw | undefined }> {
  if (!READ_TOOLS.has(name)) throw new Error(`${name} is not a read tool`);
  const params: Raw = { name, arguments: args, ...(meta && { _meta: meta }) };
  const res = await get(url, { method: 'POST', headers: { ...HEADERS, Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }), signal: AbortSignal.timeout(20_000) });
  const raw = await res.text();
  const data = raw.split('\n').find(l => l.startsWith('data:'));
  try {
    return { status: res.status, body: JSON.parse(data ? data.slice(5) : raw) as Raw };
  } catch {
    return { status: res.status, body: undefined };
  }
}

/** The result of a call as one object: `structuredContent`, else the JSON a text block holds. */
const payload = (body: Raw | undefined): Raw | undefined => {
  const r = body?.result;
  if (r?.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent;
  for (const c of Array.isArray(r?.content) ? r.content : []) {
    try {
      const v = JSON.parse(c.text);
      if (v && typeof v === 'object') return v;
    } catch {}
  }
  return undefined;
};

const paths = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map(f => (typeof f === 'string' ? f : f && typeof f === 'object' ? text(f.path) || text(f.name) : ''))
    .filter(Boolean);

const NEEDS_LOGIN = 'Claude Design access is not set up for this sign-in, so the standalone design systems are not listed. In Claude Code, run /design-login to allow it.';

/**
 * Standalone design systems, with the separate Claude Design login (`designOauth`, which /design-login writes; never refreshed or
 * written here): list_design_systems, then get_project and list_files of each. A missing, expired or refused login is reported.
 */
async function standalone(get: Fetcher, design: { accessToken?: string; expiresAt?: number } | undefined, now: number): Promise<{ systems: DesignSystem[]; state: DesignList['standalone'] }> {
  if (!design?.accessToken || (design.expiresAt && design.expiresAt <= now)) return { systems: [], state: { state: 'needsScopes', note: NEEDS_LOGIN } };
  const token = design.accessToken;
  try {
    const list = await call(get, designEndpoint(), token, 'list_design_systems', {});
    if (list.status === 401 || list.status === 403) {
      return { systems: [], state: list.body?.error === 'needs_design_scopes' || list.status === 401 ? { state: 'needsScopes', note: NEEDS_LOGIN } : { state: 'denied', note: 'claude.ai did not accept the sign-in for Claude Design.' } };
    }
    if (list.status !== 200) return { systems: [], state: { state: 'error', note: 'Claude Design could not be reached.' } };
    const body = payload(list.body);
    const rows = Array.isArray(body) ? body : Array.isArray(body?.design_systems) ? body.design_systems : [];
    const out: DesignSystem[] = [];
    for (const p of rows) {
      const id = text(p?.id) || text(p?.project_id) || text(p?.uuid);
      if (!id) continue;
      let info: Raw = {};
      let files: string[] = [];
      try {
        const g = await call(get, designEndpoint(), token, 'get_project', { project_id: id });
        if (g.status === 200) info = (payload(g.body) as Raw) ?? {};
        const f = await call(get, designEndpoint(), token, 'list_files', { project_id: id });
        if (f.status === 200) {
          const all = payload(f.body);
          files = paths(Array.isArray(all) ? all.filter((x: Raw) => !/^(dir|directory|folder)$/.test(text(x?.type))) : all?.files);
        }
      } catch {}
      const system = parseProject(p, files, info);
      if (system) out.push(system);
    }
    return { systems: out, state: { state: 'ok', note: '' } };
  } catch {
    return { systems: [], state: { state: 'error', note: 'Claude Design could not be reached.' } };
  }
}

/** Reads the OAuth token of Claude Code (never written, never refreshed, never logged) and lists every design system. */
export async function fetchDesignSystems(root: string, opts: { fetcher?: Fetcher; now?: number } = {}): Promise<DesignList> {
  const now = opts.now ?? Date.now();
  const none = { state: 'ok' as const, note: '' };
  const fail = (state: Exclude<DesignState, 'ok'>): DesignList => ({ state, note: NOTES[state], systems: [], holds: '', standalone: none, fetchedAt: now });
  let oauth: { accessToken?: string; expiresAt?: number } = {};
  let designOauth: { accessToken?: string; expiresAt?: number } | undefined;
  try {
    const credentials = JSON.parse(fs.readFileSync(path.join(root, '.credentials.json'), 'utf8')) as Raw;
    oauth = credentials.claudeAiOauth ?? {};
    designOauth = credentials.designOauth;
  } catch {
    return fail('noLogin');
  }
  if (!oauth.accessToken) return fail('noLogin');
  if (oauth.expiresAt && oauth.expiresAt <= now) return fail('expired');
  const token = oauth.accessToken;
  const get: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  const route = { [ARTIFACT_ROUTE]: {} };
  try {
    const types = await call(get, artifactsEndpoint(), token, 'list_types', {}, route);
    if (types.status === 401) return fail('expired');
    if (types.status === 403) return fail('denied');
    if (types.status !== 200 || types.body?.error) return fail('error');
    const type = (Array.isArray(payload(types.body)?.types) ? (payload(types.body)!.types as Raw[]) : []).find(t => /design system/i.test(text(t.title)));
    let systems: DesignSystem[] = [];
    if (type && text(type.slug)) {
      const inst = await call(get, artifactsEndpoint(), token, 'list_artifacts', { type: text(type.slug) }, route);
      if (inst.status === 401) return fail('expired');
      if (inst.status === 403) return fail('denied');
      if (inst.status !== 200 || inst.body?.error) return fail('error');
      const body = payload(inst.body);
      const def = typeof body?.default === 'string' ? body.default : text(body?.default?.slug);
      systems = (Array.isArray(body?.instances) ? (body!.instances as Raw[]) : []).map(i => parseInstance(i, def)).filter((s): s is DesignSystem => !!s);
    }
    const alone = await standalone(get, designOauth, now);
    return { state: 'ok', note: '', systems: [...systems, ...alone.systems], holds: text(type?.description), standalone: alone.state, fetchedAt: now };
  } catch {
    return fail('error');
  }
}
