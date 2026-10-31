// The message contract between the extension host (src/panel.ts) and the webview (src/webview). Both sides
// compile against these types, so a renamed field fails the build instead of leaving a blank panel.
import type { CheckSummary } from '../constitution';
import type { Asset, Category, Field, ScopeView } from '../harness';
import type { McpInfo } from '../probe';
import type { ScheduledList, ScheduledRuns } from '../cowork-scheduled';
import type { SessionSummary } from '../sessions';
import type { ScaffoldForm } from '../standard';
import type { Progress } from '../usage';
import type { SlimReport } from './slim';
import type { UsageSession } from '../usage-rows';
import type { ChatContents, CloudSessions, CoworkChats } from '../cowork-chats';
import type { DownloadFile, HandoverCard, HandoverDraft, HandoverRepo, HandoverSeed, HandoverSource } from '../cowork-handover';

export type { Progress } from '../usage';
export type { UsageSession } from '../usage-rows';
export type { UsageDay, UsageElement, UsageMore, UsageTool, UsageTotal } from '../usage-rows';
import type { UsageMore, UsageTotal } from '../usage-rows';
import type { HuntInfo, HuntProposal } from './hunt';
import type { BrowserCard, BrowserHuntInfo } from './browser-hunt';

/** The host's answer to `usageMore`. */
export type UsageMoreReply = { more: UsageMore } | { built: false };

/** The host's answer to `usage`: the sessions that used the element, or no index yet when the webview did not ask to build one. */
export type UsageReply = { sessions: UsageSession[] } | { built: false };

export interface Detail {
  asset: Asset;
  mode: 'markdown' | 'code' | 'settings' | 'json' | 'plugin' | 'mcp';
  fields: Field[];
  knownFields: string[];
  body: string;
}

/** Unsaved edits the webview hands over with a save or a navigation. */
export interface Pending {
  id: string;
  fields: Field[];
  body: string;
}

/** How many rows a list shows before its "show all" control, from the claudeHarness.lists.* settings. */
export interface ListLimits {
  sessions: number;
  recentRepos: number;
  huntCatalog: number;
  decisions: number;
}

export interface Standard {
  name: string;
  fix: boolean;
  scaffold: boolean;
  align: boolean;
  owner: boolean;
  /** The provider's standard document: its path, and its text for the repo page to render. */
  doc?: string;
  docText?: string;
}

export type Page = { page?: string; repo?: string; dir?: string; session?: string };

export type StyleDraft = { state: 'idle' } | { state: 'running'; model: string } | { state: 'done'; file: string; cost?: number; text?: string } | { state: 'error'; error: string };

/** One line of a provider plugin's per-session event log (`.claude-plugin/harness-events.json` names the log). */
export interface ModEvent {
  /** ISO 8601 UTC, when the hook decided. */
  at: string;
  hook: string;
  /** One plain sentence: what the plugin did. */
  text: string;
  /** Short chip label. */
  label?: string;
  /** `act` when absent. */
  tone?: 'act' | 'warn' | 'quiet';
  /** The subagent the event concerns: its row in the map. */
  agentId?: string;
  /** Verbatim text the plugin injected or answered with. */
  detail?: string;
}

/**
 * The events of one mod for one session, from a plugin's event log or from the hooks the transcript shows; one mod can
 * have a layer of each. The session data carries `layers` only when one of them holds events.
 */
export interface EventLayer {
  label: string;
  events: ModEvent[];
}

/**
 * A question the host asks in the panel instead of a system dialog. The webview shows it as a card under the button
 * marked `data-confirm="<kind>"` and answers by posting the held-back message again with an {@link Answer}.
 */
export type Confirm =
  | { kind: 'analyze'; scope: string; id: string; cwd: string; live: boolean }
  | { kind: 'draftStyle'; scope: string; id: string; model: string; corrections: number; folder: string }
  | { kind: 'continue'; scope: string; id: string; cwd: string; live: boolean }
  | { kind: 'review'; id: string; name: string; file: string; cwd: string }
  | { kind: 'consolidate'; id: string; name: string; repo: string; cwd: string; targets: ConsolidateTarget[]; target: string; notes: string[]; careful?: string; /** `click`: point at the element the owner last pressed, for a right-click menu. */ key?: string }
  | { kind: 'try'; id: string; name: string; as: 'agent' | 'skill' | 'command'; cwd: string }
  | { kind: 'slim'; id: string; name: string; file: string; cwd: string; files: number; findings: number }
  | { kind: 'resolve'; id: string; key: string; finding: 'description' | 'house' | 'body'; name: string; file: string; cwd: string }
  | { kind: 'draw'; id: string; name: string; file: string; chars: number; /** What Claude gets, in words ("the agent file"); SKILL.md when missing. */ source?: string; /** Drawn twice, in the Harness and the Process perspective. */ both?: boolean }
  | { kind: 'hunt'; prompt: string; items: number; card?: string }
  | { kind: 'browserHunt'; prompt: string; procedures: number; card?: string }
  | { kind: 'browserHuntCreate'; id: string; key: string; name: string; location: string; files: string[]; backups: string[]; /** The plugin whose source is written, as `name@marketplace`; its version moves. */ plugin?: string; /** Whether that plugin is installed and is updated afterwards. */ installed?: boolean }
  | { kind: 'huntCreate'; id: string; key: string; name: string; market: string; location: string; problems: string[]; files: string[]; replaced: string[]; kept: string[] }
  | { kind: 'handover'; id: string; key: string; title: string; cwd: string; folder: string; files: { name: string; missing: boolean }[]; prompt: string }
  | { kind: 'handoverDraft'; key: string; files: number; chars: number }
  | ShareChoice
  | PanelAsk;

/** One of the two things Share offers for an item that comes from a plugin. */
export interface ShareOption {
  id: 'item' | 'plugin';
  title: string;
  /** What the package is: `skill folder, .zip`. */
  sub: string;
  /** What is in it, one line each. */
  lines: string[];
  /** The package size, in words. */
  size: string;
  /** A codicon name. */
  glyph: string;
}

/**
 * Share's question for an item that comes from a plugin: only the item, or the whole plugin. The answer comes back as an
 * `answer` message with the same token and the picked option id in `picked`. `key: 'click'` points at the element last pressed.
 */
export interface ShareChoice {
  kind: 'shareChoice';
  token: string;
  key?: string;
  /** The item, and what kind it is in words. */
  name: string;
  what: string;
  /** The plugin it comes from. */
  plugin: string;
  options: ShareOption[];
}

/** How a repo skill stands against the copy it would be consolidated into. `contained`: the target holds every file of the repo copy, and more. */
export type ConsolidateState = 'identical' | 'near' | 'contained' | 'differs' | 'new';

/** What the card's primary and second button do: retire the repo copy, move it up, open the diff editor, or start Claude on the merge. */
export type ConsolidateRoute = 'retire' | 'move' | 'diff' | 'claude';

/** A place a repo skill can be consolidated into, and what differs between its folder and the repo copy's. */
export interface ConsolidateTarget {
  /** `global`, or the plugin key (`name@marketplace`). */
  id: string;
  label: string;
  /** The skill's folder in the target. */
  dir: string;
  state: ConsolidateState;
  /** Files in the repo copy. */
  files: number;
  /** Relative paths: both have it and it differs / only the repo copy has it / only the target has it. */
  changed: string[];
  repoOnly: string[];
  targetOnly: string[];
}

/**
 * A question whose answer comes back as an `answer` message with the same token, for a host action that waits on it (a
 * destructive command, the unsaved-changes question). `key` picks the element among several marked `data-confirm="panel"`
 * (`click` is the element the owner last pressed);
 * `alt` adds a second choice beside the primary one (Don't Save beside Save). It has no Don't ask again switch.
 */
export interface PanelAsk {
  kind: 'panel';
  token: string;
  key?: string;
  title: string;
  sub: string;
  facts: string[];
  action: string;
  alt?: string;
  /** A codicon name for the card's badge. */
  glyph?: string;
  danger?: boolean;
  /** A text field above the buttons; the typed text comes back in the answer. `error` is shown under it when an earlier answer was refused. */
  input?: { label: string; placeholder?: string; value?: string; error?: string };
  /** A list to pick from; the ids picked come back in the answer. A disabled row says in `note` why it cannot be picked. */
  choices?: { id: string; label: string; note?: string; disabled?: boolean }[];
  /** Several choices can be picked; the primary button waits for at least one. */
  multi?: boolean;
  /** Every fact is listed, in a scrolling list, instead of the first ten. */
  scroll?: boolean;
}

/** A line the skill distributor commands leave on the Skills page and on a skill's page, in place of a notification. */
export interface DistNote {
  tone: 'ok' | 'bad' | 'info' | 'busy';
  text: string;
  /** The element id to scroll to and highlight on the Skills page. */
  focus?: string;
  /** A button on the line: runs a harness command, for a skill when `id` is given. */
  action?: { label: string; command: string; id?: string };
}

/** The owner's answer on a confirm card: go ahead, and whether to skip the card from now on. */
export interface Answer {
  confirmed?: boolean;
  remember?: boolean;
}

/** What the repo's sessions say about its harness: the files the newest one loaded, and the hooks that failed in recent ones. */
export interface RepoTrace {
  /** The newest session, when the repo has one. */
  session?: { id: string; start?: number };
  /** Paths of the memory and rule files that session loaded; undefined when its transcript records none. */
  loaded?: string[];
  /** Hooks that failed in the newest sessions that had a failure, most failures first. `hook` is `Event:matcher` as Claude Code names it. */
  failures: { hook: string; count: number; exitCode?: number; command?: string }[];
  /** How many sessions the failures were counted over. */
  scanned: number;
}

/** What a plugin with an events manifest did across sessions, grouped by event label. */
export interface ModActivity {
  /** The manifest's layer name; undefined when the plugin has no events manifest. */
  label?: string;
  /** Sessions read, the newest across all repos. */
  sessions: number;
  groups: { label: string; count: number; sessions: number; tone: 'act' | 'warn' | 'quiet'; last: string; /** The latest events, capped. */ events: ModEvent[] }[];
}

/** Webview to host. */
export type ToHost =
  | { type: 'ready' }
  | { type: 'select'; id?: string; pending?: Pending; /** Set when the open element is asked for again, to show it as a page: unsaved edits ask first, and the page returns to view mode. */ view?: boolean }
  | { type: 'save'; pending: Pending }
  | { type: 'configureTools'; id: string; key: string; value: string }
  | { type: 'mcpSignIn'; id: string }
  | { type: 'mcpRetry'; id: string }
  | { type: 'command'; command: string; id?: string; kind?: string; scope?: string; rel?: string; /** For `openCowork`: the claude.ai page, `skills`, `plugins` or `connectors`; none opens Capabilities. */ target?: string; market?: string; /** `name@market` of the plugin a sync acts on. */ plugin?: string; /** For `pullToCode` of a project: `rules` (default) or a section of `claude-md`. */ into?: string }
  | { type: 'repos' }
  | { type: 'effective'; scope: string }
  | { type: 'ruleInfo'; id: string }
  | { type: 'marketplaces' }
  | { type: 'initForm'; dir: string }
  | { type: 'initRun'; dir: string; form: ScaffoldForm; apply: boolean }
  | { type: 'sessions'; scope: string }
  | { type: 'weekly' }
  /** The desktop app's chats and the files they produced (artifacts) on this PC; answered by `coworkChats`. */
  | { type: 'coworkChats' }
  /** The Cowork sessions claude.ai lists, one GET with the Claude Code login; answered by `coworkSessions`. */
  | { type: 'coworkSessions' }
  /** One chat's conversation and files; answered by `coworkChat`. */
  | { type: 'coworkChat'; id: string }
  /** Opens a file of the desktop app's data folder in a VS Code editor tab; any other path is refused. */
  | { type: 'openChatFile'; file: string }
  /** The Handover inbox: the recent files of the apps, the repositories to hand over to; answered by `handoverInbox`. */
  | { type: 'handoverInbox' }
  /** Puts a source on the card: a desktop chat by id, a Downloads file by path, a Cowork session by id and title, or a pasted link; answered by `handoverSeed`. */
  | { type: 'handoverSeed'; source: HandoverSource; id?: string; title?: string; link?: string }
  /** Asks for the file of a missing entry of the card; answered by `handoverLocated`. */
  | { type: 'handoverLocate'; index: number }
  /** Claude drafts the card's task, rules and what exists; asks first, and `card` is held back until the answer. */
  | ({ type: 'handoverDraft'; card?: HandoverCard } & Answer)
  /** Continue in terminal: with `card` it asks, listing every file and the first prompt; confirmed, it copies the files and opens Claude Code. */
  | ({ type: 'handoverRun'; card?: HandoverCard } & Answer)
  | { type: 'session'; scope: string; id: string }
  | ({ type: 'draftStyle'; scope: string; id: string; model: string } & Answer)
  | { type: 'exportSession'; scope: string; id: string }
  | ({ type: 'analyzeSession'; scope: string; id: string } & Answer)
  | ({ type: 'continueSession'; scope: string; id: string } & Answer)
  | ({ type: 'reviewAsset'; id: string } & Answer)
  /** Consolidates a repo skill into global or the plugin it comes from; always asks, and `route` is the card's button. */
  | ({ type: 'consolidateAsset'; id: string; target?: string; route?: ConsolidateRoute } & Answer)
  /** Starts Claude on a skill with what its size and spread report found; asks first like reviewAsset. */
  | ({ type: 'slimAsset'; id: string } & Answer)
  /** The size and spread report of a skill. */
  | { type: 'slim'; id: string }
  /** Starts Claude on one finding of a skill's Size card; asks first like slimAsset. */
  | ({ type: 'resolveFinding'; id: string; finding: 'description' | 'house' | 'body' } & Answer)
  /** Asks for the stored drawing of an element; answered with `drawing`. */
  | { type: 'drawing'; id: string }
  /** Has Claude draw what an element is and how its parts connect (headless, `claude -p`); asks first like reviewAsset. */
  | ({ type: 'drawAsset'; id: string } & Answer)
  /** Starts Claude with the agent, skill or command selected. */
  | ({ type: 'tryAsset'; id: string } & Answer)
  /** One finding of the repo's standard card, handed to a terminal Claude. */
  | { type: 'fixFinding'; scope: string; text: string; file?: string; line?: number }
  /** The owner's answer to a `panel` card: its token, and which button. */
  | { type: 'answer'; token: string; choice: 'ok' | 'alt' | 'cancel'; /** From a card with an input. */ text?: string; /** From a card with choices. */ picked?: string[] }
  /** The files Claude changed after a prompt's checkpoint; answered by `checkpointFiles`. */
  | { type: 'checkpointFiles'; scope: string; id: string; checkpoint: string }
  /** Opens one of those files in the side-by-side diff, the checkpoint's copy on the left and the file now on the right. */
  | { type: 'checkpointDiff'; scope: string; id: string; checkpoint: string; file: string }
  /** Puts those files back as the checkpoint had them; always asks first, listing every file it overwrites or removes. */
  | { type: 'checkpointRestore'; scope: string; id: string; checkpoint: string }
  | { type: 'importSession'; scope: string }
  | { type: 'openAt'; file: string; line?: number }
  /** Where an agent or skill was used; `build` builds the transcript index when none exists yet. */
  | { type: 'usage'; id: string; build: boolean }
  /** The newest session of a repo: what it loaded and which hooks failed. */
  | { type: 'repoTrace'; scope: string }
  /** The events a plugin with an events manifest produced across sessions. */
  | { type: 'modActivity'; id: string }
  /** The 7-day strip and the per-element or per-tool counts of an element; `build` as for `usage`. */
  | { type: 'usageMore'; id: string; build: boolean }
  /** The uses of every agent, skill or command, for a type page's Used column; never builds the index. */
  | { type: 'usageTotals'; kind: string; /** Builds the index when there is none: only the type page's Count usage button sets it. */ build?: boolean }
  /** The Plugin Hunter page: marketplaces, the catalog of skills and agents, and the saved cards. */
  | { type: 'huntInfo' }
  /** One turn of the conversation; asks first like draftStyle. The reply and the card arrive in `hunt`. */
  | ({ type: 'huntRun'; prompt: string; /** A change comment typed on this card: the turn is about its ticked elements. */ card?: string } & Answer)
  /** The cards as the page has them, and the marketplace picked last. */
  /** Starts the conversation over; the cards stay. */
  | { type: 'huntClear' }
  | { type: 'huntSave'; proposals: HuntProposal[]; market?: string }
  /** Creates the saved card's plugin in a marketplace; always asks, listing every file written and every copy retired. */
  | ({ type: 'huntCreate'; id: string; market: string } & Answer)
  /** Consolidate's merge for a repo copy that differs from the global one. */
  | { type: 'huntMerge'; path: string; kind: 'skill' | 'agent' }
  /** The Browser Automation Hunter page: the procedures of the skill and the saved cards; the reply is `browserHunt`. */
  | { type: 'browserHuntInfo' }
  /** One turn of the conversation; asks first. The reply and the card arrive in `browserHunt`. */
  | ({ type: 'browserHuntRun'; prompt: string; card?: string } & Answer)
  | { type: 'browserHuntClear' }
  /** Writes the saved card's procedure into the skill; always asks, listing every file written. */
  | ({ type: 'browserHuntCreate'; id: string } & Answer)
  | { type: 'browserHuntSave'; cards: BrowserCard[] }
  /** Reads the Cowork scheduled tasks from claude.ai (one GET); the reply is `scheduled`. */
  | { type: 'scheduled' }
  /** Reads every run of one scheduled task from claude.ai; the reply is `scheduledRuns`. */
  | { type: 'scheduledRuns'; id: string };

// Share and Import start from commands (`share`, `importSkill`, ...) posted as `command`; the right-click menu and the
// palette run the same commands, and their questions come back as `confirm` cards answered with `answer`.

/** Host to webview. Payloads the host passes through from a reader stay `unknown` here. */
export type ToWebview =
  | { type: 'state'; views: ScopeView[]; checks: Record<string, CheckSummary>; standard?: Standard; /** From the settings; absent from hosts older than the list settings. */ lists?: ListLimits; /** From claudeHarness.cowork.show; false hides the Cowork region of the nav. Absent from older hosts, which show it. */ coworkShow?: boolean; /** The Cowork scope, read-only; absent from hosts older than the Cowork scope. */ cowork?: ScopeView; /** From hosts older than the repo list. */ categories?: Category[] }
  /** The standard checks alone, when a check starts or finishes: the views stay as the last `state` sent them. */
  | { type: 'checks'; checks: Record<string, CheckSummary> }
  | { type: 'detail'; detail?: Detail; external?: boolean; /** Sent after a save was written: the page returns to view mode. */ saved?: boolean }
  | ({ type: 'page' } & Page)
  | { type: 'mcpInfo'; id: string; info?: McpInfo }
  | { type: 'tools'; id: string; key: string; value: string }
  | { type: 'repos'; rows: unknown }
  | { type: 'effective'; scope: string; data: unknown }
  | { type: 'ruleInfo'; id: string; info: unknown }
  | { type: 'marketplaces'; list: unknown }
  | { type: 'initForm'; dir: string; data: unknown }
  | { type: 'initResult'; dir: string; apply: boolean; data: unknown }
  | { type: 'sessions'; scope: string; list: SessionSummary[] }
  | { type: 'weekly'; list: unknown }
  | ({ type: 'coworkChats' } & CoworkChats)
  | { type: 'coworkSessions'; data: CloudSessions }
  /** For `coworkChat`: none when the chat is gone. */
  | { type: 'coworkChat'; id: string; data?: ChatContents }
  /** For `handoverRun`: the files are being copied, the terminal is open, or it failed. */
  | { type: 'handover'; id: string; state: 'running' | 'done' | 'error'; text?: string }
  | { type: 'handoverInbox'; downloads: DownloadFile[]; repos: HandoverRepo[]; /** The repository the current editor is in. */ cwd: string }
  /** For `handoverSeed`: what the source puts on the card, or why it cannot. */
  | { type: 'handoverSeed'; seed?: HandoverSeed; error?: string }
  /** For `handoverLocate`: the file picked, none when the picker was cancelled. */
  | { type: 'handoverLocated'; index: number; file?: string }
  /** For `handoverDraft`: Claude is drafting, the draft, or why not. */
  | { type: 'handoverDraft'; state: 'running' | 'done' | 'error'; draft?: HandoverDraft; error?: string }
  | { type: 'session'; scope: string; id: string; data: unknown }
  | ({ type: 'styleDraft'; scope: string; id: string } & StyleDraft)
  /** For `checkpointFiles`; `restored` follows a restore, with the files that could not be written. */
  | { type: 'checkpointFiles'; scope: string; id: string; checkpoint: string; files: { path: string; action: 'overwrite' | 'remove' | 'recreate' }[]; restored?: { count: number; failed: string[] } }
  | { type: 'confirm'; ask: Confirm }
  /** For `usage`: progress messages carry `indexing` while the index is built or brought up to date, the last one `sessions` or `built: false`. */
  | { type: 'usageInfo'; id: string; sessions?: UsageSession[]; indexing?: Progress; built?: false }
  | { type: 'repoTrace'; scope: string; data: RepoTrace }
  | { type: 'modActivity'; id: string; data: ModActivity }
  /** For `usageMore`: progress carries `indexing`, the last message `more` or `built: false`. */
  | { type: 'usageMore'; id: string; more?: UsageMore; indexing?: Progress; built?: false }
  /** For `usageTotals`: the totals by element id, or `built: false` while there is no index. */
  | { type: 'usageTotals'; kind: string; totals?: Record<string, UsageTotal>; built?: false }
  /** For `slim`: the report, or none when the id is not a skill with a folder. */
  | { type: 'slim'; id: string; report?: SlimReport }
  /** For `drawing` and `drawAsset`: the drawing of the element's current source (a skill's SKILL.md), or none; `running` while Claude draws, `error` when the run failed. */
  | { type: 'drawing'; id: string; svg?: string; running?: boolean; error?: string }
  | { type: 'hunt'; info: HuntInfo }
  /** For `huntRun`: running while Claude works, done once the card is in `hunt`. */
  | { type: 'huntRun'; state: 'running' | 'done' | 'error'; error?: string; /** The card the turn created or changed. */ card?: string }
  | { type: 'huntCreate'; id: string; state: 'running' | 'done' | 'error'; text?: string }
  | { type: 'browserHunt'; info: BrowserHuntInfo }
  | { type: 'browserHuntCreate'; id: string; state: 'running' | 'done' | 'error'; text?: string }
  /** For `browserHuntRun`: running while Claude works, done once the card is in `browserHunt`. */
  | { type: 'browserHuntRun'; state: 'running' | 'done' | 'error'; error?: string; card?: string }
  /** For the skill distributor commands: what the last check found per skill id (merged into the page's), and whether a check is running. */
  | { type: 'distChecks'; checks: Record<string, DistCheck>; running?: boolean }
  /** What the last distributor command did, or none to clear the line. */
  | { type: 'distNote'; note?: DistNote }
  /** The Cowork scheduled tasks, or why they are not listed. */
  | { type: 'scheduled'; list: ScheduledList }
  /** The runs of one scheduled task, newest first, or why they are not listed. */
  | { type: 'scheduledRuns'; id: string; runs: ScheduledRuns };

/** What the distributor said about a skill when it was last asked. `current`: the skill's folder is unchanged; `newer`: it changed; `gone`: the repo no longer has it. */
export interface DistCheck {
  state: 'current' | 'newer' | 'gone' | 'error';
  /** The version in the distributor's SKILL.md, when it has one and it is newer. */
  version?: string;
  error?: string;
  /** When the check ran. */
  at: number;
}
