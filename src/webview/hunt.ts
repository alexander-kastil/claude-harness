// @ts-nocheck
// The Plugin Hunter page: a conversation with Claude, a marketplace picker and the cards of proposed plugins.
import { showPage, vscode } from './core';
import { confirmAt } from './confirm';
import { aiGroup, claudeMark, countHead, el, icon, iconBtn } from './dom';
import { hideHover } from './hover';
import { showKindPage } from './kind-page';
import { card, newCard } from './hunt-card';
import { tabBar } from './repo-page';
import { chatView } from './hunt-chat';
import { marketPicker } from './hunt-picker';
import { hunt, repaint, splitCards, tickWait, workingTurns } from './hunt-state';

export const openHunt = () => {
  vscode.postMessage({ type: 'huntInfo' });
  showPage('hunt');
};

// The Plugins page's header button.
// The page's main action: the primary button with the Claude mark, since the hunt is Claude's work and counts against the plan.
export const huntButton = () => el('button', { className: 'primary hunt-cta', title: 'Plugin Hunter\nClaude proposes a plugin from the skills and agents you already have, and creates it in a marketplace you own. It counts against your plan.', onclick: openHunt }, claudeMark(16), 'Plugin Hunter');

export function onHuntMessage(m) {
  if (m.type === 'hunt') {
    hunt.info = m.info;
    hunt.proposals = m.info.proposals;
    hunt.chat = m.info.chat || [];
    hunt.created = m.info.created || {};
    if (!hunt.picked || !m.info.markets.some(k => k.name === hunt.picked && k.owned)) hunt.picked = m.info.picked;
  } else if (m.type === 'huntRun') {
    hunt.running = m.state === 'running';
    if (hunt.running) hunt.startedAt = Date.now();
    tickWait(hunt.running);
    hunt.pending = m.state === 'running' ? (hunt.cardAsk ? hunt.cardAsk.text : hunt.prompt) : '';
    hunt.error = m.state === 'error' ? m.error || 'Claude could not answer. Your message is still in the box.' : '';
    if (m.state !== 'running' && hunt.cardAsk) {
      // The comment is answered: gone from its card. A failed answer leaves it there.
      if (m.state === 'done') delete hunt.notes[hunt.cardAsk.id];
      hunt.cardAsk = undefined;
    } else if (m.state === 'done') hunt.prompt = '';
    if (m.state === 'done') {
      hunt.reveal = m.card;
      hunt.showReply = true;
    }
  } else if (m.type === 'huntCreate') {
    hunt.results[m.id] = { state: m.state, text: m.text };
    if (m.state === 'done') {
      hunt.created = { ...hunt.created, [m.id]: m.text };
      // The created card moves to the History; it opens there so the result and its chat are in view.
      hunt.tab = 'history';
      hunt.open[m.id] = true;
      hunt.reveal = m.id;
    }
  }
  repaint();
}

// Nothing to create in: the page says so and points at where marketplaces are listed.
const noMarket = () =>
  hunt.info && !hunt.info.markets.some(k => k.owned)
    ? el(
        'div',
        { className: 'notice', role: 'status' },
        el('div', {}, 'No marketplace of your own. Plugin Hunter writes plugins into a marketplace folder on your disk; GitHub and URL marketplaces are overwritten on update.'),
        el('div', { className: 'hunt-notice-actions' }, el('button', { className: 'secondary', onclick: () => showPage('marketplaces') }, icon('package'), 'Open Marketplace health'))
      )
    : null;

export function renderHunt() {
  const ask = el('textarea', {
    className: 'hunt-ask-text',
    rows: 4,
    placeholder: hunt.running ? 'Claude is answering. Your message is in the conversation below.' : 'Message Claude, e.g. "search all angular related harness elements", "create the plugin" or "take angular-pwa-swa out"',
    // The sent message shows once, in the conversation; the box holds it again only if the answer fails.
    value: hunt.running ? '' : hunt.prompt,
    readonly: hunt.running,
    'aria-label': 'Message to Claude',
    oninput: e => {
      hunt.prompt = e.target.value;
      if (huntBtn) huntBtn.disabled = hunt.running || !hunt.prompt.trim();
    },
  });
  const huntBtn = confirmAt(
    el('button', { className: 'primary', disabled: hunt.running || !hunt.prompt.trim(), onclick: () => ((hunt.cardAsk = undefined), vscode.postMessage({ type: 'huntRun', prompt: hunt.prompt })) }, icon('telescope'), hunt.running ? 'Hunting...' : 'Hunt'),
    'hunt'
  );
  const split = splitCards();
  const composer = el(
    'div',
    { className: 'hunt-ask' },
    ask,
    hunt.error ? el('div', { className: 'notice bad', role: 'alert' }, hunt.error) : null,
    el('div', { className: 'hunt-ask-actions' }, hunt.notice ? el('span', { className: 'hunt-note', role: 'status' }, icon('check'), hunt.notice) : null, el('span', { className: 'spacer' }), el('button', { className: 'secondary', disabled: hunt.running, onclick: newCard }, icon('add'), 'New plugin'), aiGroup('', huntBtn))
  );
  const pickTab = id => {
    hunt.tab = id;
    hideHover();
    repaint();
  };
  const bar = tabBar(
    [
      ['new', 'New hunt', 'sparkle', 'Talk to Claude and pick what goes into the plugin.', undefined],
      ['history', 'History', 'history', 'The plugin cards you have made or started, each with the chat that made it.', split.history.length],
    ],
    hunt.tab,
    pickTab,
    'Plugin Hunter views'
  );
  // The new hunt: half chat (the message box and the conversation), half findings and selections (the proposed card with its picker).
  const fresh = el(
    'div',
    { className: 'hunt-split' },
    el('div', { className: 'hunt-col hunt-col-chat' }, el('div', { className: 'hunt-col-head' }, icon('comment-discussion'), el('span', {}, 'Chat')), composer, chatView(workingTurns(split))),
    el(
      'div',
      { className: 'hunt-col hunt-col-find' },
      el('div', { className: 'hunt-col-head' }, icon('checklist'), el('span', {}, 'Findings and selections'), split.working ? el('span', { className: 'hunt-col-count' }, `${split.working.assets.filter(a => a.include).length} selected`) : null),
      split.working
        ? card(split.working)
        : hunt.info
          ? el('div', { className: 'empty flush' }, 'Nothing proposed yet. The skills and agents Claude finds appear here, ready to keep or drop, once you send a message or press New plugin.')
          : el('div', { className: 'empty flush' }, 'Reading your skills and agents...')
    )
  );
  const history = split.history.length
    ? el('div', { className: 'hunt-history' }, split.history.map(p => card(p, true)))
    : el('div', { className: 'empty flush' }, hunt.info ? 'No history yet. A plugin card you finish or set aside is kept here with its chat.' : 'Reading your skills and agents...');
  return el(
    'section',
    { className: 'main' },
    countHead('telescope', 'Plugin Hunter', hunt.info ? `${hunt.info.catalog.length} ${hunt.info.catalog.length === 1 ? 'skill or agent' : 'skills and agents'}` : 'Reading...', iconBtn('arrow-left', 'Back to Plugins', () => showKindPage('plugin', undefined)), marketPicker()),
    el('div', { className: 'main-body hunt-body', onscroll: hideHover }, noMarket(), bar, hunt.tab === 'history' ? history : fresh)
  );
}
