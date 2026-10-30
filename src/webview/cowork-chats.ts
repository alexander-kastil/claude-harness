// @ts-nocheck
// Cowork chats and artifacts: two nodes of the Cowork region, a list page with a filter, a read-only page per chat (the whole
// conversation and every file it produced or was given) and the Continue in terminal handover. Read-only: the data is what the
// Claude desktop app keeps on this PC and the Cowork sessions claude.ai lists; claude.ai chats themselves are not readable.
import { COWORK_NODES } from './cowork';
import { openAt, showPage, state, vscode } from './core';
import { cmd, cmdBox, drawButton } from './detail';
import { card } from './detail-view';
import { askDrawing, drawState, drawingFigure } from './drawing';
import { showHandover } from './handover';
import { aiGroup, countHead, el, fmtAgo, icon, iconBtn, plural } from './dom';
import { gridTable } from './tables';

export const CHAT_PAGE = 'cowork-chat';
const sizeText = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const chats = () => (state.coworkChats && state.coworkChats.chats) || [];
const artifacts = () => (state.coworkChats && state.coworkChats.artifacts) || [];
const sessions = () => (state.coworkSessions && state.coworkSessions.data && state.coworkSessions.data.sessions) || [];
const has = (q, ...parts) => !q || parts.join(' ').toLowerCase().includes(q);
const openFile = file => vscode.postMessage({ type: 'openChatFile', file });

const askChats = () => {
  state.coworkChats = null;
  vscode.postMessage({ type: 'coworkChats' });
};
const askSessions = () => {
  state.coworkSessions = null;
  vscode.postMessage({ type: 'coworkSessions' });
};

export const showChat = id => {
  state.coworkChat = { id, data: undefined };
  vscode.postMessage({ type: 'coworkChat', id });
  showPage(CHAT_PAGE);
};

/** The Chats and Artifacts entries of the Cowork region; a nav search lists the chats and artifacts that match. */
function chatsNode(list, q, { treeItem }) {
  if (state.coworkChats === undefined) askChats();
  if (state.coworkSessions === undefined) askSessions();
  const hitChats = chats().filter(c => has(q, c.title));
  const hitFiles = artifacts().filter(a => has(q, a.name, a.chat));
  const heads = [
    ['chats', 'Chats', 'comment-discussion', 'Chats\nYour Cowork chats on this PC with the files they produced, and the Cowork sessions on claude.ai. Read-only.', chats().length + sessions().length, 'cowork-chats'],
    ['artifacts', 'Artifacts', 'package', 'Artifacts\nThe files your Cowork chats produced on this PC.', artifacts().length, 'cowork-artifacts'],
  ];
  if (q && !hitChats.length && !hitFiles.length && !heads.some(h => h[1].toLowerCase().includes(q))) return;
  for (const [id, label, glyph, tip, n, page] of heads) {
    list.append(
      treeItem(
        el(
          'div',
          { className: `row cowork-link${!state.detail && state.page === page ? ' selected' : ''}`, title: tip, onclick: () => showPage(page) },
          icon(glyph),
          el('span', { className: 'name' }, label),
          el('span', { className: 'count' }, state.coworkChats === null ? '...' : n)
        ),
        `n|cowork|${id}`,
        2
      )
    );
    if (!q) continue;
    if (id === 'chats') {
      list.append(
        ...hitChats.slice(0, 8).map(c =>
          treeItem(el('div', { className: `row nested${!state.detail && state.page === CHAT_PAGE && state.coworkChat?.id === c.id ? ' selected' : ''}`, title: `${c.title}\n${plural(c.produced + c.uploaded, 'file')}`, onclick: () => showChat(c.id) }, icon('comment'), el('span', { className: 'name' }, c.title)), `k|cowork-chat|${c.id}`, 2)
        )
      );
    } else {
      list.append(...hitFiles.slice(0, 8).map(a => treeItem(el('div', { className: 'row nested', title: `${a.name}\n${a.chat}`, onclick: () => showPage('cowork-artifacts') }, icon('file'), el('span', { className: 'name' }, a.name)), `k|cowork-artifact|${a.file}`, 2)));
    }
  }
}
COWORK_NODES.push(chatsNode);

/** The filter of a Cowork list page: one search box that narrows the page's tables as you type. */
export function coworkFilter(placeholder, redraw) {
  return el(
    'div',
    { className: 'overview-search cowork-filter' },
    el('input', {
      type: 'search',
      placeholder,
      'aria-label': placeholder,
      value: state.coworkFilter || '',
      oninput: e => {
        state.coworkFilter = e.target.value;
        redraw();
      },
    })
  );
}

const q = () => (state.coworkFilter || '').trim().toLowerCase();

// A page whose body is redrawn in place, so the filter box keeps its focus while typing.
function filtered(head, filterBox, draw) {
  const content = el('div', { className: 'cowork-results' });
  const paint = () => content.replaceChildren(...[].concat(draw()).filter(Boolean));
  const body = el('div', { className: 'main-body' }, filterBox(paint), content);
  paint();
  return el('section', { className: 'main' }, head, body);
}

const reason = (text, glyph = 'info') => el('div', { className: 'empty flush' }, icon(glyph), ' ', text);

function chatsTable() {
  const rows = chats().filter(c => has(q(), c.title, c.model));
  if (state.coworkChats === null) return reason('Reading the chats on this PC...');
  if (!state.coworkChats.found) return reason("The Claude desktop app's data is not on this PC, so no chat is listed here.");
  if (!rows.length) return reason(q() ? 'No chat matches.' : 'No Cowork chat has run on this PC.');
  return gridTable(
    [
      { head: 'Chat', track: 'minmax(160px, 4fr)', cls: 'at-name', cell: c => [icon('comment-discussion'), el('span', { className: 'at-label' }, c.title)] },
      { head: 'Files', track: '110px', muted: true, cell: c => `${c.produced} out, ${c.uploaded} in`, title: c => `${plural(c.produced, 'file')} produced, ${plural(c.uploaded, 'file')} given to the chat` },
      { head: 'Model', track: 'minmax(100px, 2fr)', muted: true, wide: true, cell: c => c.model.replace(/^claude-/, '') },
      { head: 'Last activity', track: '110px', muted: true, cell: c => fmtAgo(c.lastActivity) },
    ],
    rows.map(c => Object.assign({ open: () => showChat(c.id) }, c)),
    'Chats on this PC'
  );
}

function cloudTable() {
  const s = state.coworkSessions;
  if (s === null || s === undefined) return reason('Reading the Cowork sessions on claude.ai...');
  if (s.data.state !== 'ok') return reason(s.data.note, 'warning');
  const rows = sessions().filter(x => has(q(), x.title, x.status));
  if (!rows.length) return reason(q() ? 'No session matches.' : 'claude.ai lists no Cowork session.');
  return gridTable(
    [
      { head: 'Session', track: 'minmax(160px, 4fr)', cls: 'at-name', cell: x => [icon('cloud'), el('span', { className: 'at-label' }, x.title)] },
      { head: 'Status', track: 'minmax(80px, 1fr)', muted: true, cell: x => x.status },
      { head: 'Messages', track: '84px', num: true, muted: true, cell: x => String(x.messages) },
      { head: 'Updated', track: '110px', muted: true, cell: x => (x.updated ? fmtAgo(x.updated) : '-') },
    ],
    rows.map(x => Object.assign({ open: () => vscode.postMessage({ type: 'command', command: 'openScheduled', target: 'run', id: x.id }) }, x)),
    'Cowork sessions on claude.ai'
  );
}

export function renderCoworkChats() {
  if (state.coworkChats === undefined) askChats();
  if (state.coworkSessions === undefined) askSessions();
  const head = countHead('comment-discussion', 'Chats', state.coworkChats?.found ? plural(chats().length, 'chat') : 'Cowork', iconBtn('refresh', 'Reload', () => (askChats(), askSessions())));
  return filtered(head, paint => coworkFilter('Search the chats', paint), () => [
    card('On this PC', state.coworkChats ? chats().filter(c => has(q(), c.title, c.model)).length : null, chatsTable()),
    card('Cowork sessions on claude.ai', state.coworkSessions?.data?.state === 'ok' ? sessions().filter(x => has(q(), x.title, x.status)).length : null, cloudTable()),
    el('div', { className: 'empty flush' }, 'Chats of claude.ai itself are not stored on this PC and the Claude Code sign-in cannot read them. Share one as an artifact link, or open it in the desktop app.'),
  ]);
}

export function renderCoworkArtifacts() {
  if (state.coworkChats === undefined) askChats();
  const head = countHead('package', 'Artifacts', state.coworkChats ? plural(artifacts().length, 'file') : 'Cowork', iconBtn('refresh', 'Reload', askChats));
  return filtered(head, paint => coworkFilter('Search the artifacts', paint), () => {
    if (state.coworkChats === null) return reason('Reading the artifacts on this PC...');
    if (!state.coworkChats.found) return reason("The Claude desktop app's data is not on this PC, so no artifact is listed here.");
    const rows = artifacts().filter(a => has(q(), a.name, a.chat));
    if (!rows.length) return reason(q() ? 'No artifact matches.' : 'No Cowork chat produced a file on this PC.');
    return gridTable(
      [
        { head: 'File', track: 'minmax(160px, 4fr)', cls: 'at-name', cell: a => [icon('file'), el('span', { className: 'at-label' }, a.name)] },
        { head: 'Chat', track: 'minmax(120px, 3fr)', muted: true, wide: true, cell: a => a.chat, title: a => `${a.chat}\nThe chat that produced this file.` },
        { head: 'Size', track: '80px', num: true, muted: true, cell: a => sizeText(a.size) },
        { head: 'Updated', track: '110px', muted: true, cell: a => fmtAgo(a.updated) },
      ],
      rows.map(a => Object.assign({ open: () => openFile(a.file) }, a)),
      'Artifacts'
    );
  });
}

const turn = m => el('div', { className: `hunt-msg ${m.role === 'you' ? 'owner' : 'claude'}` }, el('span', { className: 'hunt-msg-who' }, m.role === 'you' ? 'You' : 'Claude'), el('div', { className: 'hunt-msg-text' }, m.text));

function filesTable(files) {
  if (!files.length) return el('div', { className: 'dv-empty' }, 'The chat produced and received no files.');
  return gridTable(
    [
      { head: 'File', track: 'minmax(160px, 4fr)', cls: 'at-name', cell: f => [icon(f.kind === 'produced' ? 'new-file' : 'cloud-upload'), el('span', { className: 'at-label' }, f.name)] },
      { head: 'Kind', track: '90px', muted: true, cell: f => (f.kind === 'produced' ? 'Produced' : 'Given') },
      { head: 'Size', track: '80px', num: true, muted: true, cell: f => sizeText(f.size) },
    ],
    files.map(f => Object.assign({ open: () => openFile(f.file) }, f)),
    'Files of the chat'
  );
}

/** The page of one chat: its command bar with Continue in terminal, the files and the whole conversation. */
export function renderCoworkChat() {
  const s = state.coworkChat;
  const c = chats().find(x => x.id === s.id);
  const d = s.data;
  // Drawn from the conversation and the files it produced and was given.
  const drawn = c ? { id: `cowork-chat:${c.id}`, kind: 'chat', name: c.title } : null;
  if (drawn) askDrawing(drawn, s);
  const back = cmd('arrow-left', 'Back', 'Back\nTo the Cowork chats.', () => showPage('cowork-chats'));
  const go = cmd('terminal', 'Continue in terminal', 'Continue in terminal\nOpens the Handover card with this chat on it: you tick the files, pick the target repository and Claude drafts the task. The chat itself is only read.', () => showHandover({ source: 'chat', id: s.id }), { disabled: !d });
  const head = el(
    'header',
    { className: `main-head detail-head${drawn && drawState(drawn).running ? ' busy' : ''}` },
    el(
      'div',
      { className: 'title' },
      el(
        'div',
        { className: 'dh-line' },
        el('span', { className: 'dh-kind', title: 'Chat\nA Cowork chat of the Claude desktop app on this PC.' }, icon('comment-discussion'), el('span', {}, 'Chat')),
        el('h1', { title: c ? c.title : 'Chat' }, el('span', { className: 'dh-name' }, c ? c.title : 'Chat')),
        el('span', { className: 'dh-source', title: 'Cowork\nRead-only: the chat lives in the Claude desktop app; this page shows what it keeps on this PC.' }, icon('cloud'), el('span', {}, 'Cowork'))
      )
    ),
    el('div', { className: 'cmd-bar' }, cmdBox('Page', '', back), cmdBox('Handover', '', go), drawn ? aiGroup('', drawButton(drawn)) : null)
  );
  const body = el('div', { className: 'main-body' });
  if (!c) {
    body.append(el('div', { className: 'empty flush' }, state.coworkChats ? 'This chat is not on this PC any more.' : 'Reading the chat...'));
    return el('section', { className: 'main' }, head, body);
  }
  body.append(
    el(
      'div',
      { className: 'dv' },
      drawingFigure(drawn),
      el('section', { className: 'dv-hero' }, el('div', { className: 'dv-cols' }, el('div', { className: 'dv-group' }, el('div', { className: 'dv-group-cap' }, 'Details'), fact('Model', c.model.replace(/^claude-/, '') || '-', 'chip'), fact('Last activity', fmtAgo(c.lastActivity), 'history'), fact('Files', `${c.produced} produced, ${c.uploaded} given`, 'files'), fact('Archived', c.archived ? 'yes' : 'no', 'archive')))),
      el('div', { className: 'group-label' }, 'Contents'),
      card('Files', d ? d.files.length : null, d ? filesTable(d.files) : el('div', { className: 'empty flush' }, 'Reading...')),
      card('Conversation', d ? d.messages.length + d.more : null, d ? (d.messages.length ? el('div', { className: 'hunt-chat-log chat-log' }, d.messages.map(turn), d.more ? el('div', { className: 'empty flush' }, `${d.more} more messages not shown.`) : null) : el('div', { className: 'dv-empty' }, 'The chat has no text on this PC.')) : el('div', { className: 'empty flush' }, 'Reading...'))
    )
  );
  return el('section', { className: 'main' }, head, body);
}

const fact = (label, value, glyph) => el('div', { className: 'dv-fact' }, el('span', { className: 'k' }, icon(glyph), label), el('span', { className: 'v' }, value));

/** Host messages of the chat views; returns true when one was handled. */
export function onChatMessage(m, repaint) {
  if (m.type === 'coworkChats') {
    state.coworkChats = { found: m.found, chats: m.chats, artifacts: m.artifacts };
    repaint(true);
    return true;
  }
  if (m.type === 'coworkSessions') {
    state.coworkSessions = { data: m.data };
    repaint(false);
    return true;
  }
  if (m.type === 'coworkChat') {
    if (state.coworkChat && state.coworkChat.id === m.id) {
      state.coworkChat.data = m.data || null;
      repaint(false);
    }
    return true;
  }
  return false;
}
