import * as crypto from 'crypto';
import * as os from 'os';
import * as vscode from 'vscode';
import { Asset, Field, ScopeView, fromFields, globalScope, kindInfo, mcpToken, readMarkdown, readText, toFields, writeMarkdown, writeText } from './harness';
import { McpInfo, StdioConfig, probeHttp, probeStdio } from './probe';
import type { CheckSummary } from './constitution';
import type { InitForm } from './standard';
import { pickTools, splitTools } from './tools';

export interface Detail {
  asset: Asset;
  mode: 'markdown' | 'code' | 'settings' | 'json' | 'plugin' | 'mcp';
  fields: Field[];
  knownFields: string[];
  body: string;
}

const colorBelowTools = (fields: Field[]): Field[] => {
  const color = fields.find(f => f.key === 'color');
  const tools = fields.find(f => f.key === 'tools');
  if (!color || !tools || fields.indexOf(color) > fields.indexOf(tools)) return fields;
  const rest = fields.filter(f => f !== color);
  rest.splice(rest.indexOf(tools) + 1, 0, color);
  return rest;
};

interface Pending {
  id: string;
  fields: Field[];
  body: string;
}

type Message =
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
  | { type: 'initRun'; dir: string; form: InitForm; apply: boolean }
  | { type: 'openAt'; file: string; line?: number };

export interface PanelHost {
  views(): ScopeView[];
  find(id: string): Asset | undefined;
  refresh(): void;
  checks?(): Record<string, CheckSummary>;
  ensureChecks?(scopeIds: string[]): void;
  fleet?(): unknown;
  effective?(scopeId: string): unknown;
  ruleInfo?(id: string): unknown;
  marketplaces?(): unknown;
  initForm?(dir: string): Promise<unknown>;
  initRun?(dir: string, form: InitForm, apply: boolean): Promise<unknown>;
}

export class HarnessPanel {
  private static current: HarnessPanel | undefined;
  private selected: string | undefined;
  private page: { page?: string; repo?: string; dir?: string } | undefined;

  static show(context: vscode.ExtensionContext, host: PanelHost, id?: string): void {
    if (HarnessPanel.current) {
      HarnessPanel.current.panel.reveal();
      if (id) HarnessPanel.current.select(id);
      return;
    }
    const panel = vscode.window.createWebviewPanel('claudeHarness.panel', 'Claude Harness', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media'), vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')],
    });
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'harness-tab.svg');
    HarnessPanel.current = new HarnessPanel(context, panel, host, id);
  }

  static update(): void {
    HarnessPanel.current?.postState();
  }

  static showPage(context: vscode.ExtensionContext, host: PanelHost, page: { page?: string; repo?: string; dir?: string }): void {
    if (!HarnessPanel.current) HarnessPanel.show(context, host);
    HarnessPanel.current!.panel.reveal();
    HarnessPanel.current!.selected = undefined;
    HarnessPanel.current!.page = page;
    HarnessPanel.current!.post({ type: 'page', ...page });
  }

  static post(message: unknown): void {
    HarnessPanel.current?.post(message);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly host: PanelHost,
    initial?: string
  ) {
    this.selected = initial;
    panel.webview.html = this.html();
    panel.onDidDispose(() => (HarnessPanel.current = undefined));
    panel.onDidChangeViewState(e => e.webviewPanel.visible && host.refresh());
    panel.webview.onDidReceiveMessage((m: Message) => this.receive(m));
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private postState(): void {
    this.post({ type: 'state', views: this.host.views(), checks: this.host.checks?.() ?? {} });
    if (this.selected) this.post({ type: 'detail', detail: this.detail(this.selected), external: true });
  }

  select(id: string | undefined): void {
    this.selected = id && this.host.find(id) ? id : undefined;
    this.post({ type: 'detail', detail: this.selected ? this.detail(this.selected) : undefined });
  }

  private detail(id: string): Detail | undefined {
    const asset = this.host.find(id);
    if (!asset) return undefined;
    const info = kindInfo(asset.kind);
    if (info.markdown) {
      const doc = readMarkdown(asset.file);
      return { asset, mode: 'markdown', fields: colorBelowTools(toFields(doc.data)), knownFields: info.fields, body: doc.body };
    }
    if (asset.kind === 'workflow' || asset.kind === 'hookScript') return { asset, mode: 'code', fields: [], knownFields: [], body: readText(asset.file) };
    if (asset.kind === 'settings') return { asset, mode: 'settings', fields: [], knownFields: [], body: readText(asset.file) };
    if (asset.kind === 'plugin') return { asset, mode: 'plugin', fields: [], knownFields: [], body: '' };
    if (asset.kind === 'mcp') {
      void this.probe(asset);
      return { asset, mode: 'mcp', fields: [], knownFields: [], body: asset.file ? this.jsonExcerpt(asset) : '' };
    }
    return { asset, mode: 'json', fields: [], knownFields: [], body: this.jsonExcerpt(asset) };
  }

  private probes = new Map<string, Promise<McpInfo>>();

  private async probe(asset: Asset): Promise<void> {
    if (!this.probes.has(asset.id)) {
      let config: { url?: string; headers?: Record<string, string> } & Partial<StdioConfig> = {};
      if (asset.file) {
        try {
          config = JSON.parse(this.jsonExcerpt(asset));
        } catch {
          config = {};
        }
      } else if (/^https?:\/\//.test(asset.target ?? '')) config = { url: asset.target };
      else if (asset.target) {
        const [command, ...args] = asset.target.split(/\s+/);
        config = { command, args };
      }
      const view = this.host.views().find(v => v.id === asset.scope);
      const cwd = asset.scope !== 'global' && view?.path ? view.path : os.homedir();
      this.probes.set(
        asset.id,
        config.url && /^https?:\/\//.test(config.url)
          ? probeHttp(config.url, this.withToken(asset, config.url, config.headers ?? {}))
          : config.command
            ? probeStdio({ command: config.command, args: config.args, env: config.env }, cwd)
            : Promise.resolve({ error: 'Its config names neither a URL nor a command.' })
      );
    }
    const info = await this.probes.get(asset.id)!;
    this.post({ type: 'mcpInfo', id: asset.id, info });
  }

  private withToken(asset: Asset, url: string, headers: Record<string, string>): Record<string, string> {
    if (Object.keys(headers).some(h => h.toLowerCase() === 'authorization')) return headers;
    const token = mcpToken(globalScope().root, asset.name, url);
    return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
  }

  private signIn(asset: Asset): void {
    if (asset.source === 'claude.ai') {
      void vscode.env.openExternal(vscode.Uri.parse('https://claude.ai/new#customize/connectors/yours'));
      return;
    }
    const view = this.host.views().find(v => v.id === asset.scope);
    const terminal = vscode.window.createTerminal({ name: `Sign in: ${asset.name}`, cwd: asset.scope !== 'global' && view?.path ? view.path : os.homedir() });
    terminal.show();
    terminal.sendText('claude "/mcp"');
  }

  private jsonExcerpt(asset: Asset): string {
    try {
      const json = JSON.parse(readText(asset.file));
      const value = (asset.jsonPath ?? []).reduce<unknown>((node, key) => (node as Record<string | number, unknown> | undefined)?.[key], json);
      return JSON.stringify(value ?? {}, null, 2);
    } catch {
      return readText(asset.file);
    }
  }

  private save(pending: Pending): boolean {
    const asset = this.host.find(pending.id);
    if (!asset) return false;
    try {
      if (kindInfo(asset.kind).markdown) writeMarkdown(asset.file, fromFields(pending.fields), pending.body);
      else if (asset.kind === 'workflow' || asset.kind === 'hookScript') writeText(asset.file, pending.body);
      else if (asset.kind === 'settings') {
        JSON.parse(pending.body);
        writeText(asset.file, pending.body);
      }
      else return false;
      this.host.refresh();
      vscode.window.setStatusBarMessage(`$(check) Saved ${asset.name}`, 2500);
      return true;
    } catch (e) {
      void vscode.window.showErrorMessage(`Could not save ${asset.name}: ${(e as Error).message}`);
      return false;
    }
  }

  private async receive(m: Message): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.postState();
        this.post({ type: 'detail', detail: this.selected ? this.detail(this.selected) : undefined });
        if (this.page && !this.selected) this.post({ type: 'page', ...this.page });
        return;
      case 'select': {
        if (m.pending) {
          const name = this.host.find(m.pending.id)?.name ?? m.pending.id;
          const choice = await vscode.window.showWarningMessage(`Save changes to ${name}?`, { modal: true }, 'Save', "Don't Save");
          if (!choice) return;
          if (choice === 'Save' && !this.save(m.pending)) return;
        }
        this.select(m.id);
        return;
      }
      case 'save':
        if (this.save(m.pending)) this.post({ type: 'detail', detail: this.detail(m.pending.id) });
        return;
      case 'mcpSignIn': {
        const asset = this.host.find(m.id);
        if (asset) this.signIn(asset);
        return;
      }
      case 'mcpRetry': {
        const asset = this.host.find(m.id);
        if (!asset) return;
        this.probes.delete(asset.id);
        this.post({ type: 'mcpInfo', id: asset.id, info: undefined });
        void this.probe(asset);
        return;
      }
      case 'configureTools': {
        const tools = await pickTools(this.host.views(), this.host.find(m.id), splitTools(m.value));
        if (tools) this.post({ type: 'tools', id: m.id, key: m.key, value: tools.join(', ') });
        return;
      }
      case 'fleet':
        this.post({ type: 'fleet', rows: this.host.fleet?.() ?? [] });
        return;
      case 'effective':
        this.host.ensureChecks?.([m.scope]);
        this.post({ type: 'effective', scope: m.scope, data: this.host.effective?.(m.scope) });
        return;
      case 'ruleInfo':
        this.post({ type: 'ruleInfo', id: m.id, info: this.host.ruleInfo?.(m.id) });
        return;
      case 'marketplaces':
        this.post({ type: 'marketplaces', list: this.host.marketplaces?.() ?? [] });
        return;
      case 'initForm':
        this.post({ type: 'initForm', dir: m.dir, data: await this.host.initForm?.(m.dir) });
        return;
      case 'initRun':
        this.post({ type: 'initResult', dir: m.dir, apply: m.apply, data: await this.host.initRun?.(m.dir, m.form, m.apply) });
        return;
      case 'openAt': {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(m.file));
        const line = Math.max(0, (m.line ?? 1) - 1);
        await vscode.window.showTextDocument(doc, { selection: new vscode.Range(line, 0, line, 0) });
        return;
      }
      case 'command':
        if (m.command === 'openFile' && m.id && m.rel) {
          const asset = this.host.find(m.id);
          if (asset?.dir) await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(vscode.Uri.file(asset.dir), ...m.rel.split('/')));
          return;
        }
        await vscode.commands.executeCommand(`claudeHarness.${m.command}`, m.id ?? m.market ?? (m.kind || m.scope ? { kind: m.kind, scope: m.scope } : undefined));
        return;
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const nonce = crypto.randomBytes(16).toString('base64');
    const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', f));
    const codicons = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${codicons}">
<link rel="stylesheet" href="${media('panel.css')}">
<title>Claude Harness</title>
</head>
<body data-logo="${media('harness-tab.svg')}">
<div id="app"></div>
<script nonce="${nonce}" src="${media('panel.js')}"></script>
</body>
</html>`;
  }
}
