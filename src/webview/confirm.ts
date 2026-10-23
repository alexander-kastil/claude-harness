// @ts-nocheck
// The house confirmation card: a popover under the button that asked, in place of a system dialog. It says what will
// happen, offers a switch that remembers the answer for good, confirms on its primary button and cancels with Esc, the
// Cancel button or a click outside. The host asks for it (`confirm`) and gets the held-back message again, `confirmed`.
import { state, vscode } from './core';
import { el, icon, svg } from './dom';
import { hideHover } from './hover';

// The Claude mark as Anthropic ships it in the Claude Code extension.
const CLAUDE_PATH =
  'M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z';

export const claudeMark = (size = 14) => svg('svg', { class: 'claude-mark', width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: CLAUDE_PATH }));

const MODEL_NAMES = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku' };

// What each card says, from the facts the host sent; `send` posts the held-back message with the answer.
const CARDS = {
  analyze: ask => ({
    mark: claudeMark(18),
    title: 'Analyze this session',
    sub: 'in a new Claude, in a terminal',
    facts: [
      ['terminal', el('span', {}, 'A terminal opens in ', el('code', {}, ask.cwd), ' with a copy of this session to chat with.')],
      ['lock', 'The original session stays untouched.' + (ask.live ? ' It is still running, so the copy holds what it has written so far.' : '')],
      ['credit-card', 'Before it first answers, Claude reads the whole session again. That counts against your plan like the session itself did.'],
    ],
    action: 'Open in terminal',
    send: remember => vscode.postMessage({ type: 'analyzeSession', scope: ask.scope, id: ask.id, confirmed: true, remember }),
  }),
  draftStyle: ask => ({
    mark: icon('sparkle'),
    title: 'Draft an output style',
    sub: `with Claude ${MODEL_NAMES[ask.model] || ask.model}`,
    facts: [
      ['account', 'Runs claude -p on your own Claude login, so it counts against your plan.'],
      ['list-unordered', `Sends the scan of this session: ${ask.corrections} ${ask.corrections === 1 ? 'correction' : 'corrections'} you made, the interrupts and the length and format of the replies. No code and no whole replies.`],
      ['new-file', el('span', {}, 'Saves the draft to ', el('code', {}, ask.folder), '.')],
    ],
    action: 'Draft',
    send: remember => vscode.postMessage({ type: 'draftStyle', scope: ask.scope, id: ask.id, model: ask.model, confirmed: true, remember }),
  }),
};

let current;

export function closeConfirm(refocus) {
  if (!current) return;
  const { card, cleanup, anchor } = current;
  current = undefined;
  cleanup();
  card.classList.add('leaving');
  setTimeout(() => card.remove(), 90);
  const a = anchor();
  if (refocus && a) a.focus();
}

// Shows the card for a host's question under the button marked data-confirm="<kind>", while that session is still open.
export function showConfirm(ask) {
  const make = CARDS[ask.kind];
  const anchor = () => document.querySelector(`[data-confirm="${ask.kind}"]`);
  if (!make || !anchor() || !state.session || state.session.scope !== ask.scope || state.session.id !== ask.id) return;
  closeConfirm();
  hideHover();
  const c = make(ask);
  let remember = true;
  const track = el('button', { className: 'cf-switch on', role: 'switch', 'aria-checked': 'true', 'aria-labelledby': 'cf-remember' }, el('span', { className: 'cf-thumb' }));
  const flip = () => {
    remember = !remember;
    track.classList.toggle('on', remember);
    track.setAttribute('aria-checked', remember ? 'true' : 'false');
  };
  track.addEventListener('click', flip);
  const cancel = el('button', { className: 'secondary', onclick: () => closeConfirm(true) }, 'Cancel');
  const go = el(
    'button',
    {
      className: 'primary',
      onclick: () => {
        const keep = remember;
        closeConfirm(true);
        c.send(keep);
      },
    },
    c.action
  );
  const card = el(
    'div',
    { className: 'cf', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cf-title', 'aria-describedby': 'cf-facts' },
    el('div', { className: 'cf-head' }, el('span', { className: 'cf-badge' }, c.mark), el('div', { className: 'cf-titles' }, el('div', { className: 'cf-title', id: 'cf-title' }, c.title), el('div', { className: 'cf-sub' }, c.sub))),
    el('ul', { className: 'cf-facts', id: 'cf-facts' }, c.facts.map(([glyph, text]) => el('li', {}, icon(glyph), typeof text === 'string' ? el('span', {}, text) : text))),
    el(
      'div',
      { className: 'cf-foot' },
      el('div', { className: 'cf-remember' }, track, el('span', { id: 'cf-remember', onclick: flip }, "Don't ask again")),
      el('div', { className: 'cf-actions' }, cancel, go)
    )
  );
  document.body.append(card);
  // Under the button, its left edge on the button's, kept inside the panel; above the button when there is no room below.
  // It follows the button every frame, through scrolling and through a repaint that replaced the button.
  let last = '';
  const place = () => {
    const a = anchor();
    if (!a) return closeConfirm();
    const r = a.getBoundingClientRect();
    const at = `${r.left},${r.top},${innerWidth},${innerHeight}`;
    if (at === last) return;
    last = at;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const left = Math.max(16, Math.min(r.left, innerWidth - w - 16));
    const below = r.bottom + 8;
    const above = r.top - 8 - h;
    card.style.left = `${left}px`;
    card.style.top = `${below + h <= innerHeight - 8 || above < 8 ? below : above}px`;
    card.style.setProperty('--cf-arrow', `${Math.max(14, Math.min(r.left + r.width / 2 - left, w - 14))}px`);
    card.classList.toggle('up', !(below + h <= innerHeight - 8 || above < 8));
  };
  place();
  const outside = e => {
    if (!card.contains(e.target) && !(anchor() || { contains: () => false }).contains(e.target)) closeConfirm();
  };
  const keys = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeConfirm(true);
    } else if (e.key === 'Tab') {
      // Focus stays in the card while it is open.
      const stops = [track, cancel, go];
      const i = stops.indexOf(document.activeElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
    }
  };
  document.addEventListener('mousedown', outside, true);
  card.addEventListener('keydown', keys);
  let frame = 0;
  const follow = () => {
    place();
    if (current && current.card === card) frame = requestAnimationFrame(follow);
  };
  current = {
    card,
    anchor,
    cleanup: () => {
      document.removeEventListener('mousedown', outside, true);
      cancelAnimationFrame(frame);
    },
  };
  frame = requestAnimationFrame(follow);
  go.focus();
}
