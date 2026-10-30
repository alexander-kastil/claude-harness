// @ts-nocheck
// Handover: what a Cowork chat, an artifact link or a file of the apps hands to Claude Code. The Plugin Hunter's shape: the inbox on
// the left (a pasted or dropped link, desktop chats, Cowork sessions, recent files of the apps), the card on the right that the
// owner ticks and Claude drafts, and Continue in terminal with a confirm card that lists every file and the first prompt.
import { COWORK_NODES } from './cowork';
import { confirmAt } from './confirm';
import { showPage, state, vscode } from './core';
import { cmd, cmdBox } from './detail';
import { COWORK_GLYPH, aiGroup, el, fmtAgo, icon, iconBtn, plural } from './dom';

export const PAGE = 'cowork-handover';

const model = () => (state.handover = state.handover || { inbox: undefined, card: undefined, filter: '', link: '', error: '', drafting: false, draftError: '', result: undefined });

const sizeText = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const has = (q, ...parts) => !q || parts.join(' ').toLowerCase().includes(q);
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'handover';
const chats = () => (state.coworkChats && state.coworkChats.chats) || [];
const sessions = () => (state.coworkSessions && state.coworkSessions.data && state.coworkSessions.data.sessions) || [];

let repaintPage = () => {};

/** Opens the page; a source puts it on the card at once (the chat page's Continue in terminal does). */
export function showHandover(source) {
  const h = model();
  if (state.coworkChats === undefined) {
    state.coworkChats = null;
    vscode.postMessage({ type: 'coworkChats' });
  }
  if (source) pick(source);
  showPage(PAGE);
}

const pick = source => {
  const h = model();
  h.error = '';
  h.result = undefined;
  h.pendingKey = `${source.source}:${source.id || source.link}`;
  vscode.postMessage(Object.assign({ type: 'handoverSeed' }, source));
};

function ask() {
  const h = model();
  if (h.inbox === undefined) {
    h.inbox = null;
    vscode.postMessage({ type: 'handoverInbox' });
  }
  if (state.coworkChats === undefined) {
    state.coworkChats = null;
    vscode.postMessage({ type: 'coworkChats' });
  }
  if (state.coworkSessions === undefined) {
    state.coworkSessions = null;
    vscode.postMessage({ type: 'coworkSessions' });
  }
}

const slugFolder = c => `handover/${slug(c.title)}`;

// ---- Inbox

function useLink() {
  const h = model();
  const link = h.link.trim();
  if (!link) return;
  pick({ source: 'link', link });
}

function inbox() {
  const h = model();
  const selectedKey = h.card && h.card.key;
  const item = (key, glyph, title, detail, onclick) =>
    el('button', { type: 'button', className: `hv-item${selectedKey === key ? ' selected' : ''}`, title: `${title}\n${detail}`, onclick }, icon(glyph), el('span', { className: 'hv-item-title' }, title), el('span', { className: 'hv-item-detail' }, detail));
  const group = (label, glyph, count, rows, empty) =>
    el('div', { className: 'hv-group' }, el('div', { className: 'hv-group-head' }, icon(glyph), el('span', {}, label), el('span', { className: 'dv-count' }, count === null ? '...' : String(count))), rows.length ? rows : el('div', { className: 'empty flush' }, empty));
  const link = el(
    'div',
    { className: 'hv-link' },
    el('input', {
      type: 'text',
      placeholder: 'Paste an artifact link, or drop it here',
      'aria-label': 'Artifact link',
      value: h.link,
      oninput: e => (h.link = e.target.value),
      onkeydown: e => e.key === 'Enter' && useLink(),
    }),
    el('button', { type: 'button', className: 'secondary', onclick: useLink }, icon('link'), 'Use link')
  );
  const col = el(
    'div',
    {
      className: 'hunt-col hv-inbox',
      ondragover: e => e.preventDefault(),
      ondrop: e => {
        e.preventDefault();
        const text = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim().split('\n')[0];
        if (text) {
          h.link = text;
          useLink();
          repaintPage();
        }
      },
    },
    el('div', { className: 'hunt-col-head' }, icon('inbox'), el('span', {}, 'Inbox')),
    link,
    h.error ? el('div', { className: 'notice bad', role: 'alert' }, h.error) : null,
    el('div', { className: 'overview-search' }, el('input', { type: 'search', placeholder: 'Search the inbox', 'aria-label': 'Search the inbox', value: h.filter, oninput: e => ((h.filter = e.target.value), refill()) })),
    el('div', { className: 'hv-groups' })
  );
  const refill = () => {
    const q2 = h.filter.trim().toLowerCase();
    const m = chats().filter(c => has(q2, c.title));
    const c2 = sessions().filter(s => has(q2, s.title, s.status));
    const f2 = ((h.inbox && h.inbox.downloads) || []).filter(f => has(q2, f.name));
    col.querySelector('.hv-groups').replaceChildren(
      group('Desktop chats', 'comment-discussion', state.coworkChats === null ? null : m.length, m.slice(0, 12).map(c => item(`chat:${c.id}`, 'comment', c.title, `${c.produced + c.uploaded} files · ${fmtAgo(c.lastActivity)}`, () => (pick({ source: 'chat', id: c.id }), repaintPage()))), 'No chat on this PC.'),
      group('Cowork sessions', COWORK_GLYPH, state.coworkSessions === null ? null : c2.length, c2.slice(0, 12).map(s => item(`cloud:${s.id}`, COWORK_GLYPH, s.title, [s.messages ? plural(s.messages, 'message') : '', s.status].filter(Boolean).join(' · '), () => (pick({ source: 'cloud', id: s.id, title: s.title }), repaintPage()))), state.coworkSessions && state.coworkSessions.data.state !== 'ok' ? state.coworkSessions.data.note : 'No session listed.'),
      group('Files in Downloads', 'folder-opened', h.inbox === null ? null : f2.length, f2.map(f => item(`download:${f.file}`, 'file', f.name, `${sizeText(f.size)} · ${fmtAgo(f.updated)}`, () => (pick({ source: 'download', id: f.file }), repaintPage()))), 'No file of the last 14 days.')
    );
  };
  refill();
  return col;
}

// ---- Card

const field = (label, ...body) => el('div', { className: 'hv-field' }, el('div', { className: 'hv-label' }, label), body);
const area = (c, key, rows, placeholder) => el('textarea', { className: 'hunt-ask-text hv-area', rows, placeholder, 'aria-label': placeholder, value: c[key], oninput: e => (c[key] = e.target.value) });

function filesField(c) {
  if (!c.files.length) return el('div', { className: 'empty flush' }, 'No file comes along.');
  return el(
    'div',
    { className: 'hv-files' },
    c.files.map((f, i) =>
      el(
        'div',
        { className: `hv-file${f.missing ? ' missing' : ''}` },
        el('input', { type: 'checkbox', role: 'switch', checked: f.include, 'aria-label': `Copy ${f.name}`, onchange: e => (f.include = e.target.checked) }),
        icon(f.missing ? 'warning' : 'file'),
        el('span', { className: 'hv-file-name', title: f.file }, f.name),
        f.missing ? el('span', { className: 'hv-missing' }, 'Missing on this PC') : null,
        f.missing ? el('button', { type: 'button', className: 'link', title: 'Locate\nPick the file on this PC; it is copied instead.', onclick: () => vscode.postMessage({ type: 'handoverLocate', index: i }) }, icon('search'), ' Locate') : null
      )
    )
  );
}

const cardOf = c => ({ title: c.title, source: c.source, link: c.link, snapshot: c.snapshot, files: c.files.map(f => ({ name: f.name, file: f.file, include: f.include })), repo: c.repo, folder: c.folder, task: c.task, rules: c.rules, exists: c.exists, todo: c.todo });

function card() {
  const h = model();
  const c = h.card;
  const repos = (h.inbox && h.inbox.repos) || [];
  const cwd = h.inbox && h.inbox.cwd;
  const options = [...repos];
  if (cwd && !options.some(r => r.base.toLowerCase() === cwd.toLowerCase())) options.unshift({ label: 'Current repository', base: cwd });
  // The current repository may be spelled differently from the listed one (case, slashes): the listed spelling is kept.
  const norm = p => p.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  const listed = options.find(r => norm(r.base) === norm(c.repo || ''));
  if (listed) c.repo = listed.base;
  const ticked = c.files.filter(f => f.include).length;
  const result = h.result;
  return el(
    'div',
    { className: 'hunt-col hunt-col-find hv-card' },
    el('div', { className: 'hunt-col-head' }, icon('arrow-swap'), el('span', {}, 'Handover card'), el('span', { className: 'hunt-col-count' }, `${ticked} of ${c.files.length} files`), iconBtn('close', 'Clear the card', () => ((h.card = undefined), (h.result = undefined), repaintPage()))),
    el('div', { className: 'hv-source' }, icon({ link: 'link', cloud: COWORK_GLYPH, chat: 'comment-discussion', download: 'file' }[c.source]), el('span', { className: 'hv-source-title' }, c.title), el('span', { className: 'tag' }, { link: 'artifact link', cloud: 'Cowork session', chat: 'desktop chat', download: 'app file' }[c.source])),
    c.note ? el('div', { className: 'notice', role: 'status' }, icon('info'), el('span', {}, c.note)) : null,
    field('Task', el('input', { type: 'text', className: 'hv-task', placeholder: 'One sentence: what Claude Code does next', 'aria-label': 'Task', value: c.task, oninput: e => (c.task = e.target.value) }), h.draftError ? el('div', { className: 'notice bad', role: 'alert' }, h.draftError) : null),
    field('Files to copy', filesField(c)),
    field(
      'Target',
      el(
        'div',
        { className: 'hv-target' },
        el(
          'select',
          { 'aria-label': 'Target repository', onchange: e => (c.repo = e.target.value) },
          el('option', { value: '' }, 'Pick a repository'),
          options.map(r => el('option', Object.assign({ value: r.base, title: r.base }, c.repo === r.base ? { selected: true } : {}), r.label))
        )
      ),
      el('details', { className: 'hv-fold' }, el('summary', {}, 'Folder in the repository'), el('input', { type: 'text', 'aria-label': 'Folder', placeholder: slugFolder(c), value: c.folder, oninput: e => (c.folder = e.target.value) }))
    ),
    el(
      'details',
      { className: 'hv-fold', open: !!(c.source === 'link' || c.source === 'cloud' || c.snapshot) },
      el('summary', {}, 'Text snapshot'),
      area(c, 'snapshot', 6, 'The text of the artifact or the chat: it goes into CONTEXT.md')
    ),
    el(
      'details',
      { className: 'hv-fold hv-state', open: !!(c.rules || c.exists || c.todo) },
      el('summary', {}, 'Rules and state'),
      field('Rules the chat set', area(c, 'rules', 3, 'One rule per line')),
      field('What exists', area(c, 'exists', 3, 'One item per line')),
      field('Still to write', area(c, 'todo', 3, 'One item per line'))
    ),
    result ? el('div', { className: `notice${result.state === 'error' ? ' bad' : ''}`, role: result.state === 'error' ? 'alert' : 'status' }, icon(result.state === 'done' ? 'check' : result.state === 'error' ? 'error' : 'loading'), el('span', {}, result.state === 'running' ? 'Copying the files...' : result.text)) : null
  );
}

export function renderHandover() {
  const h = model();
  ask();
  repaintPage = () => {
    const main = document.querySelector('.main');
    if (main && state.page === PAGE) main.replaceWith(renderHandover());
  };
  const split = el('div', { className: 'hunt-split' }, inbox(), h.card ? card() : el('div', { className: 'hunt-col hunt-col-find hv-card' }, el('div', { className: 'hunt-col-head' }, icon('arrow-swap'), el('span', {}, 'Handover card')), el('div', { className: 'empty flush' }, 'Pick a source from the inbox.')));
  const c = h.card;
  const draft = confirmAt(
    cmd('sparkle', h.drafting ? 'Drafting...' : 'Draft', 'Draft\nClaude reads the snapshot and the file names and drafts the task, the rules the chat set, and what exists and what is still to write. It counts against your plan.', () => ((h.draftError = ''), vscode.postMessage({ type: 'handoverDraft', card: cardOf(c) })), { disabled: !c || h.drafting }),
    'handoverDraft',
    'draft'
  );
  const go = confirmAt(
    cmd('terminal', 'Continue in terminal', 'Continue in terminal\nLists every file and the first prompt, then copies the ticked files beside a CONTEXT.md in the target and opens Claude Code there.', () => ((h.result = undefined), vscode.postMessage({ type: 'handoverRun', card: cardOf(c) })), { disabled: !c || !c.repo || h.result?.state === 'running' }),
    'handover',
    'card'
  );
  const head = el(
    'header',
    { className: 'main-head detail-head' },
    el('div', { className: 'title' }, el('div', { className: 'dh-line' }, el('span', { className: 'dh-kind', title: 'Handover\nHand a chat, an artifact link or a file of the apps to Claude Code in a terminal.' }, icon('arrow-swap'), el('span', {}, 'Handover')), el('h1', {}, el('span', { className: 'dh-name' }, 'Cowork to Claude Code')))),
    el(
      'div',
      { className: 'cmd-bar' },
      cmdBox('Inbox', '', cmd('refresh', 'Reload', 'Reload\nReads the inbox again.', () => ((h.inbox = undefined), (state.coworkChats = undefined), (state.coworkSessions = undefined), repaintPage()))),
      aiGroup('', draft, go)
    )
  );
  head.classList.toggle('busy', !!h.drafting);
  return el('section', { className: 'main' }, head, el('div', { className: 'main-body hunt-body' }, split));
}

/** Host messages of the Handover page. */
export function onHandoverMessage(m, repaint) {
  const h = model();
  if (m.type === 'handoverInbox') {
    h.inbox = { downloads: m.downloads, repos: m.repos, cwd: m.cwd };
    repaint();
  } else if (m.type === 'handoverSeed') {
    if (m.error) h.error = m.error;
    else if (m.seed) {
      h.error = '';
      const s = m.seed;
      h.card = { key: h.pendingKey, title: s.title, source: s.source, link: s.link, snapshot: s.snapshot, note: s.note, files: s.files.map(f => Object.assign({}, f)), repo: (h.card && h.card.repo) || (h.inbox && h.inbox.cwd) || '', folder: '', task: '', rules: '', exists: '', todo: '' };
    }
    repaint();
  } else if (m.type === 'handoverLocated') {
    const f = h.card && h.card.files[m.index];
    if (f && m.file) {
      f.file = m.file;
      f.missing = false;
      f.include = true;
    }
    repaint();
  } else if (m.type === 'handoverDraft') {
    h.drafting = m.state === 'running';
    if (m.state === 'error') h.draftError = m.error;
    if (m.state === 'done' && h.card && m.draft) Object.assign(h.card, { task: m.draft.task || h.card.task, rules: m.draft.rules, exists: m.draft.exists, todo: m.draft.todo });
    repaint();
  } else if (m.type === 'handover') {
    h.result = { state: m.state, text: m.text };
    repaint();
  }
}

/** The Handover entry of the Cowork region. */
function handoverNode(list, q, { treeItem }) {
  if (q && !'handover'.includes(q)) return;
  list.append(
    treeItem(
      el('div', { className: `row cowork-link${!state.detail && state.page === PAGE ? ' selected' : ''}`, title: 'Handover\nHand a chat, an artifact link or a file of the apps to Claude Code in a terminal: Claude drafts the card, you tick what comes along.', onclick: () => showHandover() }, icon('arrow-swap'), el('span', { className: 'name' }, 'Handover')),
      'n|cowork|handover',
      2
    )
  );
}
COWORK_NODES.push(handoverNode);
