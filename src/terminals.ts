import * as vscode from 'vscode';
import * as os from 'os';

/** Where a terminal opens: the editor area by default, beside an open file, or the bottom panel when the owner chose it. */
export function terminalLocation(): vscode.TerminalLocation | vscode.TerminalEditorLocationOptions {
  const cfg = vscode.workspace.getConfiguration('claudeHarness');
  if (cfg.get<string>('terminal.location') === 'panel') return vscode.TerminalLocation.Panel;
  const hasEditors = vscode.window.tabGroups.all.some(g => g.tabs.some(t => !(t.input instanceof vscode.TabInputTerminal)));
  return hasEditors && cfg.get<boolean>('terminal.openToSide', true) ? { viewColumn: vscode.ViewColumn.Beside } : vscode.TerminalLocation.Editor;
}

/** Opens a terminal at the configured location, shows it and returns it. */
export function openTerminal(options: Omit<vscode.TerminalOptions, 'location'>): vscode.Terminal {
  const t = vscode.window.createTerminal({ ...options, location: terminalLocation() });
  t.show(false);
  return t;
}

/** The executable that starts Claude in every terminal the extension opens: claudeHarness.terminal.command, `claude` when empty. */
export function claudeExecutable(): string {
  return vscode.workspace.getConfiguration('claudeHarness').get<string>('terminal.command', 'claude').trim() || 'claude';
}

/** A line that starts an interactive Claude session: the command, the configured extra arguments, then `rest` (a prompt, --resume, --agent). */
export function claudeCommand(rest = ''): string {
  const args = vscode.workspace.getConfiguration('claudeHarness').get<string>('terminal.args', '').trim();
  return [claudeExecutable(), args, rest].filter(Boolean).join(' ');
}

/** A Claude CLI line that is not a session (plugin install, uninstall, marketplace): the command without the extra arguments. */
export function claudeCli(rest: string): string {
  return `${claudeExecutable()} ${rest}`;
}

/** The folder a new Claude terminal starts in: the active editor's workspace folder, else the first one, else home. */
export function defaultCwd(): string {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const folder = (uri && vscode.workspace.getWorkspaceFolder(uri)) || vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath || os.homedir();
}

/** A name no open terminal carries, so every new Claude terminal is told apart. */
export function uniqueTerminalName(base: string): string {
  const used = new Set(vscode.window.terminals.map(t => t.name));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} (${i})`)) return `${base} (${i})`;
}
