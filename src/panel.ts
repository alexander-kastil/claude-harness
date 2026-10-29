import * as crypto from 'crypto';
import * as os from 'os';
import { openTerminal, claudeCommand } from './terminals';
import { listLimits } from './settings';
import * as vscode from 'vscode';
import { Asset, Field, KindInfo, ScopeView, fromFields, globalScope, isPluginCopy, kindInfo, mcpToken, readMarkdown, readText, toFields, writeMarkdown, writeText } from './harness';
import { McpInfo, StdioConfig, probeHttp, probeStdio } from './probe';
import type { CheckSummary } from './constitution';
import type { ScaffoldForm } from './standard';
import type { SessionSummary } from './sessions';
import type { SlimReport } from './shared/slim';
import type { HuntInfo, HuntProposal } from './shared/hunt';
import type { Answer, Confirm, ConsolidateRoute,Detail, ModActivity, Page, PanelAsk, Pending, Progress, RepoTrace, ShareChoice, ShareOption, Standard, StyleDraft, ToHost, ToWebview, UsageMoreReply, UsageReply, UsageTotal } from './shared/messages';
import { pickTools, splitTools } from './tools';

export type { Detail, Page } from './shared/messages';

/** Requests a page makes for its own data; none of them is an action the owner is waiting on. */
const BACKGROUND = new Set<ToHost['type']>(['sessions', 'weekly', 'usage', 'usageMore', 'usageTotals', 'repoTrace', 'modActivity', 'slim', 'drawing', 'ruleInfo', 'effective', 'fleet']);

/** What a `panel` card answered: the button, and the text and the picked ids when the card had an input or choices. */
export interface PanelAnswer {
  choice: 'ok' | 'alt' | 'cancel';
  text?: string;
  picked?: string[];
}

/** The Plugin Hunter page's side of the host. Results come back through `post`; a question goes through `ask`. */
export interface HuntHost {
  info(): HuntInfo;
  save(proposals: HuntProposal[], market?: string): void;
  /** Starts the conversation over; the cards stay. */
  clear(): void;
  run(prompt: string, answer: Answer, ask: (c: Confirm) => void, post: (m: ToWebview) => void, card?: string): Promise<void>;
  create(id: string, market: string, answer: Answer, ask: (c: Confirm) => void, post: (m: ToWebview) => void): Promise<void>;
  merge(kind: 'skill' | 'agent', file: string, ask: (c: Confirm) => void): Promise<void>;
}

const colorBelowTools = (fields: Field[]): Field[] => {
  const color = fields.find(f => f.key === 'color');
  const tools = fields.find(f => f.key === 'tools');
  if (!color || !tools || fields.indexOf(color) > fields.indexOf(tools)) return fields;
  const rest = fields.filter(f => f !== color);
  rest.splice(rest.indexOf(tools) + 1, 0, color);
  return rest;
};

export interface PanelHost {
  views(): ScopeView[];
  find(id: string): Asset | undefined;
  refresh(): void;
  /** Reads the harness again a few milliseconds at a time, for a change nobody is waiting on. */
  refreshSoon?(): Promise<void>;
  checks?(): Record<string, CheckSummary>;
  standard?(): Standard | undefined;
  ensureChecks?(scopeIds: string[]): void;
  fleet?(): unknown;
  effective?(scopeId: string): unknown;
  ruleInfo?(id: string): unknown;
  marketplaces?(): unknown;
  initForm?(dir: string): Promise<unknown>;
  initRun?(dir: string, form: ScaffoldForm, apply: boolean): Promise<unknown>;
  sessions?(scopeId: string): Promise<SessionSummary[]>;
  session?(scopeId: string, id: string): Promise<unknown>;
  /** The last 7 days of every account by model, over all repos. */
  weekly?(): Promise<unknown>;
  /** Asks first, then drafts an output style from the session's style scan; `started` fires once the user agreed. */
  /** Without a confirmed answer and a remembered one, asks in the panel through `ask` and returns idle. */
  draftStyle?(scopeId: string, id: string, model: string, started: () => void, answer: Answer, ask: (c: Confirm) => void): Promise<StyleDraft>;
  exportSession?(scopeId: string, id: string): Promise<void>;
  /** The files Claude changed after the checkpoint at a prompt, and what restoring each does. */
  checkpointFiles?(scopeId: string, id: string, checkpoint: string): Promise<{ path: string; action: 'overwrite' | 'remove' | 'recreate' }[]>;
  /** Opens one of those files in the diff editor: the checkpoint's copy against the file now. */
  checkpointDiff?(scopeId: string, id: string, checkpoint: string, file: string): Promise<void>;
  /** Asks in the panel, then puts the files back as the checkpoint had them; none when the owner cancelled. */
  checkpointRestore?(scopeId: string, id: string, checkpoint: string): Promise<{ count: number; failed: string[] } | undefined>;
  /** Opens a terminal in the session's repo with a new Claude that is a copy of the session; asks first like draftStyle. */
  analyzeSession?(scopeId: string, id: string, answer: Answer, ask: (c: Confirm) => void): Promise<void>;
  /** Opens a terminal that resumes the session itself (no copy); asks first like analyzeSession. */
  continueSession?(scopeId: string, id: string, answer: Answer, ask: (c: Confirm) => void): Promise<void>;
  /** Opens a terminal in the asset's repo with Claude asked to review the file; asks first like analyzeSession. */
  reviewAsset?(id: string, answer: Answer, ask: (c: Confirm) => void): Promise<void>;
  /** Opens a terminal in the skill's repo with Claude asked to slim it, given what its size report found; asks first like reviewAsset. */
  slimAsset?(id: string, answer: Answer, ask: (c: Confirm) => void): Promise<void>;
  /** Opens a terminal in the skill's repo with Claude asked to resolve one finding of the Size card; asks first like slimAsset. */
  resolveFinding?(id: string, finding: 'description' | 'house' | 'body', answer: Answer, ask: (c: Confirm) => void): Promise<void>;
  /** The stored drawing of an element when it was made from its source as it is now (a skill's SKILL.md, a plugin's folder). */
  drawing?(id: string): string | undefined;
  /**
   * Has the user's claude draw what the element is and stores it; asks first. A plugin is drawn in both perspectives, whichever the
   * id names: `started` fires for each drawing as the run begins, `done` for each as it is ready or fails.
   */
  drawAsset?(id: string, answer: Answer, ask: (c: Confirm) => void, started: (id: string) => void, done: (id: string, result: { svg: string } | { error: string }) => void): Promise<void>;
  /** The size and spread of a skill, measured from its files. */
  slim?(id: string): SlimReport | undefined;
  /** Consolidates a repo skill into global or its plugin: always asks in the panel, then retires, moves, opens the diff editor or starts Claude on the merge. */
  consolidateAsset?(id: string, answer: Answer & { target?: string; route?: ConsolidateRoute }, ask: (c: Confirm) => void): Promise<void>;
  /** Opens a terminal with Claude started on the agent, skill or command. */
  tryAsset?(id: string, answer: Answer, ask: (c: Confirm) => void): Promise<void>;
  /** Opens a terminal at the repo with Claude asked to fix one finding of the standard check. */
  fixFinding?(scopeId: string, finding: { text: string; file?: string; line?: number }): Promise<void>;
  /** Picks a transcript and copies it into the repo; returns the session id, or nothing when cancelled or failed. */
  importSession?(scopeId: string): Promise<string | undefined>;
  /** The sessions that used an agent or skill, from the transcript index; `build` builds the index when there is none yet. */
  usage?(id: string, build: boolean, progress: (p: Progress) => void): Promise<UsageReply | undefined>;
  /** What the repo's newest session loaded and which hooks failed in its recent sessions. */
  repoTrace?(scopeId: string): Promise<RepoTrace>;
  /** The events a plugin with an events manifest produced across the newest sessions. */
  modActivity?(id: string): Promise<ModActivity>;
  /** The 7-day strip and the per-element or per-tool counts of an element, from the same index. */
  usageMore?(id: string, build: boolean, progress: (p: Progress) => void): Promise<UsageMoreReply | undefined>;
  /** The uses of every agent, skill or command; reads an index that exists, never builds one. */
  usageTotals?(kind: string, build?: boolean): Promise<Record<string, UsageTotal> | undefined>;
  /** The Plugin Hunter. */
  hunt?: HuntHost;
}

export class HarnessPanel {
  private static current: HarnessPanel | undefined;
  private selected: string | undefined;
  private page: Page | undefined;

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

  /** A check started or finished: the panel gets the checks alone, not every view of the harness again. */
  static updateChecks(): void {
    const panel = HarnessPanel.current;
    panel?.post({ type: 'checks', checks: panel.host.checks?.() ?? {} });
  }

  static showPage(context: vscode.ExtensionContext, host: PanelHost, page: Page): void {
    if (!HarnessPanel.current) HarnessPanel.show(context, host);
    HarnessPanel.current!.panel.reveal();
    HarnessPanel.current!.selected = undefined;
    HarnessPanel.current!.page = page;
    HarnessPanel.current!.post({ type: 'page', ...page });
  }

  static post(message: ToWebview): void {
    HarnessPanel.current?.post(message);
  }

  private asks = new Map<string, (answer: PanelAnswer) => void>();

  /** Whether the panel is open: the distributor commands report in it, or in a notification when it is not. */
  static isOpen(): boolean {
    return !!HarnessPanel.current;
  }

  /** Asks in the open panel and waits for the owner's button; nothing when no panel is open, so the caller uses its own dialog. */
  static ask(ask: Omit<PanelAsk, 'kind' | 'token'>): Promise<'ok' | 'alt' | 'cancel'> | undefined {
    return HarnessPanel.askFull(ask)?.then(a => a.choice);
  }

  /** Like `ask`, with what the card's input and choices held when the owner pressed the button. */
  static askFull(ask: Omit<PanelAsk, 'kind' | 'token'>): Promise<PanelAnswer> | undefined {
    const panel = HarnessPanel.current;
    if (!panel) return undefined;
    const token = crypto.randomBytes(8).toString('hex');
    return new Promise(resolve => {
      panel.asks.set(token, answer => {
        panel.asks.delete(token);
        resolve(answer);
      });
      panel.post({ type: 'confirm', ask: { kind: 'panel', token, ...ask } });
    });
  }

  /** Share's question for an item from a plugin: the picked option, or nothing when cancelled or no panel is open. */
  static askShare(ask: Omit<ShareChoice, 'kind' | 'token'>): Promise<ShareOption['id'] | undefined> | undefined {
    const panel = HarnessPanel.current;
    if (!panel) return undefined;
    const token = crypto.randomBytes(8).toString('hex');
    return new Promise(resolve => {
      panel.asks.set(token, answer => {
        panel.asks.delete(token);
        resolve(answer.choice === 'ok' ? (answer.picked?.[0] as ShareOption['id'] | undefined) : undefined);
      });
      panel.post({ type: 'confirm', ask: { kind: 'shareChoice', token, ...ask } });
    });
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly host: PanelHost,
    initial?: string
  ) {
    this.selected = initial;
    panel.webview.html = this.html();
    panel.onDidDispose(() => {
      HarnessPanel.current = undefined;
      // A question still open is cancelled, so the command that waits on it cleans up.
      [...this.asks.values()].forEach(answer => answer({ choice: 'cancel' }));
    });
    panel.onDidChangeViewState(e => e.webviewPanel.visible && (host.refreshSoon ? void host.refreshSoon() : host.refresh()));
    panel.webview.onDidReceiveMessage((m: ToHost) => this.dispatch(m));
  }

  private background: { key: string; urgent: boolean; m: ToHost }[] = [];
  private draining = false;

  /**
   * An owner's action (a click on a row, a save, a command) is answered at once. What a page asks for around it (sessions of
   * every repo, usage counts, a mod's activity) reads transcripts on this thread, and the overview alone asks for dozens: a
   * click arriving behind them waited for all of them. Those requests run one per turn of the event loop, so a click is
   * answered after at most one of them; the ones for the open element first, and a request already waiting is not queued twice.
   */
  private dispatch(m: ToHost): void {
    if (!BACKGROUND.has(m.type)) return void this.run(m);
    const key = JSON.stringify(m);
    if (this.background.some(b => b.key === key)) return;
    const urgent = 'id' in m && m.id === this.selected;
    const at = urgent ? this.background.findIndex(b => !b.urgent) : -1;
    this.background.splice(at < 0 ? this.background.length : at, 0, { key, urgent, m });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.background.length) {
      this.run(this.background.shift()!.m);
      await new Promise(resolve => setImmediate(resolve));
    }
    this.draining = false;
  }

  private run(m: ToHost): void {
    this.receive(m).catch(() => undefined);
  }

  private post(message: ToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private postedState = '';

  /** A refresh that found nothing new posts nothing: the panel would only rebuild its sidebar from 1.6 MB it already has. A panel that just loaded asks with `force`. */
  private postState(force = false): void {
    const state: ToWebview = { type: 'state', views: this.host.views(), checks: this.host.checks?.() ?? {}, standard: this.host.standard?.(), lists: listLimits() };
    const key = JSON.stringify(state);
    if (!force && key === this.postedState) return;
    this.postedState = key;
    this.post(state);
    if (this.selected) this.post({ type: 'detail', detail: this.detail(this.selected), external: true });
  }

  select(id: string | undefined, saved?: boolean): void {
    this.selected = id && this.host.find(id) ? id : undefined;
    this.post({ type: 'detail', detail: this.selected ? this.detail(this.selected) : undefined, saved });
  }

  private detail(id: string): Detail | undefined {
    const asset = this.host.find(id);
    if (!asset) return undefined;
    // A hook script has no entry in KINDS: reading `markdown` off nothing threw, no page came back, and its row opened nothing.
    const info = kindInfo(asset.kind) as KindInfo | undefined;
    if (info?.markdown) {
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
    const terminal = openTerminal({ name: `Sign in: ${asset.name}`, cwd: asset.scope !== 'global' && view?.path ? view.path : os.homedir() });
    terminal.sendText(claudeCommand('"/mcp"'));
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
    if (isPluginCopy(asset)) {
      void vscode.window.showErrorMessage(`${asset.name} comes from a plugin and is read-only: an update overwrites the installed copy.`);
      return false;
    }
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

  private async receive(m: ToHost): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.postState(true);
        this.post({ type: 'detail', detail: this.selected ? this.detail(this.selected) : undefined });
        if (this.page && !this.selected) this.post({ type: 'page', ...this.page });
        return;
      case 'select': {
        let saved = false;
        if (m.pending) {
          const name = this.host.find(m.pending.id)?.name ?? m.pending.id;
          const answer = await HarnessPanel.ask({ key: 'click', glyph: 'save', title: `Save changes to ${name}?`, sub: 'You have unsaved edits', facts: m.view ? ['Save writes them to the file, then shows the page.', "Don't Save drops them and shows the page."] : ['Save writes them to the file, then opens the next page.', "Don't Save drops them and opens the next page."], action: 'Save', alt: "Don't Save" });
          if (!answer || answer === 'cancel') return;
          if (answer === 'ok') {
            if (!this.save(m.pending)) return;
            saved = true;
          }
        }
        this.select(m.id, saved || m.view);
        return;
      }
      case 'save':
        if (this.save(m.pending)) this.post({ type: 'detail', detail: this.detail(m.pending.id), saved: true });
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
      case 'sessions':
        this.post({ type: 'sessions', scope: m.scope, list: (await this.host.sessions?.(m.scope)) ?? [] });
        return;
      case 'weekly': {
        let list: unknown = [];
        try {
          list = (await this.host.weekly?.()) ?? [];
        } catch {
          // an unreadable account folder shows no summary
        }
        this.post({ type: 'weekly', list });
        return;
      }
      case 'session': {
        let data: unknown;
        try {
          data = await this.host.session?.(m.scope, m.id);
        } catch (e) {
          data = { error: (e as Error).message };
        }
        this.post({ type: 'session', scope: m.scope, id: m.id, data: data ?? { error: 'The session transcript is gone.' } });
        return;
      }
      case 'draftStyle': {
        const reply = (data: StyleDraft) => this.post({ type: 'styleDraft', scope: m.scope, id: m.id, ...data });
        try {
          const answer = { confirmed: m.confirmed, remember: m.remember };
          reply((await this.host.draftStyle?.(m.scope, m.id, m.model, () => reply({ state: 'running', model: m.model }), answer, ask => this.post({ type: 'confirm', ask }))) ?? { state: 'idle' });
        } catch (e) {
          reply({ state: 'error', error: (e as Error).message });
        }
        return;
      }
      case 'exportSession':
        await this.host.exportSession?.(m.scope, m.id);
        return;
      case 'checkpointFiles': {
        const files = (await this.host.checkpointFiles?.(m.scope, m.id, m.checkpoint)) ?? [];
        this.post({ type: 'checkpointFiles', scope: m.scope, id: m.id, checkpoint: m.checkpoint, files });
        return;
      }
      case 'checkpointDiff':
        await this.host.checkpointDiff?.(m.scope, m.id, m.checkpoint, m.file);
        return;
      case 'checkpointRestore': {
        const restored = await this.host.checkpointRestore?.(m.scope, m.id, m.checkpoint);
        if (!restored) return;
        const files = (await this.host.checkpointFiles?.(m.scope, m.id, m.checkpoint)) ?? [];
        this.post({ type: 'checkpointFiles', scope: m.scope, id: m.id, checkpoint: m.checkpoint, files, restored });
        return;
      }
      case 'analyzeSession':
        await this.host.analyzeSession?.(m.scope, m.id, { confirmed: m.confirmed, remember: m.remember }, ask => this.post({ type: 'confirm', ask }));
        return;
      case 'continueSession':
        await this.host.continueSession?.(m.scope, m.id, { confirmed: m.confirmed, remember: m.remember }, ask => this.post({ type: 'confirm', ask }));
        return;
      case 'reviewAsset':
        await this.host.reviewAsset?.(m.id, { confirmed: m.confirmed, remember: m.remember }, ask => this.post({ type: 'confirm', ask }));
        return;
      case 'slimAsset':
        await this.host.slimAsset?.(m.id, { confirmed: m.confirmed, remember: m.remember }, ask => this.post({ type: 'confirm', ask }));
        return;
      case 'resolveFinding':
        await this.host.resolveFinding?.(m.id, m.finding, { confirmed: m.confirmed, remember: m.remember }, ask => this.post({ type: 'confirm', ask }));
        return;
      case 'drawing': {
        let svg: string | undefined;
        try {
          svg = this.host.drawing?.(m.id);
        } catch {
          svg = undefined;
        }
        this.post({ type: 'drawing', id: m.id, svg });
        return;
      }
      case 'drawAsset': {
        await this.host.drawAsset?.(
          m.id,
          { confirmed: m.confirmed, remember: m.remember },
          ask => this.post({ type: 'confirm', ask }),
          id => this.post({ type: 'drawing', id, running: true }),
          (id, result) => this.post('svg' in result ? { type: 'drawing', id, svg: result.svg } : { type: 'drawing', id, error: result.error })
        );
        return;
      }
      case 'slim': {
        let report: SlimReport | undefined;
        try {
          report = this.host.slim?.(m.id);
        } catch {
          report = undefined;
        }
        this.post({ type: 'slim', id: m.id, report });
        return;
      }
      case 'consolidateAsset':
        await this.host.consolidateAsset?.(m.id, { confirmed: m.confirmed, target: m.target, route: m.route }, ask => this.post({ type: 'confirm', ask }));
        return;
      case 'tryAsset':
        await this.host.tryAsset?.(m.id, { confirmed: m.confirmed, remember: m.remember }, ask => this.post({ type: 'confirm', ask }));
        return;
      case 'fixFinding':
        await this.host.fixFinding?.(m.scope, { text: m.text, file: m.file, line: m.line });
        return;
      case 'answer':
        this.asks.get(m.token)?.({ choice: m.choice, text: m.text, picked: m.picked });
        return;
      case 'importSession': {
        const id = await this.host.importSession?.(m.scope);
        if (!id) return;
        this.post({ type: 'sessions', scope: m.scope, list: (await this.host.sessions?.(m.scope)) ?? [] });
        this.post({ type: 'page', page: 'session', repo: m.scope, session: id });
        return;
      }
      case 'usage': {
        let reply: UsageReply | undefined;
        try {
          reply = await this.host.usage?.(m.id, m.build, indexing => this.post({ type: 'usageInfo', id: m.id, indexing }));
        } catch {
          reply = { built: false };
        }
        if (reply) this.post({ type: 'usageInfo', id: m.id, ...reply });
        return;
      }
      case 'repoTrace': {
        let data: RepoTrace = { failures: [], scanned: 0 };
        try {
          data = (await this.host.repoTrace?.(m.scope)) ?? data;
        } catch {
          // an unreadable transcript shows no trace
        }
        this.post({ type: 'repoTrace', scope: m.scope, data });
        return;
      }
      case 'modActivity': {
        let data: ModActivity = { sessions: 0, groups: [] };
        try {
          data = (await this.host.modActivity?.(m.id)) ?? data;
        } catch {
          // an unreadable transcript shows no activity
        }
        this.post({ type: 'modActivity', id: m.id, data });
        return;
      }
      case 'usageMore': {
        let reply: UsageMoreReply | undefined;
        try {
          reply = await this.host.usageMore?.(m.id, m.build, indexing => this.post({ type: 'usageMore', id: m.id, indexing }));
        } catch {
          reply = { built: false };
        }
        if (reply) this.post({ type: 'usageMore', id: m.id, ...reply });
        return;
      }
      case 'usageTotals': {
        let totals: Record<string, UsageTotal> | undefined;
        try {
          totals = await this.host.usageTotals?.(m.kind, m.build);
        } catch {
          totals = undefined;
        }
        this.post(totals ? { type: 'usageTotals', kind: m.kind, totals } : { type: 'usageTotals', kind: m.kind, built: false });
        return;
      }
      case 'huntInfo':
        if (this.host.hunt) this.post({ type: 'hunt', info: this.host.hunt.info() });
        return;
      case 'huntSave':
        this.host.hunt?.save(m.proposals, m.market);
        return;
      case 'huntClear':
        this.host.hunt?.clear();
        if (this.host.hunt) this.post({ type: 'hunt', info: this.host.hunt.info() });
        return;
      case 'huntRun':
        await this.host.hunt?.run(m.prompt, { confirmed: m.confirmed, remember: m.remember }, ask => this.post({ type: 'confirm', ask }), msg => this.post(msg), m.card);
        return;
      case 'huntCreate':
        await this.host.hunt?.create(m.id, m.market, { confirmed: m.confirmed }, ask => this.post({ type: 'confirm', ask }), msg => this.post(msg));
        return;
      case 'huntMerge':
        await this.host.hunt?.merge(m.kind, m.path, ask => this.post({ type: 'confirm', ask: ask.kind === 'consolidate' ? { ...ask, key: 'click' } : ask }));
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
        // These ask in the panel; the same commands from the left nav or a tree menu keep their dialog.
        if (['delete', 'uninstallPlugin', 'retire', 'retireCopies', 'addSkillFromUrl', 'connectSkillSource', 'updateSkill', 'linkSkillToRepo', 'share', 'syncFromGlobal', 'syncPlugin', 'syncMcp'].includes(m.command) || /^import[A-Z]/.test(m.command)) {
          await vscode.commands.executeCommand(`claudeHarness.${m.command}`, { fromPanel: true, id: m.id, scope: m.scope, plugin: m.plugin });
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
