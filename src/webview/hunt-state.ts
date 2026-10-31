// @ts-nocheck
// The Plugin Hunter page's state, its saves and its repaint, shared by the page and its card, chat and picker views.
import { app, state, vscode } from './core';
import { renderMain } from './main';

export const hunt = {
  info: undefined,
  proposals: [],
  chat: [],
  // What Create said for each card that was created: those cards are done.
  created: {},
  // The message being answered, shown in the chat until Claude's reply arrives.
  pending: '',
  picked: undefined,
  prompt: '',
  running: false,
  // When the running turn started, for the elapsed time shown while Claude works.
  startedAt: 0,
  error: '',
  // A short confirmation of an action, shown by the message box.
  notice: '',
  menu: false,
  // The card whose "add" picker is open, with its search.
  adding: undefined,
  addQuery: '',
  // What the last Create of each card said.
  results: {},
  // The page's tab, and the History items that are open (collapsed by default), by card id.
  tab: 'new',
  open: {},
  // After the next paint: a card to bring into view or to focus, the picker or the search to focus, the newest reply to show.
  reveal: undefined,
  focusName: undefined,
  focusMenu: false,
  focusAdder: false,
  showReply: false,
};

/** What the waiting reply says: that Claude is still at it, and for how long. */
export const waitText = () => {
  const s = Math.max(0, Math.floor((Date.now() - hunt.startedAt) / 1000));
  return `Claude is working on it, ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} so far. A search over many skills can take a couple of minutes.`;
};

let ticker;
/** Starts or stops the once-a-second update of the waiting reply; it changes that one text, so the page does not repaint. */
export const tickWait = on => {
  clearInterval(ticker);
  if (!on) return;
  ticker = setInterval(() => {
    const text = app.querySelector('.hunt-msg.wait .hunt-msg-text');
    if (text) text.textContent = waitText();
  }, 1000);
};

let saveTimer;
export const saveNow = () => {
  clearTimeout(saveTimer);
  vscode.postMessage({ type: 'huntSave', proposals: hunt.proposals, market: hunt.picked });
};
export const saveSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
};

const card = id => app.querySelector(`[data-card="${id}"]`);

// After a paint: the card to focus or bring into view (in whichever column or page scrolls it), the adder to focus.
const afterPaint = () => {
  if (hunt.focusName) {
    const input = card(hunt.focusName)?.querySelector('.hunt-title');
    input?.focus();
    input?.scrollIntoView({ block: 'nearest' });
  } else if (hunt.reveal) card(hunt.reveal)?.scrollIntoView({ block: 'nearest' });
  hunt.focusName = hunt.reveal = undefined;
  if (hunt.focusAdder) {
    app.querySelector('.hunt-adder input')?.focus();
    hunt.focusAdder = false;
  }
  if (hunt.focusMenu) {
    const items = [...app.querySelectorAll('.hunt-market')];
    (items.find(i => i.classList.contains('on')) || items[0])?.focus();
    hunt.focusMenu = false;
  }
};

// A repaint that stays where the owner had scrolled: the page, the card column and the chat. The chat is a traditional one: it
// follows the newest message while it is at the bottom or a reply just arrived.
const SCROLLERS = ['.main-body', '.hunt-col-find'];
export const repaint = () => {
  if (state.page !== 'hunt' || state.detail) return;
  const tops = SCROLLERS.map(q => app.querySelector(q)?.scrollTop ?? 0);
  const log = app.querySelector('.hunt-chat-log');
  const follow = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  const logTop = log?.scrollTop ?? 0;
  renderMain();
  SCROLLERS.forEach((q, i) => {
    const node = app.querySelector(q);
    if (node) node.scrollTop = tops[i];
  });
  const next = app.querySelector('.hunt-chat-log');
  if (next) next.scrollTop = follow || hunt.showReply ? next.scrollHeight : logTop;
  hunt.showReply = false;
  afterPaint();
};

/** A card Create has made a plugin of. */
export const isDone = p => !!(hunt.created[p.id] || (hunt.results[p.id] && hunt.results[p.id].state === 'done'));

/** The cards, newest first: the one being worked on (the newest not yet created) and the rest, which are the History. */
export const splitCards = () => {
  const all = [...hunt.proposals].sort((a, b) => b.created - a.created);
  const working = all.find(p => !isDone(p));
  return { all, working, history: all.filter(p => p !== working) };
};

/** The card a turn belongs to: the one it names; a turn from before that field is the newest card made at or before it; '' is the working one. */
const cardOfTurn = (t, all) => (t.card !== undefined ? t.card : (all.find(p => p.created <= t.at) || {}).id || '');

/** The turns of one card, oldest first. */
export const turnsOf = (p, all) => hunt.chat.filter(t => cardOfTurn(t, all) === p.id);

/** The turns of the hunt in progress: those of its card and those that came before any card or name a card that is gone. */
export const workingTurns = ({ all, working }) => hunt.chat.filter(t => (working ? cardOfTurn(t, all) === working.id : false) || !all.some(p => p.id === cardOfTurn(t, all)));

/** New plugin: an empty card, on top and in focus, without asking Claude. */
export const newCard = () => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  hunt.proposals = [{ id, prompt: '', created: Date.now(), name: '', description: '', category: '', assets: [] }, ...hunt.proposals];
  hunt.focusName = id;
  saveNow();
  repaint();
};

/** New hunt: an empty card and an empty chat, as the chip's name says; a card nothing is on yet already is that. */
export const newHunt = () => {
  hunt.tab = 'new';
  const { working } = splitCards();
  if (working && !working.name.trim() && !working.assets.length) {
    hunt.focusName = working.id;
    return repaint();
  }
  hunt.prompt = '';
  newCard();
};

export const marketOf = () => hunt.info && hunt.info.markets.find(k => k.name === hunt.picked);
