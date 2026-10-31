// The Browser Automation Hunter's data, shared by the host (src/browser-hunt.ts, src/browser-hunt-host.ts) and the page (src/webview/browser-hunt.ts).

/** How a procedure is kept once it is optimized in code. */
export type BrowserKeep = 'api' | 'cli' | 'guided' | 'tool';

export const BROWSER_KEEPS: { id: BrowserKeep; label: string }[] = [
  { id: 'api', label: 'API script' },
  { id: 'cli', label: 'Command line' },
  { id: 'guided', label: 'Guided run' },
  { id: 'tool', label: 'A tool' },
];

export interface BrowserStep {
  text: string;
  /** Sign-in, invite acceptance, an approval: stays with the person. */
  manual: boolean;
}

/** One procedure: prototyped on desktop, then optimized in code. */
export interface BrowserCard {
  id: string;
  prompt: string;
  created: number;
  name: string;
  goal: string;
  keep: BrowserKeep;
  stage: 'prototype' | 'optimized';
  steps: BrowserStep[];
}

/** A procedure of the browser-automations skill, with how it is kept. */
export interface BrowserProcedure {
  name: string;
  keep: BrowserKeep;
  /** The skill's own words for how it is kept. */
  how: string;
  /** The hover text: the goal from the procedure's leaf when there is one, then the how as a sentence. */
  desc?: string;
}

export interface BrowserTurn {
  role: 'owner' | 'claude';
  text: string;
  at: number;
  card?: string;
}

export interface BrowserHuntInfo {
  procedures: BrowserProcedure[];
  /** The skill file the procedures were read from, when the harness has it. */
  source?: string;
  /** Why nothing can be written, when the skill is only an installed plugin's copy of a marketplace that is not the owner's. */
  problem?: string;
  cards: BrowserCard[];
  chat: BrowserTurn[];
  /** What Create said, by card id, for the cards written into the skill. */
  created: Record<string, string>;
}
