// The Plugin Hunter's data, shared by the host (src/hunt.ts, src/hunt-host.ts) and the page (src/webview/hunt.ts).

export interface HuntAsset {
  kind: 'skill' | 'agent';
  name: string;
  include: boolean;
  why: string;
  /** `replace`: once the plugin is installed this copy is backed up and removed, and the plugin's version takes its place. Off leaves it untouched. Cards saved before the rename hold the same switch as `retire`; `replaceOf` reads both. */
  global?: { path: string; replace: boolean; retire?: boolean };
  repos: { repo: string; path: string; same: boolean; replace: boolean; retire?: boolean }[];
  /** Already shipped by this installed plugin. */
  inPlugin?: string;
  /** The name the element gets inside the plugin, when a comment to Claude renamed it. */
  as?: string;
  /** Another plugin of the same marketplace the element moves out of, and the element's path there. */
  plugin?: { name: string; path: string };
}

export interface HuntProposal {
  id: string;
  prompt: string;
  created: number;
  name: string;
  description: string;
  category: string;
  assets: HuntAsset[];
}

/** The Replace switch of a copy, from a card saved before it was called Retire too. */
export const replaceOf = (c?: { replace?: boolean; retire?: boolean }): boolean => !!(c && (c.replace ?? c.retire));

/** A skill or agent the owner can pick on a card: the asset with its paths filled in, and its description. */
export interface HuntCatalogItem {
  asset: HuntAsset;
  description: string;
}

/** A configured marketplace. Only one the owner owns on disk (a directory source) can receive a plugin. */
export interface HuntMarket {
  name: string;
  location: string;
  kind: string;
  owned: boolean;
  /** Whether the marketplace keeps its plugins in category folders (`./plugins/<category>/<name>`). */
  categorized: boolean;
  /** The category folders it already has. */
  categories: string[];
  /** Why it cannot be picked, when it is not owned. */
  note?: string;
}

/** A message of the Plugin Hunter's conversation. */
export interface HuntTurn {
  role: 'owner' | 'claude';
  text: string;
  at: number;
  /** The card the turn belongs to; empty when it came before any card. Turns stored before this field have none. */
  card?: string;
}

export interface HuntInfo {
  markets: HuntMarket[];
  /** The remembered pick, when it can still be used. */
  picked?: string;
  catalog: HuntCatalogItem[];
  proposals: HuntProposal[];
  /** The conversation, oldest first. */
  chat: HuntTurn[];
  /** What Create said, by card id, for the cards that were created: they are done. */
  created: Record<string, string>;
}
