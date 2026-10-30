// @ts-nocheck
// The Plugin Hunter's plugin card, the artifact beside the chat: its skills and agents with their copies, the picker that adds more, and Create. In the History it collapses to its header.
import { app, state, vscode } from './core';
import { confirmAt } from './confirm';
import { aiGroup, el, icon, iconBtn, plural } from './dom';
import { turnRow } from './hunt-chat';
import { hunt, marketOf, repaint, saveNow, saveSoon, splitCards, turnsOf } from './hunt-state';

const copyTag = same => el('span', { className: `tag ${same ? '' : 'warn'}` }, same ? 'identical' : 'differs');

const kindIcon = kind => icon(kind === 'skill' ? 'mortar-board' : 'hubot');

// The icon and name of an element, with what follows the name.
const nameLine = (a, ...after) => el('div', { className: 'hunt-name' }, kindIcon(a.kind), el('span', { className: 'hunt-name-text', title: a.name }, a.name), ...after);

const rootOf = file => file.replace(/[\\/]\.claude[\\/].*$/i, '');

// Repos that share a name show the folder they sit in, so that two of them are told apart without the hover.
const sharedNames = () => {
  const roots = new Map();
  for (const c of hunt.info ? hunt.info.catalog : []) for (const r of c.asset.repos) roots.set(r.repo, new Set([...(roots.get(r.repo) || []), rootOf(r.path).toLowerCase()]));
  return new Set([...roots].filter(([, set]) => set.size > 1).map(([name]) => name));
};

const repoName = r => el('span', { className: 'hunt-name-text', title: r.path }, r.repo);
const repoWhere = (r, shared) => (shared.has(r.repo) ? el('div', { className: 'hunt-where', title: rootOf(r.path) }, `in ${rootOf(r.path).split(/[\\/]/).slice(-2, -1)[0] || rootOf(r.path)}`) : null);

function assetRows(p, a) {
  const rows = [];
  const shared = sharedNames();
  // A deselected element's Retire boxes (its own and its copies') are clear and cannot be ticked.
  const tick = (label, checked, onchange, title) => el('label', { className: 'hunt-retire', title }, el('input', { type: 'checkbox', role: 'switch', checked: checked && a.include, disabled: !a.include, onchange: e => (onchange(e.target.checked), saveSoon(), syncRetireAll(p)) }), label);
  const gone = !a.global && !a.repos.length;
  rows.push(
    el(
      'div',
      { className: `hunt-asset${a.include ? '' : ' off'}` },
      el('input', { type: 'checkbox', role: 'switch', checked: a.include && !gone, 'aria-label': `Include ${a.name}`, disabled: gone, onchange: e => {
          a.include = e.target.checked;
          // Unticking an element clears what it would retire; ticking it again leaves them clear.
          if (!a.include) [a.global, ...a.repos].filter(Boolean).forEach(c => (c.retire = false));
          saveSoon();
          repaint();
        } }),
      el(
        'div',
        { className: 'hunt-main' },
        nameLine(
          a,
          a.as ? el('span', { className: 'tag hunt-in', title: `Renamed\nCreate writes this ${a.kind} into the plugin as ${a.as}.` }, `as ${a.as}`) : null,
          a.inPlugin ? el('span', { className: 'tag hunt-in', title: `Already shipped\nThe installed plugin ${a.inPlugin} already has this ${a.kind}.` }, `in ${a.inPlugin}`) : null
        ),
        gone || a.why ? el('div', { className: 'hunt-why' }, gone ? 'Gone from disk. Remove it from the card.' : a.why) : null
      ),
      el('div', { className: 'hunt-cell hunt-c-copy' }, a.global ? el('span', { className: 'hunt-copy' }, icon('globe'), 'Global') : el('span', { className: 'hunt-none' }, 'No global copy')),
      el('div', { className: 'hunt-cell hunt-c-retire' }, a.global ? tick('Retire', a.global.retire, v => (a.global.retire = v), 'Retire global copy\nAfter the plugin is installed, the global copy is backed up and removed.') : null),
      el('div', { className: 'hunt-cell hunt-c-act' }),
      el('div', { className: 'hunt-cell hunt-c-x' }, iconBtn('close', `Remove ${a.name} from the card`, () => ((p.assets = p.assets.filter(x => x !== a)), saveSoon(), repaint())))
    )
  );
  a.repos.forEach((r, i) => {
    const base = !a.global && i === 0;
    rows.push(
      el(
        'div',
        { className: `hunt-asset sub${a.include ? '' : ' off'}` },
        el('span', { className: 'hunt-gap' }),
        el('div', { className: 'hunt-main' }, el('div', { className: 'hunt-name' }, icon('repo'), repoName(r)), repoWhere(r, shared)),
        el('div', { className: 'hunt-cell hunt-c-copy' }, el('span', { className: 'hunt-copy' }, base ? el('span', { className: 'tag state', title: 'Used\nThe plugin takes this copy, there is no global one.' }, 'used') : copyTag(r.same))),
        el('div', { className: 'hunt-cell hunt-c-retire' }, tick('Retire', r.retire, v => (r.retire = v), 'Retire repo copy\nAfter the plugin is installed, this copy is backed up and removed.')),
        el(
          'div',
          { className: 'hunt-cell hunt-c-act' },
          !r.same && !base && a.kind === 'skill' && a.global
            ? aiGroup('compact', confirmAt(el('button', { className: 'secondary', title: 'Merge\nOpens Consolidate for this copy: compare it with the global copy in the editor, or let Claude merge them in a terminal.', onclick: () => vscode.postMessage({ type: 'huntMerge', path: r.path, kind: a.kind }) }, icon('git-merge'), 'Merge'), 'consolidate'))
            : !r.same && !base && a.kind === 'agent' && a.global
              ? el('button', { className: 'secondary', title: 'Compare with the global copy\nOpens the repo copy next to the global one in the editor. Agents are not merged here.', onclick: () => vscode.postMessage({ type: 'huntMerge', path: r.path, kind: a.kind }) }, icon('diff'), 'Compare')
              : null
        ),
        el('div', { className: 'hunt-cell hunt-c-x' })
      )
    );
  });
  return rows;
}

// The Retire tick of every listed copy of the ticked elements as one tick: set, partly set or clear. A deselected element and its copies are never retired.
const copiesOf = p => p.assets.filter(a => a.include).flatMap(a => [a.global, ...a.repos].filter(Boolean));

const showRetireAll = (box, copies) => {
  const on = copies.filter(c => c.retire).length;
  box.checked = on === copies.length;
  box.indeterminate = on > 0 && on < copies.length;
  // A mixed tick names the count: "Retire all · 1 of 2".
  const text = box.closest('label')?.querySelector('.hunt-retire-text');
  if (text) text.textContent = box.indeterminate ? `Retire all · ${on} of ${copies.length}` : 'Retire all';
};

// A single Retire tick moved: bring the Retire all tick in line.
const syncRetireAll = p => {
  const box = app.querySelector(`[data-card="${p.id}"] .hunt-retire-all`);
  if (box) showRetireAll(box, copiesOf(p));
};

function retireAll(p) {
  const copies = copiesOf(p);
  if (!copies.length) return null;
  const box = el('input', {
    type: 'checkbox',
    role: 'switch',
    className: 'hunt-retire-all',
    'aria-label': 'Retire all',
    onchange: e => {
      copies.forEach(c => (c.retire = e.target.checked));
      saveSoon();
      repaint();
    },
  });
  const label = el(
    'label',
    { className: 'hunt-retire', title: 'Retire all\nTicks Retire on every listed copy, global and repo. Untick to clear them all again.' },
    box,
    el('span', { className: 'hunt-retire-text' }, 'Retire all')
  );
  showRetireAll(box, copies);
  return label;
}

// A created card: what went into the plugin, read only.
const doneRows = p => p.assets.filter(a => a.include).map(a => el('div', { className: 'hunt-asset done' }, icon('check'), el('div', { className: 'hunt-main' }, nameLine(a, a.as ? el('span', { className: 'tag hunt-in', title: `Renamed\nThe plugin has this ${a.kind} as ${a.as}.` }, `as ${a.as}`) : null), a.why ? el('div', { className: 'hunt-why' }, a.why) : null)));

function adder(p) {
  const taken = new Set(p.assets.map(a => `${a.kind}:${a.name}`));
  const q = hunt.addQuery.trim().toLowerCase();
  // Skills first, then agents.
  const catalog = (hunt.info ? hunt.info.catalog : [])
    .filter(c => !taken.has(`${c.asset.kind}:${c.asset.name}`) && (!q || c.asset.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.asset.kind === 'skill') - Number(a.asset.kind === 'skill') || a.asset.name.localeCompare(b.asset.name));
  const shown = catalog.slice(0, state.lists.huntCatalog);
  const list = el(
    'div',
    { className: 'hunt-pick-list' },
    shown.map(c =>
      el(
        'button',
        {
          className: 'hunt-pick',
          title: c.description || undefined,
          onclick: () => {
            p.assets.push({ ...structuredClone(c.asset), include: true });
            hunt.focusAdder = true;
            saveNow();
            repaint();
          },
        },
        kindIcon(c.asset.kind),
        el('span', { className: 'hunt-pick-name' }, c.asset.name),
        el('span', { className: 'hunt-pick-where' }, c.asset.global ? 'Global' : c.asset.repos[0] ? c.asset.repos[0].repo : ''),
        el('span', { className: 'hunt-pick-desc' }, c.description)
      )
    ),
    shown.length ? null : el('div', { className: 'empty flush' }, 'Nothing matches.'),
    catalog.length > shown.length ? el('div', { className: 'empty flush' }, `${catalog.length - shown.length} more: narrow the search.`) : null
  );
  return el(
    'div',
    { className: 'hunt-adder' },
    el('input', {
      type: 'search',
      placeholder: 'Search your skills and agents',
      'aria-label': 'Search your skills and agents',
      value: hunt.addQuery,
      oninput: e => {
        hunt.addQuery = e.target.value;
        hunt.focusAdder = true;
        repaint();
        const input = app.querySelector('.hunt-adder input');
        if (input) input.setSelectionRange(input.value.length, input.value.length);
      },
      onkeydown: e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          hunt.adding = undefined;
          repaint();
        }
      },
    }),
    list
  );
}

// Why Create cannot be pressed yet, in words.
function whyNot(p, market) {
  if (!market) return 'Pick a marketplace of yours first.';
  if (!p.name.trim()) return 'Give the plugin a name.';
  if (!p.assets.some(a => a.include)) return 'Tick at least one skill or agent.';
  if (market.categorized && !p.category.trim()) return `${market.name} keeps plugins in category folders: ask Claude for a category.`;
  return '';
}

export function card(p, history = false) {
  const market = marketOf();
  const result = hunt.results[p.id];
  const done = hunt.created[p.id] || (result && result.state === 'done' ? result.text : '');
  const busy = !!(result && result.state === 'running');
  const blocked = whyNot(p, market);
  const create = confirmAt(
    el(
      'button',
      {
        className: 'primary',
        disabled: !!blocked || busy,
        title: blocked ? `Create\n${blocked}` : undefined,
        onclick: () => {
          hunt.results[p.id] = undefined;
          saveNow();
          vscode.postMessage({ type: 'huntCreate', id: p.id, market: hunt.picked });
        },
      },
      icon('package'),
      busy ? 'Creating...' : 'Create'
    ),
    'huntCreate',
    p.id
  );
  const open = hunt.adding === p.id;
  const sync = () => {
    const b = app.querySelector(`[data-confirm-key="${p.id}"]`);
    const hint = app.querySelector(`[data-card="${p.id}"] .hunt-hint`);
    const why = whyNot(p, marketOf());
    if (b) b.disabled = !!why;
    if (hint) hint.textContent = why;
  };
  // A History item is collapsed to its header; a click on the header, or on its chevron, opens it with the chat turns that made it.
  const expanded = !history || !!hunt.open[p.id];
  const toggle = () => {
    hunt.open[p.id] = !hunt.open[p.id];
    repaint();
  };
  const head = el(
    'div',
    { className: 'hunt-card-head', onclick: history ? e => (e.target.closest('input,button') ? undefined : toggle()) : undefined },
    history ? el('button', { type: 'button', className: 'hunt-chev', 'aria-expanded': String(expanded), 'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${p.name || 'this card'}`, onclick: toggle }, icon(expanded ? 'chevron-down' : 'chevron-right')) : null,
    icon(done ? 'pass-filled' : 'package'),
    el('input', { className: 'hunt-title', type: 'text', placeholder: 'plugin-name', value: p.name, readonly: !!done, 'aria-label': 'Plugin name', oninput: e => ((p.name = e.target.value.trim()), saveSoon(), sync()) }),
    el('span', { className: 'hunt-when' }, done ? 'Created' : p.prompt ? 'Hunted' : 'New'),
    iconBtn('trash', 'Discard this card', () => {
      hunt.proposals = hunt.proposals.filter(x => x !== p);
      saveNow();
      repaint();
    })
  );
  // The description and the category are not shown; Create reads the values Claude set.
  const bar = el(
    'div',
    { className: 'hunt-foot' },
    el(
      'button',
      {
        className: 'secondary',
        onclick: () => {
          hunt.adding = open ? undefined : p.id;
          hunt.addQuery = '';
          hunt.focusAdder = !open;
          repaint();
        },
      },
      icon(open ? 'chevron-up' : 'add'),
      open ? 'Done adding' : 'Add skill or agent'
    ),
    el('span', { className: 'hunt-count' }, plural(p.assets.filter(a => a.include).length, 'asset')),
    retireAll(p),
    el('span', { className: 'hunt-hint', role: 'status' }, blocked),
    el('span', { className: 'spacer' }),
    create
  );
  const turns = history && expanded ? turnsOf(p, splitCards().all) : [];
  const body = () => [
    turns.length ? el('div', { className: 'hunt-card-chat', role: 'log', 'aria-label': 'Conversation of this card' }, turns.map(turnRow)) : null,
    p.prompt ? el('div', { className: 'hunt-prompt', title: p.prompt }, p.prompt) : null,
    done ? el('div', { className: 'notice done', role: 'status' }, icon('check'), done) : bar,
    !done && result && result.text ? el('div', { className: `notice hunt-result${result.state === 'error' ? ' bad' : ''}`, role: result.state === 'error' ? 'alert' : 'status', title: result.text }, result.text) : null,
    !done && open ? adder(p) : null,
    done ? el('div', { className: 'hunt-assets' }, doneRows(p)) : p.assets.length ? el('div', { className: 'hunt-assets' }, p.assets.flatMap(a => assetRows(p, a))) : null,
  ].filter(Boolean);
  return el('div', { className: `hunt-card${done ? ' done' : ''}${history ? ' history' : ''}${history && !expanded ? ' collapsed' : ''}`, 'data-card': p.id }, head, expanded ? body() : null);
}
