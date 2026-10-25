// The second line of a sidebar row and of a search hit. The facts per kind are src/shared/byline.ts, shared with the native tree;
// this adds what only the webview knows (the usage totals, a duplicate server, a plugin's items) and draws each fact with its hover card.
import type { Asset } from '../harness';
import { COUNTED_KINDS, factsOf as sharedFacts, type BylineContext, type Fact } from '../shared/byline';
import { state, twinText } from './core';
import { el } from './dom';
import { askTotals, totalOf, totalsKnown } from './usage-more';

export type { Fact };

const asked = new Set<string>();

/** Asks for the uses of a kind once; the sidebar repaints when the totals arrive. */
export function askCounted(kind: string): void {
  if (!COUNTED_KINDS.includes(kind) || asked.has(kind) || totalsKnown(kind) !== undefined) return;
  asked.add(kind);
  askTotals(kind);
}

// A plugin's items, counted once per list of views: every item whose scope is the plugin's own.
let counted: { views: unknown; by: Map<string, number> } | undefined;
const itemsOf = (a: Asset): number => {
  if (!counted || counted.views !== state.views) {
    const by = new Map<string, number>();
    for (const v of state.views) for (const c of v.categories) for (const i of c.items) if (i.scope.startsWith('plugin:')) by.set(i.scope, (by.get(i.scope) || 0) + 1);
    counted = { views: state.views, by };
  }
  return counted.by.get(`plugin:${a.name}`) || 0;
};

const context: BylineContext = {
  uses: a => (totalsKnown(a.kind) ? totalOf(a) : undefined),
  twin: twinText,
  pluginItems: itemsOf,
};

export const factsOf = (a: Asset): Fact[] => sharedFacts(a, context);

/** The facts as a line: each one carries its own hover card, separated by a middle dot. */
export function bylineNodes(a: Asset, lead?: string): (string | HTMLElement)[] {
  const out: (string | HTMLElement)[] = lead ? [lead] : [];
  for (const f of factsOf(a)) {
    if (out.length) out.push(' · ');
    out.push(el('span', { className: `fact${f.tone ? ` ${f.tone}` : ''}`, title: f.tip }, f.text));
  }
  return out;
}
