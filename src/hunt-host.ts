import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { HuntHost } from './panel';
import { KeepCopies, ScopeView, backupStamp } from './harness';
import { HUNT_SYSTEM, applyProposal, chatPrompt, parseTurn, shortReply, unknownNames } from './hunt';
import { assetAt, buildCatalog, inventoryText, items, reconcile } from './hunt-catalog';
import { installPlugin, planCreate, retireCopies, unwritePlugin, writePlugin } from './hunt-create';
import { readMarkets } from './hunt-market';
import type { HuntInfo, HuntProposal, HuntTurn } from './shared/hunt';
import type { Answer, Confirm } from './shared/messages';
import { draftStyle } from './style';

export interface HuntDeps {
  state: vscode.Memento;
  root: () => string;
  views: () => ScopeView[];
  plugins: () => ScopeView[];
  keep: () => KeepCopies | undefined;
  refresh: () => void;
  /** Consolidate's own flow for a repo skill: its card, then the diff editor or Claude's merge. */
  consolidate: (assetId: string, answer: Answer, ask: (c: Confirm) => void) => Promise<void>;
}

const PROPOSALS = 'huntProposals';
const MARKET = 'huntMarket';
const REMEMBERED = 'huntRemembered';
const CHAT = 'huntChat';
// The card the conversation builds: the one a proposal updates.
const CURRENT = 'huntCurrent';
// Turns sent back to Claude with each message.
const HISTORY = 20;
// The text each created card shows, by card id.
const CREATED = 'huntCreated';

/** A Claude failure in the owner's words, not the raw error line. */
const friendly = (error: string): string => {
  const code = /\b([45]\d\d)\b/.exec(error)?.[1];
  if (/api error|overloaded|rate limit|unavailable/i.test(error) || code) return `Claude is busy or unavailable right now${code ? ` (error ${code})` : ''}. Your message is still in the box: try again.`;
  return `Claude could not answer: ${error.split('\n')[0].slice(0, 160)} Your message is still in the box.`;
};

export function huntHost(d: HuntDeps): HuntHost {
  let busy = false;
  const stored = () => d.state.get<HuntProposal[]>(PROPOSALS, []);

  const info = (): HuntInfo => {
    const markets = readMarkets(d.root());
    const last = d.state.get<string>(MARKET);
    // The last one used, else the own marketplace that holds the most installed plugins.
    const installed = (name: string) => d.plugins().filter(p => p.id.endsWith(`@${name}`)).length;
    const richest = markets.filter(m => m.owned).sort((a, b) => installed(b.name) - installed(a.name))[0]?.name;
    const picked = markets.find(m => m.owned && m.name === last)?.name ?? richest;
    const catalog = buildCatalog(d.views(), d.plugins());
    const created = d.state.get<Record<string, string>>(CREATED, {});
    const proposals = reconcile(stored(), catalog, created).sort((a, b) => b.created - a.created);
    return { markets, picked, catalog, proposals, chat: d.state.get<HuntTurn[]>(CHAT, []), created };
  };

  const self: HuntHost = {
    info,
    save: (proposals, market) => {
      void d.state.update(PROPOSALS, proposals);
      if (market) void d.state.update(MARKET, market);
    },
    run: async (prompt, answer, ask, post) => {
      if (!prompt.trim()) return void post({ type: 'huntRun', state: 'error', error: 'Write a message first.' });
      if (busy) return;
      const views = d.views();
      const plugins = d.plugins();
      const open = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
      const inventory = inventoryText(views, plugins, open);
      const chat = d.state.get<HuntTurn[]>(CHAT, []);
      // Asked once per conversation: the card says every message of it counts against the plan.
      if (!chat.length && !answer.confirmed && !d.state.get<boolean>(REMEMBERED)) return ask({ kind: 'hunt', prompt, items: inventory.split('\n').length });
      if (answer.remember) await d.state.update(REMEMBERED, true);
      busy = true;
      post({ type: 'huntRun', state: 'running' });
      let createId: string | undefined;
      let touched: string | undefined;
      let latest: HuntInfo | undefined;
      try {
        const catalog = buildCatalog(views, plugins);
        const currentId = d.state.get<string>(CURRENT);
        const sent = reconcile(stored(), catalog).find(p => p.id === currentId);
        const result = await draftStyle(chatPrompt(prompt, inventory, sent, chat.slice(-HISTORY)), 'sonnet', os.tmpdir(), 300000, HUNT_SYSTEM);
        if ('error' in result) return void post({ type: 'huntRun', state: 'error', error: friendly(result.error) });
        const turn = parseTurn(result.text);
        let reply = shortReply(turn.reply) || 'Done.';
        // Edits made on the card while Claude was answering are the card as it is now.
        const live = reconcile(stored(), catalog).find(p => p.id === currentId);
        if (turn.proposal) {
          const left = unknownNames(turn.proposal, catalog);
          if (left.length) reply += ` Left out ${left.length} not in your inventory.`;
          const card = applyProposal(live, turn.proposal, chat.find(t => t.role === 'owner')?.text ?? prompt, catalog, live?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, Date.now(), sent);
          // A proposal with nothing in it never empties a card, and never makes an empty one.
          if (card.assets.length) {
            const cards = stored();
            await d.state.update(PROPOSALS, live ? cards.map(c => (c.id === card.id ? card : c)) : [card, ...cards]);
            await d.state.update(CURRENT, card.id);
            touched = card.id;
          } else reply += live ? ' The card was left as it is.' : '';
        }
        const now = Date.now();
        await d.state.update(CHAT, [...chat, { role: 'owner', text: prompt, at: now }, { role: 'claude', text: reply, at: now }]);
        if (turn.create) createId = touched ?? d.state.get<string>(CURRENT);
        // The page gets the new card first, so that "done" can bring it and the reply into view.
        latest = info();
        post({ type: 'hunt', info: latest });
        post({ type: 'huntRun', state: 'done', card: touched });
      } catch (e) {
        post({ type: 'huntRun', state: 'error', error: friendly((e as Error).message) });
      } finally {
        busy = false;
      }
      // "Create the plugin": the card's own Create question, for the marketplace picked on the page.
      if (createId && latest?.proposals.some(p => p.id === createId)) {
        if (latest.picked) await self.create(createId, latest.picked, {}, ask, post);
        else post({ type: 'huntCreate', id: createId, state: 'error', text: 'Pick a marketplace of yours first.' });
      }
    },
    clear: () => {
      void d.state.update(CHAT, []);
      void d.state.update(CURRENT, undefined);
    },
    create: async (id, marketName, answer, ask, post) => {
      const say = (state: 'running' | 'done' | 'error', text?: string) => post({ type: 'huntCreate', id, state, text });
      const proposal = reconcile(stored(), buildCatalog(d.views(), d.plugins())).find(p => p.id === id);
      const market = readMarkets(d.root()).find(m => m.name === marketName);
      if (!proposal || !market) return say('error', 'The card or the marketplace is gone.');
      const made = d.state.get<Record<string, string>>(CREATED, {})[id];
      if (made) return say('done', made);
      if (busy) return;
      const backupRoot = path.join(d.root(), 'repo-sync-backups');
      const plan = planCreate(proposal, { root: d.root(), views: d.views(), market, backupRoot, keep: d.keep() });
      if (plan.problems.length) return say('error', plan.problems.join(' '));
      if (!answer.confirmed) return ask({ kind: 'huntCreate', id, key: id, name: proposal.name, market: market.name, location: path.resolve(market.location), problems: [], files: plan.files, retired: plan.retired, kept: plan.kept });
      busy = true;
      say('running');
      const key = `${proposal.name}@${market.name}`;
      try {
        await writePlugin(proposal, plan, market);
      } catch (e) {
        busy = false;
        return say('error', `Nothing was created: ${(e as Error).message}`);
      }
      try {
        await installPlugin(proposal, market, d.root());
      } catch (e) {
        busy = false;
        let undone = 'The plugin folder and its marketplace entry were removed again; no copy was retired.';
        try {
          unwritePlugin(proposal, plan, market);
        } catch {
          undone = 'The plugin folder and its marketplace entry are written; no copy was retired.';
        }
        d.refresh();
        return say('error', `${(e as Error).message} ${undone}`);
      }
      try {
        const backup = plan.retires.length ? retireCopies(plan, backupRoot, backupStamp()) : undefined;
        const text = `Created and installed ${key}.${backup ? ` Retired ${plan.retires.length} ${plan.retires.length === 1 ? 'copy' : 'copies'}, each backed up first in ${path.relative(d.root(), backup)}.` : ''}`;
        await d.state.update(CREATED, { ...d.state.get<Record<string, string>>(CREATED, {}), [id]: text });
        // The next proposal of the conversation is a new plugin, not a change to this one.
        if (d.state.get<string>(CURRENT) === id) await d.state.update(CURRENT, undefined);
        say('done', text);
      } catch (e) {
        say('error', `${key} is installed, but retiring failed: ${(e as Error).message}`);
      } finally {
        busy = false;
        d.refresh();
        post({ type: 'hunt', info: info() });
      }
    },
    merge: async (kind, file, ask) => {
      const asset = assetAt(d.views(), kind, file)?.asset;
      if (!asset) return void vscode.window.showInformationMessage('That copy is no longer on disk.');
      if (asset.kind === 'agent') {
        // Agents are not merged: the repo copy opens next to the global one in the diff editor.
        const global = d.views().filter(v => v.id === 'global').flatMap(v => items(v, 'agent')).find(a => a.name === asset.name);
        if (!global) return void vscode.window.showInformationMessage('There is no global copy to compare with.');
        return void vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(global.file), vscode.Uri.file(asset.file), `${asset.name}: global and repo copy`);
      }
      await d.consolidate(asset.id, {}, ask);
    },
  };
  return self;
}
