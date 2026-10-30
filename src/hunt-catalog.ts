import * as fs from 'fs';
import * as path from 'path';
import { Asset, ScopeView, contentHash, isPluginCopy } from './harness';
import type { HuntCatalogItem, HuntProposal } from './shared/hunt';

// The Plugin Hunter's read of the harness: the skills and agents it can choose from, where their copies are, and the inventory Claude is shown.

type Kind = 'skill' | 'agent';

export const keyOf = (a: { kind: string; name: string }) => `${a.kind}:${a.name}`;
export const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// A scope's own skills and agents: the ones an enabled plugin loads into Global are the plugin's, not copies to take.
export const items = (view: ScopeView, kind: Kind): Asset[] => (view.categories.find(c => c.kind === kind)?.items ?? []).filter(a => view.id.startsWith('plugin:') || !isPluginCopy(a));
export const pathOf = (a: Asset) => (a.kind === 'skill' ? a.dir ?? path.dirname(a.file) : a.file);
const pluginName = (view: ScopeView) => view.id.slice('plugin:'.length).split('@')[0];

/** The harness element at a path the page sent; nothing the scan does not list is ever copied or removed. */
export function assetAt(views: ScopeView[], kind: Kind, file: string): { asset: Asset; view: ScopeView } | undefined {
  for (const view of views) {
    const asset = items(view, kind).find(a => samePath(pathOf(a), file));
    if (asset) return { asset, view };
  }
  return undefined;
}

/** Every skill and agent of Global and of the repos, with where its copies are; plugin copies only mark `inPlugin`. */
export function buildCatalog(views: ScopeView[], plugins: ScopeView[]): HuntCatalogItem[] {
  const out: HuntCatalogItem[] = [];
  for (const kind of ['skill', 'agent'] as const) {
    const names = new Map<string, { view: ScopeView; asset: Asset }[]>();
    for (const view of views)
      for (const asset of items(view, kind)) {
        const copies = names.get(asset.name);
        if (copies) copies.push({ view, asset });
        else names.set(asset.name, [{ view, asset }]);
      }
    const shipped = new Map<string, string>();
    for (const p of plugins) for (const a of items(p, kind)) if (!shipped.has(a.name)) shipped.set(a.name, pluginName(p));
    for (const [name, copies] of names) {
      const global = copies.find(c => c.view.id === 'global');
      const base = global ?? copies[0];
      const others = copies.filter(c => c.view.id !== 'global' && c !== base);
      // Only a name with several copies is compared; the hash reads every file of the folder.
      const baseHash = others.length ? contentHash(base.asset) : '';
      const repos = others.map(c => ({ repo: c.view.label, path: pathOf(c.asset), same: contentHash(c.asset) === baseHash, retire: false }));
      // With no global copy the first repo copy is the plugin's version and is listed as the repo row.
      if (!global) repos.unshift({ repo: base.view.label, path: pathOf(base.asset), same: true, retire: false });
      out.push({
        description: base.asset.description,
        asset: { kind, name, include: false, why: '', global: global ? { path: pathOf(global.asset), retire: false } : undefined, repos, inPlugin: shipped.get(name) },
      });
    }
  }
  return out.sort((a, b) => a.asset.kind.localeCompare(b.asset.kind) || a.asset.name.localeCompare(b.asset.name));
}

/** A folder under a skills root that Claude Code does not load as a skill: it has no SKILL.md. */
export interface HuntStray {
  scope: string;
  path: string;
  why: string;
}

/** The strays of Global and the repos; the `synced` folder Claude.ai manages under the global skills and dot folders (.trash, .archive) are not. */
export function straysOf(views: ScopeView[]): HuntStray[] {
  const out: HuntStray[] = [];
  for (const view of views) {
    const global = view.id === 'global';
    const root = global ? path.join(view.path, 'skills') : path.join(view.path, '.claude', 'skills');
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const dir = path.join(root, e.name);
      if ((global && e.name === 'synced') || e.name.startsWith('.') || fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
      let inside: fs.Dirent[];
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
        inside = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      const names = inside.map(x => (x.isDirectory() ? `${x.name}/` : x.name)).sort();
      const why = names.length ? `No SKILL.md; holds ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''}.` : 'Empty folder, no SKILL.md.';
      out.push({ scope: global ? 'global' : view.label, path: dir, why });
    }
  }
  return out;
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 3)}...` : text);

/**
 * The inventory in the order of the prompt: Global, then the open repos, then every other known repo. It lists exactly the
 * elements of the catalog (one line each, so the page's count and Claude's agree); a plugin only marks the elements it ships.
 */
export function inventoryText(views: ScopeView[], plugins: ScopeView[], open: string[]): string {
  const rank = (v: ScopeView) => (v.id === 'global' ? 0 : open.some(o => o.toLowerCase() === v.path.toLowerCase()) ? 1 : 2);
  const places = [...views].sort((a, b) => rank(a) - rank(b));
  const lines: string[] = [];
  for (const kind of ['skill', 'agent'] as const) {
    const shipped = new Map<string, string>();
    for (const p of plugins) for (const a of items(p, kind)) if (!shipped.has(a.name)) shipped.set(a.name, pluginName(p));
    const byName = new Map<string, { where: string[]; description: string }>();
    for (const v of places)
      for (const a of items(v, kind)) {
        const e = byName.get(a.name) ?? { where: [], description: a.description };
        const label = v.id === 'global' ? 'global' : v.label;
        if (!e.where.includes(label)) e.where.push(label);
        byName.set(a.name, e);
      }
    for (const [name, e] of byName) lines.push(`- ${kind} ${name} [${e.where.join(', ')}${shipped.has(name) ? `; shipped by plugin ${shipped.get(name)}` : ''}]: ${clip(e.description.replace(/\s+/g, ' '), 160)}`);
  }
  return lines.join('\n');
}

/** Saved cards against the disk as it is now: paths, copies and plugins are re-read, the owner's ticks stay where the path is still there. */
export function reconcile(proposals: HuntProposal[], catalog: HuntCatalogItem[], created: Record<string, string> = {}): HuntProposal[] {
  const have = new Map(catalog.map(c => [keyOf(c.asset), c.asset]));
  // A created card is a record of what went into the plugin: its retired copies are off the disk now, so it is never re-read.
  return proposals.map(p =>
    created[p.id]
      ? p
      : {
          ...p,
          assets: p.assets.map(a => {
            const now = have.get(keyOf(a));
            if (!now) return { ...a, include: false, global: undefined, repos: [], inPlugin: undefined };
            return {
              ...a,
              inPlugin: now.inPlugin,
              global: now.global ? { path: now.global.path, retire: a.global?.path === now.global.path && a.global.retire } : undefined,
              repos: now.repos.map(r => ({ ...r, retire: !!a.repos.find(o => o.path === r.path)?.retire })),
            };
          }),
        }
  );
}
