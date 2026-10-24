// @ts-nocheck
// The data a row hands to VS Code's right-click menu (`webview/context` in package.json): the menu's `when` reads these keys.
// Only a repo skill gets any, so no other row shows Consolidate.
export const skillContext = a =>
  a.kind === 'skill' && a.scope !== 'global' && !a.scope.startsWith('plugin:')
    ? { 'data-vscode-context': JSON.stringify({ webviewSection: 'skill', scope: 'repo', assetId: a.id, preventDefaultContextMenuItems: true }) }
    : {};

// A repo row's menu: open the repo page, Open Claude here, New item, reveal the folder, remove it from the list. `scope` is the
// repo's id, which the commands read as their argument; `repoPath` is the folder for Reveal.
export const repoContext = v => ({ 'data-vscode-context': JSON.stringify({ webviewSection: 'repo', scope: v.id, repoPath: v.path, preventDefaultContextMenuItems: true }) });
