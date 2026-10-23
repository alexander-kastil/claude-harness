// The message contract between the extension host (src/panel.ts) and the webview (src/webview). Both sides
// compile against these types, so a renamed field fails the build instead of leaving a blank panel.
import type { CheckSummary } from '../constitution';
import type { Asset, Category, Field, ScopeView } from '../harness';
import type { McpInfo } from '../probe';
import type { SessionSummary } from '../sessions';
import type { ScaffoldForm } from '../standard';

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

export type StyleDraft = { state: 'idle' } | { state: 'running'; model: string } | { state: 'done'; file: string; cost?: number } | { state: 'error'; error: string };

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

/** Webview to host. */
export type ToHost =
  | { type: 'ready' }
  | { type: 'select'; id?: string; pending?: Pending }
  | { type: 'save'; pending: Pending }
  | { type: 'configureTools'; id: string; key: string; value: string }
  | { type: 'mcpSignIn'; id: string }
  | { type: 'mcpRetry'; id: string }
  | { type: 'command'; command: string; id?: string; kind?: string; scope?: string; rel?: string; market?: string }
  | { type: 'fleet' }
  | { type: 'effective'; scope: string }
  | { type: 'ruleInfo'; id: string }
  | { type: 'marketplaces' }
  | { type: 'initForm'; dir: string }
  | { type: 'initRun'; dir: string; form: ScaffoldForm; apply: boolean }
  | { type: 'sessions'; scope: string }
  | { type: 'weekly' }
  | { type: 'session'; scope: string; id: string }
  | { type: 'draftStyle'; scope: string; id: string; model: string }
  | { type: 'exportSession'; scope: string; id: string }
  | { type: 'importSession'; scope: string }
  | { type: 'openAt'; file: string; line?: number };

/** Host to webview. Payloads the host passes through from a reader stay `unknown` here. */
export type ToWebview =
  | { type: 'state'; views: ScopeView[]; checks: Record<string, CheckSummary>; standard?: Standard; /** From hosts older than the repo list. */ categories?: Category[] }
  | { type: 'detail'; detail?: Detail; external?: boolean }
  | ({ type: 'page' } & Page)
  | { type: 'mcpInfo'; id: string; info?: McpInfo }
  | { type: 'tools'; id: string; key: string; value: string }
  | { type: 'fleet'; rows: unknown }
  | { type: 'effective'; scope: string; data: unknown }
  | { type: 'ruleInfo'; id: string; info: unknown }
  | { type: 'marketplaces'; list: unknown }
  | { type: 'initForm'; dir: string; data: unknown }
  | { type: 'initResult'; dir: string; apply: boolean; data: unknown }
  | { type: 'sessions'; scope: string; list: SessionSummary[] }
  | { type: 'weekly'; list: unknown }
  | { type: 'session'; scope: string; id: string; data: unknown }
  | ({ type: 'styleDraft'; scope: string; id: string } & StyleDraft);
