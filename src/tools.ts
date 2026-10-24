import * as vscode from 'vscode';
import { Asset, ScopeView, mcpToolPrefix, readMarkdown } from './harness';

export const TOOL_FIELDS = ['tools', 'disallowedTools', 'allowed-tools'];
const BUILT_IN_TOOLS = [
  'Agent', 'AskUserQuestion', 'Bash', 'Edit', 'EnterPlanMode', 'ExitPlanMode', 'Glob', 'Grep', 'LSP', 'Monitor', 'NotebookEdit',
  'PowerShell', 'Read', 'Skill', 'TaskStop', 'TodoWrite', 'ToolSearch', 'WebFetch', 'WebSearch', 'Workflow', 'Write',
];

export const splitTools = (value: unknown): string[] =>
  (Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/[,\n]/) : []).map(s => s.trim()).filter(Boolean);

export async function pickTools(views: ScopeView[], asset: Asset | undefined, selected: string[]): Promise<string[] | undefined> {
  const servers = new Map<string, Set<string>>();
  const other = new Set<string>();
  const note = (tool: string) => {
    const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
    if (mcp) {
      if (!servers.has(mcp[1])) servers.set(mcp[1], new Set());
      servers.get(mcp[1])!.add(tool);
    } else if (!BUILT_IN_TOOLS.includes(tool)) other.add(tool);
  };
  for (const view of views)
    for (const cat of view.categories) {
      if (!cat.markdown) continue;
      for (const a of cat.items) {
        const data = readMarkdown(a.file).data;
        for (const key of TOOL_FIELDS) splitTools(data[key]).forEach(note);
      }
    }
  for (const view of views.filter(v => v.id === 'global' || v.id === asset?.scope))
    for (const s of view.categories.find(c => c.kind === 'mcp')?.items ?? []) {
      const key = mcpToolPrefix(s.name).slice(5, -2);
      if (!servers.has(key)) servers.set(key, new Set());
    }
  selected.forEach(note);

  type Item = vscode.QuickPickItem & { tool?: string };
  const item = (tool: string, label = tool, description?: string): Item => ({ label, description, tool, picked: selected.includes(tool) });
  // VS Code draws a separator's label small and right-aligned on the row below it, so the first group gets a heading row of its own.
  // It names the group and says where the MCP server groups are; it carries no tool and drops out of the result.
  const hint: Item = { label: '$(tools) Built-in tools', description: servers.size ? 'the MCP server groups follow below; type mcp__ to show only them' : 'no MCP server found', alwaysShow: true };
  const items: Item[] = [hint, ...BUILT_IN_TOOLS.map(t => item(t))];
  for (const [server, tools] of [...servers].sort(([a], [b]) => a.localeCompare(b))) {
    items.push({ label: `MCP Server: ${server}`, kind: vscode.QuickPickItemKind.Separator });
    items.push(item(`mcp__${server}__*`, `$(server) ${server}`, 'all tools'));
    for (const t of [...tools].filter(t => !t.endsWith('__*')).sort()) items.push(item(t, t.slice(`mcp__${server}__`.length), t));
  }
  if (other.size) items.push({ label: 'Other', kind: vscode.QuickPickItemKind.Separator }, ...[...other].sort().map(t => item(t)));

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: `Configure Tools${asset ? `: ${asset.name}` : ''}`,
    placeHolder: 'Select the tools this file may use, or type mcp__ for the MCP servers',
    matchOnDescription: true,
  });
  if (!picked) return undefined;
  const chosen = picked.map(p => p.tool!).filter(Boolean);
  return [...selected.filter(t => chosen.includes(t)), ...chosen.filter(t => !selected.includes(t))];
}
