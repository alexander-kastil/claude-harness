// The shape of the webview's one state object (`state` in core.ts). Fields typed `any` hold reader payloads
// the contract passes as `unknown`; they get real types as their modules switch on type checking.
import type { CheckSummary } from '../constitution';
import type { Field, ScopeView } from '../harness';
import type { McpInfo } from '../probe';
import type { Detail, Standard } from '../shared/messages';

export interface Draft {
  fields: Field[];
  body: string;
}

export interface State {
  views: ScopeView[];
  openRepos: Set<string>;
  detail?: Detail;
  repo?: string;
  draft?: Draft;
  filter: string;
  overviewFilter: string;
  expanded: Set<string>;
  listViews: Record<string, string | undefined>;
  foldedGroups: Set<string>;
  repoSort: string;
  mcpInfo: Record<string, McpInfo | undefined>;
  checks: Record<string, CheckSummary>;
  standard?: Standard;
  page?: string;
  fleet?: any;
  effective: Record<string, any>;
  ruleInfo: Record<string, any>;
  markets?: any;
  init?: any;
  sessions: Record<string, any[] | null | undefined>;
  allSessions: Set<string>;
  session?: any;
  sessionsPage?: any;
  /** The weekly summary of every account; null while it is read. */
  weekly?: any;
  kindPage?: any;
  sessionView: string;
  decisionMode: string;
  mapMode: string;
  /** Full timeline: the first line of each prompt on its step. */
  mapPrompts: boolean;
  /** Full timeline: event layers by label; a layer missing here is on. */
  mapLayers: Record<string, boolean>;
  billing: string;
  /** The plan picked on the Billing switch in this panel; until then a session starts on its account's plan. */
  billingPick?: string;
  styleModel: string;
  repoTab: string;
  /** Detail pages open in view mode; edit shows the form. A dirty draft renders in view mode as its preview. */
  detailMode: 'view' | 'edit';
  /** The tab each kind of element last showed in view mode, by kind. */
  detailTabs: Record<string, string>;
  /** Elements opened by following a reference, newest last, for the detail page's back button. */
  history: string[];
  fleetTimer?: ReturnType<typeof setTimeout>;
  repoHoverTimer?: ReturnType<typeof setTimeout>;
  repoHoverAt?: { x: number; y: number };
  timelineObserver?: ResizeObserver;
}
