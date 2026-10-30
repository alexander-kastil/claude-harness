// The side bar view the user had open before the Claude Harness icon in the activity bar was clicked, put back once the main
// panel is open. VS Code has no API for the active view container, so it is read from the window's workspace state
// (state.vscdb), which VS Code writes a moment after every change.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const ACTIVE = 'workbench.sidebar.activeviewletid';
const HIDDEN = 'workbench.sideBar.hidden';
const EXPLORER = 'workbench.view.explorer';

export interface SideBarChoice {
  view: string;
  hidden: boolean;
}

/** The side bar's view container and whether the side bar is hidden; a missing key is VS Code's default, the Explorer shown. */
export function readSideBar(db: string): SideBarChoice | undefined {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const conn = new DatabaseSync(db, { readOnly: true, timeout: 200 });
    try {
      const rows: { key: string; value: string }[] = conn.prepare('SELECT key, value FROM ItemTable WHERE key IN (?, ?)').all(ACTIVE, HIDDEN);
      const get = (key: string) => rows.find(r => r.key === key)?.value;
      return { view: get(ACTIVE) || EXPLORER, hidden: get(HIDDEN) === 'true' };
    } finally {
      conn.close();
    }
  } catch {
    return undefined;
  }
}

/** Keeps the user's last side bar choice other than `own`, and `restore` opens it again (or hides the side bar, as it was). */
export function trackSideBar(context: vscode.ExtensionContext, own: string): { restore(): void } {
  const db = context.storageUri ? path.join(path.dirname(context.storageUri.fsPath), 'state.vscdb') : undefined;
  let last: SideBarChoice | undefined;
  const update = () => {
    const now = db ? readSideBar(db) : undefined;
    if (now && now.view !== own) last = now;
  };
  update();
  if (db && fs.existsSync(db)) {
    let timer: NodeJS.Timeout | undefined;
    const watcher = fs.watch(db, () => {
      clearTimeout(timer);
      timer = setTimeout(update, 150);
    });
    context.subscriptions.push({ dispose: () => (clearTimeout(timer), watcher.close()) });
  }
  return {
    restore() {
      if (last?.hidden) return void vscode.commands.executeCommand('workbench.action.closeSidebar');
      void Promise.resolve(vscode.commands.executeCommand(last?.view ?? EXPLORER)).catch(() => vscode.commands.executeCommand(EXPLORER));
    },
  };
}
