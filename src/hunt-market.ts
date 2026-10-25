import * as fs from 'fs';
import * as path from 'path';
import { parse as parseJsonc } from 'jsonc-parser';
import type { HuntMarket } from './shared/hunt';

// The Plugin Hunter's read of the marketplaces Claude Code knows: which ones the owner owns on disk and how their plugin folders are laid out.

export const readJson = (file: string): Record<string, any> => {
  try {
    const value = parseJsonc(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

export type Entry = { name?: string; source?: unknown; description?: string };

export const catalogFileOf = (location: string) => path.join(location, '.claude-plugin', 'marketplace.json');
export const catalogOf = (location: string) => (readJson(catalogFileOf(location)).plugins ?? []) as Entry[];
export const sourcesOf = (entries: Entry[]) => entries.map(p => p.source).filter((s): s is string => typeof s === 'string' && s.startsWith('./'));

/** The layout of a marketplace's plugin folders, read from the sources it already lists. */
export function layoutOf(entries: Entry[]): { categorized: boolean; root: string; categories: string[] } {
  const parts = sourcesOf(entries).map(s => s.slice(2).split('/').filter(Boolean));
  const deep = parts.filter(p => p.length === 3);
  if (deep.length * 2 > parts.length) return { categorized: true, root: deep[0][0], categories: [...new Set(deep.map(p => p[1]))].sort() };
  const flat = parts.find(p => p.length >= 2);
  return { categorized: false, root: flat ? flat.slice(0, -1).join('/') : parts.length ? '' : 'plugins', categories: [] };
}

/** Every marketplace Claude Code knows; the directory ones are the owner's own and can receive a plugin. */
export function readMarkets(root: string): HuntMarket[] {
  const known = readJson(path.join(root, 'plugins', 'known_marketplaces.json')) as Record<string, { source?: { source?: string; path?: string }; installLocation?: string }>;
  return Object.entries(known)
    .map(([name, m]) => {
      const kind = m.source?.source ?? 'unknown';
      const location = kind === 'directory' ? m.source?.path ?? m.installLocation ?? '' : m.installLocation ?? '';
      const owned = kind === 'directory' && !!location && fs.existsSync(catalogFileOf(location));
      const layout = owned ? layoutOf(catalogOf(location)) : { categorized: false, categories: [] as string[] };
      const note = owned ? undefined : kind === 'directory' ? 'This folder has no .claude-plugin/marketplace.json.' : 'Claude Code overwrites it on update.';
      return { name, location, kind, owned, categorized: layout.categorized, categories: layout.categories, note };
    })
    .sort((a, b) => Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name));
}

/** Where a new plugin goes in a marketplace, as the `./` source its catalog entry lists. */
export function sourceFor(entries: Entry[], name: string, category: string): string {
  const layout = layoutOf(entries);
  if (layout.categorized || (!sourcesOf(entries).length && category)) return `./${layout.root || 'plugins'}/${category}/${name}`;
  return `./${layout.root ? `${layout.root}/` : ''}${name}`;
}
