import * as os from 'os';
import * as vscode from 'vscode';
import type { BrowserHuntHost } from './panel';
import { BROWSER_HUNT_SYSTEM, applyCard, chatPrompt, parseProcedures, parseTurn } from './browser-hunt';
import { locateSkill, planCardWrite, writeCard } from './browser-hunt-skill';
import { shortReply } from './hunt';
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

const friendly = (error: string): string => {
  const code = /\b([45]\d\d)\b/.exec(error)?.[1];
  if (/api error|overloaded|rate limit|unavailable/i.test(error) || code) return `Claude is busy or unavailable right now${code ? ` (error ${code})` : ''}. Your message is still in the box: try again.`;
  return `Claude could not answer: ${error.split('\n')[0].slice(0, 160)} Your message is still in the box.`;
};

export function browserHuntHost(d: BrowserHuntDeps): BrowserHuntHost {
  let busy = false;
  const stored = () => d.state.get<BrowserCard[]>(CARDS, []);

  const skill = () => locateSkill(d.views(), d.plugins(), d.root());

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
      if (!card) return say('error', 'The card is gone.');
      const plan = planCardWrite(s, card, { root: d.root(), views: d.views() });
      if (plan.problem) return say('error', plan.problem);
      if (busy) return;
      if (!answer.confirmed) return ask({ kind: 'browserHuntCreate', id, key: id, name: card.name, location: plan.location, files: plan.files, backups: plan.backups, plugin: plan.plugin, installed: plan.installed });
      busy = true;
      say('running');
      try {
        const text = await writeCard(d.root(), s, card, plan);
        await d.state.update(CREATED, { ...d.state.get<Record<string, string>>(CREATED, {}), [id]: text });
        say('done', text);
      } catch (e) {
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
