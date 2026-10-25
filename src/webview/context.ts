// @ts-nocheck
// The data a row hands to VS Code's right-click menu (`webview/context` in package.json): the menu's `when` reads these keys.
// A repo skill gets `scope: 'repo'`, so only it shows Consolidate; every element that has a share format gets `shareable`,
// so it shows Share. An MCP server shows it when it is stored in a file of yours.
import { syncableFromGlobal, syncableMcp } from './sync';
const SHARE_KINDS =['skill', 'plugin', 'agent', 'command', 'outputStyle', 'rule', 'memory', 'mcp', 'hook'];
export const skillContext = a => {
  const repoSkill = a.kind === 'skill' && a.scope !== 'global' && !a.scope.startsWith('plugin:');
  const shareable = SHARE_KINDS.includes(a.kind) && (a.kind !== 'mcp' || (!!a.file && !!a.jsonPath));
  if (!repoSkill && !shareable) return {};
  return { 'data-vscode-context': JSON.stringify({ webviewSection: repoSkill ? 'skill' : 'asset', ...(repoSkill ? { scope: 'repo' } : {}), ...(shareable ? { shareable: true } : {}), ...(syncableFromGlobal(a) ? { syncGlobal: true } : {}), ...(syncableMcp(a) ? { syncMcp: true } : {}), ...(a.kind === 'plugin' ? { syncPlugin: true } : {}), ...(a.kind === 'skill' && a.origin ? { syncSource: true } : {}), assetId: a.id, preventDefaultContextMenuItems: true }) };
};

// A repo row's menu: open the repo page, Open Claude here, New item, reveal the folder, remove it from the list. `scope` is the
// repo's id, which the commands read as their argument; `repoPath` is the folder for Reveal.
export const repoContext = v => ({ 'data-vscode-context': JSON.stringify({ webviewSection: 'repo', scope: v.id, repoPath: v.path, preventDefaultContextMenuItems: true }) });
