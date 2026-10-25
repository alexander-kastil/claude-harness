// @ts-nocheck
// The Plugin Hunter page: a conversation with Claude, a marketplace picker and the cards of proposed plugins.
import { showPage, vscode } from './core';
import { confirmAt } from './confirm';
import { aiGroup, countHead, el, icon, iconBtn } from './dom';
import { hideHover } from './hover';
import { showKindPage } from './kind-page';
import { card, newCard } from './hunt-card';
import { chatView } from './hunt-chat';
import { marketPicker } from './hunt-picker';
import { hunt, repaint } from './hunt-state';

export const openHunt = () => {
  vscode.postMessage({ type: 'huntInfo' });
  showPage('hunt');
};

// The Plugins page's header button.
export const huntButton = () => el('button', { className: 'secondary', title: 'Plugin Hunter\nProposes a plugin from the skills and agents you already have, and creates it in a marketplace you own.', onclick: openHunt }, icon('telescope'), 'Plugin Hunter');

export function onHuntMessage(m) {
  if (m.type === 'hunt') {
    hunt.info = m.info;
    hunt.proposals = m.info.proposals;
    hunt.chat = m.info.chat || [];
    hunt.created = m.info.created || {};
    if (!hunt.picked || !m.info.markets.some(k => k.name === hunt.picked && k.owned)) hunt.picked = m.info.picked;
  } else if (m.type === 'huntRun') {
    hunt.running = m.state === 'running';
    hunt.pending = m.state === 'running' ? hunt.prompt : '';
    hunt.error = m.state === 'error' ? m.error || 'Claude could not answer. Your message is still in the box.' : '';
    if (m.state === 'done') {
      hunt.prompt = '';
      hunt.reveal = m.card;
      hunt.showReply = true;
    }
  } else if (m.type === 'huntCreate') {
    hunt.results[m.id] = { state: m.state, text: m.text };
    if (m.state === 'done') {
      hunt.created = { ...hunt.created, [m.id]: m.text };
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
    placeholder: 'Message Claude, e.g. "search all angular related harness elements", "create the plugin" or "take angular-pwa-swa out"',
    value: hunt.prompt,
    readonly: hunt.running,
    'aria-label': 'Message to Claude',
    oninput: e => {
      hunt.prompt = e.target.value;
      if (huntBtn) huntBtn.disabled = hunt.running || !hunt.prompt.trim();
    },
  });
  const huntBtn = confirmAt(
    el('button', { className: 'primary', disabled: hunt.running || !hunt.prompt.trim(), onclick: () => vscode.postMessage({ type: 'huntRun', prompt: hunt.prompt }) }, icon('telescope'), hunt.running ? 'Hunting...' : 'Hunt'),
    'hunt'
  );
  const cards = [...hunt.proposals].sort((a, b) => b.created - a.created);
  return el(
    'section',
    { className: 'main' },
    countHead('telescope', 'Plugin Hunter', hunt.info ? `${hunt.info.catalog.length} ${hunt.info.catalog.length === 1 ? 'skill or agent' : 'skills and agents'}` : 'Reading...', iconBtn('arrow-left', 'Back to Plugins', () => showKindPage('plugin', undefined)), marketPicker()),
    el(
      'div',
      { className: 'main-body', onscroll: hideHover },
      el(
        'div',
        { className: 'hunt-ask' },
        ask,
        hunt.error ? el('div', { className: 'notice bad', role: 'alert' }, hunt.error) : null,
        el('div', { className: 'hunt-ask-actions' }, hunt.notice ? el('span', { className: 'hunt-note', role: 'status' }, icon('check'), hunt.notice) : null, el('span', { className: 'spacer' }), el('button', { className: 'secondary', onclick: newCard }, icon('add'), 'New plugin'), aiGroup('', huntBtn))
      ),
      noMarket(),
      chatView(),
      hunt.info ? null : el('div', { className: 'empty flush' }, 'Reading your skills and agents...'),
      cards.length ? cards.map(card) : hunt.info ? el('div', { className: 'empty flush' }, 'No plugin cards yet.') : null
    )
  );
}
