import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Constitution } from './constitution';
import { FileEdit, fleetRow, guardInfo, guardReasons, marketplaceHealth, renameCatalog, renameCommands, renameInSettings } from './fleet';
import { registerLenses } from './lenses';
import { InitForm, PLUGIN_INSTALL, applyFix, initArgs, parseInitOutput, previewFix, runScript } from './standard';
import {
  Asset,
  backupStamp,
  effectiveHarness,
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
  renameAsset,
  repoScope,
  scan,
  ScopeView,
  setFrontmatterList,
  setPluginEnabled,
  validateName,
} from './harness';
import { HarnessPanel, PanelHost } from './panel';
import { pickTools, splitTools, TOOL_FIELDS } from './tools';
import { HarnessTree, Node } from './tree';

const WATCHED = '{CLAUDE.md,settings.json,settings.local.json,agents/**,skills/**,commands/**,output-styles/**,rules/**,workflows/**,hooks/**,plugins/installed_plugins.json,plugins/known_marketplaces.json}';

export function activate(context: vscode.ExtensionContext): void {
  let global: HarnessScope = globalScope(vscode.workspace.getConfiguration('claudeHarness').get<string>('root'));
  let scopes: HarnessScope[] = [global];
  let views: ScopeView[] = [];
  let plugins: ScopeView[] = [];
  const constitution = new Constitution(
    () => global.root,
    () => path.join(global.root, 'settings.json')
  );
  const tree = new HarnessTree(
    dir => constitution.summary(dir),
    dirs => constitution.ensure(dirs)
  );
  let watcher: vscode.FileSystemWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;

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
    views = scopes.map(s => ({ id: s.id, label: s.label, path: s.base, local: s !== global && folders.some(f => samePath(f, s.base)), categories: scan(s) }));
    const globalMcp = views[0].categories.find(c => c.kind === 'mcp');
    if (globalMcp) {
      for (const a of globalMcp.items) a.status = cliServers.find(c => c.name === a.name)?.status;
      globalMcp.items.push(...cliServers.filter(c => !globalMcp.items.some(a => a.name === c.name)).map(c => ({ ...c })));
    }
    applyMcpState(views, global.userConfig);
    plugins = pluginViews(global.root);
    linkCopies(views, plugins);
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
      const roster = rosterFor(base);
      if (!base) return { ...ruleInfo(asset, '', roster), globs: [], total: 0, base: '' };
      return ruleInfo(asset, base, roster);
    },
    marketplaces: () => marketplaceHealth(global.root),
    initForm: async dir => {
      const { plugin, py } = await constitution.tools();
      return {
        name: path.basename(dir),
        hasClaudeMd: fs.existsSync(path.join(dir, 'CLAUDE.md')),
        agents: [...rosterFor(dir).agents].sort((a, b) => a.localeCompare(b)),
        error: !plugin ? `The harness-plugin is not installed. Run: ${PLUGIN_INSTALL}` : !py ? 'Python 3 was not found on PATH.' : undefined,
      };
    },
    initRun: async (dir, form: InitForm, apply) => {
      const { plugin, py } = await constitution.tools();
      if (!plugin || !py) return { error: !plugin ? `The harness-plugin is not installed. Run: ${PLUGIN_INSTALL}` : 'Python 3 was not found on PATH.' };
      if (!form.summary.trim()) return { error: 'Write a summary of one to three sentences first.' };
      const roster = rosterFor(dir);
      const unknown = form.areas.filter(a => a.owner.trim() && !roster.agents.has(a.owner.trim())).map(a => a.owner.trim());
      if (unknown.length) return { error: `No agent named ${unknown.join(', ')} on disk.` };
      const r = await runScript(py, plugin.init, initArgs(dir, form, apply));
      if (r.code !== 0) return { error: r.stderr.trim() || `init-product-repo.py exited with ${r.code}` };
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
      return parseInitOutput(r.stdout);
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
    if (!tools.plugin) {
      const pick = await vscode.window.showWarningMessage('The harness-plugin is not installed, so this command is off.', { detail: PLUGIN_INSTALL, modal: true }, 'Copy Install Command');
      if (pick) await vscode.env.clipboard.writeText(PLUGIN_INSTALL);
      return undefined;
    }
    if (!tools.py) {
      void vscode.window.showErrorMessage('Python 3 was not found on PATH (python, py -3 or python3), so this command is off.');
      return undefined;
    }
    return { plugin: tools.plugin, py: tools.py };
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
    const node = arg as Node | undefined;
    return node && (node.type === 'asset' || node.type === 'file') ? node.asset : undefined;
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

  const cwdOf = (scope: HarnessScope) => (scope.id === global.id ? os.homedir() : scope.base);

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
    status,
    lensesChanged,
    vscode.languages.registerCodeLensProvider({ language: 'markdown', scheme: 'file' }, toolLenses),
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
    vscode.commands.registerCommand('claudeHarness.removeRepo', async (id?: string) => {
      const config = vscode.workspace.getConfiguration('claudeHarness');
      const folders = config.get<string[]>('repoFolders') ?? [];
      let targets: { dir: string; folder: boolean }[];
      const repo = typeof id === 'string' ? scopes.find(s => s.id === id) : undefined;
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
      const file = node && typeof node === 'object' && node.type === 'file' ? node.file : assetOf(arg)?.dir ?? assetOf(arg)?.file;
      if (file) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
    }),

    vscode.commands.registerCommand('claudeHarness.rename', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      const name = await askName(`Rename ${asset.name} to`, asset.name);
      if (!name || name === asset.name) return;
      let file = '';
      if (run(() => (file = renameAsset(scopeOf(asset), asset, name)))) showFile(file);
    }),

    vscode.commands.registerCommand('claudeHarness.duplicate', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
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
      if (asset.kind === 'mcp') {
        if (!asset.file || !asset.jsonPath) return;
        const pick = await vscode.window.showWarningMessage(`Delete the MCP server ${asset.name}?`, { modal: true, detail: asset.file }, 'Delete');
        if (pick === 'Delete') run(() => removeJsonEntry(asset.file, asset.jsonPath!));
        return;
      }
      const target = asset.dir ?? asset.file;
      const choice = await vscode.window.showWarningMessage(`Move ${asset.name} to the trash?`, { modal: true, detail: target }, 'Move to Trash');
      if (choice !== 'Move to Trash') return;
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
      const pick = await vscode.window.showWarningMessage(`Uninstall ${asset.name} from ${scope.id === global.id ? 'your user scope' : scope.label}?`, { modal: true }, 'Uninstall');
      if (pick !== 'Uninstall') return;
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
    vscode.commands.registerCommand('claudeHarness.checkRepos', (arg?: unknown) => {
      const repo = repoOfArg(arg);
      constitution.reset();
      constitution.ensure(repo ? [repo.base] : repoViews().map(v => v.path), true);
    }),
    vscode.commands.registerCommand('claudeHarness.openStandard', async () => {
      const tools = await needTools();
      if (tools) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(tools.plugin.dir, 'skills', 'fix-constitution', 'references', 'standard.md')));
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
        { title: 'What fix-settings may change' }
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
      if (failed.length) void vscode.window.showErrorMessage(`fix-settings failed in ${failed.map(f => path.basename(f.dir)).join(', ')}: ${failed[0].error}`);
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
      const ok = await vscode.window.showWarningMessage(`Apply fix-settings to ${changed.length === 1 ? path.basename(changed[0].dir) : `${changed.length} repos`}?`, { modal: true, detail }, 'Apply');
      if (ok !== 'Apply') return;
      for (const p of changed) {
        try {
          await applyFix(tools.plugin, tools.py, p.dir, mode.keep, settings);
        } catch (e) {
          void vscode.window.showErrorMessage(`fix-settings failed in ${path.basename(p.dir)}: ${(e as Error).message}`);
        }
      }
      refresh();
      constitution.ensure(changed.map(p => p.dir), true);
      void vscode.window.showInformationMessage(`Applied fix-settings to ${changed.length === 1 ? path.basename(changed[0].dir) : `${changed.length} repos`}.`);
    }),

    vscode.commands.registerCommand('claudeHarness.initRepo', async (arg?: unknown) => {
      let dir = repoOfArg(arg)?.base;
      if (!dir) {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Init Product Repo', title: 'Folder of the new product repo' });
        dir = picked?.[0]?.fsPath;
      }
      if (dir) HarnessPanel.showPage(context, host, { page: 'init', dir });
    }),

    vscode.commands.registerCommand('claudeHarness.retire', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      const scope = scopeOf(asset);
      const block = retireBlock(asset, scope.id === global.id ? undefined : scope.base);
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
      const ok = await vscode.window.showWarningMessage(`Retire the copy of ${asset.name} in ${scope.label}?`, { modal: true, detail }, 'Retire');
      if (ok !== 'Retire') return;
      if (run(() => retireAsset(asset, scope.base, backupRoot(), stamp))) void vscode.window.showInformationMessage(`Retired ${asset.name}. Backup: ${dest}`);
    }),

    vscode.commands.registerCommand('claudeHarness.retireCopies', async () => {
      const candidates = repoViews().flatMap(v =>
        v.categories
          .filter(c => c.kind === 'skill' || c.kind === 'agent')
          .flatMap(c => c.items)
          .filter(a => !retireBlock(a, v.path))
          .map(a => ({ asset: a, view: v }))
      );
      if (!candidates.length) {
        void vscode.window.showInformationMessage('No product repo holds an identical copy of a global or plugin skill or agent.');
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
      const ok = await vscode.window.showWarningMessage(
        `Retire ${chosen.length} ${chosen.length === 1 ? 'copy' : 'copies'} from ${dirs.length} ${dirs.length === 1 ? 'repo' : 'repos'}?`,
        { modal: true, detail: `Each is backed up to ${path.join(backupRoot(), stamp)}\\<repo>\\ first, then deleted.\n\n${chosen.map(p => `${p.c.view.label}: ${p.c.asset.name}`).join('\n')}` },
        'Retire'
      );
      if (ok !== 'Retire') return;
      run(() => chosen.forEach(p => retireAsset(p.c.asset, p.c.view.path, backupRoot(), stamp)));
      constitution.ensure(dirs, true);
      void vscode.window.showInformationMessage(`Retired ${chosen.length} ${chosen.length === 1 ? 'copy' : 'copies'}. Backup: ${path.join(backupRoot(), stamp)}`);
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
