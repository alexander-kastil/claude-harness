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
  repoOverviewFilter: string;
  expanded: Set<string>;
  listViews: Record<string, string | undefined>;
  foldedGroups: Set<string>;
  repoSort: string;
  /** The left nav is collapsed to the 48px rail. */
  navRail: boolean;
  mcpInfo: Record<string, McpInfo | undefined>;
  mcpBusy: Record<string, 'busy' | 'done' | undefined>;
  checks: Record<string, CheckSummary>;
  standard?: Standard;
  lists: ListLimits;
  /** From the claudeHarness.cowork.show setting; false hides the Cowork region of the nav. */
  coworkShow?: boolean;
  page?: string;
  repoOverview?: any;
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
  /** The Cowork scheduled tasks as the host read them from claude.ai; null while they are read, undefined before the first ask. */
  scheduled?: any;
  /** The scheduled task on screen. */
  scheduledPage?: { id: string; tab?: string };
  /** The runs of each scheduled task already read, by task id. */
  scheduledRuns?: Record<string, any>;
  /** The marketplace page on screen: its name, and where its Back button goes when it was opened from the Plugins page. */
  marketPage?: { name: string; back?: { label: string; go: () => void } };
  init?: any;
  sessions: Record<string, any[] | null | undefined>;
  allSessions: Set<string>;
  session?: any;
  sessionsPage?: any;
  /** The weekly summary of every account; null while it is read. */
  weekly?: any;
  /** The desktop app's Cowork chats and artifacts; null while read, undefined before the nav asks. */
  coworkChats?: any;
  /** The Cowork sessions claude.ai lists; null while read. */
  coworkSessions?: any;
  /** The Cowork chat on screen: its id, its conversation and files once read, and the state of a Continue in terminal. */
  coworkChat?: { id: string; data?: any; handover?: { state: string; text?: string } };
  /** The Handover page: the inbox the host read, the card being built, and the state of Claude's draft and of Continue in terminal. */
  handover?: any;
  /** The filter typed on a Cowork list page. */
  coworkFilter?: string;
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
  repoOverviewTimer?: ReturnType<typeof setTimeout>;
  repoHoverTimer?: ReturnType<typeof setTimeout>;
  repoHoverAt?: { x: number; y: number };
  timelineObserver?: ResizeObserver;
  overviewObserver?: ResizeObserver;
}
