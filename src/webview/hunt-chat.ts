// @ts-nocheck
// The Plugin Hunter's conversation with Claude: the last turns, the earlier ones on request, and Start over.
import { vscode } from './core';
import { confirmAt, showConfirm } from './confirm';
import { claudeMark, el, icon, plural } from './dom';
import { hunt, repaint } from './hunt-state';

// The turns of the conversation shown without asking.
const SHOWN_TURNS = 4;

export function chatView() {
  const all = [...hunt.chat, ...(hunt.pending ? [{ role: 'owner', text: hunt.pending }, { role: 'claude', text: 'Working on it...', wait: true }] : [])];
  if (!all.length) return null;
  const hidden = hunt.earlier ? 0 : Math.max(0, all.length - SHOWN_TURNS);
  const turns = all.slice(hidden);
  const clear = confirmAt(
    el(
      'button',
      {
        className: 'secondary',
        title: 'Start over\nClears the conversation. The plugin cards stay.',
        onclick: () =>
          showConfirm({
            kind: 'huntClear',
            onConfirm: () => {
              hunt.chat = [];
              hunt.earlier = false;
              hunt.notice = 'Conversation cleared. The cards stay.';
              vscode.postMessage({ type: 'huntClear' });
              setTimeout(() => {
                hunt.notice = '';
                repaint();
              }, 5000);
              repaint();
            },
          }),
      },
      icon('clear-all'),
      'Start over'
    ),
    'huntClear'
  );
  return el(
    'div',
    { className: 'hunt-chat' },
    el('div', { className: 'hunt-chat-head' }, el('span', { className: 'hunt-label' }, 'Conversation'), el('span', { className: 'spacer' }), clear),
    hidden
      ? el(
          'button',
          {
            className: 'secondary hunt-earlier',
            onclick: () => {
              hunt.earlier = true;
              repaint();
            },
          },
          icon('chevron-up'),
          `Show ${plural(hidden, 'earlier message')}`
        )
      : null,
    el(
      'div',
      { className: 'hunt-chat-log', role: 'log', 'aria-live': 'polite' },
      turns.map(t => el('div', { className: `hunt-msg ${t.role}${t.wait ? ' wait' : ''}` }, el('span', { className: 'hunt-msg-who' }, t.role === 'owner' ? null : claudeMark(), t.role === 'owner' ? 'You' : 'Claude'), el('div', { className: 'hunt-msg-text' }, t.text)))
    )
  );
}
