import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Constitution } from './constitution';
import { consolidateApply, consolidatePlan, mergePrompt, routesOf } from './consolidate';
import type { ConsolidateRoute, ConsolidateTarget } from './shared/messages';
import { FileEdit, fleetRow, guardInfo, guardReasons, lastSessionAt, marketplaceHealth, renameCatalog, renameCommands, renameInSettings } from './fleet';
import { huntHost } from './hunt-host';
import { keyChanges, mcpApply, mcpConfig, mcpVersions, syncApply, syncFiles, syncSource, updatePluginFromMarket } from './sync';
import { registerDistributor } from './dist-host';
import { registerShare } from './share-host';
import { EventSource, eventLayers, findEventSources, transcriptLayers } from './events';
import { registerLenses } from './lenses';
import { NO_PROVIDER, Provider, ScaffoldForm, applyFix, findProvider, parseScaffoldOutput, previewFix, runScript, scaffoldArgs } from './standard';
import {
  Asset,
  backupStamp,
  effectiveHarness,
  pluginDirs,
  pluginViews,
  retireAsset,
  retireBlock,
  rosterOf,
  ruleInfo,
  addMcpServer,
  createAsset,
  jsonAt,
  marketplacePlugins,
  MCP_NAME,
  McpConfig,
  mcpAddCommand,
  splitCommandLine,
  duplicateAsset,
  globalScope,
  isPluginCopy,
  HarnessScope,
  Kind,
  KINDS,
  expandRepoFolders,
  knownRepos,
  linkCopies,
  McpSource,
  applyMcpState,
  parseMcpList,
  pluginDescription,
  pluginIsMod,
  removeJsonEntry,
  setMcpEnabled,
  parseMarkdown,
  readMarkdown,
  renameAsset,
  repoScope,
  scan,
  ScopeView,
  setFrontmatterList,
  setPluginEnabled,
  validateName,
} from './harness';
import { HarnessPanel, PanelHost } from './panel';
import { Account, accountWeek, findAccountSession, importTranscript, listAccountSessions, parseAccounts, readSession } from './sessions';
import { STYLE_MODELS, StyleModel, draftStyle, stylePrompt, writeStyleDraft } from './style';
import { Specialist, fitGeneralFindings } from './findings';
import { pickTools, splitTools, TOOL_FIELDS } from './tools';
import { modActivity, repoTrace } from './trace';
import { HarnessTree, Node } from './tree';
import { UsageIndex } from './usage';
import type { Progress } from './usage';
import { hookRows, hookTarget } from './usage-hooks';
import { analyzeSkill, slimPrompt } from './slim';
import type { SlimReport } from './shared/slim';
import { usageMore, usageRows, usageTarget, usageTotals } from './usage-rows';
import type { UsageTarget } from './usage-rows';

const WATCHED = '{CLAUDE.md,settings.json,settings.local.json,agents/**,skills/**,commands/**,output-styles/**,rules/**,workflows/**,hooks/**,plugins/installed_plugins.json,plugins/known_marketplaces.json}';

/** Text for a double-quoted prompt on the command line: one line, with nothing a shell would read. */
const promptText = (text: string) => text.replace(/[\r\n]+/g, ' ').replace(/["`$%^&|<>]/g, "'");

/** The argument a command gets when the webview started it: the command asks in the panel instead of a dialog. */
const panelArg = (arg: unknown): { fromPanel: true; id?: string } | undefined => (arg && typeof arg === 'object' && 'fromPanel' in arg ? (arg as { fromPanel: true; id?: string }) : undefined);

export function activate(context: vscode.ExtensionContext): void {
  let global: HarnessScope = globalScope(vscode.workspace.getConfiguration('claudeHarness').get<string>('root'));
  const accounts = (): Account[] => {
    const config = vscode.workspace.getConfiguration('claudeHarness');
    return parseAccounts(global.root, config.get<string>('plan'), config.get<unknown>('accounts'), undefined, config.get<string>('weekStart'));
  };
  let scopes: HarnessScope[] = [global];
  let views: ScopeView[] = [];
  let plugins: ScopeView[] = [];
  let provider: Provider | undefined;
  // Plugins that log events per session; each adds a layer to the session views.
  let eventSources: EventSource[] = [];
  const constitution = new Constitution(
    () => provider,
    () => path.join(global.root, 'settings.json')
  );
  const loadProvider = () => {
    const dirs = pluginDirs(global.root, true);
    const next = findProvider(dirs);
    eventSources = findEventSources(dirs);
    const changed = next?.dir !== provider?.dir;
    provider = next;
    void vscode.commands.executeCommand('setContext', 'claudeHarness.standard', !!provider);
    void vscode.commands.executeCommand('setContext', 'claudeHarness.align', !!provider?.align);
    void vscode.commands.executeCommand('setContext', 'claudeHarness.scaffold', !!provider?.scaffold);
    void vscode.commands.executeCommand('setContext', 'claudeHarness.fix', !!provider?.fix);
    if (changed && !provider) constitution.clear();
  };
  const tree = new HarnessTree(
    dir => constitution.summary(dir),
    dirs => constitution.ensure(dirs),
    () => !!provider,
    dir => listAccountSessions(dir, accounts())
  );
  let watcher: vscode.FileSystemWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;
  // Where each agent and skill was used, over the transcripts of every account; built the first time the Used in tab opens.
  const usageIndex = new UsageIndex(path.join(context.globalStorageUri.fsPath, 'usage-index.json'));
  // The target of an element for the pages that read beyond the session list; an output style is matched by its frontmatter name.
  const targetOf = (asset: Asset): UsageTarget | undefined => usageTarget(asset, views, asset.kind === 'outputStyle' ? String(readMarkdown(asset.file).data.name ?? '') || undefined : undefined);
  // The index, brought up to date: undefined without one when `build` is false. Progress at most four times a second.
  const usageData = async (build: boolean, progress?: (p: Progress) => void) => {
    if (!build && !(await usageIndex.exists())) return undefined;
    let shown = Date.now();
    return usageIndex.refresh(
      accounts().map(a => a.root),
      p => {
        if (!progress || Date.now() - shown < 250) return;
        shown = Date.now();
        progress(p);
      },
      build ? 0 : 3000
    );
  };

  const assets = () => views.flatMap(v => v.categories.flatMap(c => c.items));
  const find = (id: string): Asset | undefined => assets().find(a => a.id === id);
  const samePath = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const assetOfFile = (file: string) => assets().find(a => samePath(a.file, file));
  const lensesChanged = new vscode.EventEmitter<void>();
  const scopeOf = (asset: Asset) => scopes.find(s => s.id === asset.scope) ?? global;

  const loadScopes = () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    const config = vscode.workspace.getConfiguration('claudeHarness');
    const added = expandRepoFolders(config.get<string[]>('repoFolders') ?? []);
    const removed = config.get<string[]>('removedRepos') ?? [];
    const repos = knownRepos([...folders, ...added]).filter(dir => !removed.some(r => samePath(r, dir)));
    const local = (dir: string) => folders.some(f => samePath(f, dir));
    scopes = [global, ...[...repos.filter(local), ...repos.filter(dir => !local(dir))].map(dir => repoScope(dir))];
  };

  let cliServers: Asset[] = [];
  const loadCliServers = () =>
    exec('claude mcp list', { cwd: os.homedir(), timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_err, stdout) => {
      const servers = parseMcpList(stdout ?? '');
      if (!servers.length) return;
      cliServers = servers.map(s => {
        const source: McpSource = s.name.startsWith('claude.ai ') ? 'claude.ai' : s.name.startsWith('plugin:') ? 'plugin' : 'user';
        const plugin = source === 'plugin' ? s.name.split(':')[1] : undefined;
        return {
          id: `${global.id}|mcp:${s.name}`,
          scope: global.id,
          kind: 'mcp',
          name: s.name,
          description: [s.target, s.status].filter(Boolean).join(' · '),
          file: '',
          mtime: 0,
          source,
          about: plugin ? pluginDescription(global.root, plugin) : undefined,
          target: s.target.replace(/\s*\((HTTP|SSE|stdio)\)$/i, ''),
          status: s.status,
        };
      });
      refresh();
    });

  const refresh = () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    views = scopes.map(s => ({ id: s.id, label: s.label, path: s.base, local: s !== global && folders.some(f => samePath(f, s.base)), lastUsed: s !== global ? lastSessionAt(s.base) : undefined, categories: scan(s) }));
    const globalMcp = views[0].categories.find(c => c.kind === 'mcp');
    if (globalMcp) {
      for (const a of globalMcp.items) a.status = cliServers.find(c => c.name === a.name)?.status;
      globalMcp.items.push(...cliServers.filter(c => !globalMcp.items.some(a => a.name === c.name)).map(c => ({ ...c })));
    }
    applyMcpState(views, global.userConfig);
    plugins = pluginViews(global.root);
    loadProvider();
    linkCopies(views, plugins);
    // A plugin enabled in your settings runs its agents as global agents, so they join the global Agents list, read-only.
    const globalAgents = views[0].categories.find(c => c.kind === 'agent');
    const enabledPlugins = new Set((views[0].categories.find(c => c.kind === 'plugin')?.items ?? []).filter(p => p.enabled).map(p => p.name));
    if (globalAgents) {
      for (const p of plugins.filter(v => enabledPlugins.has(v.id.slice('plugin:'.length))))
        for (const a of p.categories.find(c => c.kind === 'agent')?.items ?? [])
          globalAgents.items.push({ ...a, source: 'plugin', description: [`plugin ${p.id.slice('plugin:'.length).split('@')[0]}`, a.description].filter(Boolean).join(' · ') });
      globalAgents.items.sort((x, y) => x.name.localeCompare(y.name));
    }
    // Their skills load in every session too, so they join the global Skills list the same way.
    const globalSkills = views[0].categories.find(c => c.kind === 'skill');
    if (globalSkills) {
      for (const p of plugins.filter(v => enabledPlugins.has(v.id.slice('plugin:'.length))))
        for (const a of p.categories.find(c => c.kind === 'skill')?.items ?? []) globalSkills.items.push({ ...a, source: 'plugin' });
      globalSkills.items.sort((x, y) => x.name.localeCompare(y.name));
    }
    for (const a of views.flatMap(v => v.categories.find(c => c.kind === 'plugin')?.items ?? [])) if (pluginIsMod(global.root, a.name)) a.description += ' · mod';
    tree.setCategories(views[0].categories, views.slice(1));
    HarnessPanel.update();
    lensesChanged.fire();
  };
  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  };

  const watch = () => {
    watcher?.dispose();
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(global.root), WATCHED));
    watcher.onDidChange(scheduleRefresh);
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
  };

  const repoViews = () => views.filter(v => v.id !== global.id);
  const viewOfScope = (id: string) => views.find(v => v.id === id);
  const rosterFor = (base: string | undefined) => rosterOf([views[0], ...views.filter(v => v.id !== global.id && base && samePath(v.path, base))].filter(Boolean), plugins);
  const inside = (file: string, dir: string) => {
    const rel = path.relative(dir, file);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  const repoOfFile = (file: string) =>
    repoViews()
      .filter(v => inside(file, v.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
  const harnessFileOf = (file: string) => {
    const repo = repoOfFile(file);
    if (!repo) return undefined;
    const rel = path.relative(repo.path, file).split(path.sep).join('/');
    return rel === 'CLAUDE.md' || rel === 'CLAUDE.local.md' || rel.startsWith('.claude/') ? repo : undefined;
  };
  const checksChanged = new vscode.EventEmitter<void>();
  constitution.changed(() => {
    tree.setCategories(views[0]?.categories ?? [], repoViews());
    HarnessPanel.update();
    checksChanged.fire();
  });

  const host: PanelHost = {
    views: () => views,
    find,
    refresh,
    checks: () => Object.fromEntries(repoViews().map(v => [v.id, constitution.summary(v.path)])),
    standard: () =>
      provider
        ? {
            name: provider.name,
            fix: !!provider.fix,
            scaffold: !!provider.scaffold,
            align: !!provider.align,
            owner: !!provider.ownerPattern,
            doc: provider.standard && fs.existsSync(provider.standard) ? provider.standard : undefined,
            docText: provider.standard && fs.existsSync(provider.standard) ? fs.readFileSync(provider.standard, 'utf8') : undefined,
          }
        : undefined,
    ensureChecks: ids => constitution.ensure(ids.map(id => viewOfScope(id)?.path).filter((p): p is string => !!p && p !== global.base)),
    fleet: () => {
      constitution.ensure(repoViews().map(v => v.path));
      return repoViews().map(v => fleetRow(v, constitution.get(v.path)));
    },
    effective: id => {
      const scope = scopes.find(s => s.id === id);
      if (!scope || scope.id === global.id) return undefined;
      return { effective: effectiveHarness(global, scope), check: constitution.summary(scope.base, true) };
    },
    ruleInfo: id => {
      const asset = find(id);
      if (!asset || asset.kind !== 'rule') return undefined;
      const scope = scopeOf(asset);
      const base = scope.id === global.id ? repoViews().find(v => v.local)?.path : scope.base;
      return { ...ruleInfo(asset, base ?? '', rosterFor(base), provider?.ownerPattern), base: base ?? '' };
    },
    marketplaces: () => marketplaceHealth(global.root),
    initForm: async dir => {
      const { provider: p, error } = await constitution.tools();
      return {
        name: path.basename(dir),
        hasClaudeMd: fs.existsSync(path.join(dir, 'CLAUDE.md')),
        agents: [...rosterFor(dir).agents].sort((a, b) => a.localeCompare(b)),
        error: error ?? (p?.scaffold ? undefined : `${p?.name ?? 'The provider'} has no scaffold.`),
      };
    },
    initRun: async (dir, form: ScaffoldForm, apply) => {
      const { provider: p, py, error } = await constitution.tools();
      if (error || !p?.scaffold) return { error: error ?? `${p?.name ?? 'The provider'} has no scaffold.` };
      if (!form.summary.trim()) return { error: 'Write a summary of one to three sentences first.' };
      const roster = rosterFor(dir);
      const unknown = form.areas.filter(a => a.owner.trim() && !roster.agents.has(a.owner.trim())).map(a => a.owner.trim());
      if (unknown.length) return { error: `No agent named ${unknown.join(', ')} on disk.` };
      const r = await runScript(py, p.scaffold, scaffoldArgs(dir, form, apply));
      if (r.code !== 0) return { error: r.stderr.trim() || `The scaffold exited with ${r.code}` };
      if (apply) {
        const config = vscode.workspace.getConfiguration('claudeHarness');
        if (!scopes.some(s => samePath(s.base, dir))) {
          const folders = config.get<string[]>('repoFolders') ?? [];
          if (!folders.some(f => samePath(f, dir))) await config.update('repoFolders', [...folders, dir], vscode.ConfigurationTarget.Global);
        }
        loadScopes();
        refresh();
        constitution.ensure([dir], true);
      }
      return parseScaffoldOutput(r.stdout);
    },
    sessions: id => {
      const view = viewOfScope(id);
      return view && view.id !== global.id ? listAccountSessions(view.path, accounts()) : [];
    },
    weekly: () => Promise.all(accounts().map(a => accountWeek(a))),
    session: async (id, sessionId) => {
      const view = viewOfScope(id);
      const summary = view && view.id !== global.id ? findAccountSession(view.path, accounts(), sessionId) : undefined;
      if (!summary) return undefined;
      const detail = await readSession(summary);
      // An agent definition's own `color` field colors its lanes.
      const definitions = [...views, ...plugins].flatMap(v => v.categories.find(c => c.kind === 'agent')?.items ?? []);
      const agentColors: Record<string, string> = {};
      for (const type of new Set(detail.agents.map(a => a.type))) {
        const asset = definitions.find(a => a.name === (type.split(':').pop() ?? type));
        const color = asset ? readMarkdown(asset.file).data.color : undefined;
        if (typeof color === 'string') agentColors[type] = color.trim().toLowerCase();
      }
      // Mod events: the logs of the plugins that ship an events manifest, then what the transcript shows of every hook.
      const { hooks, ...rest } = detail;
      const logs = eventLayers(eventSources, summary.file, summary.id);
      const layers = [...logs, ...transcriptLayers(hooks, logs, eventSources)];
      // A general-purpose run is a finding only when an agent this session could have launched fits its brief.
      const specialists: Specialist[] = [
        ...[views[0], view!].flatMap(v => (v?.categories.find(c => c.kind === 'agent')?.items ?? []).map(a => ({ use: a.name, name: a.name, description: a.description }))),
        ...plugins.flatMap(p => (p.categories.find(c => c.kind === 'agent')?.items ?? []).map(a => ({ use: `${p.id.slice('plugin:'.length).split('@')[0]}:${a.name}`, name: a.name, description: a.description }))),
      ].filter(s => s.name !== 'general-purpose');
      rest.findings = fitGeneralFindings(rest.findings, rest.agents, specialists);
      return { ...rest, repo: view!.label, agentColors, account: summary.account, plan: accounts().find(a => a.root === (summary.accountRoot ?? global.root))?.plan, ...(layers.length ? { layers } : {}) };
    },
    draftStyle: async (id, sessionId, model, started, answer, ask) => {
      const scope = scopes.find(s => s.id === id && s.id !== global.id);
      const summary = scope ? findAccountSession(scope.base, accounts(), sessionId) : undefined;
      if (!scope || !summary) return { state: 'error', error: 'The session transcript is gone.' };
      if (!STYLE_MODELS.includes(model as StyleModel)) return { state: 'error', error: `Unknown model ${model}.` };
      const scan = (await readSession(summary)).style;
      // Asked in the panel, until the owner switches on Don't ask again.
      if (!answer.confirmed && !context.globalState.get<boolean>('draftStyleRemembered')) {
        ask({ kind: 'draftStyle', scope: id, id: sessionId, model, corrections: scan.corrections.length, folder: path.join(scope.root, 'output-styles') });
        return { state: 'idle' };
      }
      if (answer.remember) await context.globalState.update('draftStyleRemembered', true);
      started();
      const result = await draftStyle(stylePrompt(scan), model as StyleModel, os.tmpdir());
      if ('error' in result) return { state: 'error', error: result.error };
      let file = '';
      try {
        file = writeStyleDraft(scope.root, result.text, scan.active);
      } catch (e) {
        return { state: 'error', error: (e as Error).message };
      }
      refresh();
      showFile(file);
      return { state: 'done', file, cost: result.cost, text: fs.readFileSync(file, 'utf8') };
    },
    exportSession: async (id, sessionId) => {
      const scope = scopes.find(s => s.id === id && s.id !== global.id);
      const summary = scope ? findAccountSession(scope.base, accounts(), sessionId) : undefined;
      if (!summary) return void vscode.window.showErrorMessage('The session transcript is gone.');
      const downloads = path.join(os.homedir(), 'Downloads');
      const target = await vscode.window.showSaveDialog({
        title: 'Export the session transcript',
        saveLabel: 'Export',
        defaultUri: vscode.Uri.file(path.join(fs.existsSync(downloads) ? downloads : os.homedir(), path.basename(summary.file))),
        filters: { 'Claude Code transcript': ['jsonl'] },
      });
      if (!target) return;
      try {
        fs.copyFileSync(summary.file, target.fsPath);
      } catch (e) {
        return void vscode.window.showErrorMessage(`Could not export the transcript: ${(e as Error).message}`);
      }
      void vscode.window.showInformationMessage(`Exported the session transcript to ${target.fsPath}.`);
    },
    analyzeSession: async (id, sessionId, answer, ask) => {
      const scope = scopes.find(s => s.id === id && s.id !== global.id);
      const summary = scope ? findAccountSession(scope.base, accounts(), sessionId) : undefined;
      if (!scope || !summary) return void vscode.window.showErrorMessage('The session transcript is gone.');
      // The copy resumes from the folder the session ran in, since Claude Code finds a transcript by that folder.
      const recorded = (await readSession(summary)).cwd;
      const cwd = recorded && fs.existsSync(recorded) ? recorded : scope.base;
      // Asked in the panel, until the owner switches on Don't ask again.
      if (!answer.confirmed && !context.globalState.get<boolean>('analyzeRemembered')) return ask({ kind: 'analyze', scope: id, id: sessionId, cwd, live: !!summary.live });
      if (answer.remember) await context.globalState.update('analyzeRemembered', true);
      // The copy holds the main thread with each agent's report; the agents' own work is in their transcripts, so the
      // first message tells the copy where they are (a resumed session ignores --append-system-prompt). The message rides
      // the command line, so a path with a character a shell reads is left out.
      const agents = path.join(path.dirname(summary.file), summary.id, 'subagents').replace(/\\/g, '/');
      const hint = fs.existsSync(agents) && /^[\w .:/-]+$/.test(agents)
        ? ` "This is a copy of the session, opened so I can analyze it. The agents of the session wrote their transcripts to ${agents}, one agent-ID.jsonl per agent. When a question is about the work inside an agent, read that transcript a part at a time. Reply only: Ready."`
        : '';
      const env = summary.accountRoot && path.resolve(summary.accountRoot) !== path.resolve(global.root) ? { CLAUDE_CONFIG_DIR: summary.accountRoot } : undefined;
      const t = vscode.window.createTerminal({ name: `Analyze: ${summary.title.slice(0, 40)}`, cwd, env });
      t.show();
      t.sendText(`claude --resume ${summary.id} --fork-session${hint}`);
    },
    continueSession: async (id, sessionId, answer, ask) => {
      const scope = scopes.find(s => s.id === id && s.id !== global.id);
      const summary = scope ? findAccountSession(scope.base, accounts(), sessionId) : undefined;
      if (!scope || !summary) return void vscode.window.showErrorMessage('The session transcript is gone.');
      const recorded = (await readSession(summary)).cwd;
      const cwd = recorded && fs.existsSync(recorded) ? recorded : scope.base;
      if (!answer.confirmed && !context.globalState.get<boolean>('continueRemembered')) return ask({ kind: 'continue', scope: id, id: sessionId, cwd, live: !!summary.live });
      if (answer.remember) await context.globalState.update('continueRemembered', true);
      const env = summary.accountRoot && path.resolve(summary.accountRoot) !== path.resolve(global.root) ? { CLAUDE_CONFIG_DIR: summary.accountRoot } : undefined;
      const t = vscode.window.createTerminal({ name: `Continue: ${summary.title.slice(0, 40)}`, cwd, env });
      t.show();
      t.sendText(`claude --resume ${summary.id}`);
    },
    reviewAsset: async (id, answer, ask) => {
      const asset = find(id);
      if (!asset || !asset.file) return;
      const cwd = cwdOf(scopeOf(asset));
      if (!answer.confirmed && !context.globalState.get<boolean>('reviewRemembered')) return ask({ kind: 'review', id, name: asset.name, file: asset.file, cwd });
      if (answer.remember) await context.globalState.update('reviewRemembered', true);
      const what = (KINDS.find(k => k.kind === asset.kind)?.label ?? asset.kind).replace(/s$/, '').toLowerCase();
      const prompt = `Review the ${what} at ${asset.file}. Read it, check that it is clear, specific and consistent with the rest of the harness, and list what you would improve and why. Do not change the file until I agree.`;
      terminal(`Review: ${asset.name}`, cwd, `claude "${promptText(prompt)}"`);
    },
    consolidateAsset: async (id, answer, ask) => {
      const asset = find(id);
      if (!asset) return;
      const plan = planConsolidate(asset);
      if (plan.block) return void vscode.window.showInformationMessage(`${asset.name} cannot be consolidated. ${plan.block}`);
      const target = plan.targets.find(t => t.id === answer.target) ?? plan.targets[0];
      if (!target) return;
      // A destructive question: it asks every time, and a route the target's state no longer offers asks again.
      if (!answer.confirmed || !answer.route || !routesOf(target.state).includes(answer.route)) {
        const scope = scopeOf(asset);
        const careful = guardReasons(await guardInfo(scope.base));
        return ask({ kind: 'consolidate', id, name: asset.name, repo: scope.label, cwd: cwdOf(scope), targets: plan.targets, target: target.id, notes: plan.notes, careful: careful.length ? careful.join(', ') : undefined });
      }
      await consolidateRun(asset, target, answer.route);
    },
    tryAsset: async (id, answer, ask) => {
      const asset = find(id);
      if (!asset || !['agent', 'skill', 'command'].includes(asset.kind)) return;
      if (!answer.confirmed && !context.globalState.get<boolean>('tryRemembered')) return ask({ kind: 'try', id, name: asset.name, as: asset.kind as 'agent' | 'skill' | 'command', cwd: cwdOf(scopeOf(asset)) });
      if (answer.remember) await context.globalState.update('tryRemembered', true);
      const plugin = asset.scope.startsWith('plugin:') ? asset.scope.slice('plugin:'.length).split('@')[0] : /^plugin ([^ ]+) ·/.exec(asset.description)?.[1];
      const name = plugin ? `${plugin}:${asset.name}` : asset.name;
      if (!/^[\w.:-]+$/.test(name)) return void vscode.window.showErrorMessage(`${asset.name} has a name Claude cannot be started with.`);
      terminal(`Try: ${asset.name}`, cwdOf(scopeOf(asset)), asset.kind === 'agent' ? `claude --agent ${name}` : `claude "/${name}"`);
    },
    fixFinding: async (id, finding) => {
      const tools = await needTools();
      const repo = scopes.find(s => s.id === id && s.id !== global.id);
      if (!tools || !repo) return;
      const at = finding.file ? ` The finding is in ${finding.file}${finding.line ? ` at line ${finding.line}` : ''}.` : '';
      const prompt = `The harness standard check reports this finding: ${finding.text}${at} Fix this one finding and nothing else.`;
      terminal(`Fix: ${repo.label}`, repo.base, `claude "${promptText(prompt)}"`);
    },
    importSession: async id => {
      const scope = scopes.find(s => s.id === id && s.id !== global.id);
      if (!scope) return undefined;
      const picked = await vscode.window.showOpenDialog({ title: `Import a session transcript into ${scope.label}`, openLabel: 'Import', canSelectMany: false, filters: { 'Claude Code transcript': ['jsonl'] } });
      if (!picked?.[0]) return undefined;
      try {
        const { id: sessionId, existed } = importTranscript(picked[0].fsPath, scope.base, global.root);
        void vscode.window.showInformationMessage(existed ? `${scope.label} already has this session.` : `Imported the session into ${scope.label}. Resume it there with claude --resume ${sessionId}.`);
        return sessionId;
      } catch (e) {
        void vscode.window.showErrorMessage(`Could not import the transcript: ${(e as Error).message}`);
        return undefined;
      }
    },
    usage: async (id, build, progress) => {
      const asset = find(id);
      // A hook or hook script lists the sessions where it ran, from the hook counts of the same index.
      const fired = asset ? hookTarget(asset, views) : undefined;
      const target = fired ? undefined : asset ? targetOf(asset) : undefined;
      if (!target && !fired) return undefined;
      if (!build && !(await usageIndex.exists())) return { built: false };
      const list = accounts();
      // Progress at most four times a second, and none for a refresh that is over sooner.
      let shown = Date.now();
      const data = await usageIndex.refresh(
        list.map(a => a.root),
        p => {
          if (Date.now() - shown < 250) return;
          shown = Date.now();
          progress(p);
        },
        // Opening the tab always looks for new transcripts; a repaint of the page does not within 3 s of the last look.
        build ? 0 : 3000
      );
      const repos = repoViews().map(v => ({ id: v.id, label: v.label, path: v.path }));
      return { sessions: fired ? hookRows(data, fired, repos, list) : usageRows(data, target!, repos, list) };
    },
    repoTrace: id => {
      const view = viewOfScope(id);
      return repoTrace(view && view.id !== global.id ? listAccountSessions(view.path, accounts()) : []);
    },
    modActivity: id => {
      const asset = find(id);
      const short = asset?.kind === 'plugin' ? asset.name.split('@')[0] : '';
      const sessions = repoViews().flatMap(v => listAccountSessions(v.path, accounts()));
      return modActivity(eventSources.find(s => s.plugin === short), eventSources, sessions);
    },
    usageMore: async (id, build, progress) => {
      const asset = find(id);
      const target = asset ? targetOf(asset) : undefined;
      if (!target) return undefined;
      const data = await usageData(build, progress);
      return data ? { more: usageMore(data, target) } : { built: false };
    },
    hunt: huntHost({
      state: context.globalState,
      root: () => global.root,
      views: () => views,
      plugins: () => plugins,
      keep: () => provider?.keepCopies,
      refresh,
      consolidate: (id, answer, ask) => host.consolidateAsset!(id, answer, ask),
    }),
    usageTotals: async (kind, build) => {
      if (kind !== 'agent' && kind !== 'skill' && kind !== 'command') return undefined;
      const data = await usageData(!!build);
      if (!data) return undefined;
      const targets = assets()
        .filter(a => a.kind === kind)
        .flatMap(a => {
          const target = targetOf(a);
          // An own skill of a repo is listed only in that repo's sessions.
          const dir = a.scope !== global.id && a.source !== 'plugin' ? views.find(v => v.id === a.scope)?.path : undefined;
          return target ? [{ id: a.id, target, dir }] : [];
        });
      return usageTotals(data, targets, kind === 'skill');
    },
    slim: id => {
      const asset = find(id);
      if (!asset || asset.kind !== 'skill' || !asset.dir) return undefined;
      return skillReport(asset);
    },
    slimAsset: async (id, answer, ask) => {
      const asset = find(id);
      if (!asset || asset.kind !== 'skill' || !asset.dir) return;
      const report = skillReport(asset);
      const cwd = cwdOf(scopeOf(asset));
      const files = asset.files ?? [];
      if (!answer.confirmed && !context.globalState.get<boolean>('slimRemembered')) return ask({ kind: 'slim', id, name: asset.name, file: asset.file, cwd, files: files.length, findings: report.findings });
      if (answer.remember) await context.globalState.update('slimRemembered', true);
      terminal(`Slim: ${asset.name}`, cwd, `claude "${promptText(slimPrompt(report, asset.file, files, !!provider))}"`);
    },
  };

  const guard = async (dirs: string[], title: string): Promise<string[] | undefined> => {
    const infos = await Promise.all(dirs.map(d => guardInfo(d)));
    const items = infos.map(g => {
      const reasons = guardReasons(g);
      return { label: `${reasons.length ? '$(warning)' : '$(repo)'} ${path.basename(g.dir)}`, description: reasons.join(' · ') || 'clean', detail: g.dir, picked: !reasons.length, dir: g.dir };
    });
    if (items.length === 1 && items[0].picked) return dirs;
    const picked = await vscode.window.showQuickPick(items, { canPickMany: true, title, placeHolder: 'Repos with uncommitted harness files, a busy Claude session or stale worktree copies are unticked. Tick one to include it anyway.' });
    return picked?.map(p => p.dir);
  };

  const needTools = async () => {
    const tools = await constitution.tools();
    if (!tools.provider || tools.error) {
      void vscode.window.showInformationMessage(`${tools.error ?? NO_PROVIDER} This command is off.`);
      return undefined;
    }
    return { plugin: tools.provider, py: tools.py };
  };

  const repoOfArg = (arg: unknown): HarnessScope | undefined => {
    const id = typeof arg === 'string' ? arg : arg && typeof arg === 'object' ? ((arg as { scope?: string }).scope ?? ((arg as Node).type === 'repo' ? (arg as Extract<Node, { type: 'repo' }>).view.id : undefined)) : undefined;
    const scope = scopes.find(s => s.id === id);
    return scope && scope.id !== global.id ? scope : undefined;
  };

  const pickRepos = async (title: string, preselect: (v: ScopeView) => boolean = () => false) => {
    const items = repoViews().map(v => ({ label: `$(repo) ${v.label}`, description: v.path, picked: preselect(v), dir: v.path }));
    return (await vscode.window.showQuickPick(items, { canPickMany: true, title, matchOnDescription: true }))?.map(i => i.dir);
  };

  const previewEdits = async (edits: FileEdit[], title: string) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-edit-'));
    for (const [i, e] of edits.slice(0, 8).entries()) {
      const after = path.join(temp, `${i}-${path.basename(e.file)}`);
      fs.writeFileSync(after, e.after, 'utf8');
      await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(e.file), vscode.Uri.file(after), `${title}: ${path.basename(path.dirname(path.dirname(e.file)))}/${path.basename(e.file)} (now ↔ after)`, { preview: false });
    }
  };

  const backupRoot = () => path.join(global.root, 'repo-sync-backups');

  const assetOf = (arg: unknown): Asset | undefined => {
    if (typeof arg === 'string') return find(arg);
    const fromPanel = panelArg(arg);
    if (fromPanel) return fromPanel.id ? find(fromPanel.id) : undefined;
    const node = arg as Node | undefined;
    return node && (node.type === 'asset' || node.type === 'file') ? node.asset : undefined;
  };

  /** A copy a plugin ships is overwritten on update: it is not renamed, duplicated in place or deleted. Says so and returns true. */
  const readOnlyCopy = (asset: Asset, what: string) => {
    if (asset.kind === 'plugin' || !isPluginCopy(asset)) return false;
    void vscode.window.showInformationMessage(`${asset.name} comes from a plugin and cannot be ${what}: an update overwrites the installed copy.`);
    return true;
  };

  const askName = async (prompt: string, value?: string) =>
    vscode.window.showInputBox({ prompt, value, validateInput: v => validateName(v.replace(/:/g, '-')) });

  const run = (fn: () => void) => {
    try {
      fn();
      refresh();
      return true;
    } catch (e) {
      void vscode.window.showErrorMessage((e as Error).message);
      return false;
    }
  };

  const terminal = (name: string, cwd: string, text: string) => {
    const t = vscode.window.createTerminal({ name, cwd });
    t.show();
    t.sendText(text);
  };

  /** A destructive question: a card in the panel when the webview started the command, the modal dialog from the nav or a tree menu. */
  const askFirst = async (arg: unknown, card: { key: string; title: string; sub: string; facts: string[]; action: string }, modal: () => Thenable<string | undefined>): Promise<boolean> => {
    const inPanel = panelArg(arg) ? HarnessPanel.ask({ ...card, glyph: 'trash', danger: true }) : undefined;
    return inPanel ? (await inPanel) === 'ok' : (await modal()) === card.action;
  };

  const cwdOf = (scope: HarnessScope) => (scope.id === global.id ? os.homedir() : scope.base);

  /** The id a sync command starts from: a string, the webview's argument, the row's right-click context or a tree node. */
  const syncAsset = (arg: unknown): Asset | undefined => {
    const row = arg && typeof arg === 'object' && 'assetId' in arg ? String((arg as { assetId: unknown }).assetId) : undefined;
    return row ? find(row) : assetOf(arg);
  };

  /** A sync question: a card in the panel pointing at what was pressed, the modal dialog from the palette or a tree menu. */
  const askSync = async (arg: unknown, card: { title: string; sub: string; facts: string[]; action: string }): Promise<boolean> => {
    const inPanel = panelArg(arg) || (arg && typeof arg === 'object' && 'assetId' in arg) ? HarnessPanel.ask({ key: 'click', glyph: 'sync', ...card }) : undefined;
    return inPanel ? (await inPanel) === 'ok' : (await vscode.window.showWarningMessage(card.title, { modal: true, detail: card.facts.join('\n') }, card.action)) === card.action;
  };

  const fileList = (label: string, files: string[]) => (files.length ? [`${label}: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ` and ${files.length - 8} more` : ''}`] : []);

  /** A repo skill or agent that differs from its Global copy is overwritten with the Global version, the repo copy backed up first. */
  const syncFromGlobal = async (arg: unknown) => {
    const asset = syncAsset(arg);
    if (!asset) return;
    const scope = scopeOf(asset);
    const { source, block } = syncSource(asset, scope.id === global.id ? undefined : scope.base);
    const from = source && find(source.id);
    if (block || !from) return void vscode.window.showInformationMessage(`${asset.name} cannot be synced from Global. ${block ?? 'The Global copy is not in the list.'}`);
    const files = syncFiles(asset, from);
    const stamp = backupStamp();
    const dest = path.join(backupRoot(), stamp, path.basename(scope.base), path.relative(scope.base, asset.dir ?? asset.file));
    const reasons = guardReasons(await guardInfo(scope.base));
    const facts = [
      `Overwrites the ${asset.kind} in ${scope.label} with the Global version.`,
      ...fileList('Replaced', files.replaced),
      ...fileList('Added', files.added),
      ...fileList('Deleted', files.deleted),
      `Backup: ${dest}`,
      ...(reasons.length ? [`Careful: ${reasons.join(', ')}.`] : []),
    ];
    if (!(await askSync(arg, { title: `Sync ${asset.name} in ${scope.label} from Global?`, sub: 'Backed up first, then overwritten', facts, action: 'Sync' }))) return;
    if (run(() => syncApply(asset, from, scope.base, backupRoot(), stamp))) {
      constitution.ensure([scope.base], true);
      void vscode.window.showInformationMessage(`Synced ${asset.name} in ${scope.label} from Global. Backup: ${dest}`);
    }
  };

  /** A plugin whose marketplace source is ahead of the installed copy is refreshed and updated with the Claude Code CLI. */
  const syncPluginCommand = async (arg: unknown) => {
    const panel = arg && typeof arg === 'object' ? (arg as { plugin?: string }) : undefined;
    const key = panel?.plugin ?? (typeof arg === 'string' ? arg : syncAsset(arg)?.name);
    const market = marketplaceHealth(global.root).find(m => m.plugins.some(p => p.key === key));
    const plugin = market?.plugins.find(p => p.key === key);
    if (!key || !market || !plugin) return void vscode.window.showInformationMessage(`${key ?? 'That plugin'} is not in a registered marketplace.`);
    if (!plugin.ahead) return void vscode.window.showInformationMessage(`${plugin.name} is current: its marketplace source is not ahead of the installed ${plugin.installed ?? 'copy'}.`);
    const facts = [`Installed: ${plugin.installed}`, `Source in ${market.name}: ${plugin.source}`, `Runs claude plugin marketplace update ${market.name}, then claude plugin update ${key}.`, 'Claude Code sessions that are open pick it up after a restart.'];
    if (!(await askSync(arg, { title: `Sync ${plugin.name} from ${market.name}?`, sub: `${plugin.installed} to ${plugin.source}`, facts, action: 'Sync plugin' }))) return;
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Syncing ${plugin.name} from ${market.name}` }, () => updatePluginFromMarket(key, market.name, plugin.source, global.root));
      refresh();
      HarnessPanel.post({ type: 'marketplaces', list: marketplaceHealth(global.root) });
      void vscode.window.showInformationMessage(`${plugin.name} is now ${plugin.source}. Restart Claude Code sessions to use it.`);
    } catch (e) {
      void vscode.window.showErrorMessage((e as Error).message);
    }
  };

  /** One MCP server name configured differently in several files: the owner picks the version, and that entry is written into the other files. */
  const syncMcp = async (arg: unknown) => {
    const asset = syncAsset(arg);
    if (!asset || asset.kind !== 'mcp') return;
    const labelOf = (a: Asset) => `${scopeOf(a).label}${a.source === 'local' ? ' (local config)' : ''}`;
    const seen = new Set<string>();
    const peers = assets().filter(a => {
      const key = `${a.file}|${a.jsonPath?.join('/')}`;
      if (a.kind !== 'mcp' || a.name !== asset.name || !a.file || !a.jsonPath || seen.has(key)) return false;
      return seen.add(key), true;
    });
    const versions = mcpVersions(peers);
    if (versions.length < 2) return void vscode.window.showInformationMessage(`${asset.name} is configured the same in ${peers.length === 1 ? 'its one file' : `all ${peers.length} files`}. Nothing to sync.`);
    const summary = (c: Record<string, unknown>) => (typeof c.url === 'string' ? c.url : [c.command, ...(Array.isArray(c.args) ? c.args : [])].filter(Boolean).join(' '));
    const choices = versions.map((v, i) => ({ id: String(i), label: v.assets.map(labelOf).join(', '), note: summary(v.config) }));
    let kept: number | undefined;
    const pick = panelArg(arg) || (arg && typeof arg === 'object' && 'assetId' in arg)
      ? HarnessPanel.askFull({ key: 'click', glyph: 'sync', title: `Keep which version of ${asset.name}?`, sub: `${versions.length} different configurations in ${peers.length} files`, facts: [], action: 'Continue', choices })
      : undefined;
    if (pick) {
      const answer = await pick;
      kept = answer.choice === 'ok' && answer.picked?.length ? Number(answer.picked[0]) : undefined;
    } else {
      const chosen = await vscode.window.showQuickPick(choices.map(c => ({ label: c.label, description: c.note, id: Number(c.id) })), { title: `Keep which version of ${asset.name}?` });
      kept = chosen?.id;
    }
    if (kept === undefined) return;
    const keep = versions[kept];
    const writes = versions
      .filter((_, i) => i !== kept)
      .flatMap(v => v.assets.map(a => ({ asset: a, label: labelOf(a), keys: keyChanges(keep.config, mcpConfig(a) ?? {}) })));
    const stamp = backupStamp();
    const facts = [
      `Writes the ${keep.assets.map(labelOf).join(', ')} entry of ${asset.name} into ${writes.length} ${writes.length === 1 ? 'file' : 'files'}.`,
      ...writes.flatMap(w => [`${w.label}: ${w.asset.file}`, `Changes: ${w.keys.join(', ') || 'no keys'}`]),
      'Every other entry and the file formatting stay.',
      `Backup: ${path.join(backupRoot(), stamp, 'mcp')}`,
    ];
    if (!(await askSync(arg, { title: `Sync ${asset.name} to the other copies?`, sub: 'Backed up first, then one entry replaced per file', facts, action: 'Sync' }))) return;
    if (run(() => mcpApply(keep.config, writes, backupRoot(), stamp))) void vscode.window.showInformationMessage(`Synced ${asset.name} into ${writes.length} ${writes.length === 1 ? 'file' : 'files'}. Backup: ${path.join(backupRoot(), stamp, 'mcp')}`);
  };

  /** Where a repo skill can be consolidated to, and why it cannot be. */
  const planConsolidate = (asset: Asset) => {
    const scope = scopeOf(asset);
    return consolidatePlan(asset, scope.id === global.id ? undefined : scope.base, global.root, provider?.keepCopies);
  };

  /** Carries out a route of the Consolidate card or dialog: the diff editor, a terminal with Claude, or the move or retire. */
  const consolidateRun = async (asset: Asset, target: ConsolidateTarget, route: ConsolidateRoute) => {
    const scope = scopeOf(asset);
    if (!routesOf(target.state).includes(route)) return;
    if (route === 'diff') {
      // The repo copy on the left, the target on the right: what the owner keeps goes into the right-hand file.
      let opened = 0;
      for (const rel of [...target.changed, ...target.repoOnly]) {
        if (opened++ >= 8) break;
        const left = vscode.Uri.file(path.join(asset.dir!, ...rel.split('/')));
        if (target.repoOnly.includes(rel)) await vscode.commands.executeCommand('vscode.open', left, { preview: false });
        else await vscode.commands.executeCommand('vscode.diff', left, vscode.Uri.file(path.join(target.dir, ...rel.split('/'))), `${asset.name}/${rel} (${scope.label} ↔ ${target.label})`, { preview: false });
      }
      const only = target.repoOnly.length ? ` ${target.repoOnly.join(', ')} ${target.repoOnly.length === 1 ? 'is' : 'are'} only in the repo copy: copy ${target.repoOnly.length === 1 ? 'it' : 'them'} to ${target.dir}.` : '';
      void vscode.window.showInformationMessage(`Bring what you want to keep into ${target.label}, on the right.${only} Then run Consolidate on ${asset.name} again to retire the repo copy.`);
    } else if (route === 'claude') {
      // The prompt first: --add-dir takes every argument after it as a folder.
      const add = /^[\w .:\\/-]+$/.test(target.dir) ? ` --add-dir "${target.dir}"` : '';
      terminal(`Consolidate: ${asset.name}`, cwdOf(scope), `claude "${promptText(mergePrompt(asset, target))}"${add}`);
      void vscode.window.showInformationMessage(`Claude merges ${asset.name} into ${target.label} in the terminal. When it is done, run Consolidate on ${asset.name} again to retire the repo copy.`);
    } else {
      const stamp = backupStamp();
      try {
        const backup = consolidateApply(asset, scope.base, target, route, backupRoot(), stamp);
        refresh();
        constitution.ensure([scope.base], true);
        void vscode.window.showInformationMessage(`${route === 'move' ? `Moved ${asset.name} to ${target.label}` : `Retired the copy of ${asset.name} in ${scope.label}`}. Backup: ${backup}`);
      } catch (e) {
        void vscode.window.showErrorMessage((e as Error).message);
      }
    }
  };

  /** The size and spread of a skill, measured from its files on disk. The house rule on descriptions applies only with a provider. */
  const skillReport = (asset: Asset): SlimReport => {
    const doc = readMarkdown(asset.file);
    const description = typeof doc.data.description === 'string' ? doc.data.description : asset.description;
    const dir = asset.dir ?? path.dirname(asset.file);
    const read = (rel: string) => {
      try {
        return fs.readFileSync(path.join(dir, rel), 'utf8');
      } catch {
        return undefined;
      }
    };
    return analyzeSkill({ id: asset.id, name: asset.name, description, body: doc.body, files: asset.files ?? [], read, house: !!provider });
  };

  type ScopeItem = vscode.QuickPickItem & { scope: HarnessScope };
  const pickScope = async (arg: unknown, title: string, globalLabel = 'Global'): Promise<HarnessScope | undefined> => {
    const given = arg && typeof arg === 'object' && 'scope' in arg ? scopes.find(s => s.id === (arg as { scope?: string }).scope) : undefined;
    if (given) return given;
    if (arg && typeof arg === 'object' && 'type' in arg) return global;
    const items: ScopeItem[] = [
      ...scopes.filter(s => s.id !== global.id).map(s => ({ label: `$(repo) ${s.label}`, description: s.base, scope: s })),
      { label: `$(globe) ${globalLabel}`, scope: global },
    ];
    return (await vscode.window.showQuickPick(items, { title, matchOnDescription: true }))?.scope;
  };

  const scopeFlag = (asset: Asset): 'user' | 'project' | 'local' => (asset.source === 'project' ? 'project' : asset.source === 'local' ? 'local' : 'user');

  const showFile = (file: string) => {
    const asset = assets().find(a => a.file === file);
    if (asset) HarnessPanel.show(context, host, asset.id);
  };

  const status = vscode.window.createStatusBarItem('claudeHarness.status', vscode.StatusBarAlignment.Left, 0);
  status.name = 'Claude Harness';
  status.text = '$(hubot) Claude Harness';
  status.tooltip = 'Open the Claude harness';
  status.command = 'claudeHarness.open';
  status.show();

  const toolLenses: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: lensesChanged.event,
    provideCodeLenses: doc => {
      if (!assetOfFile(doc.uri.fsPath) || doc.lineAt(0).text.trim() !== '---') return [];
      const lenses: vscode.CodeLens[] = [];
      for (let i = 1; i < doc.lineCount; i++) {
        const line = doc.lineAt(i).text;
        if (line.trim() === '---') break;
        const key = /^([A-Za-z-]+)\s*:/.exec(line)?.[1];
        if (key && TOOL_FIELDS.includes(key))
          lenses.push(new vscode.CodeLens(doc.lineAt(i).range, { title: 'Configure Tools...', command: 'claudeHarness.configureTools', arguments: [doc.uri, key] }));
      }
      return lenses;
    },
  };

  context.subscriptions.push(
    ...registerShare({ root: () => global.root, scopes: () => scopes, assetOf, refresh, backupRoot }),
    ...registerDistributor({
      root: () => global.root,
      skills: () => (views.find(v => v.id === global.id)?.categories.find(c => c.kind === 'skill')?.items ?? []).filter(a => a.source !== 'plugin'),
      repos: () => repoViews().map(v => ({ label: v.label, path: v.path })),
      find: assetOf,
      refresh,
      backupRoot,
    }),
    status,
    lensesChanged,
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'markdown', scheme: 'file' },
        // VS Code gives these files other languages (Agent, Prompt), so match by path too
        ...['**/agents/**/*.md', '**/commands/**/*.md', '**/skills/**/SKILL.md', '**/output-styles/**/*.md'].map(pattern => ({ scheme: 'file', pattern })),
      ],
      toolLenses
    ),
    vscode.commands.registerCommand('claudeHarness.configureTools', async (uri: vscode.Uri, key: string) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      const tools = await pickTools(views, assetOfFile(uri.fsPath), splitTools(parseMarkdown(doc.getText()).data[key]));
      if (!tools) return;
      const old = doc.getText();
      const next = setFrontmatterList(old, key, tools);
      if (next === old) return;
      let start = 0;
      while (start < old.length && start < next.length && old[start] === next[start]) start++;
      let end = 0;
      while (end < old.length - start && end < next.length - start && old[old.length - 1 - end] === next[next.length - 1 - end]) end++;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(start), doc.positionAt(old.length - end)), next.slice(start, next.length - end));
      await vscode.workspace.applyEdit(edit);
    }),
    vscode.window.createTreeView('claudeHarness.tree', { treeDataProvider: tree, showCollapseAll: true }),
    { dispose: () => watcher?.dispose() },
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeHarness.repoFolders') || e.affectsConfiguration('claudeHarness.removedRepos')) {
        loadScopes();
        refresh();
      }
      if (e.affectsConfiguration('claudeHarness.accounts') || e.affectsConfiguration('claudeHarness.plan') || e.affectsConfiguration('claudeHarness.weekStart')) refresh();
      if (!e.affectsConfiguration('claudeHarness.root')) return;
      global = globalScope(vscode.workspace.getConfiguration('claudeHarness').get<string>('root'));
      loadScopes();
      watch();
      refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      loadScopes();
      refresh();
    }),

    vscode.commands.registerCommand('claudeHarness.open', (id?: string) => HarnessPanel.show(context, host, typeof id === 'string' ? id : undefined)),
    vscode.commands.registerCommand('claudeHarness.addRepo', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: true,
        openLabel: 'Add Repo',
        title: 'Add a repo folder, or a parent folder that holds several repos',
      });
      if (!picked?.length) return;
      const config = vscode.workspace.getConfiguration('claudeHarness');
      const current = config.get<string[]>('repoFolders') ?? [];
      const next = [...current];
      for (const uri of picked) if (!next.some(f => samePath(f, uri.fsPath))) next.push(uri.fsPath);
      const before = scopes.length;
      const removed = config.get<string[]>('removedRepos') ?? [];
      const keep = removed.filter(r => !picked.some(uri => samePath(r, uri.fsPath) || samePath(path.dirname(r), uri.fsPath)));
      if (keep.length !== removed.length) await config.update('removedRepos', keep, vscode.ConfigurationTarget.Global);
      await config.update('repoFolders', next, vscode.ConfigurationTarget.Global);
      loadScopes();
      refresh();
      const found = scopes.length - before;
      void vscode.window.showInformationMessage(
        found ? `Added ${found} ${found === 1 ? 'repo' : 'repos'} to the Claude harness.` : 'No new repo with a .claude folder or a CLAUDE.md found there.'
      );
    }),
    vscode.commands.registerCommand('claudeHarness.removeRepo', async (arg?: string | { scope?: string }) => {
      const config = vscode.workspace.getConfiguration('claudeHarness');
      const folders = config.get<string[]>('repoFolders') ?? [];
      let targets: { dir: string; folder: boolean }[];
      // A repo row's menu in the panel hands over { scope: <repo id> }.
      const id = arg && typeof arg === 'object' ? arg.scope : arg;
      const repo = typeof id === 'string' ? scopes.find(s => s.id === id && s.id !== global.id) : undefined;
      if (repo) targets = [{ dir: repo.base, folder: false }];
      else {
        type Item = vscode.QuickPickItem & { dir?: string; folder?: boolean };
        const items: Item[] = [];
        if (folders.length) items.push({ label: 'Added folders', kind: vscode.QuickPickItemKind.Separator }, ...folders.map(f => ({ label: `$(folder) ${path.basename(f)}`, description: f, dir: f, folder: true })));
        const repos = scopes.filter(s => s.id !== global.id);
        if (repos.length) items.push({ label: 'Repositories', kind: vscode.QuickPickItemKind.Separator }, ...repos.map(s => ({ label: `$(repo) ${s.label}`, description: s.base, dir: s.base, folder: false })));
        const picked = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Remove from the Claude harness', placeHolder: 'Pick repos or added parent folders. Nothing is deleted on disk.', matchOnDescription: true });
        if (!picked?.length) return;
        targets = picked.map(p => ({ dir: p.dir!, folder: !!p.folder }));
      }
      const nextFolders = folders.filter(f => !targets.some(t => samePath(t.dir, f)));
      const removed = config.get<string[]>('removedRepos') ?? [];
      const nextRemoved = [...removed, ...targets.filter(t => !t.folder && !folders.some(f => samePath(f, t.dir)) && !removed.some(r => samePath(r, t.dir))).map(t => t.dir)];
      const before = scopes.length;
      if (nextFolders.length !== folders.length) await config.update('repoFolders', nextFolders, vscode.ConfigurationTarget.Global);
      if (nextRemoved.length !== removed.length) await config.update('removedRepos', nextRemoved, vscode.ConfigurationTarget.Global);
      loadScopes();
      refresh();
      const gone = before - scopes.length;
      void vscode.window.showInformationMessage(`Removed ${gone} ${gone === 1 ? 'repo' : 'repos'} from the Claude harness. Nothing was deleted on disk.`);
    }),
    vscode.commands.registerCommand('claudeHarness.refresh', () => {
      loadScopes();
      refresh();
      loadCliServers();
    }),

    vscode.commands.registerCommand('claudeHarness.create', async (arg?: unknown) => {
      const node = arg as Node | { kind?: Kind; scope?: string } | undefined;
      let kind: Kind | undefined = node && 'type' in node ? (node.type === 'category' ? node.category.kind : undefined) : node?.kind;
      const scope = scopes.find(s => s.id === (node && !('type' in node) ? node.scope : undefined)) ?? global;
      if (!kind) {
        const pick = await vscode.window.showQuickPick(
          KINDS.filter(k => k.creatable).map(k => ({ label: `$(${k.icon}) ${k.label}`, harnessKind: k.kind })),
          { placeHolder: `What do you want to create in ${scope.label}?` }
        );
        kind = pick?.harnessKind;
      }
      if (!kind) return;
      const name = await askName(`Name of the new ${KINDS.find(k => k.kind === kind)!.label.replace(/s$/, '').toLowerCase()} in ${scope.label}`);
      if (!name) return;
      let file = '';
      if (run(() => (file = createAsset(scope, kind!, name)))) showFile(file);
    }),

    vscode.commands.registerCommand('claudeHarness.openFile', async (arg?: unknown) => {
      const node = arg as Node | undefined;
      const file = node && typeof node === 'object' && node.type === 'file' ? node.file : assetOf(arg)?.file;
      if (file) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
    }),

    vscode.commands.registerCommand('claudeHarness.reveal', async (arg?: unknown) => {
      const node = arg as Node | undefined;
      // A repo row's menu in the panel hands over the repo's folder.
      const folder = arg && typeof arg === 'object' && 'repoPath' in arg ? String((arg as { repoPath: unknown }).repoPath) : undefined;
      const file = folder ?? (node && typeof node === 'object' && node.type === 'file' ? node.file : assetOf(arg)?.dir ?? assetOf(arg)?.file);
      if (file) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
    }),

    vscode.commands.registerCommand('claudeHarness.rename', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      if (readOnlyCopy(asset, 'renamed')) return;
      const name = await askName(`Rename ${asset.name} to`, asset.name);
      if (!name || name === asset.name) return;
      let file = '';
      if (run(() => (file = renameAsset(scopeOf(asset), asset, name)))) showFile(file);
    }),

    vscode.commands.registerCommand('claudeHarness.duplicate', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      if (readOnlyCopy(asset, 'duplicated in place')) return;
      const name = await askName(`Name of the copy of ${asset.name}`, `${asset.name}-copy`);
      if (!name) return;
      let file = '';
      if (run(() => (file = duplicateAsset(scopeOf(asset), asset, name)))) showFile(file);
    }),

    vscode.commands.registerCommand('claudeHarness.compare', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      if (!asset.copies?.length) {
        void vscode.window.showInformationMessage(`${asset.name} has no copy in another scope.`);
        return;
      }
      const copy =
        asset.copies.length === 1
          ? asset.copies[0]
          : (await vscode.window.showQuickPick(
              asset.copies.map(c => ({ label: c.label, description: c.same ? 'identical' : 'differs', detail: c.file, copy: c })),
              { title: `Compare ${asset.name} with` }
            ))?.copy;
      if (!copy) return;
      const label = views.find(v => v.id === asset.scope)?.label ?? asset.scope;
      await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(asset.file), vscode.Uri.file(copy.file), `${asset.name}: ${label} ↔ ${copy.label}`);
    }),

    vscode.commands.registerCommand('claudeHarness.delete', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      if (readOnlyCopy(asset, 'deleted')) return;
      if (asset.kind === 'mcp') {
        if (!asset.file || !asset.jsonPath) return;
        const sureMcp = await askFirst(
          arg,
          { key: 'delete', title: `Delete the MCP server ${asset.name}?`, sub: 'Removes its entry from the config file', facts: [`Edits ${asset.file}.`], action: 'Delete' },
          () => vscode.window.showWarningMessage(`Delete the MCP server ${asset.name}?`, { modal: true, detail: asset.file }, 'Delete')
        );
        if (sureMcp) run(() => removeJsonEntry(asset.file, asset.jsonPath!));
        return;
      }
      const target = asset.dir ?? asset.file;
      const sureTrash = await askFirst(
        arg,
        { key: 'delete', title: `Move ${asset.name} to the trash?`, sub: 'You can restore it from the trash', facts: [target], action: 'Move to Trash' },
        () => vscode.window.showWarningMessage(`Move ${asset.name} to the trash?`, { modal: true, detail: target }, 'Move to Trash')
      );
      if (!sureTrash) return;
      await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: true, useTrash: true });
      refresh();
    }),

    vscode.commands.registerCommand('claudeHarness.addMcp', async (arg?: unknown) => {
      const scope = await pickScope(arg, 'Add the MCP server to');
      if (!scope) return;
      const name = await vscode.window.showInputBox({
        prompt: `Name of the new MCP server in ${scope.label}`,
        validateInput: v => (MCP_NAME.test(v) ? undefined : 'Letters, digits, dots, dashes and underscores; starts with a letter or digit.'),
      });
      if (!name) return;
      const kind = await vscode.window.showQuickPick(
        [
          { label: '$(terminal) Local command', stdio: true },
          { label: '$(globe) HTTP URL', stdio: false },
        ],
        { title: `How does Claude reach ${name}?` }
      );
      if (!kind) return;
      const value = await vscode.window.showInputBox(
        kind.stdio
          ? { prompt: 'Command line', placeHolder: 'npx -y @example/mcp-server', validateInput: v => (v.trim() ? undefined : 'Enter a command.') }
          : { prompt: 'URL', placeHolder: 'https://example.com/mcp', validateInput: v => (/^https?:\/\//.test(v.trim()) ? undefined : 'Starts with http:// or https://') }
      );
      if (!value) return;
      const [command, ...args] = splitCommandLine(value.trim());
      const server: McpConfig = kind.stdio ? { type: 'stdio', command, args, env: {} } : { type: 'http', url: value.trim() };
      if (!run(() => addMcpServer(scope.mcpFile, name, server))) return;
      const added = assets().find(a => a.kind === 'mcp' && a.scope === scope.id && a.name === name);
      if (added) HarnessPanel.show(context, host, added.id);
    }),

    vscode.commands.registerCommand('claudeHarness.copyMcpAdd', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (asset?.kind !== 'mcp') return;
      if (asset.source === 'claude.ai' || asset.source === 'plugin') {
        void vscode.window.showInformationMessage(`${asset.name} comes from ${asset.source === 'plugin' ? 'a plugin' : 'claude.ai'}, so there is no claude mcp add command for it.`);
        return;
      }
      let config: McpConfig;
      if (asset.file && asset.jsonPath) config = (jsonAt(asset.file, asset.jsonPath) ?? {}) as McpConfig;
      else if (/^https?:\/\//.test(asset.target ?? '')) config = { type: 'http', url: asset.target };
      else {
        const [command, ...args] = splitCommandLine(asset.target ?? '');
        config = { command, args };
      }
      const text = mcpAddCommand(asset.name, config, scopeFlag(asset));
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage(`$(check) Copied: ${text}`, 4000);
    }),

    vscode.commands.registerCommand('claudeHarness.openClaude', async (arg?: unknown) => {
      const scope = await pickScope(arg, 'Open Claude in', 'Home folder');
      if (scope) terminal(`Claude: ${scope.id === global.id ? 'home' : scope.label}`, cwdOf(scope), 'claude');
    }),

    vscode.commands.registerCommand('claudeHarness.installPlugin', async (arg?: unknown) => {
      const installed = new Set(views.flatMap(v => v.categories.find(c => c.kind === 'plugin')?.items ?? []).map(a => a.name));
      const items = marketplacePlugins(global.root)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(p => ({ label: p.key, description: installed.has(p.key) ? 'installed' : '', detail: p.description }));
      if (!items.length) {
        void vscode.window.showInformationMessage('No marketplace catalog found. Add one with claude plugin marketplace add first.');
        return;
      }
      const plugin = await vscode.window.showQuickPick(items, { title: 'Install a plugin', matchOnDescription: true, matchOnDetail: true });
      if (!plugin) return;
      const scope = await pickScope(arg, `Install ${plugin.label} for`, 'You, in every folder');
      if (!scope) return;
      terminal(`Install ${plugin.label}`, cwdOf(scope), `claude plugin install ${plugin.label} --scope ${scope.id === global.id ? 'user' : 'project'}`);
    }),

    vscode.commands.registerCommand('claudeHarness.uninstallPlugin', async (arg?: unknown) => {
      let asset = assetOf(arg);
      if (asset?.kind !== 'plugin') {
        const items = views.flatMap(v => (v.categories.find(c => c.kind === 'plugin')?.items ?? []).map(a => ({ label: a.name, description: v.label, detail: a.description, asset: a })));
        asset = (await vscode.window.showQuickPick(items, { title: 'Uninstall a plugin', matchOnDescription: true }))?.asset;
      }
      if (!asset) return;
      const scope = scopeOf(asset);
      const where = scope.id === global.id ? 'your user scope' : scope.label;
      const sureUninstall = await askFirst(
        arg,
        { key: 'uninstall', title: `Uninstall ${asset.name} from ${where}?`, sub: 'Runs claude plugin uninstall in a terminal', facts: [`Removes the plugin from ${where}.`], action: 'Uninstall' },
        () => vscode.window.showWarningMessage(`Uninstall ${asset.name} from ${where}?`, { modal: true }, 'Uninstall')
      );
      if (!sureUninstall) return;
      terminal(`Uninstall ${asset.name}`, cwdOf(scope), `claude plugin uninstall ${asset.name} --scope ${scope.id === global.id ? 'user' : 'project'}`);
    }),

    vscode.commands.registerCommand('claudeHarness.openSettings', async () => {
      const items = views.flatMap(v =>
        (v.categories.find(c => c.kind === 'settings')?.items ?? []).map(a => ({ label: `$(settings-gear) ${a.name}`, description: v.label, detail: a.file, asset: a }))
      );
      if (!items.length) {
        void vscode.window.showInformationMessage('No settings.json or settings.local.json found.');
        return;
      }
      const pick = await vscode.window.showQuickPick(items, { title: 'Open a settings file', matchOnDescription: true, matchOnDetail: true });
      if (pick) HarnessPanel.show(context, host, pick.asset.id);
    }),

    vscode.commands.registerCommand('claudeHarness.toggleMcp', (arg?: unknown) => {
      const asset = assetOf(arg);
      if (asset?.kind !== 'mcp') return;
      const repo = asset.scope === global.id ? undefined : scopeOf(asset).base;
      run(() => setMcpEnabled(global.userConfig, asset, repo, !asset.enabled));
    }),
    vscode.commands.registerCommand('claudeHarness.openConnectors', () => vscode.env.openExternal(vscode.Uri.parse('https://claude.ai/new#customize/connectors/yours'))),
    vscode.commands.registerCommand('claudeHarness.togglePlugin', (arg?: unknown) => {
      const asset = assetOf(arg);
      if (asset?.kind === 'plugin') run(() => setPluginEnabled(scopeOf(asset), asset.name, !asset.enabled));
    }),

    constitution,
    checksChanged,
    vscode.workspace.onDidSaveTextDocument(doc => {
      const repo = harnessFileOf(doc.uri.fsPath);
      if (repo) constitution.ensure([repo.path]);
    }),
    vscode.workspace.onDidOpenTextDocument(doc => {
      const repo = doc.uri.scheme === 'file' && path.basename(doc.uri.fsPath) === 'CLAUDE.md' ? harnessFileOf(doc.uri.fsPath) : undefined;
      if (repo) constitution.ensure([repo.path]);
    }),
    vscode.commands.registerCommand('claudeHarness.showRepo', (arg?: unknown) => {
      const repo = repoOfArg(arg);
      if (!repo) return;
      constitution.ensure([repo.base]);
      HarnessPanel.showPage(context, host, { repo: repo.id });
    }),
    vscode.commands.registerCommand('claudeHarness.showFleet', () => {
      constitution.ensure(repoViews().map(v => v.path));
      HarnessPanel.showPage(context, host, { page: 'fleet' });
    }),
    vscode.commands.registerCommand('claudeHarness.showMarketplaces', () => HarnessPanel.showPage(context, host, { page: 'marketplaces' })),
    vscode.commands.registerCommand('claudeHarness.showSession', (arg?: unknown, sessionId?: string) => {
      const node = arg as Node | undefined;
      const repo = node && typeof node === 'object' && node.type === 'session' ? node.view.id : repoOfArg(arg)?.id;
      const id = node && typeof node === 'object' && node.type === 'session' ? node.session.id : sessionId;
      if (repo && id) HarnessPanel.showPage(context, host, { page: 'session', repo, session: id });
    }),
    vscode.commands.registerCommand('claudeHarness.checkRepos', (arg?: unknown) => {
      const repo = repoOfArg(arg);
      loadProvider();
      if (!provider) {
        void vscode.window.showInformationMessage(`${NO_PROVIDER} This command is off.`);
        return;
      }
      constitution.ensure(repo ? [repo.base] : repoViews().map(v => v.path), true);
    }),
    vscode.commands.registerCommand('claudeHarness.openStandard', async () => {
      const tools = await needTools();
      if (tools?.plugin.standard) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(tools.plugin.standard));
    }),
    vscode.commands.registerCommand('claudeHarness.alignClaudeMd', async (arg?: unknown) => {
      const tools = await needTools();
      if (!tools?.plugin.align) return;
      const repo = repoOfArg(arg) ?? (await pickScope(undefined, 'Align CLAUDE.md in'));
      if (!repo || repo.id === global.id) return;
      const dirs = await guard([repo.base], `Align CLAUDE.md in ${repo.label}`);
      if (!dirs?.length) return;
      terminal(`Align: ${repo.label}`, repo.base, `claude "${tools.plugin.align.replace(/"/g, '\\"')}"`);
    }),

    vscode.commands.registerCommand('claudeHarness.fixSettings', async (arg?: unknown) => {
      const tools = await needTools();
      if (!tools) return;
      const one = repoOfArg(arg);
      let dirs = one ? [one.base] : await pickRepos('Fix settings and hooks in', v => /settings|hook/.test(JSON.stringify(constitution.get(v.path).result?.findings ?? [])));
      if (!dirs?.length) return;
      const mode = await vscode.window.showQuickPick(
        [
          { label: 'Fix plugins, marketplaces and hooks', keep: false },
          { label: 'Keep plugin settings', description: '--keep-plugins: only replaced hooks are removed', keep: true },
        ],
        { title: 'What the fix may change' }
      );
      if (!mode) return;
      dirs = await guard(dirs, 'Fix settings in these repos');
      if (!dirs?.length) return;
      const settings = path.join(global.root, 'settings.json');
      const previews = await Promise.all(
        dirs.map(async dir => {
          try {
            return { dir, preview: await previewFix(tools.plugin, tools.py, dir, mode.keep, settings) };
          } catch (e) {
            return { dir, error: (e as Error).message };
          }
        })
      );
      const failed = previews.filter(p => p.error);
      if (failed.length) void vscode.window.showErrorMessage(`The fix failed in ${failed.map(f => path.basename(f.dir)).join(', ')}: ${failed[0].error}`);
      const changed = previews.filter(p => p.preview && p.preview.changes.length);
      if (!changed.length) {
        if (!failed.length) void vscode.window.showInformationMessage(`Nothing to fix in ${dirs.length === 1 ? path.basename(dirs[0]) : `${dirs.length} repos`}.`);
        return;
      }
      let opened = 0;
      for (const p of changed)
        for (const f of p.preview!.files)
          if (f.after && opened++ < 8)
            await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(f.before), vscode.Uri.file(f.after), `${path.basename(p.dir)}: ${f.rel} (now ↔ after fix)`, { preview: false });
      const detail = changed.map(p => `${path.basename(p.dir)}\n${p.preview!.changes.map(c => `  ${c}`).join('\n')}`).join('\n\n');
      const ok = await vscode.window.showWarningMessage(`Apply the fix to ${changed.length === 1 ? path.basename(changed[0].dir) : `${changed.length} repos`}?`, { modal: true, detail }, 'Apply');
      if (ok !== 'Apply') return;
      for (const p of changed) {
        try {
          await applyFix(tools.plugin, tools.py, p.dir, mode.keep, settings);
        } catch (e) {
          void vscode.window.showErrorMessage(`The fix failed in ${path.basename(p.dir)}: ${(e as Error).message}`);
        }
      }
      refresh();
      constitution.ensure(changed.map(p => p.dir), true);
      void vscode.window.showInformationMessage(`Applied the fix to ${changed.length === 1 ? path.basename(changed[0].dir) : `${changed.length} repos`}.`);
    }),

    vscode.commands.registerCommand('claudeHarness.scaffoldRepo', async (arg?: unknown) => {
      const tools = await needTools();
      if (!tools?.plugin.scaffold) return;
      let dir = repoOfArg(arg)?.base;
      if (!dir) {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Scaffold Repo Harness', title: 'Folder of the repo to scaffold' });
        dir = picked?.[0]?.fsPath;
      }
      if (dir) HarnessPanel.showPage(context, host, { page: 'init', dir });
    }),

    vscode.commands.registerCommand('claudeHarness.retire', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      const scope = scopeOf(asset);
      const block = retireBlock(asset, scope.id === global.id ? undefined : scope.base, provider?.keepCopies);
      if (block) {
        void vscode.window.showInformationMessage(`${asset.name} cannot be retired. ${block}`);
        return;
      }
      const reasons = guardReasons(await guardInfo(scope.base));
      const stamp = backupStamp();
      const target = asset.dir ?? asset.file;
      const dest = path.join(backupRoot(), stamp, path.basename(scope.base), path.relative(scope.base, target));
      const same = (asset.copies ?? []).filter(c => c.same && (c.scope === global.id || c.scope.startsWith('plugin:'))).map(c => c.label);
      const detail = [`Identical to: ${same.join(', ')}`, `Backs up ${target}`, `to ${dest}`, 'then deletes it from the repo.', reasons.length ? `\nCareful: ${reasons.join(', ')}.` : ''].filter(Boolean).join('\n');
      const sureRetire = await askFirst(
        arg,
        { key: 'retire', title: `Retire the copy of ${asset.name} in ${scope.label}?`, sub: 'Backed up first, then deleted from the repo', facts: detail.split('\n').filter(Boolean), action: 'Retire' },
        () => vscode.window.showWarningMessage(`Retire the copy of ${asset.name} in ${scope.label}?`, { modal: true, detail }, 'Retire')
      );
      if (!sureRetire) return;
      if (run(() => retireAsset(asset, scope.base, backupRoot(), stamp))) void vscode.window.showInformationMessage(`Retired ${asset.name}. Backup: ${dest}`);
    }),

    vscode.commands.registerCommand('claudeHarness.retireCopies', async (arg?: unknown) => {
      const candidates = repoViews().flatMap(v =>
        v.categories
          .filter(c => c.kind === 'skill' || c.kind === 'agent')
          .flatMap(c => c.items)
          .filter(a => !retireBlock(a, v.path, provider?.keepCopies))
          .map(a => ({ asset: a, view: v }))
      );
      if (!candidates.length) {
        void vscode.window.showInformationMessage('No repo holds an identical copy of a global or plugin skill or agent.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        candidates.map(c => ({
          label: `$(${c.asset.kind === 'skill' ? 'mortar-board' : 'hubot'}) ${c.asset.name}`,
          description: `${c.view.label} · identical to ${(c.asset.copies ?? []).filter(x => x.same && (x.scope === global.id || x.scope.startsWith('plugin:'))).map(x => x.label).join(', ')}`,
          picked: true,
          c,
        })),
        { canPickMany: true, title: 'Retire clean copies', matchOnDescription: true }
      );
      if (!picked?.length) return;
      const dirs = await guard([...new Set(picked.map(p => p.c.view.path))], 'Retire copies in these repos');
      if (!dirs?.length) return;
      const chosen = picked.filter(p => dirs.some(d => samePath(d, p.c.view.path)));
      if (!chosen.length) return;
      const stamp = backupStamp();
      const retireTitle = `Retire ${chosen.length} ${chosen.length === 1 ? 'copy' : 'copies'} from ${dirs.length} ${dirs.length === 1 ? 'repo' : 'repos'}?`;
      const retireDetail = `Each is backed up to ${path.join(backupRoot(), stamp)}\\<repo>\\ first, then deleted.\n\n${chosen.map(p => `${p.c.view.label}: ${p.c.asset.name}`).join('\n')}`;
      const sureCopies = await askFirst(
        arg,
        { key: 'retireCopies', title: retireTitle, sub: 'Backed up first, then deleted from the repos', facts: retireDetail.split('\n').filter(Boolean), action: 'Retire' },
        () => vscode.window.showWarningMessage(retireTitle, { modal: true, detail: retireDetail }, 'Retire')
      );
      if (!sureCopies) return;
      run(() => chosen.forEach(p => retireAsset(p.c.asset, p.c.view.path, backupRoot(), stamp)));
      constitution.ensure(dirs, true);
      void vscode.window.showInformationMessage(`Retired ${chosen.length} ${chosen.length === 1 ? 'copy' : 'copies'}. Backup: ${path.join(backupRoot(), stamp)}`);
    }),

    vscode.commands.registerCommand('claudeHarness.syncFromGlobal', syncFromGlobal),
    vscode.commands.registerCommand('claudeHarness.syncPlugin', syncPluginCommand),
    vscode.commands.registerCommand('claudeHarness.syncMcp', syncMcp),

    // From the tree: the target is picked when there is more than one, and the native dialog asks, like the other destructive tree commands.
    vscode.commands.registerCommand('claudeHarness.consolidate', async (arg?: unknown) => {
      // From a right-click on a skill row in the panel: the row's context object. It asks with the card, pointing at the row.
      const rowId = arg && typeof arg === 'object' && 'assetId' in arg ? String((arg as { assetId: unknown }).assetId) : undefined;
      if (rowId) return void (await host.consolidateAsset?.(rowId, {}, ask => HarnessPanel.post({ type: 'confirm', ask: ask.kind === 'consolidate' ? { ...ask, key: 'click' } : ask })));
      const asset = assetOf(arg);
      if (!asset) return;
      const plan = planConsolidate(asset);
      if (plan.block || !plan.targets.length) return void vscode.window.showInformationMessage(`${asset.name} cannot be consolidated. ${plan.block ?? ''}`.trim());
      let target = plan.targets[0];
      if (plan.targets.length > 1) {
        const picked = await vscode.window.showQuickPick(
          plan.targets.map((t, i) => ({ label: `$(${t.id === 'global' ? 'globe' : 'package'}) ${t.label}`, description: `${i === 0 ? 'default · ' : ''}${t.state === 'new' ? 'not there yet' : t.state}`, detail: t.dir, t })),
          { title: `Consolidate ${asset.name} into`, matchOnDescription: true }
        );
        if (!picked) return;
        target = picked.t;
      }
      const scope = scopeOf(asset);
      const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
      const careful = guardReasons(await guardInfo(scope.base));
      const lines: Record<ConsolidateTarget['state'], string> = {
        identical: `${target.label} holds the same files.`,
        near: `${target.label} holds the same files, apart from whitespace or version lines.`,
        contained: `${target.label} holds every file of the repo copy, and ${target.targetOnly.length} more.`,
        differs: `${count(target.changed.length, 'file')} differ and ${count(target.repoOnly.length, 'file')} exist only in the repo copy:\n${[...target.changed, ...target.repoOnly].slice(0, 8).join(', ')}`,
        new: `${target.label} has no ${asset.name} yet. The whole folder (${count(target.files, 'file')}) is copied to ${target.dir}.`,
      };
      const ends = target.state === 'differs' ? 'Merge the changes into the target first, in the diff editor or with Claude; the repo copy is retired when you run this again.' : `Then the repo copy is backed up to ${path.join(backupRoot(), '<time>', path.basename(scope.base))} and deleted from the repo.`;
      const detail = [`Repo copy: ${asset.dir}`, `Target: ${target.dir}`, '', lines[target.state], '', ends, ...plan.notes.map(n => `\n${n}`), careful.length ? `\nCareful: ${careful.join(', ')}.` : ''].join('\n');
      const labels: Record<ConsolidateRoute, string> = { retire: 'Retire repo copy', move: `Move to ${target.label}`, diff: 'Compare in editor', claude: 'Merge with Claude' };
      const routes = routesOf(target.state);
      const choice = await vscode.window.showWarningMessage(`Consolidate ${asset.name} into ${target.label}?`, { modal: true, detail }, ...routes.map(r => labels[r]));
      const route = routes.find(r => labels[r] === choice);
      if (route) await consolidateRun(asset, target, route);
    }),

    vscode.commands.registerCommand('claudeHarness.renameMarketplace', async (arg?: unknown) => {
      const markets = marketplaceHealth(global.root);
      const market =
        markets.find(m => m.name === arg) ??
        (await vscode.window.showQuickPick(markets.map(m => ({ label: m.name, description: `${m.kind} · ${m.source}`, m })), { title: 'Rename which marketplace?' }))?.m;
      if (!market) return;
      if (market.kind !== 'directory') {
        void vscode.window.showWarningMessage(`${market.name} is a ${market.kind} marketplace: its name comes from the marketplace.json at its source, so it can only be renamed there.`);
        return;
      }
      const to = await vscode.window.showInputBox({
        prompt: `New name for ${market.name}`,
        value: market.name,
        validateInput: v => (!/^[a-z0-9][a-z0-9-]*$/.test(v) ? 'Lowercase letters, digits and dashes.' : markets.some(m => m.name === v) ? `${v} already exists.` : undefined),
      });
      if (!to || to === market.name) return;
      const repoEdits = repoViews().flatMap(v => ['settings.json', 'settings.local.json'].map(f => ({ dir: v.path, edit: renameInSettings(path.join(v.path, '.claude', f), market.name, to) })).filter(x => x.edit));
      const dirs = repoEdits.length ? await guard([...new Set(repoEdits.map(x => x.dir))], `Rewrite @${market.name} in these repos`) : [];
      if (!dirs) return;
      const edits = [renameInSettings(path.join(global.root, 'settings.json'), market.name, to), renameCatalog(market.location, to), ...repoEdits.filter(x => dirs.some(d => samePath(d, x.dir))).map(x => x.edit)].filter(
        (e): e is FileEdit => !!e
      );
      await previewEdits(edits, `Rename ${market.name}`);
      const commands = renameCommands(market, to);
      const ok = await vscode.window.showWarningMessage(
        `Rename ${market.name} to ${to}?`,
        { modal: true, detail: `Rewrites ${edits.length} ${edits.length === 1 ? 'file' : 'files'}:\n${edits.map(e => `  ${e.file}`).join('\n')}\n\nThen a terminal re-registers the marketplace:\n${commands.map(c => `  ${c}`).join('\n')}` },
        'Rename'
      );
      if (ok !== 'Rename') return;
      run(() => edits.forEach(e => fs.writeFileSync(e.file, e.after, 'utf8')));
      const t = vscode.window.createTerminal({ name: `Rename ${market.name}`, cwd: os.homedir() });
      t.show();
      for (const c of commands) t.sendText(c);
    })
  );

  registerLenses(context, {
    problemsFor: file => constitution.problemsFor(file),
    baseOf: file => {
      const repo = harnessFileOf(file);
      if (!repo) return undefined;
      const rel = path.relative(repo.path, file).split(path.sep).join('/');
      return rel === 'CLAUDE.md' || rel.startsWith('.claude/rules/') ? repo.path : undefined;
    },
    roster: base => rosterFor(base),
    alsoDirs: () => [path.join(global.root, 'skills')],
    changed: listener => {
      const a = checksChanged.event(listener);
      const b = lensesChanged.event(listener);
      return { dispose: () => (a.dispose(), b.dispose()) };
    },
  });

  loadScopes();
  watch();
  refresh();
  loadCliServers();
  const openRepos = vscode.workspace.textDocuments
    .filter(doc => doc.uri.scheme === 'file' && path.basename(doc.uri.fsPath) === 'CLAUDE.md')
    .map(doc => harnessFileOf(doc.uri.fsPath)?.path)
    .filter((dir): dir is string => !!dir);
  if (openRepos.length) constitution.ensure([...new Set(openRepos)]);
}

export function deactivate(): void {}
