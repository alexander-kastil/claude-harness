// @ts-nocheck
// The Cowork scope: what Claude.ai brings to this PC (synced skills and org plugins, claude.ai connectors), always read-only.
import { command, persist, state } from './core';
import { el, icon, iconBtn } from './dom';

export const COWORK_ID = 'cowork';
export const MANAGED = 'Managed by Claude.ai';

export const isCowork = x => !!x && (x.id === COWORK_ID || x.scope === COWORK_ID);

/** The Cowork scope as the host sent it, or undefined from a host that predates it. */
export const coworkScope = () => state.views.find(v => v.id === COWORK_ID);

/**
 * Entries of the Cowork region that live only on claude.ai: no count, a click opens the page in the browser (`openCowork` with
 * `target`; the host maps the target to the URL). Add an entry here to add a row to the region.
 */
export const COWORK_LINKS = [
  { id: 'memory', label: 'Memory', glyph: 'book', target: 'memory', tip: 'Opens your Memory settings on claude.ai in the browser.' },
];

/**
 * Nodes other agents add to the Cowork region, after the kinds and before the links: each is `(list, q, { treeItem, render }) => void`
 * and appends its own tree items to `list` (a Projects node, a Scheduled node).
 */
export const COWORK_NODES = [];

/** The Cowork region of the left nav, a peer of the Code tree and of Repositories: its head, the kinds, the nodes, then the links. */
export function renderCoworkRegion(view, q, renderCategories, treeItem, render, regionHead) {
  const count = view.categories.reduce((n, c) => n + c.items.length, 0);
  const links = COWORK_LINKS.filter(l => !q || l.label.toLowerCase().includes(q));
  const region = el('div', { className: 'cowork-region' });
  const [folded, head] = regionHead(
    'cowork',
    'cloud',
    'Cowork',
    `Cowork\nWhat Claude.ai brings to this PC: synced skills, synced org plugins and claude.ai connectors. ${MANAGED}, read-only.`,
    [iconBtn('link-external', 'Manage on claude.ai', () => command('openCowork'))],
    count
  );
  region.append(head);
  if (folded) return region;
  renderCategories(region, { ...view, categories: view.categories.filter(c => c.items.length) }, q, false);
  for (const node of COWORK_NODES) node(region, q, { treeItem, render });
  region.append(
    ...links.map(l =>
      treeItem(
        el('div', { className: 'row cowork-link', title: `${l.label}\n${l.tip}`, onclick: () => command('openCowork', { target: l.target }) }, icon(l.glyph), el('span', { className: 'name' }, l.label), icon('link-external')),
        `l|cowork|${l.id}`,
        1
      )
    )
  );
  // A search that matches nothing of the region (no kind, node or link) hides the region.
  if (q && region.children.length === 1) return null;
  const info = view.cowork;
  if (info && info.empty) region.append(el('div', { className: 'empty' }, info.empty));
  return region;
}

/** On a skill pulled from Cowork that no longer matches its origin: the tag and the compare link. */
export function coworkDriftTag(a) {
  const o = a.coworkOrigin;
  if (!o || o.state === 'same') return null;
  return el(
    'div',
    { className: 'dv-notice cowork-notice' },
    icon('cloud'),
    el('span', {}, o.state === 'gone' ? `Pulled from Cowork ${o.item}, which is no longer synced.` : `Differs from Cowork: ${o.item} changed, or this copy did, since it was pulled.`),
    o.state === 'differs' ? el('button', { className: 'link', type: 'button', title: 'Compare\nOpens the Cowork version and this copy side by side', onclick: () => command('compareCowork', { id: a.id }) }, icon('diff'), ' Compare') : null
  );
}
