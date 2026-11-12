// @ts-nocheck
// The Browse page of the Skills page: a search of the public skills on skills.sh. The host asks the network only when a search runs
// (`skillsCatalogSearch`); an install goes through Add from skills.sh, so its confirm card comes before any file is written.
import { state, vscode } from './core';
import { confirmAt } from './confirm';
import { countHead, el, icon, iconBtn, plural, tag } from './dom';
import { hideHover } from './hover';
import { renderMain } from './main';
import { kindEntries, showKindPage } from './kind-page';
import { tabBar } from './repo-page';
import { gridTable } from './tables';

let filter = 'all';

const FILTERS = [
  ['all', 'All', 'list-flat', 'Every result of the search.'],
  ['new', 'Not installed', 'cloud', 'Results you do not have yet.'],
  ['installed', 'Installed', 'check', 'Results already in one of your scopes.'],
];

/** 227931 reads 228K, 2376 reads 2.4K. */
export const installsText = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n));

/** The installed skills of this name, in any scope. */
const installedOf = s => kindEntries('skill').filter(e => e.a.name.toLowerCase() === s.skill.toLowerCase());

const search = () => {
  const q = (state.skillsCatalogQuery || '').trim();
  if (!q) return;
  state.skillsCatalogBusy = true;
  vscode.postMessage({ type: 'skillsCatalogSearch', query: q });
  renderMain();
};

const install = s => {
  hideHover();
  vscode.postMessage({ type: 'skillsCatalogInstall', address: `${s.source}/${s.skill}`, anchor: `catalog-${s.id}` });
};

const line = () => {
  const r = state.skillsCatalogResult;
  if (state.skillsCatalogBusy) return 'Searching skills.sh...';
  if (!r) return 'Type a word and press Enter. The network is asked only when you search.';
  if (r.error) return r.error;
  if (!r.skills.length) return `Nothing on skills.sh matches "${r.query}".`;
  return '';
};

const table = skills =>
  gridTable(
    [
      {
        head: 'Name',
        track: 'minmax(120px, 2fr)',
        cls: 'at-name',
        cell: s => [icon('package'), el('span', { className: 'at-label' }, s.name)],
        title: s => (s.description ? `${s.name}\n${s.source}\n${s.description}` : `${s.name}\n${s.source}\nskills.sh does not list a description. The install card shows it before anything is written.`),
      },
      { head: 'Source', track: 'minmax(120px, 2fr)', muted: true, low: true, cell: s => s.source, title: s => `Source\nThe GitHub repository ${s.source}. The skill's files are downloaded from there.` },
      { head: 'Installs', track: 'minmax(64px, 80px)', num: true, align: 'center', cell: s => (s.installs == null ? '-' : installsText(s.installs)), title: s => (s.installs == null ? '' : `Installs\n${s.installs.toLocaleString()} installs counted by skills.sh.`) },
      {
        head: 'State',
        track: 'minmax(80px, 100px)',
        align: 'center',
        cell: s => {
          const have = installedOf(s);
          return have.length ? tag('installed', `Installed\nA skill named ${s.skill} is already in ${have.map(e => e.v.label).join(', ')}.`) : '';
        },
      },
      {
        head: '',
        track: '34px',
        align: 'center',
        cell: s =>
          confirmAt(
            el('button', { className: 'icon-btn row-act', 'aria-label': `Install ${s.name}`, title: `Install\nDownloads ${s.name} from ${s.source} into ~/.claude/skills after you confirm. The files are copied, never linked.`, onclick: () => install(s) }, icon('cloud-download')),
            'panel',
            `catalog-${s.id}`
          ),
      },
    ],
    skills,
    'Skills on skills.sh'
  );

export function renderSkillsCatalog() {
  const r = state.skillsCatalogResult;
  const all = (r && r.skills) || [];
  const shown = all.filter(s => (filter === 'all' ? true : filter === 'installed' ? installedOf(s).length : !installedOf(s).length));
  const input = el('input', {
    type: 'search',
    id: 'catalog-search',
    placeholder: 'Search skills on skills.sh, for example pdf or testing',
    value: state.skillsCatalogQuery || '',
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: e => (state.skillsCatalogQuery = e.target.value),
    onkeydown: e => {
      if (e.key === 'Enter') search();
    },
  });
  const chips = tabBar(
    FILTERS.map(([id, label, glyph, about]) => [id, label, glyph, about, String(id === 'all' ? all.length : all.filter(s => (id === 'installed') === !!installedOf(s).length).length)]),
    filter,
    id => ((filter = id), renderMain()),
    'Filter the results'
  );
  const note = line();
  const sub = r && !r.error ? `${plural(all.length, 'skill')} for "${r.query}"` : 'skills.sh';
  const page = el(
    'section',
    { className: 'main' },
    countHead('search', 'Browse skills', sub, iconBtn('arrow-left', 'Back to Skills', () => showKindPage('skill', undefined)), iconBtn('search', 'Search', search)),
    el(
      'div',
      { className: 'main-body' },
      el('div', { className: 'kind-search' }, el('div', { className: 'combo' }, icon('search'), input), all.length ? chips : null),
      state.distNote && state.distNote.text ? el('div', { className: 'empty flush' }, state.distNote.text) : null,
      note ? el('div', { className: 'empty flush' }, note) : null,
      all.length ? table(shown) : null
    )
  );
  if (!r && !state.skillsCatalogBusy) requestAnimationFrame(() => input.isConnected && !document.activeElement?.closest?.('input') && input.focus());
  return page;
}
