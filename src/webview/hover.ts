// @ts-nocheck
// The house hover card and the title tooltips that use it.
import { el, icon } from './dom';

export let hover;

export const hideHover = () => hover && hover.classList.remove('show');

// After a press, no card opens again until the pointer really moves or a key is pressed: a click re-draws the page under a
// stationary pointer, and the browser's follow-up mouseover would otherwise open the card over what was just clicked.
let pressedAt;

// The element the pointer last entered; a card opened without its own anchor belongs to it, and goes when it is removed.
let lastOver;

// One floating card for every rich hover; `build` runs again when the card's data arrives later.
export function placeCard(key, build, at) {
  if (pressedAt) return;
  if (!hover) {
    hover = el('div', { className: 'tl-hover', role: 'tooltip' });
    document.body.append(hover);
  }
  if (hover.dataset.key !== key) {
    hover.replaceChildren(build());
    hover.dataset.key = key;
    hover.build = build;
  }
  hover.classList.add('show');
  // A tooltip stops at a quarter of the window; text cut off there fades out instead of ending mid-line.
  hover.querySelectorAll('.tip-lines').forEach(n => n.classList.toggle('cut', n.scrollHeight > n.clientHeight + 1));
  const gap = 14;
  const w = hover.offsetWidth;
  const h = hover.offsetHeight;
  let left = at.x + gap;
  let top = at.y + gap;
  if (left + w > window.innerWidth - 8) left = Math.max(8, at.x - w - gap);
  // Flipped above, a card keeps clear of the element it describes when the caller names that element's top edge.
  if (top + h > window.innerHeight - 8) top = Math.max(8, (at.above !== undefined ? at.above : at.y - gap) - h);
  hover.anchor = at.anchor || lastOver;
  hover.style.left = `${left}px`;
  hover.style.top = `${top}px`;
}

export const refreshCard = key => {
  if (hover && hover.dataset.key === key && hover.classList.contains('show') && hover.build) hover.replaceChildren(hover.build());
};

// Every `title` tooltip in the house hover style. On the first hover the title moves to `data-tip`, so the
// browser's own tooltip never shows; the card opens after the repo card's pause, and at once on focus.
export let tipTimer;

export let tipTarget;

export const tipCard = (text, glyph) => {
  let [first, ...rest] = text.split('\n');
  // A long one-line hint is body text, not a heading, so it obeys the card's height limit.
  if (!rest.length && first.length > 90) {
    rest = [first];
    first = '';
  }
  return el(
    'div',
    { className: 'hc hc-tip' },
    first ? el('div', { className: 'hc-head' }, glyph ? icon(glyph) : null, el('span', { className: 'hc-type' }, first)) : null,
    rest.length ? el('div', { className: 'hc-text tip-lines' }, rest.join('\n')) : null
  );
};

export const tipHost = node => (node instanceof Element ? node.closest('[title], [data-tip]') : null);

export const showTip = (t, delay) => {
  if (t.hasAttribute('title')) {
    const title = t.getAttribute('title');
    t.removeAttribute('title');
    if (title) {
      t.dataset.tip = title;
      if (!t.hasAttribute('aria-label') && !t.hasAttribute('aria-description')) t.setAttribute('aria-description', title);
    }
  }
  clearTimeout(tipTimer);
  tipTarget = t;
  const text = t.dataset.tip;
  if (!text) return;
  const own = t.querySelector(':scope > .codicon');
  const glyph = own && [...own.classList].find(c => c.startsWith('codicon-') && !c.startsWith('codicon-modifier'));
  tipTimer = setTimeout(() => {
    if (tipTarget !== t || !t.isConnected) return;
    const r = t.getBoundingClientRect();
    placeCard(`tip:${text}`, () => tipCard(text, glyph && glyph.slice('codicon-'.length)), { x: r.left - 14, y: r.bottom - 6, above: r.top - 6, anchor: t });
  }, delay);
};

export const hideTip = () => {
  clearTimeout(tipTimer);
  tipTarget = undefined;
  if (hover && (hover.dataset.key || '').startsWith('tip:')) hideHover();
};

document.addEventListener(
  'mouseover',
  e => {
    lastOver = e.target;
    // Entering an element away from the press ends the block before the element's own mouseenter runs.
    if (pressedAt && Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 3) pressedAt = undefined;
  },
  true
);

document.addEventListener('mouseover', e => {
  const t = tipHost(e.target);
  if (t && t !== tipTarget) showTip(t, 350);
});

document.addEventListener('mouseout', e => {
  const t = tipHost(e.target);
  if (t && t === tipTarget && !t.contains(e.relatedTarget)) hideTip();
});

document.addEventListener('focusin', e => {
  const t = tipHost(e.target);
  if (t) showTip(t, 0);
});

document.addEventListener('focusout', hideTip);

// Every card goes on a press, a key, a wheel turn, any scroll, the pointer leaving the panel, and when the element it
// described is no longer on the page (a tab that was redrawn under the pointer sends no mouseleave).
const dismiss = () => {
  clearTimeout(tipTimer);
  tipTarget = undefined;
  hideHover();
};

document.addEventListener(
  'mousedown',
  e => {
    pressedAt = { x: e.clientX, y: e.clientY };
    dismiss();
  },
  true
);

document.addEventListener(
  'mousemove',
  e => {
    if (pressedAt && Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 3) pressedAt = undefined;
    if (hover && hover.classList.contains('show') && hover.anchor && !hover.anchor.isConnected) dismiss();
  },
  true
);

document.addEventListener(
  'keydown',
  e => {
    pressedAt = undefined;
    if (e.key === 'Escape') dismiss();
  },
  true
);

document.addEventListener('wheel', dismiss, { capture: true, passive: true });

document.addEventListener('scroll', dismiss, true);

document.documentElement.addEventListener('mouseleave', dismiss);

export const tabTip = (label, glyph, text) => el('div', { className: 'hc hc-tip' }, el('div', { className: 'hc-head' }, icon(glyph), el('span', { className: 'hc-type' }, label)), el('div', { className: 'hc-text' }, text));
