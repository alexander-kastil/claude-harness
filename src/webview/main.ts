// Entry: renders the page for the current state and handles the host messages.
import { onMessage } from './bridge';
import { app, isDirty, persist, save, showPage, showRepo, snapshot, state, viewOf, vscode } from './core';
import { clone, renderDetail } from './detail';
import { refreshCard } from './hover';
import { renderKindPage } from './kind-page';
import { renderOverview } from './overview';
import { renderFleet, renderInit, renderMarkets } from './pages';
import { renderRepo } from './repo-page';
import { renderSession } from './session-page';
import { renderSessionsPage, showSession } from './sessions';
import { renderSidebar } from './sidebar';

export function renderMain() {
  const repo = state.repo && viewOf(state.repo);
  const main = state.detail
    ? renderDetail()
    : state.page === 'fleet'
      ? renderFleet()
      : state.page === 'session' && state.session
        ? renderSession()
      : state.page === 'sessions' && state.sessionsPage
        ? renderSessionsPage()
      : state.page === 'kind' && state.kindPage
        ? renderKindPage()
      : state.page === 'marketplaces'
        ? renderMarkets()
        : state.page === 'init' && state.init
          ? renderInit()
          : repo
            ? renderRepo(repo)
            : renderOverview();
  const current = app.querySelector('.main');
  current ? current.replaceWith(main) : app.append(main);
}

// The sidebar's scrolling list; render keeps its scroll position across a repaint.
const list = () => app.querySelector<HTMLElement>('.list');
const keepScroll = (paint: () => void) => {
  const scroll = list()?.scrollTop ?? 0;
  paint();
  const after = list();
  if (after) after.scrollTop = scroll;
};

export function render() {
  keepScroll(() => {
    app.replaceChildren(renderSidebar());
    renderMain();
  });
}

onMessage(m => {
  if (m.type === 'state') {
    state.views = m.views || (m.categories ? [{ id: 'global', label: 'Global', path: '', categories: m.categories }] : []);
    const before = state.checks;
    state.checks = m.checks || {};
    state.standard = m.standard;
    const current = app.querySelector('.sidebar');
    keepScroll(() => (current ? current.replaceWith(renderSidebar()) : render()));
    if (state.repo && before[state.repo] && state.checks[state.repo] && before[state.repo].state !== state.checks[state.repo].state && !['running', 'unchecked'].includes(state.checks[state.repo].state))
      vscode.postMessage({ type: 'effective', scope: state.repo });
    if (state.page === 'fleet' && !state.detail) {
      clearTimeout(state.fleetTimer);
      state.fleetTimer = setTimeout(() => vscode.postMessage({ type: 'fleet' }), 400);
    }
    if (current && !state.detail && (state.repo || state.page === 'fleet')) renderMain();
    if (current && !state.detail && state.page === 'kind' && state.kindPage && state.kindPage.refresh) state.kindPage.refresh();
  } else if (m.type === 'page') {
    if (m.page === 'session' && m.repo && m.session) showSession(m.repo, m.session);
    else if (m.repo) {
      state.openRepos.add(m.repo);
      persist();
      state.effective[m.repo] = undefined;
      showRepo(m.repo);
    } else if (m.page) showPage(m.page, m.dir);
  } else if (m.type === 'fleet') {
    state.fleet = m.rows;
    if (state.page === 'fleet' && !state.detail) renderMain();
  } else if (m.type === 'marketplaces') {
    state.markets = m.list;
    if (state.page === 'marketplaces' && !state.detail) renderMain();
  } else if (m.type === 'weekly') {
    state.weekly = m.list || [];
    if (!state.detail && state.repo && state.repoTab === 'models') renderMain();
  } else if (m.type === 'sessions') {
    state.sessions[m.scope] = m.list || [];
    refreshCard(`repo:${m.scope}`);
    const current = app.querySelector('.sidebar');
    if (current) keepScroll(() => current.replaceWith(renderSidebar()));
    if (!state.detail && !state.page && state.repo === m.scope) renderMain();
    if (!state.detail && state.page === 'sessions' && state.sessionsPage && state.sessionsPage.scope === m.scope && state.sessionsPage.refresh) state.sessionsPage.refresh();
  } else if (m.type === 'session') {
    if (state.session && state.session.scope === m.scope && state.session.id === m.id) {
      state.session.data = m.data;
      if (state.page === 'session' && !state.detail) renderMain();
    }
  } else if (m.type === 'styleDraft') {
    if (state.session && state.session.scope === m.scope && state.session.id === m.id) {
      state.session.styleDraft = m;
      if (state.page === 'session' && !state.detail) renderMain();
    }
  } else if (m.type === 'effective') {
    state.effective[m.scope] = m.data || { effective: { memory: [], rules: [], plugins: [], hooks: [] } };
    if (!state.detail && state.repo === m.scope) renderMain();
  } else if (m.type === 'ruleInfo') {
    state.ruleInfo[m.id] = m.info || { globs: [], base: '' };
    if (state.detail && state.detail.asset.id === m.id) renderMain();
  } else if (m.type === 'initForm') {
    if (state.init && state.init.dir === m.dir) {
      state.init.data = m.data || { agents: [] };
      if (state.page === 'init' && !state.detail) renderMain();
    }
  } else if (m.type === 'initResult') {
    if (state.init && state.init.dir === m.dir) {
      const result = m.data as { error?: string } | undefined;
      state.init.result = result;
      state.init.applied = !!m.apply && result && !result.error;
      if (!m.apply) state.init.previewKey = state.init.pendingKey;
      if (state.page === 'init' && !state.detail) renderMain();
    }
  } else if (m.type === 'mcpInfo') {
    state.mcpInfo[m.id] = m.info;
    if (state.detail && state.detail.asset.id === m.id) renderMain();
  } else if (m.type === 'tools') {
    if (!state.draft || !state.detail || state.detail.asset.id !== m.id) return;
    const f = state.draft.fields.find(x => x.key === m.key);
    if (!f) return;
    f.value = m.value;
    renderMain();
  } else if (m.type === 'detail') {
    if (m.external && isDirty()) return;
    if (m.external && m.detail && state.detail && snapshot(m.detail) === snapshot(state.detail) && m.detail.asset.enabled === state.detail.asset.enabled) return;
    state.detail = m.detail;
    if (m.detail && m.detail.asset.kind === 'rule' && !m.external) state.ruleInfo[m.detail.asset.id] = undefined;
    if (m.detail) {
      state.expanded.add(`${m.detail.asset.scope || 'global'}|${m.detail.asset.kind}`);
      if (m.detail.asset.scope && m.detail.asset.scope !== 'global') state.openRepos.add(m.detail.asset.scope);
      persist();
    }
    state.draft = m.detail ? clone(m.detail) : undefined;
    render();
  }
});

window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});

vscode.postMessage({ type: 'ready' });
