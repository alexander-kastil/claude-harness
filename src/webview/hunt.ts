// @ts-nocheck
// The Plugin Hunter page: a marketplace picker and two tabs. New hunt is a chat with Claude beside the card it proposes; History keeps the other cards with their chats.
import { showPage, vscode } from './core';
import { aiGroup, claudeMark, countHead, coworkIcon, el, icon, iconBtn } from './dom';
import { hideHover } from './hover';
import { showKindPage } from './kind-page';
import { card } from './hunt-card';
import { chatColumn } from './hunt-chat';
import { marketPicker } from './hunt-picker';
import { hunt, repaint, splitCards, tickWait } from './hunt-state';
import { tabBar } from './repo-page';
import { browserHuntButton } from './browser-hunt';

export const openHunt = () => {
  vscode.postMessage({ type: 'huntInfo' });
  showPage('hunt');
};

// The Plugin Hunter button, in the AI group since the hunt is Claude's work and counts against the plan; like every AI group it sits last, at the right end of its bar.
export const huntButton = () => aiGroup('hunt-cta', el('button', { className: 'secondary', title: 'Plugin Hunter\nClaude proposes a plugin from the skills and agents you already have, and creates it in a marketplace you own. It counts against your plan.', 'aria-label': 'Plugin Hunter', onclick: openHunt }, icon('telescope'), el('span', { className: 'cta-label' }, 'Plugin Hunter')), browserHuntButton(), handoverButton());

// After the Browser Automation Hunter button, in the same AI group; the page reads its own inbox when it opens.
function handoverButton() {
  return el('button', { className: 'secondary', title: 'Cowork Handover\nHand a Cowork chat, an artifact link or a file of the apps to Claude Code in a terminal: Claude drafts the card, you tick what comes along. It counts against your plan.', 'aria-label': 'Cowork Handover', onclick: () => showPage('cowork-handover') }, coworkIcon(), el('span', { className: 'cta-label' }, 'Cowork Handover'));
}

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
    hunt.pending = hunt.running ? hunt.prompt : '';
    hunt.error = m.state === 'error' ? m.error || 'Claude could not answer. Your message is still in the box.' : '';
    // The message is answered: gone from the box. A failed answer leaves it there.
    if (m.state === 'done') {
      hunt.prompt = '';
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

const reading = 'Reading your skills and agents...';

export function renderHunt() {
  const split = splitCards();
  const bar = tabBar(
    [
      ['new', 'New hunt', 'sparkle', 'Talk to Claude and pick what goes into the plugin.', undefined],
      ['history', 'History', 'history', 'The plugin cards you have made or started, each with the chat that made it.', split.history.length],
    ],
    hunt.tab,
    id => ((hunt.tab = id), hideHover(), repaint()),
    'Plugin Hunter views'
  );
  // The new hunt: half chat, like a traditional one with its composer at the bottom, half findings and selections, the artifact: the proposed card with its picker.
  const fresh = el(
    'div',
    { className: 'hunt-split' },
    chatColumn(split),
    el(
      'div',
      { className: 'hunt-col hunt-col-find' },
      el('div', { className: 'hunt-col-head' }, icon('checklist'), el('span', {}, 'Findings and selections'), split.working ? el('span', { className: 'hunt-col-count' }, `${split.working.assets.filter(a => a.include).length} selected`) : null),
      split.working ? card(split.working) : el('div', { className: 'empty flush' }, hunt.info ? 'Nothing proposed yet. The skills and agents Claude finds appear here, ready to keep or drop, once you send a message or press New plugin.' : reading)
    )
  );
  const history = split.history.length ? el('div', { className: 'hunt-history' }, split.history.map(p => card(p, true))) : el('div', { className: 'empty flush' }, hunt.info ? 'No history yet. A plugin card you finish or set aside is kept here with its chat.' : reading);
  const count = hunt.info && hunt.info.catalog.length;
  const head = countHead('telescope', 'Plugin Hunter', hunt.info ? `${count} ${count === 1 ? 'skill or agent' : 'skills and agents'}` : 'Reading...', iconBtn('arrow-left', 'Back to Plugins', () => showKindPage('plugin', undefined)), marketPicker());
  // The processing line while Claude answers a Hunt or a Go.
  head.classList.toggle('busy', hunt.running);
  return el(
    'section',
    { className: 'main' },
    head,
    el('div', { className: 'main-body hunt-body', onscroll: hideHover }, noMarket(), bar, hunt.tab === 'history' ? history : fresh)
  );
}
