import * as path from 'path';
import * as vscode from 'vscode';
import type { CheckSummary } from './constitution';
import { Asset, Category, ScopeView, copiesText } from './harness';
import { factsOf } from './shared/byline';
import type { SessionSummary } from './sessions';

export type Node =
  | { type: 'category'; category: Category }
  | { type: 'asset'; asset: Asset }
  | { type: 'file'; asset: Asset; rel: string; file: string; isDir: boolean; children: string[] }
  | { type: 'repos' }
  | { type: 'repo'; view: ScopeView }
  | { type: 'session'; view: ScopeView; session: SessionSummary };

export const durationText = (ms: number): string => {
  const minutes = Math.round(ms / 60000);
  if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))} s`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
};

export const sessionText = (s: SessionSummary): string =>
  [
    s.start ? new Date(s.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
    s.start ? durationText(s.end - s.start) : '',
    s.agents ? `${s.agents} ${s.agents === 1 ? 'agent' : 'agents'}` : '',
    s.children.length ? `${s.children.length} headless` : '',
    s.headless ? 'headless' : '',
    s.live ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

const CHECK_ICONS: Record<string, [string, string | undefined]> = {
  pass: ['pass', 'testing.iconPassed'],
  fail: ['error', 'list.errorForeground'],
  review: ['warning', 'list.warningForeground'],
  running: ['sync~spin', undefined],
  error: ['circle-slash', 'list.errorForeground'],
  'no-plugin': ['circle-slash', undefined],
  'no-python': ['circle-slash', undefined],
  unchecked: ['repo', undefined],
};

export const checkText = (s: CheckSummary): string =>
  s.state === 'pass'
    ? 'passes the standard'
    : s.state === 'fail'
      ? `fail ${s.fail ?? 0}${s.review ? ` · review ${s.review}` : ''}`
      : s.state === 'review'
        ? `review ${s.review ?? 0}`
        : s.state === 'running'
          ? 'checking...'
          : s.state === 'unchecked'
            ? ''
            : s.error ?? s.state;

function fileNodes(asset: Asset, prefix: string): Node[] {
  const files = (asset.files ?? []).filter(f => f !== 'SKILL.md' && f.startsWith(prefix));
  const level = new Map<string, string[]>();
  for (const f of files) {
    const rest = f.slice(prefix.length);
    const head = rest.split('/')[0];
    const list = level.get(head) ?? [];
    if (rest.includes('/')) list.push(f);
    level.set(head, list);
  }
  return [...level.entries()]
    .map(([head, children]) => {
      const rel = prefix + head;
      return { type: 'file' as const, asset, rel, file: path.join(asset.dir!, ...rel.split('/')), isDir: children.length > 0, children };
    })
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.rel.localeCompare(b.rel));
}

export class HarnessTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private categories: Category[] = [];
  private repos: ScopeView[] = [];

  constructor(
    private readonly checkOf: (dir: string) => CheckSummary = () => ({ state: 'unchecked' }),
    private readonly onExpandRepos: (dirs: string[]) => void = () => undefined,
    private readonly standard: () => boolean = () => false,
    private readonly sessionsOf: (dir: string) => SessionSummary[] = () => []
  ) {}

  setCategories(categories: Category[], repos: ScopeView[] = this.repos): void {
    this.categories = categories;
    this.repos = repos;
    this.changed.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (!node) return [...this.categories.map(category => ({ type: 'category' as const, category })), ...(this.repos.length ? [{ type: 'repos' as const }] : [])];
    if (node.type === 'repos') {
      this.onExpandRepos(this.repos.map(v => v.path));
      return this.repos.map(view => ({ type: 'repo', view }));
    }
    if (node.type === 'repo') return this.sessionsOf(node.view.path).map(session => ({ type: 'session', view: node.view, session }));
    if (node.type === 'session') return node.session.children.map(session => ({ type: 'session', view: node.view, session }));
    if (node.type === 'category') return node.category.items.map(asset => ({ type: 'asset', asset }));
    if (node.type === 'asset' && node.asset.kind === 'skill') return fileNodes(node.asset, '');
    if (node.type === 'file' && node.isDir) return fileNodes(node.asset, `${node.rel}/`);
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'repos') {
      const item = new vscode.TreeItem('Repositories', vscode.TreeItemCollapsibleState.Collapsed);
      item.id = 'repos';
      item.description = String(this.repos.length);
      item.iconPath = new vscode.ThemeIcon('repo');
      if (this.standard()) item.tooltip = 'Expanding checks every repo against the harness standard.';
      item.contextValue = 'repos';
      return item;
    }
    if (node.type === 'repo') {
      const check = this.checkOf(node.view.path);
      const [glyph, color] = CHECK_ICONS[check.state] ?? CHECK_ICONS.unchecked;
      const item = new vscode.TreeItem(node.view.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `repo:${node.view.id}`;
      item.description = checkText(check);
      item.tooltip = new vscode.MarkdownString(`**${node.view.label}**\n\n\`${node.view.path}\`${check.error ? `\n\n${check.error}` : ''}`);
      item.iconPath = new vscode.ThemeIcon(glyph, color ? new vscode.ThemeColor(color) : undefined);
      item.contextValue = 'repo';
      item.command = { command: 'claudeHarness.showRepo', title: 'Open', arguments: [node.view.id] };
      return item;
    }
    if (node.type === 'session') {
      const { session } = node;
      const item = new vscode.TreeItem(session.title.length > 80 ? `${session.title.slice(0, 77)}...` : session.title, session.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = `session:${node.view.id}:${session.id}`;
      item.description = sessionText(session);
      item.tooltip = new vscode.MarkdownString(`**${session.title.slice(0, 300).replace(/[\\`*_[\]<>]/g, '\\$&')}**\n\n${sessionText(session)}${session.branch ? ` · ${session.branch}` : ''}\n\n\`${session.file}\``);
      item.iconPath = session.live
        ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'))
        : new vscode.ThemeIcon(session.headless ? 'terminal' : session.agents ? 'type-hierarchy-sub' : 'comment-discussion');
      item.contextValue = 'session';
      item.command = { command: 'claudeHarness.showSession', title: 'Open Session', arguments: [node.view.id, session.id] };
      return item;
    }
    if (node.type === 'category') {
      const { category } = node;
      const item = new vscode.TreeItem(category.label, category.items.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = `category:${category.kind}`;
      item.description = String(category.items.length);
      item.iconPath = new vscode.ThemeIcon(category.icon);
      item.contextValue = category.creatable ? 'category.creatable' : `category.${category.kind}`;
      return item;
    }
    if (node.type === 'asset') {
      const { asset } = node;
      const item = new vscode.TreeItem(asset.name, asset.kind === 'skill' && (asset.files?.length ?? 0) > 1 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = asset.id;
      const facts = factsOf(asset);
      item.description = facts.map(f => f.text).join(' · ');
      const factLines = facts.map(f => `- **${f.tip.split('\n')[0]}**: ${f.tip.split('\n').slice(1).join(' ')}`).join('\n');
      item.tooltip = new vscode.MarkdownString(`**${asset.name}**\n\n${asset.description}${factLines ? `\n\n${factLines}` : ''}\n\n\`${asset.file}\`${asset.copies?.length ? `\n\n${copiesText(asset)}` : ''}`);
      item.iconPath =
        asset.kind === 'plugin'
          ? new vscode.ThemeIcon(asset.enabled ? 'pass-filled' : 'circle-large-outline', asset.enabled ? new vscode.ThemeColor('testing.iconPassed') : undefined)
          : new vscode.ThemeIcon(this.categories.find(c => c.kind === asset.kind)?.icon ?? 'file');
      item.contextValue = asset.kind === 'mcp' && asset.file && asset.jsonPath ? 'asset.mcp.stored' : asset.source === 'plugin' && asset.kind !== 'mcp' ? `asset.${asset.kind}.plugin` : asset.kind === 'skill' && asset.origin ? 'asset.skill.linked' : `asset.${asset.kind}`;
      item.command = { command: 'claudeHarness.open', title: 'Open', arguments: [asset.id] };
      return item;
    }
    const item = new vscode.TreeItem(path.posix.basename(node.rel), node.isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = `${node.asset.id}/${node.rel}`;
    item.resourceUri = vscode.Uri.file(node.file);
    item.contextValue = node.isDir ? 'folder' : 'file';
    if (!node.isDir) item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(node.file)] };
    return item;
  }
}
