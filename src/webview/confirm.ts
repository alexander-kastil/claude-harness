// @ts-nocheck
// The house confirmation card: a popover under the button that asked, in place of a system dialog. It says what will
// happen, offers a switch that remembers the answer for good, confirms on its primary button and cancels with Esc, the
// Cancel button or a click outside. The host asks for it (`confirm`) and gets the held-back message again, `confirmed`.
import { state, vscode } from './core';
import { claudeMark, el, icon } from './dom';
import { hideHover } from './hover';

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
    mark: claudeMark(18),
    title: 'Draft an output style',
    sub: `with Claude ${MODEL_NAMES[ask.model] || ask.model}`,
    facts: [
      ['account', 'Runs claude -p on your own Claude login, so it counts against your plan.'],
      ['list-unordered', `Sends the scan of this session: ${ask.corrections} ${ask.corrections === 1 ? 'correction' : 'corrections'} you made, the interrupts and the length and format of the replies. No code and no whole replies.`],
      ['new-file', el('span', {}, 'Saves the draft to ', el('code', {}, ask.folder), ', under a name no style has.')],
      ['eye', 'The whole draft appears on this page when it is done, ready to read before you use it.'],
    ],
    action: 'Draft',
    send: remember => vscode.postMessage({ type: 'draftStyle', scope: ask.scope, id: ask.id, model: ask.model, confirmed: true, remember }),
  }),
  continue: ask => ({
    mark: claudeMark(18),
    title: 'Continue this session',
    sub: 'in Claude, in a terminal',
    facts: [
      ['terminal', el('span', {}, 'A terminal opens in ', el('code', {}, ask.cwd), ' and resumes this very session.')],
      ['edit', ask.live ? 'It is still running elsewhere. Two Claudes writing to one session mix their turns; end the other one first.' : 'What you say is added to this session, not to a copy.'],
      ['credit-card', 'Claude reads the session again before it answers. That counts against your plan.'],
    ],
    action: 'Continue',
    send: remember => vscode.postMessage({ type: 'continueSession', scope: ask.scope, id: ask.id, confirmed: true, remember }),
  }),
  review: ask => ({
    mark: claudeMark(18),
    title: `Review ${ask.name} with Claude`,
    sub: 'in a new Claude, in a terminal',
    facts: [
      ['terminal', el('span', {}, 'A terminal opens in ', el('code', {}, ask.cwd), '.')],
      ['file', el('span', {}, 'Claude is asked to read ', el('code', {}, ask.file), ' and say what to improve. It changes nothing until you agree.')],
      ['credit-card', 'The run counts against your plan.'],
    ],
    action: 'Open in terminal',
    send: remember => vscode.postMessage({ type: 'reviewAsset', id: ask.id, confirmed: true, remember }),
  }),
  try: ask => ({
    mark: claudeMark(18),
    title: `Try ${ask.name} in Claude`,
    sub: 'in a new Claude, in a terminal',
    facts: [
      ['terminal', el('span', {}, 'A terminal opens in ', el('code', {}, ask.cwd), '.')],
      ['play', ask.as === 'agent' ? el('span', {}, 'Claude starts as this agent: ', el('code', {}, `claude --agent ${ask.name}`), '.') : el('span', {}, 'Claude starts and runs ', el('code', {}, `/${ask.name}`), '.')],
      ['credit-card', 'The run counts against your plan.'],
    ],
    action: 'Open in terminal',
    send: remember => vscode.postMessage({ type: 'tryAsset', id: ask.id, confirmed: true, remember }),
  }),
  // The page's own question, no host involved: dropping the edits of the open element. No Don't ask again switch.
  discard: ask => ({
    mark: icon('discard'),
    title: 'Discard your changes?',
    sub: `to ${ask.name}`,
    facts: [['discard', 'The edits are dropped and the saved element is shown again.']],
    action: 'Discard',
    danger: true,
    plain: true,
    send: () => ask.onConfirm(),
  }),
  slim: ask => ({
    mark: claudeMark(18),
    title: `Slim ${ask.name} with Claude`,
    sub: 'in a new Claude, in a terminal',
    facts: [
      ['terminal', el('span', {}, 'A terminal opens in ', el('code', {}, ask.cwd), '.')],
      ['files', `Claude is told the skill's ${ask.files} ${ask.files === 1 ? 'file' : 'files'} and ${ask.findings ? `the ${ask.findings} ${ask.findings === 1 ? 'thing' : 'things'} flagged here` : 'that nothing is flagged'}. It says what to move and cut, and changes nothing until you agree.`],
      ['credit-card', 'The run counts against your plan.'],
    ],
    action: 'Open in terminal',
    send: remember => vscode.postMessage({ type: 'slimAsset', id: ask.id, confirmed: true, remember }),
  }),
  // Consolidate a repo skill: destructive, so no Don't ask again switch. The place it goes to is chosen on the card, and
  // that place's state decides the facts and the buttons (`mount` redraws both when the choice changes).
  consolidate: ask => {
    let cur = ask.targets.find(t => t.id === ask.target) || ask.targets[0];
    const count = (n, what) => `${n} ${what}${n === 1 ? '' : 's'}`;
    const names = list => list.slice(0, 4).join(', ') + (list.length > 4 ? `, and ${list.length - 4} more` : '');
    // A place in plain words: Global, or the plugin by its name.
    const place = t => (t.id === 'global' ? 'Global' : `the ${t.id.split('@')[0]} plugin`);
    const routeOf = t => (t.state === 'differs' ? 'diff' : t.state === 'new' ? 'move' : 'retire');
    const actionOf = t => (t.state === 'differs' ? 'Compare in editor' : t.state === 'new' ? `Move to ${place(t)}` : 'Retire repo copy');
    const titleOf = t => `Consolidate ${ask.name} into ${place(t)}`;
    const stateOf = t => ({ identical: 'identical', near: 'nearly identical', contained: 'holds it and more', differs: 'differs', new: 'not there yet' })[t.state];
    const factsOf = t => {
      const out = [];
      if (t.state === 'new') {
        out.push(['info', `${place(t)} does not have ${ask.name} yet.`]);
        out.push(['new-folder', el('span', {}, `Moving copies the whole folder (${count(t.files, 'file')}) to `, el('code', {}, t.dir), `, then removes the copy in ${ask.repo}. A backup is kept.`)]);
      } else if (t.state === 'differs') {
        const parts = [t.changed.length ? `${count(t.changed.length, 'file')} ${t.changed.length === 1 ? 'is' : 'are'} different` : '', t.repoOnly.length ? `${count(t.repoOnly.length, 'file')} ${t.repoOnly.length === 1 ? 'is' : 'are'} only in ${ask.repo}` : ''].filter(Boolean);
        out.push(['diff', `${ask.repo} and ${place(t)} do not match: ${parts.join(', ')} (${names([...t.changed, ...t.repoOnly])}).`]);
        out.push(['edit', `Compare opens the files side by side, ${ask.repo} on the left and ${place(t)} on the right. Copy what you want to keep to the right, then open this card again to retire the copy in ${ask.repo}.`]);
        out.push(['terminal', el('span', {}, 'Or Claude merges them in a terminal in ', el('code', {}, ask.cwd), '. That counts against your plan.')]);
      } else {
        const same = { identical: `${ask.repo} has the same copy as ${place(t)} (${count(t.files, 'file')}).`, near: `${ask.repo} has the same copy as ${place(t)}, apart from whitespace or version lines.`, contained: `${place(t)} has everything in the ${ask.repo} copy, and ${count(t.targetOnly.length, 'more file')}.` }[t.state];
        out.push(['check', same]);
        out.push(['archive', `Retiring it removes the copy in ${ask.repo}. A backup is kept.`]);
      }
      for (const note of ask.notes) out.push(['info', note]);
      if (ask.careful) out.push(['warning', `Careful: ${ask.careful}.`]);
      return out;
    };
    return {
      mark: icon('git-merge'),
      title: titleOf(cur),
      sub: `the copy in ${ask.repo}`,
      facts: factsOf(cur),
      action: actionOf(cur),
      alt: 'Merge with Claude',
      altClaude: true,
      danger: true,
      plain: true,
      send: () => vscode.postMessage({ type: 'consolidateAsset', id: ask.id, target: cur.id, route: routeOf(cur), confirmed: true }),
      sendAlt: () => vscode.postMessage({ type: 'consolidateAsset', id: ask.id, target: cur.id, route: 'claude', confirmed: true }),
      mount: ({ card, go, alt, relayout }) => {
        const facts = card.querySelector('.cf-facts');
        const rows = ask.targets.map(t => {
          const row = el('button', { className: 'cf-target', role: 'radio', 'aria-checked': String(t === cur), onclick: () => pick(t) }, icon(t.id === 'global' ? 'globe' : 'package'), el('span', { className: 'cf-target-name' }, t.id === 'global' ? 'Global' : t.id.split('@')[0]), el('span', { className: 'cf-target-state' }, stateOf(t)));
          return [t, row];
        });
        const redraw = () => {
          facts.replaceChildren(...factsOf(cur).map(([glyph, text]) => el('li', {}, icon(glyph), typeof text === 'string' ? el('span', {}, text) : text)));
          card.querySelector('.cf-title').textContent = titleOf(cur);
          go.textContent = actionOf(cur);
          alt.hidden = cur.state !== 'differs';
          for (const [t, row] of rows) row.setAttribute('aria-checked', String(t === cur));
          relayout();
        };
        const pick = t => {
          cur = t;
          redraw();
        };
        if (rows.length > 1) facts.before(el('div', { className: 'cf-targets', role: 'radiogroup', 'aria-label': 'Consolidate into' }, rows.map(([, row]) => row)));
        alt.hidden = cur.state !== 'differs';
      },
    };
  },
  // A question the host waits on: its buttons answer with the token. No Don't ask again switch.
  panel: ask => ({
    mark: icon(ask.glyph || 'question'),
    title: ask.title,
    sub: ask.sub,
    facts: ask.facts.slice(0, 8).map(f => ['circle-small-filled', f]).concat(ask.facts.length > 8 ? [['ellipsis', `and ${ask.facts.length - 8} more lines`]] : []),
    action: ask.action,
    alt: ask.alt,
    danger: ask.danger,
    plain: true,
    send: () => vscode.postMessage({ type: 'answer', token: ask.token, choice: 'ok' }),
    sendAlt: () => vscode.postMessage({ type: 'answer', token: ask.token, choice: 'alt' }),
  }),
};

let current;

// The element the owner last pressed or typed in, outside a card: where a question about that action points.
let lastTarget;
const noteTarget = e => {
  const t = e.target;
  if (t && t.closest && !t.closest('.cf')) lastTarget = t.closest('button, [role=button], a, .row') || t;
};
document.addEventListener('mousedown', noteTarget, true);
document.addEventListener('keydown', noteTarget, true);

// The element a question points at: marked data-confirm="<kind>", and when several are, data-confirm-key picks by the
// ask's key or by its session. A question about one row of a list points at that row's button.
function findAnchor(ask) {
  if ((ask.kind === 'panel' || ask.kind === 'consolidate') && ask.key === 'click') return lastTarget && lastTarget.isConnected ? lastTarget : null;
  const all = [...document.querySelectorAll(`[data-confirm="${ask.kind}"]`)];
  const key = ask.key || (ask.scope && ask.id ? `${ask.scope}/${ask.id}` : undefined);
  const keyed = all.find(n => n.dataset.confirmKey === key);
  return keyed || (ask.kind === 'panel' ? null : all.find(n => !n.dataset.confirmKey)) || null;
}

export function closeConfirm(refocus) {
  if (!current) return;
  const { card, cleanup, anchor, ask, answered } = current;
  current = undefined;
  if (ask.token && !answered) vscode.postMessage({ type: 'answer', token: ask.token, choice: 'cancel' });
  cleanup();
  card.classList.add('leaving');
  setTimeout(() => card.remove(), 90);
  const a = anchor();
  if (refocus && a) a.focus();
}

// Shows the card for a host's question under the button marked data-confirm="<kind>", while that session is still open.
export function showConfirm(ask) {
  const make = CARDS[ask.kind];
  const anchor = () => findAnchor(ask);
  if (!make || !anchor()) {
    // Nothing to point at: a waiting host action is cancelled instead of left hanging.
    if (ask.token) vscode.postMessage({ type: 'answer', token: ask.token, choice: 'cancel' });
    return;
  }
  closeConfirm();
  hideHover();
  const c = make(ask);
  let remember = false;
  const track = el('button', { className: 'cf-switch', role: 'switch', 'aria-checked': 'false', 'aria-labelledby': 'cf-remember' }, el('span', { className: 'cf-thumb' }));
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
        if (current) current.answered = true;
        closeConfirm(true);
        c.send(keep);
      },
    },
    c.action
  );
  const alt = c.alt
    ? el(
        'button',
        {
          className: 'secondary',
          onclick: () => {
            if (current) current.answered = true;
            closeConfirm(true);
            c.sendAlt();
          },
        },
        c.altClaude ? claudeMark() : null,
        c.alt
      )
    : null;
  const card = el(
    'div',
    { className: 'cf', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cf-title', 'aria-describedby': 'cf-facts' },
    el('div', { className: 'cf-head' }, el('span', { className: 'cf-badge' }, c.mark), el('div', { className: 'cf-titles' }, el('div', { className: 'cf-title', id: 'cf-title' }, c.title), el('div', { className: 'cf-sub' }, c.sub))),
    el('ul', { className: 'cf-facts', id: 'cf-facts' }, c.facts.map(([glyph, text]) => el('li', {}, icon(glyph), typeof text === 'string' ? el('span', {}, text) : text))),
    el(
      'div',
      { className: 'cf-foot' },
      c.plain ? el('div', { className: 'cf-remember' }) : el('div', { className: 'cf-remember' }, track, el('span', { id: 'cf-remember', onclick: flip }, "Don't ask again")),
      el('div', { className: 'cf-actions' }, cancel, alt, go)
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
  // A card that changes with a choice on it redraws its facts and buttons, then asks for a new place.
  if (c.mount)
    c.mount({
      card,
      go,
      alt,
      relayout: () => {
        last = '';
        place();
      },
    });
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
      // A button the card hid is no stop.
      const stops = [c.plain ? null : track, cancel, alt, go].filter(n => n && !n.hidden);
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
    ask,
    answered: false,
    cleanup: () => {
      document.removeEventListener('mousedown', outside, true);
      cancelAnimationFrame(frame);
    },
  };
  frame = requestAnimationFrame(follow);
  (c.danger ? cancel : go).focus();
}

// Marks a button as where a card of this kind points; `key` tells it from the others of its kind (one row among many).
export const confirmAt = (node, kind, key) => {
  node.dataset.confirm = kind;
  if (key) node.dataset.confirmKey = key;
  return node;
};

// Analyze from one row of a list: a button that asks for the card under itself, without opening the row.
export const analyzeRowButton = (scope, id) =>
  confirmAt(
    el(
      'button',
      {
        className: 'icon-btn row-act',
        title: 'Analyze\nA new Claude in a terminal with a copy of this session, to ask about it. The session stays untouched.',
        'aria-label': 'Analyze this session',
        onclick: e => {
          e.stopPropagation();
          hideHover();
          vscode.postMessage({ type: 'analyzeSession', scope, id });
        },
        onkeydown: e => e.stopPropagation(),
      },
      claudeMark()
    ),
    'analyze',
    `${scope}/${id}`
  );
