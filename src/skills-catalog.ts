// The skills catalog: a search of the public skills on skills.sh, the registry the skills CLI (`npx skills find`, github.com/vercel-labs/skills,
// src/find.ts) searches. One GET of `<base>/api/search?q=<text>` answers `{ skills: [{ id, source, skillId, name, installs }] }`; the base is
// `SKILLS_API_URL` or https://skills.sh, as in the CLI. The registry gives no description, so one is shown only when a row carries it.
// The network is called only when a search runs.

export interface CatalogSkill {
  /** The registry id, `owner/repo/skill`. */
  id: string;
  name: string;
  /** The GitHub repository, `owner/repo`. */
  source: string;
  /** The skill's folder name in that repository. */
  skill: string;
  installs?: number;
  description?: string;
}

export interface CatalogResult {
  query: string;
  skills: CatalogSkill[];
  /** Why nothing could be listed: the registry could not be reached or refused. */
  error?: string;
}

export type CatalogFetch = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const MAX = 50;

const base = () => (process.env.SKILLS_API_URL || 'https://skills.sh').replace(/\/+$/, '');

/** Rows of a registry answer that name a skill and its repository; anything else is dropped. */
export function parseCatalog(body: unknown): CatalogSkill[] {
  const rows = (body as { skills?: unknown } | undefined)?.skills;
  if (!Array.isArray(rows)) return [];
  const out: CatalogSkill[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const source = typeof r?.source === 'string' ? r.source : '';
    const id = typeof r?.id === 'string' ? r.id : '';
    const name = typeof r?.name === 'string' ? r.name : '';
    if (!source || !name) continue;
    const skill = typeof r.skillId === 'string' && r.skillId ? r.skillId : id.startsWith(`${source}/`) ? id.slice(source.length + 1) : name;
    out.push({ id: id || `${source}/${skill}`, name, source, skill, installs: typeof r.installs === 'number' ? r.installs : undefined, description: typeof r.description === 'string' && r.description ? r.description : undefined });
    if (out.length >= MAX) break;
  }
  return out;
}

/** Searches the registry; a failure comes back as `error`, never thrown. */
export async function searchCatalog(query: string, get: CatalogFetch = url => fetch(url, { headers: { 'User-Agent': 'claude-harness' }, signal: AbortSignal.timeout(20000) })): Promise<CatalogResult> {
  const q = query.trim();
  if (!q) return { query, skills: [] };
  try {
    const r = await get(`${base()}/api/search?${new URLSearchParams({ q }).toString()}`);
    if (!r.ok) return { query, skills: [], error: `skills.sh answered ${r.status}.` };
    return { query, skills: parseCatalog(await r.json()) };
  } catch (e) {
    return { query, skills: [], error: `Could not reach skills.sh: ${(e as Error).message}` };
  }
}

/** The address an install of a result goes through: the one Add from skills.sh takes. */
export const catalogAddress = (s: Pick<CatalogSkill, 'source' | 'skill'>): string => `${s.source}/${s.skill}`;
