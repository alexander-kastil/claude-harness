// @ts-nocheck
// The input of every chat with Claude: one frame holding the message box, and under the text, inside the same frame, one row with the
// page's own buttons on the left of the AI group and the AI group at the right end. A chat passes what is its own; the look is here.
import { aiGroup, el, icon } from './dom';

/**
 * The column of every chat: a head, the conversation from the top scrolling in the space left, and the input pinned at the bottom.
 * The head is the icon and Chat, nothing else. `rows` are the message rows, `empty` the line shown without any, `input` a chatComposer.
 */
export const chatPane = ({ rows, empty, input }) =>
  el(
    'div',
    { className: 'hunt-col hunt-col-chat' },
    el('div', { className: 'hunt-col-head' }, icon('comment-discussion'), el('span', {}, 'Chat')),
    el('div', { className: 'hunt-chat-log', role: 'log', 'aria-live': 'polite' }, rows.length ? rows : el('div', { className: 'empty flush' }, empty)),
    input
  );

/**
 * opts.placeholder, opts.rows, opts.value, opts.readonly: the message box.
 * opts.onInput(text), opts.onEnter(): typing, and Enter without Shift (the caller decides whether a send is allowed).
 * opts.note: a plain muted line of a few words at the left of the row.
 * opts.error: a failed answer, above the frame.
 * opts.extra: the page's own buttons, left of the AI group.
 * opts.actions: the buttons that start Claude, drawn in the AI group.
 */
export function chatComposer(opts) {
  const text = el('textarea', {
    className: 'hunt-ask-text chat-input-text',
    rows: opts.rows || 2,
    placeholder: opts.placeholder || 'Message Claude',
    value: opts.value || '',
    readonly: !!opts.readonly,
    'aria-label': 'Message to Claude',
    oninput: e => opts.onInput && opts.onInput(e.target.value),
    onkeydown: e => {
      if (e.key === 'Enter' && !e.shiftKey && opts.onEnter) {
        e.preventDefault();
        opts.onEnter();
      }
    },
  });
  return el(
    'div',
    { className: 'hunt-composer' },
    opts.error ? el('div', { className: 'notice bad', role: 'alert' }, opts.error) : null,
    el(
      'div',
      { className: 'chat-input', onclick: e => e.target === e.currentTarget && text.focus() },
      text,
      el('div', { className: 'chat-input-bar' }, opts.note ? el('span', { className: 'hunt-note', role: 'status' }, icon('check'), opts.note) : null, el('span', { className: 'spacer' }), opts.extra || null, aiGroup('', opts.actions || []))
    )
  );
}
