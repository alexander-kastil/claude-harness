// The host side of the sync-tools page: reads the plan, opens the side-by-side compare, and writes after the confirm card.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { backupStamp } from './harness';
import { HarnessPanel } from './panel';
import { SyncPlan, SyncToolsData, planSyncTools, syncToolsData, writeSyncTools } from './sync-tools';

export interface SyncToolsHost {
  read(scope: string): SyncToolsData;
  diff(scope: string, id: string): Promise<void>;
  write(scope: string, ids: string[]): Promise<SyncToolsData>;
}

interface Ctx {
  /** The ~/.claude folder. */
  root: () => string;
  /** The folder of a repo scope, undefined for Global or an unknown id. */
  folder: (scope: string) => string | undefined;
  backupRoot: () => string;
}

export function createSyncToolsHost(ctx: Ctx): SyncToolsHost {
  const plan = (scope: string): SyncPlan | undefined => {
    const dir = scope === 'global' ? undefined : ctx.folder(scope);
    return scope === 'global' || dir ? planSyncTools(scope, dir, os.homedir(), ctx.root()) : undefined;
  };
  const read = (scope: string, wrote?: string[]): SyncToolsData => {
    const p = plan(scope);
    return p ? syncToolsData(p, wrote) : { scope, global: false, source: { file: '', label: 'CLAUDE.md', exists: false, chars: 0, imports: 0 }, targets: [], error: 'This repository has no folder here.' };
  };
  return {
    read: scope => read(scope),
    diff: async (scope, id) => {
      const t = plan(scope)?.targets.find(x => x.id === id);
      if (!t) return;
      // What the sync would write goes to a temp file, so the target and the result sit side by side.
      const dir = path.join(os.tmpdir(), 'claude-harness-sync-tools');
      fs.mkdirSync(dir, { recursive: true });
      const after = path.join(dir, `${id.replace(/[^A-Za-z0-9.]+/g, '_')}-after`);
      fs.writeFileSync(after, t.expected);
      const before = t.exists ? t.file : path.join(dir, 'empty');
      if (!t.exists) fs.writeFileSync(before, '');
      await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(before), vscode.Uri.file(after), `${t.label}: now, after sync`, { preview: false });
    },
    write: async (scope, ids) => {
      const p = plan(scope);
      const todo = p ? p.targets.filter(t => ids.includes(t.id) && t.state !== 'same') : [];
      if (!p || !todo.length) return read(scope);
      const stamp = backupStamp();
      const backup = path.join(ctx.backupRoot(), stamp, 'sync-tools');
      const facts = [
        `Writes ${p.source.label} into ${todo.length} ${todo.length === 1 ? 'file' : 'files'}:`,
        ...todo.map(t => `${t.exists ? 'Overwrites' : 'Creates'} ${t.file}`),
        'CLAUDE.md itself is not changed.',
        ...(todo.some(t => t.exists) ? [`Backup of the files overwritten: ${backup}`] : []),
      ];
      const card = { key: 'click', glyph: 'sync', title: `Sync ${p.global ? 'the global' : 'this repo\'s'} instructions to ${todo.length} ${todo.length === 1 ? 'file' : 'files'}?`, sub: 'Backed up first, then written', facts, action: 'Sync', scroll: true };
      const inPanel = HarnessPanel.ask(card);
      const ok = inPanel ? (await inPanel) === 'ok' : (await vscode.window.showWarningMessage(card.title, { modal: true, detail: facts.join('\n') }, 'Sync')) === 'Sync';
      if (!ok) return read(scope);
      let wrote: string[] = [];
      try {
        wrote = writeSyncTools(p, todo.map(t => t.id), backup);
      } catch (e) {
        void vscode.window.showErrorMessage(`Sync failed: ${(e as Error).message}`);
      }
      return read(scope, wrote);
    },
  };
}
