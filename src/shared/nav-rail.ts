// The collapsed left nav: a 48px rail with one button per region and top-level group. The state and the entries are plain data,
// so the unit tests cover them without a DOM.

/** What `persist` keeps: true when the nav is collapsed to the rail. The default is expanded. */
export const railFromSaved = (saved: { navRail?: boolean } | undefined): boolean => !!saved && saved.navRail === true;

export type RailRegion = 'code' | 'cowork' | 'repos';

export interface RailEntry {
  /** The nav's own key for the group: `<view id>|<kind>`, `markets`, `repo:<id>`, or `region:<key>` for a region. */
  id: string;
  region: RailRegion;
  level: 0 | 1;
  label: string;
  glyph: string;
  count: number;
  active: boolean;
}

export interface RailInput {
  code?: { label: string; count: number; groups: { id: string; label: string; glyph: string; count: number }[] };
  cowork?: { label: string; count: number; groups: { id: string; label: string; glyph: string; count: number }[] };
  repos: { label: string; count: number; repos: { id: string; label: string; count: number }[] };
  /** The group of the page that is open, as an entry id. */
  active?: string;
}

const REGION_GLYPH: Record<RailRegion, string> = { code: 'terminal', cowork: 'cloud', repos: 'github' };

/** The rail's buttons in nav order: each region, then its groups. A region without data (Cowork hidden) has none. */
export function railEntries(input: RailInput): RailEntry[] {
  const out: RailEntry[] = [];
  const region = (key: RailRegion, label: string, count: number) => out.push({ id: `region:${key}`, region: key, level: 0, label, glyph: REGION_GLYPH[key], count, active: false });
  for (const key of ['code', 'cowork'] as const) {
    const r = input[key];
    if (!r) continue;
    region(key, r.label, r.count);
    for (const g of r.groups) out.push({ id: g.id, region: key, level: 1, label: g.label, glyph: g.glyph, count: g.count, active: g.id === input.active });
  }
  region('repos', input.repos.label, input.repos.count);
  for (const r of input.repos.repos) out.push({ id: `repo:${r.id}`, region: 'repos', level: 1, label: r.label, glyph: 'repo', count: r.count, active: `repo:${r.id}` === input.active });
  return out;
}

/** The rail's count text: three digits do not fit a 48px rail. */
export const railCount = (n: number): string => (n > 99 ? '99+' : String(n));

export interface RailFolds {
  expanded: Set<string>;
  openRepos: Set<string>;
  foldedGroups: Set<string>;
}

/** What pressing an entry opens in the full nav: its region, and the group or repo itself. Nothing is ever closed, so the groups
 * keep their own state. Returns the nav key to scroll to. */
export function revealEntry(entry: RailEntry, folds: RailFolds): string {
  folds.foldedGroups.delete(`region|${entry.region}`);
  if (entry.id.startsWith('region:')) return `r|${entry.region}`;
  if (entry.id.startsWith('repo:')) {
    folds.openRepos.add(entry.id.slice(5));
    return `p|${entry.id.slice(5)}`;
  }
  folds.expanded.add(entry.id);
  return `s|${entry.id}`;
}

/** The entry id of the open page's group, from the pieces of the nav's selection. */
export function activeEntry(sel: { kind?: string; scope?: string; market?: boolean; repo?: string }): string | undefined {
  if (sel.market) return 'markets';
  const scope = sel.scope;
  if (sel.kind && scope) return scope === 'global' || scope === 'cowork' ? `${scope}|${sel.kind}` : `repo:${scope}`;
  if (scope && scope !== 'global' && scope !== 'cowork') return `repo:${scope}`;
  if (sel.repo) return `repo:${sel.repo}`;
  return undefined;
}
