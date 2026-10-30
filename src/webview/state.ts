// The shape of the webview's one state object (`state` in core.ts). Fields typed `any` hold reader payloads
// the contract passes as `unknown`; they get real types as their modules switch on type checking.
import type { CheckSummary } from '../constitution';
import type { Field, ScopeView } from '../harness';
import type { McpInfo } from '../probe';
import type { Detail, DistCheck, DistNote, ListLimits, Progress, Standard, UsageSession } from '../shared/messages';

export interface Draft {
  fields: Field[];
  body: string;
}

/** What the host last said about where an agent or skill was used; `indexing` while the index is read, kept beside the last sessions. */
export interface UsageState {
  sessions?: UsageSession[];
  indexing?: Progress;
  built?: false;
}

export interface State {
  views: ScopeView[];
  openRepos: Set<string>;
  detail?: Detail;
  repo?: string;
  draft?: Draft;
  filter: string;
  overviewFilter: string;
  fleetFilter: string;
  expanded: Set<string>;
  listViews: Record<string, string | undefined>;
  foldedGroups: Set<string>;
  repoSort: string;
  mcpInfo: Record<string, McpInfo | undefined>;
  mcpBusy: Record<string, 'busy' | 'done' | undefined>;
  checks: Record<string, CheckSummary>;
  standard?: Standard;
  lists: ListLimits;
  page?: string;
  fleet?: any;
  effective: Record<string, any>;
  ruleInfo: Record<string, any>;
  /** The Used in tab of agents and skills, by element id. */
  usage: Record<string, UsageState | undefined>;
  /** What the distributor said about each skill (by element id) when it was last asked, and whether a check is running. */
  dist: Record<string, DistCheck | undefined>;
  distRunning: boolean;
  /** What the last distributor command did, shown on the Skills page and a skill's page until dismissed. */
  distNote?: DistNote;
  /** The skill row to scroll to and highlight once, after the next repaint. */
  distScroll?: string;
  markets?: any;
  /** The marketplace page on screen: its name, and where its Back button goes when it was opened from the Plugins page. */
  marketPage?: { name: string; back?: { label: string; go: () => void } };
  init?: any;
  sessions: Record<string, any[] | null | undefined>;
  allSessions: Set<string>;
  session?: any;
  sessionsPage?: any;
  /** The weekly summary of every account; null while it is read. */
  weekly?: any;
  /** Redraws the overview's session and repository blocks in place; set while the overview is built. */
  overviewRefresh?: () => void;
  kindPage?: any;
  sessionView: string;
  decisionMode: string;
  mapMode: string;
  /** Full timeline: the first line of each prompt on its step. */
  mapPrompts: boolean;
  /** Full timeline: the events of every mod, switched on and off together. */
  mapMods: boolean;
  billing: string;
  /** The plan picked on the Billing switch in this panel; until then a session starts on its account's plan. */
  billingPick?: string;
  styleModel: string;
  /** The session page's Review group: 'findings' or 'style'; empty until picked. */
  reviewTab: string;
  repoTab: string;
  /** The list the overview shows under its search: sessions, repos or changed. */
  overviewTab: string;
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
  overviewObserver?: ResizeObserver;
}
