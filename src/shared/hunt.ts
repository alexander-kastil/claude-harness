// The Plugin Hunter's data, shared by the host (src/hunt.ts, src/hunt-host.ts) and the page (src/webview/hunt.ts).

export interface HuntAsset {
  kind: 'skill' | 'agent';
  name: string;
  include: boolean;
  why: string;
  global?: { path: string; retire: boolean };
  repos: { repo: string; path: string; same: boolean; retire: boolean }[];
  /** Already shipped by this installed plugin. */
  inPlugin?: string;
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
