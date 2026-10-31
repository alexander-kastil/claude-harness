// @ts-nocheck
// The chat column of the Plugin Hunter's New hunt tab, built like a traditional chat: the conversation in order with the newest message at the bottom, and the composer pinned under it. The card beside it is the artifact.
import { vscode } from './core';
import { confirmAt, showConfirm } from './confirm';
import { chatComposer } from './chat-composer';
import { claudeMark, el, icon } from './dom';
import { hunt, newCard, repaint, waitText, workingTurns } from './hunt-state';

/** One message of the conversation. */
export const turnRow = t => el('div', { className: `hunt-msg ${t.role}${t.wait ? ' wait' : ''}` }, el('span', { className: 'hunt-msg-who' }, t.role === 'owner' ? null : claudeMark(), t.role === 'owner' ? 'You' : 'Claude'), el('div', { className: 'hunt-msg-text' }, t.text));

const startOver = () =>
  confirmAt(
    el(
      'button',
      {
        className: 'secondary hunt-clear',
        disabled: hunt.running || !hunt.chat.length,
        title: 'Start over\nClears the conversation, the chats in History too. The plugin cards stay.',
        onclick: () =>
          showConfirm({
            kind: 'huntClear',
            onConfirm: () => {
              hunt.chat = [];
              hunt.notice = 'Conversation cleared. The cards stay.';
              vscode.postMessage({ type: 'huntClear' });
              setTimeout(() => ((hunt.notice = ''), repaint()), 5000);
              repaint();
            },
          }),
      },
      icon('clear-all'),
      'Start over'
    ),
    'huntClear'
  );

// One box for both ways to talk to Claude. Hunt sends the message as it is: search, change the card, create the plugin. Go sends it
// as a change to the ticked elements of the card beside the chat. Both start with the question that counts against the plan.
function composer(working) {
  const ticked = working ? working.assets.filter(a => a.include).length : 0;
  const idle = () => hunt.running || !hunt.prompt.trim();
  const send = card => vscode.postMessage({ type: 'huntRun', prompt: hunt.prompt, card });
  const sync = () => {
    go.disabled = idle() || !ticked;
    hunter.disabled = idle();
  };
  const go = confirmAt(
    el('button', { className: 'secondary', title: ticked ? 'Go\nSends the message as a change to the ticked elements of the card on the right. Claude answers in the conversation and changes the card. A rename is carried out when you press Create.' : 'Go\nTick an element of the card to change it.', onclick: () => send(working.id) }, icon('send'), 'Go'),
    'hunt'
  );
  const hunter = confirmAt(el('button', { className: 'primary', onclick: () => send() }, icon('telescope'), hunt.running ? 'Hunting...' : 'Hunt'), 'hunt');
  sync();
  return chatComposer({
    rows: 2,
    placeholder: hunt.running ? 'Claude is answering. Your message is in the conversation above.' : 'Message Claude, e.g. "search all angular skills" or "create the plugin". Go changes the ticked elements: "rename docker-images to hetzner-docker".',
    // The sent message shows once, in the conversation; the box holds it again only if the answer fails.
    value: hunt.running ? '' : hunt.prompt,
    readonly: hunt.running,
    onInput: v => ((hunt.prompt = v), sync()),
    onEnter: () => !idle() && hunter.click(),
    note: hunt.notice,
    error: hunt.error,
    extra: el('button', { className: 'secondary', disabled: hunt.running, onclick: newCard }, icon('add'), 'New plugin'),
    actions: [go, hunter],
  });
}

/** The column: its head, the conversation of the hunt in progress with the message being answered at its end, and the composer. */
export function chatColumn(split) {
  const turns = [...workingTurns(split), ...(hunt.pending ? [{ role: 'owner', text: hunt.pending }, { role: 'claude', text: waitText(), wait: true }] : [])];
  return el(
    'div',
    { className: 'hunt-col hunt-col-chat' },
    el('div', { className: 'hunt-col-head' }, icon('comment-discussion'), el('span', {}, 'Chat'), startOver()),
    el('div', { className: 'hunt-chat-log', role: 'log', 'aria-live': 'polite' }, turns.length ? turns.map(turnRow) : el('div', { className: 'empty flush' }, 'Tell Claude which skills and agents belong together. Its answers show up here and the plugin it proposes on the right.')),
    composer(split.working)
  );
}
