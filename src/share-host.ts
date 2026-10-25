import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Asset, HarnessScope, backupStamp, pluginDirs } from './harness';
import { installPlugin, isInstalled, runClaude, unwritePlugin } from './hunt-create';
import { readMarkets } from './hunt-market';
import { HarnessPanel } from './panel';
import {
  ImportPlan,
  Pack,
  Pkg,
  ShareKind,
  SHARE_KINDS,
  applyImport,
  freeName,
  inventoryWords,
  notShareable,
  packAsset,
  packPlugin,
  planImport,
  planPluginImport,
  pluginInventory,
  readPackage,
  shareLabel,
  sizeWords,
  writePluginImport,
} from './share';
import type { HuntMarket, HuntProposal } from './shared/hunt';
import type { CreatePlan } from './hunt-create';

// The Share and Import commands. A question is a card in the panel when the panel started the command, and the editor's
// own quick pick or dialog when the palette or a tree menu did.

export interface ShareDeps {
  root: () => string;
  scopes: () => HarnessScope[];
  /** The asset a command argument names: a row's context object, a tree node or an id. */
  assetOf: (arg: unknown) => Asset | undefined;
  refresh: () => void;
  backupRoot: () => string;
  /** The folder packages are saved to; `Downloads` in the home folder when absent. */
  downloads?: () => string;
}

type Card = { title: string; sub: string; facts: string[]; action: string; alt?: string; glyph?: string; danger?: boolean; scroll?: boolean };

/** One way of asking: panel cards, or the editor's own pickers. */
interface Ui {
  confirm(card: Card): Promise<'ok' | 'alt' | undefined>;
  pick(card: Card & { choices: { id: string; label: string; note?: string }[] }): Promise<string | undefined>;
  input(card: Card & { label: string; value?: string; validate: (v: string) => string | undefined }): Promise<string | undefined>;
}

const panelUi: Ui = {
  confirm: async card => {
    const answer = await HarnessPanel.ask({ key: 'click', ...card });
    return answer === 'ok' || answer === 'alt' ? answer : undefined;
  },
  pick: async card => {
    const answer = await HarnessPanel.askFull({ key: 'click', ...card });
    return answer?.choice === 'ok' ? answer.picked?.[0] : undefined;
  },
  input: async card => {
    let error: string | undefined;
    let value = card.value;
    for (;;) {
      const answer = await HarnessPanel.askFull({ key: 'click', title: card.title, sub: card.sub, facts: card.facts, action: card.action, glyph: card.glyph, input: { label: card.label, value, error } });
      if (!answer || answer.choice !== 'ok') return undefined;
      value = answer.text ?? '';
      error = card.validate(value);
      if (!error) return value;
    }
  },
};

const nativeUi: Ui = {
  confirm: async card => {
    const choice = await vscode.window.showWarningMessage(card.title, { modal: true, detail: [card.sub, '', ...card.facts].join('\n') }, ...[card.action, card.alt].filter((b): b is string => !!b));
    return choice === card.action ? 'ok' : choice && choice === card.alt ? 'alt' : undefined;
  },
  pick: async card => (await vscode.window.showQuickPick(card.choices.map(c => ({ label: c.label, description: c.note, id: c.id })), { title: `${card.title} ${card.sub}`.trim() }))?.id,
  input: async card => vscode.window.showInputBox({ title: card.title, prompt: card.label, value: card.value, validateInput: card.validate }),
};

/** The arguments a command gets from the panel: a context object of a row (`assetId`), or the page's own `{ fromPanel }`. */
const fromPanel = (arg: unknown): boolean => !!arg && typeof arg === 'object' && ('assetId' in arg || 'fromPanel' in arg) && HarnessPanel.isOpen();

const lower = (kind: ShareKind) => (kind === 'mcp' ? 'MCP server' : kind === 'memory' ? 'CLAUDE.md' : shareLabel[kind].toLowerCase());

const home = (p: string) => (p.toLowerCase().startsWith(os.homedir().toLowerCase()) ? `~${p.slice(os.homedir().length)}` : p);

const FILTERS: Record<ShareKind, Record<string, string[]>> = {
  skill: { 'Skill (.zip)': ['zip'] },
  plugin: { 'Plugin (.zip)': ['zip'] },
  agent: { 'Agent (.md)': ['md'] },
  command: { 'Command (.md)': ['md'] },
  outputStyle: { 'Output style (.md)': ['md'] },
  rule: { 'Rule (.md)': ['md'] },
  memory: { 'CLAUDE.md': ['md'] },
  mcp: { 'MCP server (.json)': ['json'] },
  hook: { 'Hook (.json or .zip)': ['json', 'zip'] },
};

const COMMAND: Record<ShareKind, string> = {
  skill: 'importSkill',
  plugin: 'importPlugin',
  agent: 'importAgent',
  command: 'importCommand',
  outputStyle: 'importOutputStyle',
  rule: 'importRule',
  memory: 'importMemory',
  mcp: 'importMcp',
  hook: 'importHook',
};

export const importCommands = SHARE_KINDS.map(kind => ({ kind, command: `claudeHarness.${COMMAND[kind]}` }));

export function registerShare(d: ShareDeps): vscode.Disposable[] {
  const downloads = () => d.downloads?.() ?? path.join(os.homedir(), 'Downloads');
  const pluginDir = (key: string) => pluginDirs(d.root()).find(p => p.key === key)?.dir;
  const uiFor = (arg: unknown): Ui => (fromPanel(arg) ? panelUi : nativeUi);
  const say = (text: string, ...actions: string[]) => vscode.window.showInformationMessage(text, ...actions);

  const save = async (pack: Pack): Promise<void> => {
    const dir = downloads();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, freeName(dir, pack.file));
    fs.writeFileSync(file, pack.data);
    const hit = await say(`Saved ${path.basename(file)} to ${home(dir)}.`, 'Show in folder');
    if (hit) void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
  };

  const share = async (arg?: unknown) => {
    const asset = d.assetOf(arg && typeof arg === 'object' && 'assetId' in arg ? String((arg as { assetId: unknown }).assetId) : arg);
    if (!asset) return void vscode.window.showInformationMessage('Pick the element to share in the Claude Harness list first.');
    const why = notShareable(asset);
    if (why) return void vscode.window.showInformationMessage(why);
    const ui = uiFor(arg);
    const kindWord = lower(asset.kind as ShareKind);
    try {
      let pack: Pack;
      if (asset.kind === 'plugin') {
        const dir = pluginDir(asset.name);
        if (!dir) return void vscode.window.showInformationMessage(`${asset.name} has no folder on disk to package.`);
        pack = packPlugin(dir, asset.name);
      } else if (asset.scope.startsWith('plugin:')) {
        const key = asset.scope.slice('plugin:'.length);
        const dir = pluginDir(key);
        const item = packAsset(asset, d.scopes()[0]);
        if (!dir) pack = item;
        else {
          // The plugin question: only this item, or the whole plugin.
          const whole = packPlugin(dir, key);
          const inv = pluginInventory(dir);
          const choice = HarnessPanel.isOpen() && fromPanel(arg)
            ? await HarnessPanel.askShare({
                key: 'click',
                name: asset.name,
                what: kindWord,
                plugin: key,
                options: [
                  { id: 'item', title: `Only ${asset.name}`, sub: item.what, lines: item.files.length > 4 ? [`${item.files.length} files`, ...item.files.slice(0, 3), '...'] : item.files, size: sizeWords(item.data.length), glyph: asset.kind === 'skill' ? 'mortar-board' : 'file' },
                  { id: 'plugin', title: `The whole ${key.split('@')[0]} plugin`, sub: whole.what, lines: [inventoryWords(inv), `${inv.files} files, with .claude-plugin/plugin.json`], size: sizeWords(whole.data.length), glyph: 'package' },
                ],
              })
            : (
                await vscode.window.showQuickPick(
                  [
                    { label: `Only ${asset.name}`, description: sizeWords(item.data.length), detail: item.what, id: 'item' as const },
                    { label: `The whole ${key.split('@')[0]} plugin`, description: sizeWords(whole.data.length), detail: `${inventoryWords(inv)} · ${whole.what}`, id: 'plugin' as const },
                  ],
                  { title: `${asset.name} comes from the plugin ${key}. Share what?` }
                )
              )?.id;
          if (!choice) return;
          pack = choice === 'plugin' ? whole : item;
        }
      } else pack = packAsset(asset, d.scopes().find(s => s.id === asset.scope) ?? d.scopes()[0]);

      if (pack.secrets.length) {
        const go = await ui.confirm({
          title: `Share ${asset.name} with its keys?`,
          sub: 'The package carries values that look like secrets',
          glyph: 'key',
          danger: true,
          facts: [`${pack.secrets.join(', ')}.`, 'They are saved in the package as they are. Nothing is removed.', 'Anyone who gets the file can read them.'],
          action: 'Save with the values',
        });
        if (go !== 'ok') return;
      }
      await save(pack);
    } catch (e) {
      void vscode.window.showErrorMessage(`Could not share ${asset.name}: ${(e as Error).message}`);
    }
  };

  const scopeCard = async (ui: Ui, kind: ShareKind, pkg: Pkg, preferred?: string): Promise<HarnessScope | undefined> => {
    const scopes = d.scopes();
    const ordered = [...scopes.filter(s => s.id === preferred), ...scopes.filter(s => s.id !== preferred)];
    const id = await ui.pick({
      title: `Import ${pkg.name}`,
      sub: `${shareLabel[kind]}${pkg.description ? `: ${pkg.description.slice(0, 80)}` : ''}`,
      facts: ['Pick where it goes. The next step lists every file it writes.'],
      action: 'Next',
      glyph: 'cloud-download',
      choices: ordered.map(s => ({ id: s.id, label: s.id === 'global' ? 'Global' : s.label, note: home(s.id === 'global' ? s.root : s.base) })),
    });
    return scopes.find(s => s.id === id);
  };

  const renamed = (pkg: Pkg, name: string): Pkg => {
    if (pkg.kind === 'mcp') return { ...pkg, name, servers: { [name]: Object.values(pkg.servers)[0] } };
    return { ...pkg, name } as Pkg;
  };

  const asName = (existing: (name: string) => boolean) => (v: string) => (/^[a-z0-9][a-z0-9._:-]*$/.test(v) ? (existing(v) ? `${v} exists too.` : undefined) : 'Lowercase letters, digits, dots, dashes and underscores; starts with a letter or digit.');

  const importInto = async (ui: Ui, kind: ShareKind, original: Pkg, scope: HarnessScope): Promise<void> => {
    const stamp = backupStamp();
    let pkg = original;
    let plan: ImportPlan = planImport(pkg, scope);
    const canRename = ['skill', 'agent', 'command', 'outputStyle', 'rule'].includes(kind) || (kind === 'mcp' && Object.keys((pkg as { servers: object }).servers).length === 1);
    const where = scope.id === 'global' ? 'Global' : scope.label;
    for (;;) {
      if (plan.problem) {
        const name = await ui.input({ title: `Name the ${lower(kind)}`, sub: `into ${where}`, facts: [plan.problem ?? ''], label: 'Name', value: plan.name, action: 'Next', glyph: 'edit', validate: asName(() => false) });
        if (!name) return;
        pkg = renamed(pkg, name);
        plan = planImport(pkg, scope, name);
        continue;
      }
      const clash = !!plan.exists;
      const files = plan.files.map(f => home(f));
      const facts = [
        ...(clash ? [`${plan.exists ? home(plan.exists) : ''} already exists in ${where}.`, `Replace backs it up first, in ${home(path.join(d.backupRoot(), stamp))}.`] : []),
        `Writes ${files.length} ${files.length === 1 ? 'file' : 'files'}:`,
        ...files,
        ...plan.notes,
      ];
      const answer = await ui.confirm({
        title: `${clash ? 'Replace' : 'Import'} ${pkg.name}`,
        sub: `${shareLabel[kind]} into ${where}`,
        glyph: clash ? 'replace-all' : 'cloud-download',
        danger: clash,
        scroll: true,
        facts,
        action: clash ? 'Replace' : 'Import',
        alt: clash && canRename ? 'Use a new name' : undefined,
      });
      if (!answer) return;
      if (answer === 'alt') {
        const name = await ui.input({
          title: 'Use a new name',
          sub: `${shareLabel[kind]} into ${where}`,
          facts: [`${pkg.name} exists in ${where}. Pick a name it does not have.`],
          label: 'Name',
          value: `${plan.name}-2`,
          action: 'Next',
          glyph: 'edit',
          validate: asName(n => !!planImport(renamed(pkg, n), scope, n).exists),
        });
        if (!name) return;
        pkg = renamed(pkg, name);
        plan = planImport(pkg, scope, name);
        continue;
      }
      try {
        const backup = applyImport(pkg, scope, plan, clash, d.backupRoot(), stamp);
        d.refresh();
        void say(`Imported ${lower(kind)} ${plan.name} into ${where}.${backup ? ` The old one is backed up in ${home(backup)}.` : ''}`);
      } catch (e) {
        void vscode.window.showErrorMessage(`Could not import ${pkg.name}: ${(e as Error).message}`);
      }
      return;
    }
  };

  const proposal = (name: string) => ({ name }) as HuntProposal;

  const importPlugin = async (ui: Ui, original: Pkg & { kind: 'plugin' }): Promise<void> => {
    const markets = readMarkets(d.root()).filter(m => m.owned);
    if (!markets.length) return void vscode.window.showInformationMessage('A plugin needs a marketplace folder of yours on disk. Register one with claude plugin marketplace add <folder>.');
    const picked = await ui.pick({
      title: `Import ${original.name}`,
      sub: 'Plugin into a marketplace',
      facts: ['The plugin is written into a marketplace folder of yours and installed from it.'],
      action: 'Next',
      glyph: 'package',
      choices: markets.map(m => ({ id: m.name, label: m.name, note: home(m.location) })),
    });
    const market: HuntMarket | undefined = markets.find(m => m.name === picked);
    if (!market) return;
    const stamp = backupStamp();
    let pkg = original;
    let category = '';
    if (market.categorized) {
      const value = await ui.input({ title: 'Pick a category', sub: `${market.name} keeps plugins in category folders`, facts: [`Existing: ${market.categories.join(', ') || 'none'}.`], label: 'Category', value: market.categories[0] ?? '', action: 'Next', glyph: 'folder', validate: v => (/^[a-z0-9][a-z0-9._-]*$/.test(v) ? undefined : 'Lowercase letters, digits, dots, dashes and underscores.') });
      if (!value) return;
      category = value;
    }
    let plan = planPluginImport(pkg, market, pkg.name, category);
    for (;;) {
      if (plan.problem) {
        const name = await ui.input({ title: 'Name the plugin', sub: `into ${market.name}`, facts: [plan.problem], label: 'Name', value: plan.name, action: 'Next', glyph: 'edit', validate: v => (/^[a-z0-9][a-z0-9._-]*$/.test(v) ? undefined : 'Lowercase letters, digits, dots, dashes and underscores.') });
        if (!name) return;
        pkg = { ...pkg, name };
        plan = planPluginImport(pkg, market, name, category);
        continue;
      }
      const key = `${plan.name}@${market.name}`;
      const answer = await ui.confirm({
        title: `${plan.exists ? 'Replace' : 'Import'} ${plan.name}`,
        sub: `Plugin into ${market.name}`,
        glyph: plan.exists ? 'replace-all' : 'package',
        danger: plan.exists,
        scroll: true,
        facts: [
          ...(plan.exists ? [`${market.name} already has a plugin called ${plan.name}.`, `Replace moves its folder to ${home(path.join(d.backupRoot(), stamp))} first.`] : []),
          `Writes into ${home(path.resolve(market.location))}:`,
          ...plan.files,
          `Installs ${key} for you in every folder.`,
        ],
        action: plan.exists ? 'Replace' : 'Import',
        alt: plan.exists ? 'Use a new name' : undefined,
      });
      if (!answer) return;
      if (answer === 'alt') {
        const name = await ui.input({ title: 'Use a new name', sub: `Plugin into ${market.name}`, facts: [`${market.name} has ${plan.name} already.`], label: 'Name', value: `${plan.name}-2`, action: 'Next', glyph: 'edit', validate: v => (!/^[a-z0-9][a-z0-9._-]*$/.test(v) ? 'Lowercase letters, digits, dots, dashes and underscores.' : planPluginImport(pkg, market, v, category).exists ? `${v} exists too.` : undefined) });
        if (!name) return;
        pkg = { ...pkg, name };
        plan = planPluginImport(pkg, market, name, category);
        continue;
      }
      let backup: string | undefined;
      try {
        backup = writePluginImport(pkg, plan, market, d.backupRoot(), stamp);
      } catch (e) {
        return void vscode.window.showErrorMessage(`Nothing was imported: ${(e as Error).message}`);
      }
      try {
        if (plan.exists && isInstalled(d.root(), key)) {
          await runClaude(['plugin', 'marketplace', 'update', market.name], d.root());
          const r = await runClaude(['plugin', 'update', key, '--scope', 'user'], d.root());
          if (r.code !== 0) throw new Error(`claude plugin update ${key} failed: ${r.out.split('\n').filter(Boolean).slice(-1)[0] ?? `exit ${r.code}`}`);
        } else await installPlugin(proposal(plan.name), market, d.root());
        d.refresh();
        void say(`Imported and installed ${key}.${backup ? ` The old folder is backed up in ${home(backup)}.` : ''}`);
      } catch (e) {
        let undone = `The plugin folder is written in ${home(path.resolve(market.location))}.`;
        if (!plan.exists) {
          try {
            unwritePlugin(proposal(plan.name), { dir: plan.dir } as CreatePlan, market);
            undone = 'The plugin folder and its marketplace entry were removed again.';
          } catch {
            // the folder stays and the message says so
          }
        }
        d.refresh();
        void vscode.window.showErrorMessage(`${(e as Error).message} ${undone}`);
      }
      return;
    }
  };

  const importKind = (kind: ShareKind) => async (arg?: unknown) => {
    const given = arg && typeof arg === 'object' && 'file' in arg ? String((arg as { file: unknown }).file) : undefined;
    const file =
      given ??
      (
        await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: `Import ${shareLabel[kind]}`,
          title: `Import ${shareLabel[kind]}: pick the ${kind === 'skill' || kind === 'plugin' ? 'zip' : 'file'} someone shared`,
          filters: FILTERS[kind],
        })
      )?.[0]?.fsPath;
    if (!file) return;
    const read = readPackage(kind, file);
    if ('problem' in read) return void vscode.window.showErrorMessage(`${path.basename(file)} is not a ${shareLabel[kind]}. ${read.problem}`);
    const ui = uiFor(arg);
    if (read.pkg.kind === 'plugin') return importPlugin(ui, read.pkg);
    const preferred = arg && typeof arg === 'object' && 'scope' in arg ? String((arg as { scope: unknown }).scope || '') : undefined;
    const scope = await scopeCard(ui, kind, read.pkg, preferred);
    if (scope) await importInto(ui, kind, read.pkg, scope);
  };

  return [vscode.commands.registerCommand('claudeHarness.share', share), ...SHARE_KINDS.map(kind => vscode.commands.registerCommand(`claudeHarness.${COMMAND[kind]}`, importKind(kind)))];
}
