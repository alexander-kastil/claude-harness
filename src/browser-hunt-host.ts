import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { BrowserHuntHost } from './panel';
import { BROWSER_HUNT_SYSTEM, applyCard, chatPrompt, leafText, parseProcedures, parseTurn, withRow } from './browser-hunt';
import { backupStamp } from './harness';
import { Bump, CreatePlan, isInstalled, planBump, writeVersions } from './hunt-create';
import { Entry, catalogOf, readMarkets } from './hunt-market';
import { updatePluginFromMarket } from './sync';
import type { HuntMarket } from './shared/hunt';
import { shortReply } from './hunt';
import { items } from './hunt-catalog';
import { ScopeView } from './harness';
import type { BrowserCard, BrowserHuntInfo, BrowserTurn } from './shared/browser-hunt';
import { draftStyle } from './style';

export interface BrowserHuntDeps {
  state: vscode.Memento;
  views: () => ScopeView[];
  plugins: () => ScopeView[];
  root: () => string;
  refresh: () => void;
}

const CARDS = 'browserHuntCards';
const CHAT = 'browserHuntChat';
const CURRENT = 'browserHuntCurrent';
const REMEMBERED = 'browserHuntRemembered';
// The text each written card shows, by card id.
const CREATED = 'browserHuntCreated';
// Turns sent back to Claude with each message.
const HISTORY = 20;
// The skill whose procedure table the hunter starts from.
const SKILL = 'browser-automations';

const friendly = (error: string): string => {
  const code = /\b([45]\d\d)\b/.exec(error)?.[1];
  if (/api error|overloaded|rate limit|unavailable/i.test(error) || code) return `Claude is busy or unavailable right now${code ? ` (error ${code})` : ''}. Your message is still in the box: try again.`;
  return `Claude could not answer: ${error.split('\n')[0].slice(0, 160)} Your message is still in the box.`;
};

export function browserHuntHost(d: BrowserHuntDeps): BrowserHuntHost {
  let busy = false;
  const stored = () => d.state.get<BrowserCard[]>(CARDS, []);

  /**
   * The skill file and its text. A Global or repo copy is written directly. An installed plugin's copy is a version copy in the
   * plugin cache that the next update overwrites, so it is written in the plugin's source in a marketplace of the owner's, and
   * `plugin` says where; with no such marketplace `problem` says why nothing can be written.
   */
  const skill = (): { file?: string; text: string; plugin?: { key: string; name: string; market: HuntMarket; entries: Entry[]; dir: string }; problem?: string } => {
    const read = (file: string) => {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch {
        return undefined;
      }
    };
    for (const v of d.views()) {
      const a = items(v, 'skill').find(x => x.name === SKILL);
      const text = a && read(a.file);
      if (a && text !== undefined) return { file: a.file, text };
    }
    for (const v of d.plugins()) {
      const a = items(v, 'skill').find(x => x.name === SKILL);
      if (!a) continue;
      const key = v.id.slice('plugin:'.length);
      const [name, marketName] = key.split('@');
      const cached = read(a.file) ?? '';
      const market = readMarkets(d.root()).find(m => m.name === marketName && m.owned);
      if (!market) return { text: cached, problem: `${name} comes from ${marketName}, which is not a marketplace folder of yours on disk. Its installed copy is overwritten on the next update, so nothing is written there.` };
      const entries = catalogOf(market.location);
      const source = entries.find(e => e.name === name)?.source;
      const dir = typeof source === 'string' && source.startsWith('./') ? path.resolve(market.location, source) : '';
      const file = dir && path.join(dir, 'skills', SKILL, 'SKILL.md');
      const text = file ? read(file) : undefined;
      if (!file || text === undefined) return { text: cached, problem: `${marketName} does not hold the ${SKILL} skill of ${name} as a folder, so nothing is written.` };
      return { file, text, plugin: { key, name, market, entries, dir } };
    }
    return { text: '' };
  };

  const info = (): BrowserHuntInfo => {
    const s = skill();
    return { procedures: parseProcedures(s.text), source: s.file, problem: s.problem, cards: stored().sort((a, b) => b.created - a.created), chat: d.state.get<BrowserTurn[]>(CHAT, []), created: d.state.get<Record<string, string>>(CREATED, {}) };
  };

  return {
    info,
    save: cards => void d.state.update(CARDS, cards),
    clear: () => {
      void d.state.update(CHAT, []);
      void d.state.update(CURRENT, undefined);
    },
    create: async (id, answer, ask, post) => {
      const say = (state: 'running' | 'done' | 'error', text?: string) => post({ type: 'browserHuntCreate', id, state, text });
      const card = stored().find(c => c.id === id);
      const s = skill();
      const file = s.file;
      if (!card) return say('error', 'The card is gone.');
      if (s.problem) return say('error', s.problem);
      if (!file) return say('error', `No ${SKILL} skill was found in Global, a repo or an installed plugin.`);
      if (!card.name.trim() || !card.steps.length) return say('error', 'Give the procedure a name and at least one step.');
      if (busy) return;
      const dir = path.dirname(file);
      const leaf = path.join(dir, 'references', `${card.name}.md`);
      const leafRel = `references/${card.name}.md`;
      const backups = ['SKILL.md', ...(fs.existsSync(leaf) ? [leafRel] : [])];
      // In a plugin's source the plugin's patch version moves too, in plugin.json and the marketplace entry, and the installed plugin is updated.
      let bump: Bump | undefined;
      const files = ['SKILL.md', leafRel];
      if (s.plugin) {
        const plan: CreatePlan = { problems: [], files: [], retired: [], kept: [], source: '', dir: '', chosen: [], retires: [], extra: [] };
        bump = planBump(s.plugin.name, s.plugin.entries, { root: d.root(), views: d.views(), market: s.plugin.market, backupRoot: path.join(d.root(), 'repo-sync-backups') }, plan);
        if (plan.problems.length) return say('error', plan.problems.join(' '));
        const rel = path.relative(s.plugin.market.location, dir).replace(/\\/g, '/');
        files.splice(0, files.length, `${rel}/SKILL.md`, `${rel}/${leafRel}`, ...plan.files);
      }
      const installed = !!s.plugin && isInstalled(d.root(), s.plugin.key);
      if (!answer.confirmed) return ask({ kind: 'browserHuntCreate', id, key: id, name: card.name, location: s.plugin ? s.plugin.market.location : dir, files, backups, plugin: s.plugin ? s.plugin.key : undefined, installed });
      busy = true;
      say('running');
      const before = { skill: fs.readFileSync(file, 'utf8'), leaf: fs.existsSync(leaf) ? fs.readFileSync(leaf, 'utf8') : undefined };
      let saved: { file: string; text: string }[] = [];
      const undo = () => {
        fs.writeFileSync(file, before.skill);
        if (before.leaf === undefined) fs.rmSync(leaf, { force: true });
        else fs.writeFileSync(leaf, before.leaf);
        for (const f of saved) fs.writeFileSync(f.file, f.text);
      };
      try {
        // What changes is backed up first, next to the other backups of the harness.
        const backup = path.join(d.root(), 'repo-sync-backups', `browser-hunt-${backupStamp()}`);
        for (const f of backups) {
          fs.mkdirSync(path.dirname(path.join(backup, f)), { recursive: true });
          fs.copyFileSync(path.join(dir, f), path.join(backup, f));
        }
        fs.writeFileSync(file, withRow(before.skill, card));
        fs.mkdirSync(path.dirname(leaf), { recursive: true });
        fs.writeFileSync(leaf, leafText(card));
        if (s.plugin && bump) {
          saved = writeVersions([bump], s.plugin.market);
          if (installed) await updatePluginFromMarket(s.plugin.key, s.plugin.market.name, bump.version ?? undefined, d.root());
        }
        const text = `Written to ${SKILL}${s.plugin ? ` (${s.plugin.name} ${bump?.version ?? 'unchanged'}${installed ? ', installed plugin updated' : ''})` : ''}. Backup: ${path.relative(d.root(), backup)}`;
        await d.state.update(CREATED, { ...d.state.get<Record<string, string>>(CREATED, {}), [id]: text });
        say('done', text);
      } catch (e) {
        undo();
        say('error', `Nothing was kept: ${(e as Error).message}`);
      } finally {
        busy = false;
        d.refresh();
        post({ type: 'browserHunt', info: info() });
      }
    },
    run: async (prompt, answer, ask, post, cardId) => {
      if (!prompt.trim()) return void post({ type: 'browserHuntRun', state: 'error', error: 'Write a message first.' });
      if (busy) return;
      const s = skill();
      const chat = d.state.get<BrowserTurn[]>(CHAT, []);
      // Asked once per conversation: the card says every message of it counts against the plan.
      if (!chat.length && !answer.confirmed && !d.state.get<boolean>(REMEMBERED)) return ask({ kind: 'browserHunt', prompt, procedures: parseProcedures(s.text).length, card: cardId });
      if (answer.remember) await d.state.update(REMEMBERED, true);
      busy = true;
      post({ type: 'browserHuntRun', state: 'running' });
      try {
        const currentId = cardId && stored().some(c => c.id === cardId) ? cardId : d.state.get<string>(CURRENT);
        const sent = stored().find(c => c.id === currentId);
        const result = await draftStyle(chatPrompt(prompt, s.text, sent, chat.slice(-HISTORY)), 'sonnet', os.tmpdir(), 300000, BROWSER_HUNT_SYSTEM);
        if ('error' in result) return void post({ type: 'browserHuntRun', state: 'error', error: friendly(result.error) });
        const turn = parseTurn(result.text);
        const reply = shortReply(turn.reply) || 'Done.';
        // Edits made on the card while Claude was answering are the card as it is now.
        const live = stored().find(c => c.id === currentId);
        let touched: string | undefined;
        if (turn.card) {
          const next = applyCard(live, turn.card, chat.find(t => t.role === 'owner')?.text ?? prompt, live?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, Date.now(), sent);
          // An answer with nothing in it never empties a card, and never makes an empty one.
          if (next.steps.length || live) {
            await d.state.update(CARDS, live ? stored().map(c => (c.id === next.id ? next : c)) : [next, ...stored()]);
            await d.state.update(CURRENT, next.id);
            touched = next.id;
          }
        }
        const now = Date.now();
        const at = touched ?? live?.id ?? '';
        await d.state.update(CHAT, [...chat, { role: 'owner', text: prompt, at: now, card: at }, { role: 'claude', text: reply, at: now, card: at }]);
        post({ type: 'browserHunt', info: info() });
        post({ type: 'browserHuntRun', state: 'done', card: touched });
      } catch (e) {
        post({ type: 'browserHuntRun', state: 'error', error: friendly((e as Error).message) });
      } finally {
        busy = false;
      }
    },
  };
}
