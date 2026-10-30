// @ts-nocheck
// The Browser Automation Hunter page: a chat with Claude beside the procedure card it proposes, and a History of the other cards.
// A procedure is prototyped on the desktop in the browser, then optimized in code; the card holds its steps and how it is kept.
// Every command sits in the page's header bar: the page's own on the left, the Claude group with Hunt at the right end.
import { app, showPage, state, vscode } from './core';
import { confirmAt, showConfirm } from './confirm';
import { aiGroup, claudeMark, countHead, el, icon, iconBtn } from './dom';
import { hideHover } from './hover';
import { showKindPage } from './kind-page';
import { tabBar } from './repo-page';
import { renderMain } from './main';

const KEEPS = [
  ['api', 'API script'],
  ['cli', 'Command line'],
  ['guided', 'Guided browser run'],
  ['tool', 'A tool'],
];
// A command's text, hidden when the page is narrow so the header bar stays one row; each command has its aria-label.
const lab = t => el('span', { className: 'bh-label' }, t);
const keepLabel =id => (KEEPS.find(k => k[0] === id) || KEEPS[2])[1];

const bh = {
  info: undefined,
  cards: [],
  chat: [],
  // What Create said for each card written into the skill, and the last answer of each Create press.
  created: {},
  results: {},
  pending: '',
  prompt: '',
  running: false,
  startedAt: 0,
  error: '',
  notice: '',
  tab: 'new',
  open: {},
  reveal: undefined,
  focusName: undefined,
  focusStep: undefined,
  focusPrompt: false,
  showReply: false,
};

export const openBrowserHunt = () => {
  vscode.postMessage({ type: 'browserHuntInfo' });
  showPage('browser-hunt');
};

// Beside the Plugin Hunter button, in the same AI group.
export const browserHuntButton = () =>
  el('button', { className: 'secondary', title: 'Browser Automation Hunter\nTalk to Claude about a browser procedure: prototype it on the desktop, then optimize it in code. It counts against your plan.', 'aria-label': 'Browser Automation Hunter', onclick: openBrowserHunt }, icon('globe'), el('span', { className: 'cta-label' }, 'Browser Automation Hunter'));

const waitText = () => {
  const s = Math.max(0, Math.floor((Date.now() - bh.startedAt) / 1000));
  return `Claude is working on it, ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

let ticker;
const tickWait = on => {
  clearInterval(ticker);
  if (!on) return;
  ticker = setInterval(() => {
    const text = app.querySelector('.bh-page .hunt-msg.wait .hunt-msg-text');
    if (text) text.textContent = waitText();
  }, 1000);
};

let saveTimer;
const saveNow = () => {
  clearTimeout(saveTimer);
  vscode.postMessage({ type: 'browserHuntSave', cards: bh.cards });
};
const saveSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
};

const repaint = () => {
  if (state.page !== 'browser-hunt' || state.detail) return;
  const top = app.querySelector('.main-body')?.scrollTop ?? 0;
  const find = app.querySelector('.hunt-col-find')?.scrollTop ?? 0;
  const log = app.querySelector('.hunt-chat-log');
  const follow = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  const logTop = log?.scrollTop ?? 0;
  renderMain();
  const body = app.querySelector('.main-body');
  if (body) body.scrollTop = top;
  const col = app.querySelector('.hunt-col-find');
  if (col) col.scrollTop = find;
  const next = app.querySelector('.hunt-chat-log');
  if (next) next.scrollTop = follow || bh.showReply ? next.scrollHeight : logTop;
  bh.showReply = false;
  if (bh.focusName) {
    const input = app.querySelector(`[data-card="${bh.focusName}"] .hunt-title`);
    input?.focus();
    input?.scrollIntoView({ block: 'nearest' });
  } else if (bh.focusStep !== undefined) {
    const input = app.querySelectorAll('.bh-page .hunt-col-find .bh-step-text')[bh.focusStep];
    input?.focus();
    input?.scrollIntoView({ block: 'nearest' });
  } else if (bh.focusPrompt) {
    const box = app.querySelector('.bh-page .hunt-ask-text');
    box?.focus();
    box?.select();
  } else if (bh.reveal) app.querySelector(`[data-card="${bh.reveal}"]`)?.scrollIntoView({ block: 'nearest' });
  bh.focusName = bh.focusStep = bh.reveal = undefined;
  bh.focusPrompt = false;
};

export function onBrowserHuntMessage(m) {
  if (m.type === 'browserHunt') {
    bh.info = m.info;
    bh.cards = m.info.cards;
    bh.chat = m.info.chat || [];
    bh.created = m.info.created || {};
  } else if (m.type === 'browserHuntCreate') {
    bh.results[m.id] = { state: m.state, text: m.text };
    if (m.state === 'done') bh.created = { ...bh.created, [m.id]: m.text };
  } else if (m.type === 'browserHuntRun') {
    bh.running = m.state === 'running';
    if (bh.running) bh.startedAt = Date.now();
    tickWait(bh.running);
    bh.pending = bh.running ? bh.prompt : '';
    bh.error = m.state === 'error' ? m.error || 'Claude could not answer. Your message is still in the box.' : '';
    if (m.state === 'done') {
      bh.prompt = '';
      bh.reveal = m.card;
      bh.showReply = true;
    }
  }
  repaint();
}

// The cards, newest first: the one being worked on and the rest, which are the History.
const split = () => {
  const all = [...bh.cards].sort((a, b) => b.created - a.created);
  const working = all[0];
  return { all, working, history: all.slice(1) };
};

// A card nothing has been put on yet: it offers the procedures the skill keeps.
const blank = p => !p.name.trim() && !p.goal.trim() && !p.steps.length;

const turnsOf = (p, all) => bh.chat.filter(t => t.card === p.id);
const workingTurns = ({ all, working }) => bh.chat.filter(t => (working ? t.card === working.id : false) || !all.some(p => p.id === t.card));

const turnRow = t => el('div', { className: `hunt-msg ${t.role}${t.wait ? ' wait' : ''}` }, el('span', { className: 'hunt-msg-who' }, t.role === 'owner' ? null : claudeMark(), t.role === 'owner' ? 'You' : 'Claude'), el('div', { className: 'hunt-msg-text' }, t.text));

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const newCard = () => {
  const id = newId();
  bh.cards = [{ id, prompt: '', created: Date.now(), name: '', goal: '', keep: 'guided', stage: 'prototype', steps: [] }, ...bh.cards];
  bh.focusName = id;
  bh.tab = 'new';
  saveNow();
  repaint();
};

// Picking a procedure of the skill fills the blank card (a new card when the working one has content) and leaves the message for Claude ready.
const pick = proc => {
  const { working } = split();
  const fill = { name: slug(proc.name), keep: proc.keep, stage: 'prototype' };
  if (working && blank(working)) Object.assign(working, fill);
  else bh.cards = [{ id: newId(), prompt: '', created: Date.now(), goal: '', steps: [], ...fill }, ...bh.cards];
  bh.tab = 'new';
  bh.prompt = `Write the steps for ${proc.name}.`;
  bh.focusPrompt = true;
  saveNow();
  repaint();
};

// ---- The header command bar ----

const startOver = () =>
  confirmAt(
    el(
      'button',
      {
        className: 'secondary',
        'aria-label': 'Start over',
        disabled: bh.running || !bh.chat.length,
        title: 'Start over\nClears the conversation, the chats in History too. The procedure cards stay.',
        onclick: () =>
          showConfirm({
            kind: 'browserHuntClear',
            onConfirm: () => {
              bh.chat = [];
              bh.notice = 'Conversation cleared';
              vscode.postMessage({ type: 'browserHuntClear' });
              setTimeout(() => ((bh.notice = ''), repaint()), 5000);
              repaint();
            },
          }),
      },
      icon('clear-all'),
      lab('Start over')
    ),
    'browserHuntClear'
  );

// Why Create cannot be pressed, in words; the empty string when it can.
const whyNot = (p, tab) => {
  if (tab === 'history') return 'Open New hunt: Create writes the procedure you are working on.';
  if (!p) return 'Pick a procedure or press New procedure first.';
  if (!bh.info || !bh.info.source) return (bh.info && bh.info.problem) || 'No browser automation skill was found to write into.';
  if (!p.name.trim()) return 'Give the procedure a name.';
  if (!p.steps.some(s => s.text.trim())) return 'Add at least one step.';
  return '';
};

const createButton = p => {
  const why = whyNot(p, bh.tab);
  const writing = !!(p && bh.results[p.id] && bh.results[p.id].state === 'running');
  return confirmAt(
    el(
      'button',
      {
        className: 'secondary',
        'aria-label': 'Create',
        disabled: !!why || writing,
        title: why ? `Create\n${why}` : 'Create\nWrites the procedure into the browser automation skill: its table row and a leaf with the steps. The files are listed first and backed up.',
        onclick: () => {
          bh.results[p.id] = undefined;
          saveNow();
          vscode.postMessage({ type: 'browserHuntCreate', id: p.id });
        },
      },
      icon('package'),
      lab(writing ? 'Creating...' : p && bh.created[p.id] ? 'Create again' : 'Create')
    ),
    'browserHuntCreate',
    p ? p.id : undefined
  );
};

const idle = () => bh.running || !bh.prompt.trim();

const huntButton = () =>
  confirmAt(
    el('button', { className: 'primary', 'aria-label': 'Hunt', title: bh.running ? 'Hunt\nClaude is answering.' : idle() ? 'Hunt\nWrite a message to Claude first.' : 'Hunt\nSends your message to Claude.', disabled: idle(), onclick: () => vscode.postMessage({ type: 'browserHuntRun', prompt: bh.prompt }) }, icon('telescope'), lab(bh.running ? 'Hunting...' : 'Hunt')),
    'browserHunt'
  );

// ---- The chat ----

function chatColumn(sp) {
  const turns = [...workingTurns(sp), ...(bh.pending ? [{ role: 'owner', text: bh.pending }, { role: 'claude', text: waitText(), wait: true }] : [])];
  const text = el('textarea', {
    className: 'hunt-ask-text',
    rows: 2,
    placeholder: 'Message Claude',
    value: bh.running ? '' : bh.prompt,
    readonly: bh.running,
    'aria-label': 'Message to Claude',
    oninput: e => {
      bh.prompt = e.target.value;
      const go = app.querySelector('.bh-page [data-confirm="browserHunt"]');
      if (go) {
        go.disabled = idle();
        go.title = idle() ? 'Hunt\nWrite a message to Claude first.' : 'Hunt\nSends your message to Claude.';
      }
    },
    onkeydown: e => {
      if (e.key === 'Enter' && !e.shiftKey && !idle()) {
        e.preventDefault();
        app.querySelector('.bh-page [data-confirm="browserHunt"]')?.click();
      }
    },
  });
  return el(
    'div',
    { className: 'hunt-col hunt-col-chat' },
    el('div', { className: 'hunt-col-head' }, icon('comment-discussion'), el('span', {}, 'Chat'), bh.notice ? el('span', { className: 'hunt-note', role: 'status' }, icon('check'), bh.notice) : null),
    el('div', { className: 'hunt-chat-log', role: 'log', 'aria-live': 'polite' }, turns.length ? turns.map(turnRow) : el('div', { className: 'empty flush' }, 'Describe a browser procedure.')),
    bh.error ? el('div', { className: 'notice bad', role: 'alert' }, bh.error) : null,
    el('div', { className: 'hunt-composer' }, text)
  );
}

// ---- The procedure card ----

const stageBtn = (p, id, glyph, text, about) =>
  el(
    'button',
    {
      type: 'button',
      className: `bh-stage${p.stage === id ? ' on' : ''}`,
      'aria-pressed': String(p.stage === id),
      title: `${text}\n${about}`,
      onclick: () => ((p.stage = id), saveSoon(), repaint()),
    },
    icon(glyph),
    text
  );

function stepRow(p, s, i) {
  return el(
    'div',
    { className: 'bh-step' },
    el('span', { className: 'bh-step-n' }, String(i + 1)),
    el('input', {
      type: 'text',
      className: 'bh-step-text',
      value: s.text,
      'aria-label': `Step ${i + 1}`,
      oninput: e => ((s.text = e.target.value), saveSoon()),
      // Enter adds the next step under this one and moves there.
      onkeydown: e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        p.steps.splice(i + 1, 0, { text: '', manual: false });
        bh.focusStep = i + 1;
        saveSoon();
        repaint();
      },
    }),
    el('label', { className: 'bh-manual', title: 'Manual step\nSign-in, invite acceptance, MFA or an approval: a person does this step, the automation waits.' }, el('input', { type: 'checkbox', role: 'switch', checked: s.manual, 'aria-label': `Step ${i + 1} is manual`, onchange: e => ((s.manual = e.target.checked), saveSoon(), repaint()) })),
    iconBtn('close', `Remove step ${i + 1}`, () => ((p.steps = p.steps.filter(x => x !== s)), saveSoon(), repaint()))
  );
}

// The procedures the skill keeps, to start a card from: one press fills the card and readies the message for Claude.
function procedures() {
  const list = bh.info ? bh.info.procedures : [];
  if (!list.length) return null;
  return el(
    'div',
    { className: 'bh-procs', role: 'group', 'aria-label': 'Procedures you keep' },
    el('div', { className: 'bh-procs-head' }, 'Start from'),
    list.map(p =>
      el(
        'button',
        { className: 'bh-proc', title: `${p.name}\n${p.how}`, disabled: bh.running, onclick: () => pick(p) },
        el('span', { className: 'bh-proc-name' }, p.name),
        el('span', { className: 'tag' }, keepLabel(p.keep))
      )
    )
  );
}

function card(p, history = false) {
  const expanded = !history || !!bh.open[p.id];
  const toggle = () => ((bh.open[p.id] = !bh.open[p.id]), repaint());
  const head = el(
    'div',
    { className: 'hunt-card-head', onclick: history ? e => (e.target.closest('input,button') ? undefined : toggle()) : undefined },
    history ? el('button', { type: 'button', className: 'hunt-chev', 'aria-expanded': String(expanded), 'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${p.name || 'this card'}`, onclick: toggle }, icon(expanded ? 'chevron-down' : 'chevron-right')) : null,
    icon('globe'),
    el('input', { className: 'hunt-title', type: 'text', placeholder: 'procedure-name', value: p.name, 'aria-label': 'Procedure name', oninput: e => ((p.name = e.target.value.trim()), saveSoon()) }),
    iconBtn('trash', 'Discard this card', () => {
      bh.cards = bh.cards.filter(x => x !== p);
      saveNow();
      repaint();
    })
  );
  const keep = el(
    'select',
    { className: 'bh-keep', 'aria-label': 'Kept as', title: 'Kept as\nHow the procedure runs once it is optimized in code.', onchange: e => ((p.keep = e.target.value), saveSoon(), repaint()) },
    KEEPS.map(k => el('option', { value: k[0], selected: p.keep === k[0] }, k[1]))
  );
  const result = bh.results[p.id];
  const body = () => {
    const turns = history ? turnsOf(p, split().all) : [];
    return [
      turns.length ? el('div', { className: 'hunt-card-chat', role: 'log', 'aria-label': 'Conversation of this card' }, turns.map(turnRow)) : null,
      el('input', { className: 'bh-goal', type: 'text', placeholder: 'Goal', value: p.goal, 'aria-label': 'Goal', oninput: e => ((p.goal = e.target.value), saveSoon()) }),
      el(
        'div',
        { className: 'bh-row' },
        el('div', { className: 'bh-stages', role: 'group', 'aria-label': 'Stage' }, stageBtn(p, 'prototype', 'device-desktop', 'Prototype on desktop', 'Walk the steps in the browser with Claude and save the click path.'), stageBtn(p, 'optimized', 'code', 'Optimized in code', 'The steps run as the kept form; only manual steps stay with a person.')),
        el('label', { className: 'bh-keep-label' }, 'Kept as', keep)
      ),
      p.steps.length ? el('div', { className: 'bh-steps-head' }, el('span', {}, 'Steps'), el('span', { className: 'bh-manual-head' }, 'Manual')) : null,
      el('div', { className: 'bh-steps' }, p.steps.map((s, i) => stepRow(p, s, i))),
      el('div', { className: 'bh-add' }, el('button', { className: 'secondary', onclick: () => ((p.steps = [...p.steps, { text: '', manual: false }]), (bh.focusStep = p.steps.length - 1), saveSoon(), repaint()) }, icon('add'), 'Add step')),
      result && result.state === 'error' ? el('div', { className: 'notice hunt-result bad', role: 'alert', title: result.text }, result.text) : bh.created[p.id] ? el('div', { className: 'notice done', role: 'status', title: bh.created[p.id] }, icon('check'), bh.created[p.id]) : null,
    ].filter(Boolean);
  };
  return el('div', { className: `hunt-card${history ? ' history' : ''}${history && !expanded ? ' collapsed' : ''}`, 'data-card': p.id }, head, expanded ? body() : null);
}

export function renderBrowserHunt() {
  const sp = split();
  const bar = tabBar(
    [
      ['new', 'New hunt', 'sparkle', 'Talk to Claude and shape the procedure.', undefined],
      ['history', 'History', 'history', 'The procedure cards you have made or started, each with the chat that made it.', sp.history.length || undefined],
    ],
    bh.tab,
    id => ((bh.tab = id), hideHover(), repaint()),
    'Browser Automation Hunter views'
  );
  const showPicker = !sp.working || blank(sp.working);
  const fresh = el(
    'div',
    { className: 'hunt-split' },
    chatColumn(sp),
    el(
      'div',
      { className: 'hunt-col hunt-col-find' },
      el('div', { className: 'hunt-col-head' }, icon('checklist'), el('span', {}, 'Procedure'), sp.working && !blank(sp.working) ? el('span', { className: 'hunt-col-count' }, `${sp.working.steps.length} ${sp.working.steps.length === 1 ? 'step' : 'steps'}`) : null),
      sp.working ? card(sp.working) : null,
      showPicker ? procedures() : null
    )
  );
  const history = sp.history.length ? el('div', { className: 'hunt-history' }, sp.history.map(p => card(p, true))) : el('div', { className: 'empty flush' }, bh.info ? 'No other procedures yet.' : 'Reading...');
  const count = bh.info && bh.info.procedures.length;
  const head = countHead(
    'globe',
    'Browser Automation Hunter',
    bh.info ? `${count} ${count === 1 ? 'procedure' : 'procedures'} kept` : 'Reading...',
    iconBtn('arrow-left', 'Back to Plugins', () => showKindPage('plugin', undefined)),
    el('button', { className: 'secondary', 'aria-label': 'New procedure', title: 'New procedure\nAn empty card to start from.', disabled: bh.running, onclick: newCard }, icon('add'), lab('New procedure')),
    createButton(bh.tab === 'new' ? sp.working : undefined),
    startOver(),
    aiGroup('', huntButton())
  );
  head.classList.toggle('busy', bh.running);
  return el('section', { className: 'main bh-page' }, head, el('div', { className: 'main-body hunt-body', onscroll: hideHover }, bar, bh.tab === 'history' ? history : fresh));
}
