// What the host last said about a repo's sessions (loaded files, failed hooks) and about a plugin's events across sessions.
// Kept here, not in the shared state object: a reply replaces the entry, and an entry older than a minute is asked for again.
import type { ModActivity, RepoTrace } from '../shared/messages';
import { vscode } from './core';

const FRESH_MS = 60000;

interface Entry<T> {
  at: number;
  data?: T;
}

const traces = new Map<string, Entry<RepoTrace>>();
const activities = new Map<string, Entry<ModActivity>>();

/** The repo's trace, or undefined while it is read; asks the host when there is none or it is stale. */
export function repoTraceOf(scope: string): RepoTrace | undefined {
  const have = traces.get(scope);
  if (!have || Date.now() - have.at > FRESH_MS) {
    traces.set(scope, { at: Date.now(), data: have?.data });
    vscode.postMessage({ type: 'repoTrace', scope });
  }
  return traces.get(scope)?.data;
}

export const setRepoTrace = (scope: string, data: RepoTrace) => traces.set(scope, { at: Date.now(), data });

/** The plugin's activity, or undefined while it is read. */
export function modActivityOf(id: string): ModActivity | undefined {
  const have = activities.get(id);
  if (!have || Date.now() - have.at > FRESH_MS) {
    activities.set(id, { at: Date.now(), data: have?.data });
    vscode.postMessage({ type: 'modActivity', id });
  }
  return activities.get(id)?.data;
}

export const setModActivity = (id: string, data: ModActivity) => activities.set(id, { at: Date.now(), data });
