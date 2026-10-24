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
export const onMessage = (handle: (m: ToWebview) => void) => window.addEventListener('message', e => handle(e.data as ToWebview));
