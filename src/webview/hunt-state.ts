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
  error: '',
  // A short confirmation of an action, shown by the message box.
  notice: '',
  menu: false,
  // The card whose "add" picker is open, with its search.
  adding: undefined,
  addQuery: '',
  // What the last Create of each card said.
  results: {},
  // The conversation shows its last turns; older ones open on request.
  earlier: false,
  // After the next paint: a card to bring into view or to focus, the picker or the search to focus, the newest reply to show.
  reveal: undefined,
  focusName: undefined,
  focusMenu: false,
  focusAdder: false,
  showReply: false,
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

// Scrolls the page body, and nothing above it, so that a node shows: at the top of the body, or just inside it.
const bring = (node, where) => {
  const body = app.querySelector('.main-body');
  if (!body || !node) return;
  const b = body.getBoundingClientRect();
  const n = node.getBoundingClientRect();
  if (where === 'start' || n.top < b.top || n.height > b.height) body.scrollTop += n.top - b.top - 8;
  else if (n.bottom > b.bottom) body.scrollTop += n.bottom - b.bottom + 8;
};

const afterPaint = () => {
  const card = id => app.querySelector(`[data-card="${id}"]`);
  if (hunt.focusName) {
    const input = card(hunt.focusName)?.querySelector('.hunt-title');
    input?.focus();
    bring(input);
    hunt.focusName = undefined;
    hunt.reveal = undefined;
  } else if (hunt.reveal) {
    bring(card(hunt.reveal));
    hunt.reveal = undefined;
    hunt.showReply = false;
  } else if (hunt.showReply) {
    const replies = app.querySelectorAll('.hunt-msg.claude');
    bring(replies[replies.length - 1], 'start');
    hunt.showReply = false;
  }
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

// A repaint that stays where the owner had scrolled, unless something asked to be shown.
export const repaint = () => {
  if (state.page !== 'hunt' || state.detail) return;
  const top = app.querySelector('.main-body')?.scrollTop ?? 0;
  renderMain();
  const body = app.querySelector('.main-body');
  if (body) body.scrollTop = top;
  afterPaint();
};

export const marketOf = () => hunt.info && hunt.info.markets.find(k => k.name === hunt.picked);
