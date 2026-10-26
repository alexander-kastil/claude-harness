// @ts-nocheck
// The Plugin Hunter's plugin card: its fields, the skills and agents in it with their copies, the picker that adds more, and Create.
import { app, state, vscode } from './core';
import { confirmAt } from './confirm';
import { aiGroup, el, icon, iconBtn, plural } from './dom';
import { hunt, marketOf, repaint, saveNow, saveSoon } from './hunt-state';

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const newCard = () => {
  const id = newId();
  hunt.proposals = [{ id, prompt: '', created: Date.now(), name: '', description: '', category: '', assets: [] }, ...hunt.proposals];
  hunt.focusName = id;
  saveNow();
  repaint();
};

const field = (label, ...nodes) => el('label', { className: 'hunt-field' }, el('span', { className: 'hunt-label' }, label), ...nodes);

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
  const tick = (label, checked, onchange, title) => el('label', { className: 'hunt-retire', title }, el('input', { type: 'checkbox', checked, onchange: e => (onchange(e.target.checked), saveSoon(), syncRetireAll(p)) }), label);
  const gone = !a.global && !a.repos.length;
  rows.push(
    el(
      'div',
      { className: `hunt-asset${a.include ? '' : ' off'}` },
      el('input', { type: 'checkbox', checked: a.include && !gone, 'aria-label': `Include ${a.name}`, disabled: gone, onchange: e => ((a.include = e.target.checked), saveSoon(), repaint()) }),
      el(
        'div',
        { className: 'hunt-main' },
        nameLine(a, a.inPlugin ? el('span', { className: 'tag hunt-in', title: `Already shipped\nThe installed plugin ${a.inPlugin} already has this ${a.kind}.` }, `in ${a.inPlugin}`) : null),
        gone || a.why ? el('div', { className: 'hunt-why' }, gone ? 'Gone from disk. Remove it from the card.' : a.why) : null
      ),
      el(
        'div',
        { className: 'hunt-side' },
        a.global ? el('span', { className: 'hunt-copy' }, icon('globe'), 'Global') : el('span', { className: 'hunt-none' }, 'No global copy'),
        a.global ? tick('Retire', a.global.retire, v => (a.global.retire = v), 'Retire global copy\nAfter the plugin is installed, the global copy is backed up and removed.') : null,
        iconBtn('close', `Remove ${a.name} from the card`, () => ((p.assets = p.assets.filter(x => x !== a)), saveSoon(), repaint()))
      )
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
        el(
          'div',
          { className: 'hunt-side' },
          el('span', { className: 'hunt-copy' }, base ? el('span', { className: 'tag', title: 'Used\nThe plugin takes this copy, there is no global one.' }, 'used') : copyTag(r.same)),
          tick('Retire', r.retire, v => (r.retire = v), 'Retire repo copy\nAfter the plugin is installed, this copy is backed up and removed.'),
          !r.same && !base && a.kind === 'skill' && a.global
            ? aiGroup('compact', confirmAt(el('button', { className: 'secondary', title: 'Merge with Claude\nOpens Consolidate for this copy: compare it with the global copy in the editor, or let Claude merge them in a terminal.', onclick: () => vscode.postMessage({ type: 'huntMerge', path: r.path, kind: a.kind }) }, icon('git-merge'), 'Merge'), 'consolidate'))
            : !r.same && !base && a.kind === 'agent' && a.global
              ? el('button', { className: 'secondary', title: 'Compare with the global copy\nOpens the repo copy next to the global one in the editor. Agents are not merged here.', onclick: () => vscode.postMessage({ type: 'huntMerge', path: r.path, kind: a.kind }) }, icon('diff'), 'Compare')
              : null
        )
      )
    );
  });
  return rows;
}

// One tick for the Retire tick of every listed copy: set, partly set or clear.
const copiesOf = p => p.assets.flatMap(a => [a.global, ...a.repos].filter(Boolean));

const showRetireAll = (box, copies) => {
  const on = copies.filter(c => c.retire).length;
  box.checked = on === copies.length;
  box.indeterminate = on > 0 && on < copies.length;
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
    className: 'hunt-retire-all',
    'aria-label': 'Retire all',
    onchange: e => {
      copies.forEach(c => (c.retire = e.target.checked));
      saveSoon();
      repaint();
    },
  });
  showRetireAll(box, copies);
  return el(
    'label',
    { className: 'hunt-retire', title: 'Retire all\nTicks Retire on every listed copy, global and repo. Untick to clear them all again.' },
    box,
    'Retire all'
  );
}

// A created card: what went into the plugin, read only.
const doneRows = p => p.assets.filter(a => a.include).map(a => el('div', { className: 'hunt-asset done' }, icon('check'), el('div', { className: 'hunt-main' }, nameLine(a), a.why ? el('div', { className: 'hunt-why' }, a.why) : null)));

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
  if (market.categorized && !p.category.trim()) return `${market.name} keeps plugins in category folders: fill in the category.`;
  return '';
}

// The description grows with its text, so no sentence is cut off and no scrollbar sits in a two-row box.
const fit = ta => {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
};

function describe(p, done) {
  const ta = el('textarea', { rows: 2, value: p.description, readonly: !!done, oninput: e => ((p.description = e.target.value), fit(ta), saveSoon()) });
  requestAnimationFrame(() => fit(ta));
  return ta;
}

export function card(p) {
  const market = marketOf();
  const result = hunt.results[p.id];
  const done = hunt.created[p.id] || (result && result.state === 'done' ? result.text : '');
  const chosen = p.assets.filter(a => a.include);
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
  const categories = market && market.categorized ? market.categories : [];
  const sync = () => {
    const b = app.querySelector(`[data-confirm-key="${p.id}"]`);
    const hint = app.querySelector(`[data-card="${p.id}"] .hunt-hint`);
    const why = whyNot(p, marketOf());
    if (b) b.disabled = !!why;
    if (hint) hint.textContent = why;
  };
  return el(
    'div',
    { className: `hunt-card${done ? ' done' : ''}`, 'data-card': p.id },
    el(
      'div',
      { className: 'hunt-card-head' },
      icon(done ? 'pass-filled' : 'package'),
      el('input', { className: 'hunt-title', type: 'text', placeholder: 'plugin-name', value: p.name, readonly: !!done, 'aria-label': 'Plugin name', oninput: e => ((p.name = e.target.value.trim()), saveSoon(), sync()) }),
      el('span', { className: 'hunt-when' }, done ? 'Created' : p.prompt ? 'Hunted' : 'New'),
      iconBtn('trash', 'Discard this card', () => {
        hunt.proposals = hunt.proposals.filter(x => x !== p);
        saveNow();
        repaint();
      })
    ),
    p.prompt ? el('div', { className: 'hunt-prompt', title: p.prompt }, p.prompt) : null,
    el(
      'div',
      { className: 'hunt-fields' },
      field('Description', describe(p, done)),
      field(
        'Category folder',
        el('input', { type: 'text', placeholder: market && market.categorized ? 'e.g. guards' : 'optional', value: p.category, readonly: !!done, list: `hunt-cats-${p.id}`, oninput: e => ((p.category = e.target.value.trim()), saveSoon(), sync()) }),
        el('datalist', { id: `hunt-cats-${p.id}` }, categories.map(c => el('option', { value: c })))
      )
    ),
    done
      ? el('div', { className: 'hunt-assets' }, doneRows(p))
      : p.assets.length
        ? el('div', { className: 'hunt-assets' }, p.assets.flatMap(a => assetRows(p, a)))
        : null,
    done ? null : open ? adder(p) : null,
    done
      ? el('div', { className: 'notice done', role: 'status' }, icon('check'), done)
      : el(
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
          el('span', { className: 'hunt-count' }, plural(chosen.length, 'asset')),
          retireAll(p),
          el('span', { className: 'hunt-hint', role: 'status' }, blocked),
          el('span', { className: 'spacer' }),
          create
        ),
    !done && result && result.text ? el('div', { className: `notice hunt-result${result.state === 'error' ? ' bad' : ''}`, role: result.state === 'error' ? 'alert' : 'status', title: result.text }, result.text) : null
  );
}
