// The channel to the extension host, typed by the shared contract in src/shared/messages.ts.
import type { ToHost, ToWebview } from '../shared/messages';

/** What `persist` keeps across reloads of the panel. */
export interface Saved {
  filter?: string;
  expanded?: string[];
  openRepos?: string[];
  listViews?: Record<string, string | undefined>;
  /** Before 0.2.27 the MCP and skill views had keys of their own. */
  mcpView?: string;
  skillView?: string;
  foldedGroups?: string[];
  repoSort?: string;
  /** The left nav is collapsed to the rail; expanded unless stored true. */
  navRail?: boolean;
  sessionView?: string;
  decisionView?: string;
  mapMode?: string;
  /** The Delegation map's Full timeline shows each prompt's first line on its step; off unless switched on. */
  mapPrompts?: boolean;
  /** The Delegation map's Full timeline shows what every mod did; on unless stored false. */
  mapMods?: boolean;
  billing?: string;
  styleModel?: string;
  reviewTab?: string;
  repoTab?: string;
  overviewTab?: string;
  detailMode?: 'view' | 'edit';
}

interface VsCodeApi {
  postMessage(message: ToHost): void;
  getState(): Saved | undefined;
  setState(state: Saved): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
export const saved: Saved = vscode.getState() || {};

// A message that arrives while the mouse button is down waits for the release. Its repaint replaces the row under the
// pointer, and the browser sends no click when the press and the release land on different elements: a list row or nav
// row pressed while checks or usage counts came in opened nothing. Held messages keep their order. The press ends on the
// release, a cancel, or the panel losing focus or sight; only a release never seen lets them through, after 30 s. A 2 s
// limit let a slow press, or a press while the host was slow to answer, lose its click again.
let pressed = false;
let pressTimer: ReturnType<typeof setTimeout> | undefined;
const PRESS_LIMIT_MS = 30000;
const held: ToWebview[] = [];
let deliver: ((m: ToWebview) => void) | undefined;
const drain = () => {
  while (!pressed && held.length) deliver?.(held.shift() as ToWebview);
};
const release = () => {
  if (!pressed) return;
  pressed = false;
  clearTimeout(pressTimer);
  // After the click, which the browser sends right after the release.
  setTimeout(drain);
};
window.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  pressed = true;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(release, PRESS_LIMIT_MS);
}, true);
window.addEventListener('pointerup', release, true);
window.addEventListener('pointercancel', release, true);
// A release that happened outside the panel is never seen; the next move without a button ends the press, not the 30 s limit.
window.addEventListener('pointermove', e => e.buttons === 0 && release(), true);
window.addEventListener('blur', release);
document.addEventListener('visibilitychange', () => document.hidden && release());

export const onMessage = (handle: (m: ToWebview) => void) => {
  deliver = handle;
  window.addEventListener('message', e => {
    if (pressed || held.length) held.push(e.data as ToWebview);
    else handle(e.data as ToWebview);
  });
};
