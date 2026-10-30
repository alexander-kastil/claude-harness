import * as vscode from 'vscode';
import type { ListLimits } from './shared/messages';

/** A whole number setting, kept inside its range; anything else falls back to the default. */
export function intSetting(key: string, fallback: number, min: number, max: number): number {
  const v = vscode.workspace.getConfiguration('claudeHarness').get<number>(key);
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

/** Whether the Cowork region shows in the panel's nav (`claudeHarness.cowork.show`, on by default). */
export const coworkShown = (): boolean => vscode.workspace.getConfiguration('claudeHarness').get<boolean>('cowork.show', true) !== false;

/** How many rows each list shows before its "show all" control. */
export function listLimits(): ListLimits {
  return {
    sessions: intSetting('lists.sessions', 10, 1, 500),
    recentRepos: intSetting('lists.recentRepos', 10, 1, 500),
    huntCatalog: intSetting('lists.huntCatalog', 60, 1, 1000),
    decisions: intSetting('lists.decisions', 6, 1, 100),
  };
}
