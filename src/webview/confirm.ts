// @ts-nocheck
// The house confirmation card: a popover under the button that asked, in place of a system dialog. It says what will
// happen, offers a switch that remembers the answer for good, confirms on its primary button and cancels with Esc, the
// Cancel button or a click outside. The host asks for it (`confirm`) and gets the held-back message again, `confirmed`.
import { state, vscode } from './core';
import { aiGroup, claudeMark, el, icon } from './dom';
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
    title: `Edit ${ask.name} with Claude`,
    sub: 'in a new Claude, in a terminal',
    facts: [
      ['terminal', el('span', {}, 'A terminal opens in ', el('code', {}, ask.cwd), '.')],
      ['file', el('span', {}, 'Claude is asked to read ', el('code', {}, ask.file), ', say what to improve and make the changes you agree to. It changes nothing until you agree.')],
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
  hunt: ask => ({
    mark: claudeMark(18),
    title: 'Hunt a plugin with Claude',
    sub: 'with Claude Sonnet, in a conversation',
    facts: [
      ['account', 'Uses your own Claude account. This message and every later one of this conversation count against your plan.'],
      ['list-unordered', `Sends your message, the conversation so far and the inventory of ${ask.items} ${ask.items === 1 ? 'skill or agent' : 'skills and agents'} of yours, with name, description and where each lives. No file contents.`],
      ['eye', 'Claude answers in the conversation and can add or change the plugin card. Nothing is created until you press Create, or ask Claude to create it and confirm.'],
    ],
    action: 'Hunt',
    send: remember => vscode.postMessage({ type: 'huntRun', prompt: ask.prompt, card: ask.card, confirmed: true, remember }),
  }),
  // Starting the conversation over, no host involved. No Don't ask again switch.
  huntClear: ask => ({
    mark: icon('clear-all'),
    title: 'Start the conversation over?',
    sub: 'Plugin Hunter',
    facts: [
      ['comment-discussion', 'The messages above are cleared, and Claude no longer sees them.'],
      ['package', 'The plugin cards below stay as they are.'],
    ],
    action: 'Start over',
    plain: true,
    send: () => ask.onConfirm(),
  }),
  // Creating the plugin: every file written and every copy retired, listed before anything happens. No Don't ask again switch.
  huntCreate: ask => ({
    mark: icon('package'),
    title: `Create ${ask.name}`,
    sub: `in ${ask.market}`,
    facts: [
      ['folder', el('span', {}, 'Writes the plugin into ', el('code', {}, ask.location), ':')],
      ...ask.files.map(f => ['file', el('code', {}, f)]),
      ['extensions', el('span', {}, 'Installs ', el('code', {}, `${ask.name}@${ask.market}`), ' for you in every folder, then retires the copies below.')],
      ...ask.retired.map(r => ['archive', `Retires ${r}. A backup is kept.`]),
      ...(ask.retired.length ? [] : [['check', 'No copy is retired.']]),
      ...ask.kept.map(k => ['info', k]),
      ['git-commit', 'Nothing is committed in the marketplace.'],
    ],
    action: 'Create',
    plain: true,
    send: () => vscode.postMessage({ type: 'huntCreate', id: ask.id, market: ask.market, confirmed: true }),
    mount: ({ card, relayout }) => {
      card.querySelector('.cf-facts').classList.add('cf-scroll');
      relayout();
    },
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
  resolve: ask => ({
    mark: claudeMark(18),
    title: `Resolve this finding of ${ask.name}`,
    sub: 'in a new Claude, in a terminal',
    facts: [
      ['terminal', el('span', {}, 'A terminal opens in ', el('code', {}, ask.cwd), '.')],
      ['file', el('span', {}, 'Claude is told this one finding and asked to fix it in ', el('code', {}, ask.file), ' and the skill\'s files, and nothing else.')],
      ['credit-card', 'The run counts against your plan.'],
    ],
    action: 'Open in terminal',
    send: remember => vscode.postMessage({ type: 'resolveFinding', id: ask.id, finding: ask.finding, confirmed: true, remember }),
  }),
  draw: ask => ({
    mark: claudeMark(18),
    title: `Draw ${ask.name} with Claude`,
    sub: 'with Claude Sonnet, in the background',
    facts: [
      ['account', `Runs claude -p on your own Claude login${ask.both ? ', twice: one drawing for the Harness and one for the Process perspective,' : ','} so it counts against your plan.`],
      ['files', `Claude gets ${ask.source || 'SKILL.md'} (${ask.chars} characters) and nothing else: no tools, no other files.`],
      ['symbol-color', `The drawing is kept in the extension, not beside your files, and is dropped when ${ask.source ? 'any of that' : 'SKILL.md'} changes.`],
    ],
    action: 'Draw',
    send: remember => vscode.postMessage({ type: 'drawAsset', id: ask.id, confirmed: true, remember }),
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
  // Share's question for an item that comes from a plugin: two tiles, only the item or the whole plugin, each with what it
  // holds and its size. A radio group: arrows move, Enter shares, Esc cancels. No Don't ask again switch.
  shareChoice: ask => {
    let cur = ask.options[0];
    const word = o => (o.id === 'plugin' ? 'Share the plugin' : `Share ${ask.what}`);
    return {
      mark: icon('export'),
      title: `Share ${ask.name}`,
      sub: `${ask.what} from the ${ask.plugin.split('@')[0]} plugin`,
      facts: [],
      action: word(cur),
      plain: true,
      send: () => vscode.postMessage({ type: 'answer', token: ask.token, choice: 'ok', picked: [cur.id] }),
      mount: ({ card, go, relayout }) => {
        card.classList.add('cf-share');
        const tiles = ask.options.map(o =>
          el(
            'button',
            { type: 'button', className: 'cf-tile', role: 'radio', 'aria-checked': String(o === cur), tabIndex: o === cur ? 0 : -1 },
            el('span', { className: 'cf-tile-mark' }, icon(o.glyph)),
            el(
              'span',
              { className: 'cf-tile-body' },
              el('span', { className: 'cf-tile-title' }, o.title),
              el('span', { className: 'cf-tile-sub' }, o.sub),
              el('ul', { className: 'cf-tile-lines' }, o.lines.map(l => el('li', {}, l)))
            ),
            el('span', { className: 'cf-tile-size' }, o.size),
            el('span', { className: 'cf-tile-radio' }, icon('check'))
          )
        );
        const choose = (i, focus) => {
          cur = ask.options[i];
          tiles.forEach((t, n) => {
            t.setAttribute('aria-checked', String(n === i));
            t.tabIndex = n === i ? 0 : -1;
          });
          go.textContent = word(cur);
          if (focus) tiles[i].focus();
        };
        tiles.forEach((t, i) => {
          t.addEventListener('click', () => choose(i, false));
          t.addEventListener('keydown', e => {
            const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
            if (step) {
              e.preventDefault();
              choose((i + step + tiles.length) % tiles.length, true);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go.click();
            }
          });
        });
        card.querySelector('.cf-facts').before(el('div', { className: 'cf-tiles', role: 'radiogroup', 'aria-label': `What to share of ${ask.name}` }, tiles));
        relayout();
      },
    };
  },
  // A question the host waits on: its buttons answer with the token. No Don't ask again switch.
  // With `input` it carries a text field, with `choices` a list to pick from; the primary button waits until there is text or a pick.
  panel: ask => {
    const picked = new Set();
    let field;
    const typed = () => (field ? field.value.trim() : '');
    const ready = () => (!ask.input || !!typed()) && (!ask.choices || picked.size > 0);
    return {
      mark: icon(ask.glyph || 'question'),
      title: ask.title,
      sub: ask.sub,
      facts: (ask.scroll ? ask.facts : ask.facts.slice(0, 10)).map(f => ['circle-small-filled', f]).concat(!ask.scroll && ask.facts.length > 10 ? [['ellipsis', `and ${ask.facts.length - 10} more lines`]] : []),
      action: ask.action,
      alt: ask.alt,
      danger: ask.danger,
      plain: true,
      mount: ({ card, go, relayout }) => {
        if (ask.scroll) card.querySelector('.cf-facts').classList.add('cf-scroll');
        if (!ask.input && !ask.choices) return relayout();
        const sync = () => (go.disabled = !ready());
        const wrap = el('div', { className: 'cf-field' });
        if (ask.input) {
          field = el('input', { type: 'text', className: 'cf-input', placeholder: ask.input.placeholder || '', value: ask.input.value || '', 'aria-label': ask.input.label, spellcheck: false });
          field.addEventListener('input', sync);
          field.addEventListener('keydown', e => {
            if (e.key === 'Enter' && ready()) {
              e.preventDefault();
              go.click();
            }
          });
          wrap.append(el('label', { className: 'cf-label' }, ask.input.label), field, ask.input.error ? el('div', { className: 'cf-error', role: 'alert' }, icon('error'), el('span', {}, ask.input.error)) : null);
        }
        if (ask.choices) {
          const rows = ask.choices.map(c => {
            const row = el(
              'button',
              { type: 'button', className: 'cf-choice', disabled: !!c.disabled, 'aria-pressed': 'false', onclick: () => {
                if (!ask.multi) {
                  picked.clear();
                  rows.forEach(r => r.setAttribute('aria-pressed', 'false'));
                }
                if (picked.has(c.id)) picked.delete(c.id);
                else picked.add(c.id);
                row.setAttribute('aria-pressed', picked.has(c.id) ? 'true' : 'false');
                sync();
              } },
              el('span', { className: 'cf-tick' }, icon('check')),
              el('span', { className: 'cf-choice-label' }, c.label),
              c.note ? el('span', { className: 'cf-choice-note' }, c.note) : null
            );
            return row;
          });
          wrap.append(el('div', { className: 'cf-choices', role: ask.multi ? 'group' : 'radiogroup', 'aria-label': ask.title }, rows));
        }
        card.querySelector('.cf-foot').before(wrap);
        sync();
        relayout();
        if (field) field.focus();
      },
      send: () => vscode.postMessage({ type: 'answer', token: ask.token, choice: 'ok', text: typed() || undefined, picked: ask.choices ? [...picked] : undefined }),
      sendAlt: () => vscode.postMessage({ type: 'answer', token: ask.token, choice: 'alt' }),
    };
  },
};

let current;

// The element the owner last pressed or typed in, outside a card: where a question about that action points.
let lastTarget;
let lastRowText;
const noteTarget = e => {
  const t = e.target;
  if (t && t.closest && !t.closest('.cf')) {
    lastTarget = t.closest('button, [role=button], a, .row, .at-row') || t;
    // A page that is drawn again replaces the element: the row with the same text stands in for it.
    lastRowText = lastTarget.matches('.row, .at-row') ? lastTarget.textContent : undefined;
  }
};
document.addEventListener('mousedown', noteTarget, true);
document.addEventListener('keydown', noteTarget, true);

// The element a question points at: marked data-confirm="<kind>", and when several are, data-confirm-key picks by the
// ask's key or by its session. A question about one row of a list points at that row's button.
function findAnchor(ask) {
  if ((ask.kind === 'panel' || ask.kind === 'consolidate' || ask.kind === 'shareChoice') && ask.key === 'click') {
    if (lastTarget && lastTarget.isConnected) return lastTarget;
    return (lastRowText && [...document.querySelectorAll('.at-row, .row')].find(r => r.textContent === lastRowText)) || null;
  }
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
        c.altClaude ? icon('git-merge') : null,
        c.alt
      )
    : null;
  // An alternative that starts a Claude sits in the AI group; `alt` stays the button, so focus and mounts still reach it.
  const altNode = alt && c.altClaude ? aiGroup('', alt) : alt;
  const card = el(
    'div',
    { className: 'cf', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cf-title', 'aria-describedby': 'cf-facts' },
    el('div', { className: 'cf-head' }, el('span', { className: 'cf-badge' }, c.mark), el('div', { className: 'cf-titles' }, el('div', { className: 'cf-title', id: 'cf-title' }, c.title), el('div', { className: 'cf-sub' }, c.sub))),
    el('ul', { className: 'cf-facts', id: 'cf-facts' }, c.facts.map(([glyph, text]) => el('li', {}, icon(glyph), typeof text === 'string' ? el('span', {}, text) : text))),
    el(
      'div',
      { className: 'cf-foot' },
      c.plain ? el('div', { className: 'cf-remember' }) : el('div', { className: 'cf-remember' }, track, el('span', { id: 'cf-remember', onclick: flip }, "Don't ask again")),
      el('div', { className: 'cf-actions' }, cancel, altNode, go)
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
    // From the sidebar the card stays inside its column, so it never spills over the table beside it.
    const side = a.closest('.sidebar');
    card.style.width = side ? `${Math.max(240, Math.min(380, side.getBoundingClientRect().width - 16))}px` : '';
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const minLeft = side ? side.getBoundingClientRect().left + 8 : 16;
    const left = Math.max(minLeft, Math.min(r.left, innerWidth - w - 16));
    const below = r.bottom + 8;
    const above = r.top - 8 - h;
    card.style.left = `${left}px`;
    const fitsBelow = below + h <= innerHeight - 8;
    const fitsAbove = above >= 8;
    const top = Math.max(8, Math.min(fitsBelow || !fitsAbove ? below : above, innerHeight - h - 8));
    card.style.top = `${top}px`;
    card.style.setProperty('--cf-arrow', `${Math.max(14, Math.min(r.left + r.width / 2 - left, w - 14))}px`);
    card.classList.toggle('up', !fitsBelow && fitsAbove);
    // Neither side has room: the card goes beside the element it asks about, never over it.
    const covers = top < r.bottom && top + h > r.top;
    card.classList.toggle('beside', covers);
    if (covers) {
      const besideLeft = r.right + 8 + w <= innerWidth - 8 ? r.right + 8 : Math.max(8, r.left - 8 - w);
      card.style.left = `${besideLeft}px`;
      card.style.top = `${Math.max(8, Math.min(r.top, innerHeight - h - 8))}px`;
    }
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
      const stops = [c.plain ? null : track, ...card.querySelectorAll('.cf-input, .cf-choice:not(:disabled), .cf-tile[aria-checked="true"]'), cancel, alt, go].filter(n => n && !n.hidden && !n.disabled);
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
  const first = card.querySelector('.cf-input');
  (first || (c.danger || go.disabled ? cancel : go)).focus();
}

// Marks a button as where a card of this kind points; `key` tells it from the others of its kind (one row among many).
export const confirmAt = (node, kind, key) => {
  node.dataset.confirm = kind;
  if (key) node.dataset.confirmKey = key;
  return node;
};

// Analyze from one row of a list: a button that asks for the card under itself, without opening the row.
export const analyzeRowButton = (scope, id) =>
  aiGroup(
    'compact row-ai',
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
        icon('comment-discussion')
      ),
      'analyze',
      `${scope}/${id}`
    )
  );
