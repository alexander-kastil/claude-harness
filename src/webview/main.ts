// Entry: renders the page for the current state and handles the host messages.
import { onMessage } from './bridge';
import { showConfirm } from './confirm';
import { app, isDirty, persist, save, showPage, showRepo, snapshot, state, viewOf, vscode } from './core';
import { clone, renderDetail } from './detail';
import { refreshUsage } from './detail-view';
import { refreshCard } from './hover';
import { renderKindPage } from './kind-page';
import { renderOverview } from './overview';
import { onHuntMessage, renderHunt } from './hunt';
import { renderFleet, renderInit, renderMarkets } from './pages';
import { renderRepo } from './repo-page';
import { redrawCheckpoint, renderSession } from './session-page';
import { renderSessionsPage, showSession } from './sessions';
import { renderSidebar } from './sidebar';
import { storeSlim } from './slim';
import { storeDrawing } from './drawing';
import { setModActivity, setRepoTrace } from './trace';
import { askTotals, storeMore, storeTotals } from './usage-more';

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
      : state.page === 'hunt'
        ? renderHunt()
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

// A live session's page reads the transcript again in the background every few seconds while it is in sight.
const LIVE_MS = 5000;

// What a repaint would change: new records, prompts, events, usage, or an agent's progress.
const sessionSig = (d: any) =>
  d && !d.error ? JSON.stringify([d.end, d.live, d.prompts?.length, d.checkpoints?.length, d.events?.length, d.usage, (d.agents || []).map((a: any) => [a.id, a.status, a.end, a.tools])]) : '';

// A live repaint keeps the page where the owner had scrolled it, also after the diagrams have drawn, until they scroll.
const keepMainScroll = (paint: () => void) => {
  const top = app.querySelector<HTMLElement>('.main-body')?.scrollTop ?? 0;
  paint();
  const body = app.querySelector<HTMLElement>('.main-body');
  if (!body || !top) return;
  body.scrollTop = top;
  const hold = new ResizeObserver(() => (body.scrollTop = top));
  [...body.children].forEach(c => hold.observe(c));
  const release = () => hold.disconnect();
  body.addEventListener('wheel', release, { once: true });
  body.addEventListener('keydown', release, { once: true });
  setTimeout(release, 800);
};

setInterval(() => {
  const s = state.session;
  if (state.page !== 'session' || state.detail || !s || !s.data || !s.data.live || document.hidden) return;
  vscode.postMessage({ type: 'session', scope: s.scope, id: s.id });
}, LIVE_MS);

onMessage(m => {
  if (m.type === 'state') {
    state.views = m.views || (m.categories ? [{ id: 'global', label: 'Global', path: '', categories: m.categories }] : []);
    const before = state.checks;
    state.checks = m.checks || {};
    state.standard = m.standard;
    if (m.lists) state.lists = m.lists;
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
    else if (!state.detail && !state.repo && !state.page) state.overviewRefresh ? state.overviewRefresh() : renderMain();
    else if (state.detail && state.detail.asset.kind === 'agent' && state.detailMode !== 'edit') renderMain();
  } else if (m.type === 'sessions') {
    state.sessions[m.scope] = m.list || [];
    refreshCard(`repo:${m.scope}`);
    // A path rule's Loaded in tab weighs its "Never matched" marker by the sessions of its repo.
    if (state.detail && state.detail.asset.kind === 'rule' && state.detail.asset.scope === m.scope) refreshUsage();
    const current = app.querySelector('.sidebar');
    if (current) keepScroll(() => current.replaceWith(renderSidebar()));
    if (!state.detail && !state.page && state.repo === m.scope) renderMain();
    else if (!state.detail && !state.page && !state.repo && state.overviewRefresh) state.overviewRefresh();
    if (!state.detail && state.page === 'sessions' && state.sessionsPage && state.sessionsPage.scope === m.scope && state.sessionsPage.refresh) state.sessionsPage.refresh();
  } else if (m.type === 'session') {
    const s = state.session;
    if (s && s.scope === m.scope && s.id === m.id) {
      const onScreen = !!s.data;
      s.data = m.data;
      if (state.page !== 'session' || state.detail) return;
      // A live session's fresh read repaints only when something changed, and waits while a card is open.
      const sig = sessionSig(m.data);
      if (onScreen && (sig === s.shown || document.querySelector('.tl-hover.show, .cf'))) return;
      s.shown = sig;
      if (onScreen) keepMainScroll(renderMain);
      else renderMain();
    }
  } else if (m.type === 'checkpointFiles') {
    const s = state.session;
    if (s && s.scope === m.scope && s.id === m.id && s.checkpoint === m.checkpoint) {
      s.cpFiles = m.files;
      if (m.restored) s.cpRestored = m.restored;
      redrawCheckpoint();
    }
  } else if (m.type === 'styleDraft') {
    if (state.session && state.session.scope === m.scope && state.session.id === m.id) {
      state.session.styleDraft = m;
      if (state.page === 'session' && !state.detail) keepMainScroll(renderMain);
    }
  } else if (m.type === 'hunt' || m.type === 'huntRun' || m.type === 'huntCreate') {
    onHuntMessage(m);
  } else if (m.type === 'confirm') {
    showConfirm(m.ask);
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
  } else if (m.type === 'usageInfo') {
    // Progress keeps the sessions already known, so the badge stays; the answer replaces both. The tab updates in place:
    // a repaint of the page would ask again.
    const before = state.usage[m.id];
    // An answer equal to the one on the page changes nothing: every repaint of the page asks again.
    const same = !m.indexing && !!m.sessions && !before?.indexing && JSON.stringify(before?.sessions) === JSON.stringify(m.sessions);
    state.usage[m.id] = m.indexing ? { sessions: before?.sessions, indexing: m.indexing } : m.sessions ? { sessions: m.sessions } : { built: false };
    if (!same && state.detail && state.detail.asset.id === m.id) refreshUsage();
    // A skill page asked for its weight before the index existed: it asks again once the index is built.
    if (m.sessions && !same && state.detail && state.detail.asset.id === m.id && m.id && state.detail.asset.kind === 'skill') askTotals('skill');
  } else if (m.type === 'repoTrace') {
    setRepoTrace(m.scope, m.data);
    if (!state.detail && !state.page && state.repo === m.scope && state.repoTab === 'effective') keepMainScroll(renderMain);
  } else if (m.type === 'modActivity') {
    setModActivity(m.id, m.data);
    if (state.detail && state.detail.asset.id === m.id) keepMainScroll(renderMain);
  } else if (m.type === 'usageMore') {
    // The strip and counts arrive beside the sessions: a server page draws them in place of its cards, the other pages in their live Used in tab.
    if (storeMore(m) && state.detail && state.detail.asset.id === m.id) {
      if (state.detail.asset.kind === 'mcp') renderMain();
      else refreshUsage();
    }
  } else if (m.type === 'usageTotals') {
    if (storeTotals(m)) {
      // The sidebar byline shows the uses of an agent, skill or command once the totals are known.
      const current = app.querySelector('.sidebar');
      if (current) keepScroll(() => current.replaceWith(renderSidebar()));
      if (state.page === 'kind' && !state.detail && state.kindPage && state.kindPage.kind === m.kind) state.kindPage.refresh?.();
      // A skill's flags are weighed by its uses and sessions.
      else if (state.detail && state.detail.asset.kind === 'skill' && m.kind === 'skill' && state.detailMode !== 'edit') keepMainScroll(renderMain);
    }
  } else if (m.type === 'distChecks') {
    state.dist = { ...state.dist, ...m.checks };
    state.distRunning = !!m.running;
    const onSkillPage = state.page === 'kind' && !state.detail && state.kindPage?.kind === 'skill';
    if (onSkillPage || (state.detail && state.detail.asset.kind === 'skill' && state.detailMode !== 'edit')) keepMainScroll(renderMain);
  } else if (m.type === 'distNote') {
    state.distNote = m.note;
    state.distScroll = m.note?.focus;
    const onSkillPage = state.page === 'kind' && !state.detail && state.kindPage?.kind === 'skill';
    if (onSkillPage || (state.detail && state.detail.asset.kind === 'skill' && state.detailMode !== 'edit')) {
      keepMainScroll(renderMain);
      if (state.distScroll)
        requestAnimationFrame(() => {
          app.querySelector('.at-row.flash')?.scrollIntoView({ block: 'nearest' });
          state.distScroll = undefined;
        });
    }
  } else if (m.type === 'slim') {
    if (storeSlim(m) && state.detail && state.detail.asset.id === m.id && state.detailMode !== 'edit') keepMainScroll(renderMain);
  } else if (m.type === 'drawing') {
    if (storeDrawing(m) && state.detail && state.detail.asset.id === m.id && state.detailMode !== 'edit') keepMainScroll(renderMain);
  } else if (m.type === 'mcpInfo') {
    // A retry keeps the old banner, busy, until the new answer comes in.
    if (m.info === undefined && state.mcpBusy[m.id] === 'busy') return;
    state.mcpInfo[m.id] = m.info;
    if (state.mcpBusy[m.id] === 'busy') state.mcpBusy[m.id] = 'done';
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
    const before = state.detail && state.detail.asset.id;
    state.detail = m.detail;
    // A save, or another element than the one on screen, lands in View.
    if (m.saved || (m.detail && m.detail.asset.id !== before)) state.detailMode = 'view';
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
