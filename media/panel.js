(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const state = {
    views: [],
    openRepos: new Set(saved.openRepos || []),
    detail: undefined,
    repo: undefined,
    draft: undefined,
    filter: saved.filter || '',
    overviewFilter: '',
    expanded: new Set(saved.expanded || []),
    mcpSort: saved.mcpSort || 'name',
    mcpInfo: {},
    checks: {},
    page: undefined,
    fleet: undefined,
    effective: {},
    ruleInfo: {},
    markets: undefined,
    init: undefined,
  };
  const app = document.getElementById('app');

  const el = (tag, attrs, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'className') node.className = v;
      else if (k === 'value') node.value = v;
      else if (k === 'checked') node.checked = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) node.append(c.nodeType ? c : String(c));
    return node;
  };
  const icon = name => el('span', { className: `codicon codicon-${name}` });
  const logo = size => (document.body.dataset.logo ? el('img', { className: `logo ${size}`, src: document.body.dataset.logo, alt: '' }) : icon('hubot'));
  const iconBtn = (name, title, onclick, disabled) => el('button', { className: 'icon-btn', title, 'aria-label': title, onclick, disabled }, icon(name));

  const persist = () => vscode.setState({ filter: state.filter, expanded: [...state.expanded], openRepos: [...state.openRepos], mcpSort: state.mcpSort });
  const SOURCES = {
    user: { icon: 'account', label: 'Your config (~/.claude.json)' },
    local: { icon: 'lock', label: 'Local to this repo (~/.claude.json)' },
    project: { icon: 'repo', label: 'Repo .mcp.json' },
    'claude.ai': { icon: 'cloud', label: 'claude.ai connector' },
    plugin: { icon: 'extensions', label: 'Plugin' },
  };
  const SOURCE_ORDER = Object.keys(SOURCES);
  const labelOf = a =>
    a.kind !== 'mcp' ? a.name : a.source === 'claude.ai' ? a.name.replace(/^claude\.ai /, '') : a.source === 'plugin' ? a.name.split(':').slice(2).join(':') : a.name;
  const pluginOf = a => (a.source === 'plugin' ? a.name.split(':')[1] : '');
  const mcpDesc = a => [pluginOf(a) && `${pluginOf(a)} plugin`, a.enabled === false ? 'off' : a.offIn ? `off in ${a.offIn} folders` : '', a.status || a.target].filter(Boolean).join(' · ');
  const assetDesc = a => [a.version && `v${a.version}`, a.copies && a.copies.length ? `also in ${a.copies.map(c => `${c.label} (${c.same ? 'identical' : 'differs'})`).join(', ')}` : '', a.description].filter(Boolean).join(' · ');
  const statusRank = a => (a.enabled === false ? 9 : /^connected/i.test(a.status || '') ? 0 : /auth/i.test(a.status || '') ? 1 : /not configured/i.test(a.status || '') ? 3 : 2);
  const byLabel = (a, b) => labelOf(a).localeCompare(labelOf(b)) || a.name.localeCompare(b.name);
  const SORTS = {
    name: byLabel,
    source: (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || byLabel(a, b),
    status: (a, b) => statusRank(a) - statusRank(b) || byLabel(a, b),
  };
  const editable = () => state.detail && ['markdown', 'code', 'settings'].includes(state.detail.mode);
  const snapshot = d => JSON.stringify({ fields: d.fields, body: d.body });
  const isDirty = () => !!(state.draft && state.detail && snapshot(state.draft) !== snapshot(state.detail));
  const pending = () => (isDirty() ? { id: state.detail.asset.id, fields: state.draft.fields, body: state.draft.body } : undefined);
  const categoryOf = kind => (state.views[0] ? state.views[0].categories.find(c => c.kind === kind) : undefined);
  const viewOf = id => state.views.find(v => v.id === id);
  const RENAMABLE = ['agent', 'skill', 'command', 'outputStyle', 'rule', 'workflow'];
  const TOOL_FIELDS = ['tools', 'disallowedTools', 'allowed-tools'];
  const MODELS = ['inherit', 'sonnet', 'opus', 'haiku', 'fable'];

  const select = id => {
    if (state.detail && state.detail.asset.id === id) return;
    vscode.postMessage({ type: 'select', id, pending: pending() });
  };
  const showRepo = id => {
    state.repo = id;
    state.page = undefined;
    if (id) state.effective[id] = undefined;
    if (state.detail) select(undefined);
    else render();
  };
  const showPage = (page, extra) => {
    state.page = page;
    state.repo = undefined;
    if (page === 'init') state.init = { dir: extra, form: { summary: '', areas: [{ name: '', globs: '', owner: '' }], rules: '' }, data: undefined, result: undefined };
    if (page === 'fleet') vscode.postMessage({ type: 'fleet' });
    if (page === 'marketplaces') vscode.postMessage({ type: 'marketplaces' });
    if (page === 'init') vscode.postMessage({ type: 'initForm', dir: extra });
    if (state.detail) select(undefined);
    else render();
  };
  const CHECK = {
    pass: ['pass', 'ok', 'Passes the harness standard'],
    fail: ['error', 'bad', 'Fails the harness standard'],
    review: ['warning', 'warn', 'Lines to review'],
    running: ['sync', 'muted', 'Checking...'],
    error: ['circle-slash', 'bad', 'Check failed'],
    'no-plugin': ['circle-slash', 'muted', 'harness-plugin not installed'],
    'no-python': ['circle-slash', 'muted', 'Python 3 not found'],
  };
  const checkText = c =>
    !c || c.state === 'unchecked'
      ? 'not checked'
      : c.state === 'pass'
        ? 'pass'
        : c.state === 'fail'
          ? `fail ${c.fail || 0}${c.review ? ` · review ${c.review}` : ''}`
          : c.state === 'review'
            ? `review ${c.review || 0}`
            : c.state === 'running'
              ? 'checking...'
              : c.error || c.state;
  const checkBadge = c => {
    if (!c || !CHECK[c.state]) return null;
    const [glyph, tone, title] = CHECK[c.state];
    return el('span', { className: `check-badge ${tone}`, title: c.error || `${title}${c.fail !== undefined ? ` (fail ${c.fail}, review ${c.review})` : ''}` }, icon(glyph));
  };
  const command = (cmd, extra) => vscode.postMessage(Object.assign({ type: 'command', command: cmd }, extra));
  const save = () => {
    if (isDirty()) vscode.postMessage({ type: 'save', pending: pending() });
  };

  const matches = (a, q) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || (a.about || '').toLowerCase().includes(q);
  const total = view => view.categories.reduce((n, c) => n + c.items.length, 0);

  function renderCategories(list, view, q, nested) {
    for (const cat of view.categories) {
      const items = cat.items.filter(a => matches(a, q));
      if (cat.kind === 'mcp') items.sort(SORTS[state.mcpSort] || SORTS.name);
      if (!items.length && (q || nested)) continue;
      const key = `${view.id}|${cat.kind}`;
      const collapsed = !state.expanded.has(key) && !q;
      list.append(
        el(
          'div',
          {
            className: `section-head${nested ? ' nested' : ''}`,
            onclick: () => {
              collapsed ? state.expanded.add(key) : state.expanded.delete(key);
              persist();
              render();
            },
          },
          icon(collapsed ? 'chevron-right' : 'chevron-down'),
          el('span', { className: 'label' }, cat.label),
          cat.kind === 'mcp' && !collapsed && items.length > 1
            ? el(
                'select',
                {
                  className: 'sort',
                  title: 'Sort by',
                  onclick: e => e.stopPropagation(),
                  onchange: e => {
                    state.mcpSort = e.target.value;
                    persist();
                    render();
                  },
                },
                Object.keys(SORTS).map(k => el('option', { value: k, selected: state.mcpSort === k }, `Sort: ${k}`))
              )
            : null,
          cat.kind === 'mcp' && view.id === 'global'
            ? iconBtn('link-external', 'Add a connector on claude.ai', e => {
                e.stopPropagation();
                command('openConnectors');
              })
            : null,
          cat.kind === 'mcp' || cat.kind === 'plugin'
            ? iconBtn('add', cat.kind === 'mcp' ? 'Add MCP Server...' : 'Install Plugin...', e => {
                e.stopPropagation();
                command(cat.kind === 'mcp' ? 'addMcp' : 'installPlugin', { scope: view.id });
              })
            : null,
          cat.creatable
            ? iconBtn('add', `New ${cat.label}`, e => {
                e.stopPropagation();
                command('create', { kind: cat.kind, scope: view.id });
              })
            : null,
          el('span', { className: 'count' }, items.length)
        )
      );
      if (collapsed) continue;
      if (!items.length) list.append(el('div', { className: 'empty' }, 'None'));
      for (const a of items) {
        const selected = state.detail && state.detail.asset.id === a.id;
        const glyph = a.kind === 'plugin' ? (a.enabled ? 'pass-filled' : 'circle-large-outline') : a.kind === 'mcp' && SOURCES[a.source] ? SOURCES[a.source].icon : cat.icon;
        const off = (a.kind === 'plugin' || a.kind === 'mcp') && a.enabled === false;
        const desc = a.kind === 'mcp' ? mcpDesc(a) : assetDesc(a);
        list.append(
          el(
            'div',
            {
              className: `row${nested ? ' nested' : ''}${selected ? ' selected' : ''}${off ? ' disabled' : ''}`,
              title: desc,
              onclick: () => select(a.id),
            },
            icon(glyph),
            el('span', { className: 'name' }, labelOf(a)),
            desc ? el('span', { className: 'desc' }, desc) : null
          )
        );
      }
    }
  }

  function renderSidebar() {
    const q = state.filter.toLowerCase();
    const list = el('div', { className: 'list' });
    const [global, ...repos] = state.views;
    if (global) {
      const block = el('div', { className: 'scope-block' });
      renderCategories(block, global, q, false);
      list.append(block);
    }
    const visibleRepos = repos.filter(v => !q || v.categories.some(c => c.items.some(a => matches(a, q))));
    list.append(
      el(
        'div',
        { className: 'scope-head' },
        el('span', { className: 'label' }, 'Repositories'),
        iconBtn('repo-create', 'Add Repo...', () => command('addRepo')),
        iconBtn('trash', 'Remove Repo...', () => command('removeRepo')),
        el('span', { className: 'count' }, visibleRepos.length)
      )
    );
    visibleRepos.forEach((view, i) => {
      if (i > 0 && visibleRepos[i - 1].local && !view.local) list.append(el('div', { className: 'repo-separator' }));
      const open = state.openRepos.has(view.id) || !!q;
      const count = q ? view.categories.reduce((n, c) => n + c.items.filter(a => matches(a, q)).length, 0) : total(view);
      list.append(
        el(
          'div',
          {
            className: `repo-head${!state.detail && state.repo === view.id ? ' selected' : ''}`,
            title: view.path,
            onclick: () => {
              open ? state.openRepos.delete(view.id) : state.openRepos.add(view.id);
              persist();
              showRepo(view.id);
            },
          },
          icon(open ? 'chevron-down' : 'chevron-right'),
          icon('repo'),
          el('span', { className: 'label' }, view.label),
          checkBadge(state.checks[view.id]),
          iconBtn('terminal', `Open Claude in ${view.label}`, e => {
            e.stopPropagation();
            command('openClaude', { scope: view.id });
          }),
          iconBtn('add', `New in ${view.label}`, e => {
            e.stopPropagation();
            command('create', { scope: view.id });
          }),
          el('span', { className: 'count' }, count)
        )
      );
      if (open) renderCategories(list, view, q, true);
    });
    const search = el('input', {
      type: 'search',
      placeholder: 'Search the harness',
      value: state.filter,
      oninput: e => {
        state.filter = e.target.value;
        persist();
        const sidebar = app.querySelector('.sidebar');
        sidebar.replaceWith(renderSidebar());
        const input = app.querySelector('.search input');
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      },
    });
    return el(
      'aside',
      { className: 'sidebar' },
      el(
        'div',
        { className: 'sidebar-head' },
        logo('logo-sm'),
        el('span', {}, 'Claude Harness'),
        el('span', { className: 'spacer' }),
        iconBtn('home', 'Overview', () => showRepo(undefined)),
        iconBtn('table', 'Fleet overview', () => showPage('fleet')),
        iconBtn('package', 'Marketplace health', () => showPage('marketplaces')),
        iconBtn('add', 'New...', () => command('create')),
        iconBtn('refresh', 'Refresh', () => command('refresh'))
      ),
      el('div', { className: 'search' }, search),
      list
    );
  }

  function renderOverview() {
    const [global, ...repos] = state.views;
    const categories = global ? global.categories : [];
    const all = state.views.flatMap(v => v.categories.flatMap(c => c.items.map(a => Object.assign({ icon: c.icon, scopeLabel: v.label }, a))));
    const recent = all
      .filter(a => ['memory', 'rule', 'agent', 'skill', 'command', 'outputStyle', 'workflow'].includes(a.kind))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 12);
    const results = el('div', { className: 'recent' });
    const showResults = () => {
      const q = state.overviewFilter.toLowerCase();
      const hits = q ? all.filter(a => matches(a, q)) : [];
      results.replaceChildren(
        ...(q
          ? [
              el('div', { className: 'group-label' }, `Results (${hits.length})`),
              hits.length
                ? hits.map(a =>
                    el(
                      'div',
                      { className: 'row', title: a.description, onclick: () => select(a.id) },
                      icon(a.icon),
                      el('span', { className: 'name' }, labelOf(a)),
                      el('span', { className: 'desc' }, [a.scopeLabel, a.kind === 'mcp' ? mcpDesc(a) : assetDesc(a)].filter(Boolean).join(' · '))
                    )
                  )
                : el('div', { className: 'empty flush' }, 'No matches'),
            ]
          : []
        ).flat()
      );
      results.hidden = !q;
    };
    showResults();
    const search = el(
      'div',
      { className: 'overview-search' },
      el('input', {
        type: 'search',
        placeholder: 'Search harness elements',
        value: state.overviewFilter,
        oninput: e => {
          state.overviewFilter = e.target.value;
          showResults();
        },
      })
    );
    return el(
      'section',
      { className: 'main' },
      el(
        'header',
        { className: 'main-head' },
        el('span', { className: 'big' }, logo('logo-lg')),
        el('div', { className: 'title' }, el('h1', {}, 'Claude Harness'), el('div', { className: 'path' }, `${global ? total(global) : 0} global assets · ${repos.length} repositories`))
      ),
      el(
        'div',
        { className: 'main-body' },
        el(
          'div',
          { className: 'overview' },
          categories.map(c =>
            el(
              'div',
              {
                className: 'tile',
                onclick: () => {
                  state.expanded.add(`${global.id}|${c.kind}`);
                  persist();
                  if (c.items[0]) select(c.items[0].id);
                },
              },
              el('span', { className: 'n' }, c.items.length),
              el('span', { className: 'l' }, icon(c.icon), c.label)
            )
          )
        ),
        search,
        results,
        repos.length
          ? el(
              'div',
              { className: 'recent' },
              el('div', { className: 'group-label' }, 'Repositories'),
              repos.map(v =>
                el(
                  'div',
                  {
                    className: 'row',
                    title: v.path,
                    onclick: () => {
                      state.openRepos.add(v.id);
                      persist();
                      showRepo(v.id);
                    },
                  },
                  icon('repo'),
                  el('span', { className: 'name' }, v.label),
                  el(
                    'span',
                    { className: 'desc' },
                    v.categories
                      .filter(c => c.items.length)
                      .map(c => `${c.items.length} ${c.label.toLowerCase()}`)
                      .join(' · ') || 'empty'
                  )
                )
              )
            )
          : null,
        el(
          'div',
          { className: 'recent' },
          el('div', { className: 'group-label' }, 'Recently changed'),
          recent.map(a =>
            el(
              'div',
              { className: 'row', onclick: () => select(a.id) },
              icon(a.icon),
              el('span', { className: 'name' }, a.name),
              el('span', { className: 'desc' }, `${a.scopeLabel} · ${new Date(a.mtime).toLocaleString()}`)
            )
          )
        )
      )
    );
  }

  function renderRepo(view) {
    const items = view.categories.flatMap(c => c.items.map(a => Object.assign({ icon: c.icon }, a)));
    const recent = items.sort((a, b) => b.mtime - a.mtime).slice(0, 12);
    return el(
      'section',
      { className: 'main' },
      el(
        'header',
        { className: 'main-head' },
        el('span', { className: 'big' }, icon('repo')),
        el('div', { className: 'title' }, el('h1', {}, view.label), el('div', { className: 'path', title: view.path }, `${total(view)} assets · ${view.path}`)),
        el(
          'div',
          { className: 'toolbar' },
          iconBtn('checklist', 'Check against the harness standard', () => command('checkRepos', { scope: view.id })),
          iconBtn('wrench', 'Fix settings and hooks...', () => command('fixSettings', { scope: view.id })),
          iconBtn('new-folder', 'Init product repo...', () => showPage('init', view.path)),
          iconBtn('add', `New in ${view.label}`, () => command('create', { scope: view.id })),
          iconBtn('trash', `Remove ${view.label} from the harness`, () => {
            state.repo = undefined;
            command('removeRepo', { id: view.id });
          })
        )
      ),
      el(
        'div',
        { className: 'main-body' },
        el(
          'div',
          { className: 'overview' },
          view.categories.map(c =>
            el(
              'div',
              {
                className: 'tile',
                onclick: () => {
                  state.expanded.add(`${view.id}|${c.kind}`);
                  state.openRepos.add(view.id);
                  persist();
                  if (c.items[0]) select(c.items[0].id);
                  else render();
                },
              },
              el('span', { className: 'n' }, c.items.length),
              el('span', { className: 'l' }, icon(c.icon), c.label)
            )
          )
        ),
        recent.length
          ? el(
              'div',
              { className: 'recent' },
              el('div', { className: 'group-label' }, 'Recently changed'),
              recent.map(a =>
                el(
                  'div',
                  { className: 'row', onclick: () => select(a.id) },
                  icon(a.icon),
                  el('span', { className: 'name' }, a.name),
                  el('span', { className: 'desc' }, new Date(a.mtime).toLocaleString())
                )
              )
            )
          : null,
        renderStandard(view),
        renderEffective(view)
      )
    );
  }

  const openAt = (file, line) => vscode.postMessage({ type: 'openAt', file, line });
  const LEVEL_ICONS = { FAIL: 'error', REVIEW: 'warning', INFO: 'info' };

  function renderStandard(view) {
    const eff = state.effective[view.id];
    const live = state.checks[view.id];
    const c = eff && eff.check && (!live || eff.check.state === live.state) ? eff.check : live;
    const findings = (c && c.findings) || [];
    return el(
      'div',
      { className: 'recent' },
      el('div', { className: 'group-label' }, 'Harness standard'),
      el('div', { className: 'check-line' }, checkBadge(c) || icon('circle-large-outline'), el('span', {}, checkText(c)), c && c.kind ? el('span', { className: 'desc' }, `${c.kind} repo`) : null),
      findings.map(f =>
        el(
          'div',
          { className: 'row', title: f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : f.text, onclick: f.file ? () => openAt(f.file, f.line) : undefined },
          el('span', { className: `check-badge ${f.level === 'FAIL' ? 'bad' : f.level === 'REVIEW' ? 'warn' : 'muted'}` }, icon(LEVEL_ICONS[f.level] || 'info')),
          el('span', { className: 'name wrap' }, f.text.replace(/^(FAIL|REVIEW|INFO) /, ''))
        )
      )
    );
  }

  function memoryRows(node, depth) {
    return [
      el(
        'div',
        { className: `row indent-${Math.min(depth, 5)}`, title: node.file, onclick: node.exists ? () => openAt(node.file) : undefined },
        icon(depth ? 'arrow-small-right' : 'markdown'),
        el('span', { className: 'name' }, node.label),
        el('span', { className: 'desc' }, node.exists ? (depth ? 'imported' : node.file) : 'not found')
      ),
      ...node.imports.flatMap(n => memoryRows(n, depth + 1)),
    ];
  }

  function renderEffective(view) {
    const eff = state.effective[view.id];
    if (eff === undefined) {
      state.effective[view.id] = null;
      vscode.postMessage({ type: 'effective', scope: view.id });
    }
    if (!eff) return el('div', { className: 'empty flush' }, 'Reading what a session here loads...');
    const e = eff.effective;
    const plugin = p =>
      [
        ['user', p.user],
        ['project', p.project],
        ['local', p.local],
      ]
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k} ${v ? 'on' : 'off'}`)
        .join(' · ');
    return el(
      'div',
      { className: 'effective' },
      el('div', { className: 'group-label' }, 'Effective harness: what a session here loads'),
      el('div', { className: 'sub-label' }, 'Memory, imports expanded'),
      e.memory.length ? e.memory.flatMap(n => memoryRows(n, 0)) : el('div', { className: 'empty flush' }, 'No CLAUDE.md'),
      el('div', { className: 'sub-label' }, `Rules (${e.rules.length})`),
      e.rules.length
        ? e.rules.map(r =>
            el(
              'div',
              { className: 'row', title: r.file, onclick: () => openAt(r.file) },
              icon(r.always ? 'law' : r.total ? 'filter' : 'warning'),
              el('span', { className: 'name' }, `${r.scope === view.label ? '' : `${r.scope} · `}${r.name}`),
              el('span', { className: 'desc' }, r.always ? 'always loaded' : `${r.globs.map(g => g.glob).join(', ')} · ${r.total} ${r.total === 1 ? 'file' : 'files'}${e.capped ? '+' : ''}`)
            )
          )
        : el('div', { className: 'empty flush' }, 'No rules'),
      el('div', { className: 'sub-label' }, `Plugins (${e.plugins.filter(p => p.enabled).length} on)`),
      e.plugins.length
        ? e.plugins.map(p =>
            el(
              'div',
              { className: `row${p.enabled ? '' : ' disabled'}` },
              icon(p.enabled ? 'pass-filled' : 'circle-large-outline'),
              el('span', { className: 'name' }, p.key),
              el('span', { className: `desc${p.duplicate ? ' warn' : ''}` }, [plugin(p), p.duplicate ? 'duplicate: already on for the user' : ''].filter(Boolean).join(' · '))
            )
          )
        : el('div', { className: 'empty flush' }, 'No plugins'),
      el('div', { className: 'sub-label' }, `Hooks (${e.hooks.length})`),
      e.hooks.length
        ? e.hooks.map(h =>
            el(
              'div',
              { className: 'row', title: h.command },
              icon(h.event === 'mod' ? 'extensions' : 'zap'),
              el('span', { className: 'name' }, h.matcher ? `${h.event} · ${h.matcher}` : h.event),
              el('span', { className: 'desc' }, `${h.command} · ${h.source}`)
            )
          )
        : el('div', { className: 'empty flush' }, 'No hooks')
    );
  }

  function renderRuleInfo(a) {
    const info = state.ruleInfo[a.id];
    if (info === undefined) {
      state.ruleInfo[a.id] = null;
      vscode.postMessage({ type: 'ruleInfo', id: a.id });
    }
    if (!info) return el('div', { className: 'empty flush' }, 'Matching paths...');
    return el(
      'div',
      {},
      el('div', { className: 'group-label' }, 'Paths'),
      info.base ? el('div', { className: 'empty flush' }, `Matched against ${info.base}`) : null,
      info.globs.length
        ? info.globs.map(g =>
            el(
              'div',
              { className: 'row', title: g.sample.join('\n') },
              icon(g.matches ? 'pass' : 'warning'),
              el('span', { className: 'name' }, g.glob),
              el('span', { className: 'desc' }, `${g.matches} ${g.matches === 1 ? 'file' : 'files'}${info.capped ? '+' : ''}${g.sample.length ? ` · ${g.sample.join(', ')}` : ''}`)
            )
          )
        : el('div', { className: 'empty flush' }, 'No paths: the rule loads in every session'),
      info.owner
        ? el(
            'div',
            { className: 'row' },
            icon(info.ownerFound ? 'pass' : 'error'),
            el('span', { className: 'name' }, `Owner agent: ${info.owner}`),
            el('span', { className: 'desc' }, info.ownerFound ? 'found on disk' : 'no agent with this name on disk')
          )
        : el('div', { className: 'empty flush' }, 'No Owner agent line')
    );
  }

  function pageHead(glyph, title, sub, ...tools) {
    return el('header', { className: 'main-head' }, el('span', { className: 'big' }, icon(glyph)), el('div', { className: 'title' }, el('h1', {}, title), el('div', { className: 'path' }, sub)), el('div', { className: 'toolbar' }, ...tools));
  }

  const liveCheck = r => state.checks[r.id] || { state: r.checkState };

  function renderFleet() {
    const rows = state.fleet;
    const body = el('div', { className: 'main-body' });
    if (!rows) body.append(el('div', { className: 'empty flush' }, 'Reading the repos...'));
    else {
      const heads = ['Repo', 'Layout', 'Standard', 'Lines', 'Em dashes', 'Restated', 'Plugins', 'Hook copies', 'Copies'];
      body.append(
        el(
          'div',
          { className: 'table-wrap' },
          el(
            'table',
            { className: 'grid' },
            el('thead', {}, el('tr', {}, heads.map((h, i) => el('th', { className: i >= 3 ? 'num' : '' }, h)))),
            el(
              'tbody',
              {},
              rows.map(r =>
                el(
                  'tr',
                  {
                    className: 'clickable',
                    title: r.path,
                    onclick: () => {
                      state.openRepos.add(r.id);
                      persist();
                      showRepo(r.id);
                    },
                  },
                  el('td', {}, el('span', { className: 'cell' }, icon('repo'), r.label)),
                  el('td', { className: r.layout === 'router' ? '' : 'warn' }, r.layout),
                  el('td', {}, el('span', { className: 'cell' }, checkBadge(liveCheck(r)), checkText(liveCheck(r)))),
                  el('td', { className: `num${r.lines > 120 ? ' warn' : ''}` }, r.lines || ''),
                  el('td', { className: `num${r.emDashes ? ' warn' : ''}` }, r.emDashes),
                  el('td', { className: `num${r.check && r.check.restated ? ' warn' : ''}` }, r.check ? r.check.restated : ''),
                  el('td', { className: 'num', title: r.plugins.join('\n') }, r.plugins.length || ''),
                  el('td', { className: 'num' }, r.hookCopies || ''),
                  el('td', { className: 'num' }, r.copies || '')
                )
              )
            )
          )
        ),
        el('div', { className: 'empty flush' }, 'Lines and em dashes count the root CLAUDE.md. Restated comes from the harness standard check. Copies count skills and agents that also exist in another scope or a plugin.')
      );
    }
    return el(
      'section',
      { className: 'main' },
      pageHead(
        'table',
        'Fleet overview',
        rows ? `${rows.length} repositories` : 'Reading...',
        iconBtn('checklist', 'Check every repo against the harness standard', () => command('checkRepos')),
        iconBtn('wrench', 'Fix settings and hooks...', () => command('fixSettings')),
        iconBtn('archive', 'Retire clean copies...', () => command('retireCopies')),
        iconBtn('refresh', 'Reload the table', () => vscode.postMessage({ type: 'fleet' }))
      ),
      body
    );
  }

  function renderMarkets() {
    const list = state.markets;
    const body = el('div', { className: 'main-body' });
    if (!list) body.append(el('div', { className: 'empty flush' }, 'Reading the marketplaces...'));
    else if (!list.length) body.append(el('div', { className: 'empty flush' }, 'No marketplace registered. Add one with claude plugin marketplace add.'));
    else
      for (const m of list) {
        const ahead = m.plugins.filter(p => p.ahead).length;
        body.append(
          el(
            'div',
            { className: 'recent' },
            el('div', { className: 'market-head' }, icon('package'), el('span', { className: 'label' }, m.name), ahead ? el('span', { className: 'tag warn' }, `${ahead} ahead`) : null, el('span', { className: 'spacer' }),
              m.kind === 'directory' ? el('button', { className: 'secondary', onclick: () => command('renameMarketplace', { market: m.name }) }, icon('edit'), 'Rename...') : null),
            el('div', { className: 'facts' }, [
              [el('span', { className: 'key' }, 'Source'), el('span', { className: 'value' }, `${m.kind} · ${m.source}`)],
              [el('span', { className: 'key' }, 'Location'), el('span', { className: 'value' }, m.location)],
            ].flat()),
            m.plugins.length
              ? el(
                  'div',
                  { className: 'table-wrap' },
                  el(
                    'table',
                    { className: 'grid' },
                    el('thead', {}, el('tr', {}, ['Plugin', 'Installed', 'Source', 'State'].map(h => el('th', {}, h)))),
                    el(
                      'tbody',
                      {},
                      m.plugins.map(p =>
                        el(
                          'tr',
                          {},
                          el('td', {}, p.name),
                          el('td', {}, p.installed || 'not installed'),
                          el('td', {}, p.source || ''),
                          el('td', { className: p.ahead ? 'warn' : '' }, [p.ahead ? 'source ahead of the installed copy' : p.installed ? 'current' : '', p.enabled ? 'enabled' : ''].filter(Boolean).join(' · '))
                        )
                      )
                    )
                  )
                )
              : el('div', { className: 'empty flush' }, 'No plugins installed from it')
          )
        );
      }
    return el('section', { className: 'main' }, pageHead('package', 'Marketplace health', list ? `${list.length} marketplaces` : 'Reading...', iconBtn('refresh', 'Reload', () => vscode.postMessage({ type: 'marketplaces' }))), body);
  }

  const initForm = () => ({ summary: state.init.form.summary, areas: state.init.form.areas, rules: state.init.form.rules.split(/\r?\n/) });

  function renderInit() {
    const s = state.init;
    const data = s.data;
    const body = el('div', { className: 'main-body' });
    let createBtn;
    const syncCreate = () => {
      if (createBtn) createBtn.disabled = !(s.result && !s.result.error && !s.applied && s.previewKey === JSON.stringify(initForm()));
    };
    if (!data) body.append(el('div', { className: 'empty flush' }, 'Loading...'));
    else {
      if (data.error) body.append(el('div', { className: 'notice bad' }, data.error));
      if (data.hasClaudeMd) body.append(el('div', { className: 'notice' }, 'This folder has a CLAUDE.md. Init only creates missing files and never overwrites one.'));
      const owners = data.agents || [];
      body.append(
        el('div', { className: 'group-label' }, 'Summary'),
        el('textarea', { className: 'text', rows: 3, placeholder: 'One to three sentences: what the product is and its stack.', value: s.form.summary, oninput: e => ((s.form.summary = e.target.value), syncCreate()) }),
        el('div', { className: 'group-label' }, 'Areas'),
        el(
          'div',
          { className: 'areas' },
          s.form.areas.map((a, i) =>
            el(
              'div',
              { className: 'area' },
              el('input', { type: 'text', placeholder: 'name, e.g. api', value: a.name, oninput: e => ((a.name = e.target.value), syncCreate()) }),
              el('input', { type: 'text', placeholder: 'globs, e.g. src/api/**', value: a.globs, oninput: e => ((a.globs = e.target.value), syncCreate()) }),
              el(
                'select',
                { onchange: e => ((a.owner = e.target.value), syncCreate()) },
                el('option', { value: '', selected: !a.owner }, 'Owner agent'),
                owners.map(o => el('option', { value: o, selected: a.owner === o }, o))
              ),
              iconBtn('close', 'Remove area', () => {
                s.form.areas.splice(i, 1);
                renderMain();
              })
            )
          )
        ),
        el('div', { className: 'add-field' }, el('button', { className: 'secondary', onclick: () => (s.form.areas.push({ name: '', globs: '', owner: '' }), renderMain()) }, icon('add'), 'Add area')),
        el('div', { className: 'group-label' }, 'Repo rules'),
        el('textarea', { className: 'text', rows: 3, placeholder: 'One repo-only hard rule per line.', value: s.form.rules, oninput: e => ((s.form.rules = e.target.value), syncCreate()) })
      );
      createBtn = el(
        'button',
        {
          className: 'primary',
          onclick: () => vscode.postMessage({ type: 'initRun', dir: s.dir, form: initForm(), apply: true }),
        },
        icon('new-file'),
        'Create files'
      );
      body.append(
        el(
          'div',
          { className: 'toolbar' },
          el(
            'button',
            {
              className: 'secondary',
              onclick: () => {
                s.pendingKey = JSON.stringify(initForm());
                vscode.postMessage({ type: 'initRun', dir: s.dir, form: initForm(), apply: false });
              },
            },
            icon('eye'),
            'Preview'
          ),
          createBtn
        )
      );
      syncCreate();
      if (s.result) {
        if (s.result.error) body.append(el('div', { className: 'notice bad' }, s.result.error));
        else
          body.append(
            el(
              'div',
              {},
              el('div', { className: 'group-label' }, s.applied ? 'Created' : 'Preview: nothing is written yet'),
              (s.result.files || []).map(f => el('div', { className: 'row' }, icon(f.action === 'create' ? 'new-file' : 'circle-slash'), el('span', { className: 'name' }, f.rel), el('span', { className: 'desc' }, f.action === 'create' ? (s.applied ? 'created' : 'will be created') : 'exists, skipped'))),
              el('div', { className: 'empty flush' }, s.result.summary || '')
            )
          );
      }
    }
    const wrap = el('div', { className: 'init-form' });
    wrap.append(...[...body.childNodes]);
    body.append(wrap);
    return el('section', { className: 'main' }, pageHead('new-folder', 'Init product repo', s.dir), body);
  }

  const fit = box => {
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight + 2}px`;
  };

  function fieldInput(f, i) {
    const update = value => {
      state.draft.fields[i] = Object.assign({}, f, { value });
      refreshHead();
    };
    if (f.type === 'boolean') return el('input', { type: 'checkbox', checked: f.value === true, onchange: e => update(e.target.checked) });
    if (TOOL_FIELDS.includes(f.key)) {
      const box = el('textarea', { className: 'tools', rows: 1, value: f.value, spellcheck: false, placeholder: 'comma separated', oninput: e => (update(e.target.value), fit(box)) });
      requestAnimationFrame(() => fit(box));
      return el(
        'div',
        { className: 'tools-field' },
        box,
        el('button', { className: 'link', onclick: () => vscode.postMessage({ type: 'configureTools', id: state.detail.asset.id, key: f.key, value: String(state.draft.fields[i].value) }) }, 'Configure Tools...')
      );
    }
    if (f.type === 'text' || f.type === 'yaml')
      return el('textarea', { className: f.type, rows: f.type === 'text' ? 4 : 3, value: f.value, oninput: e => update(e.target.value), spellcheck: f.type === 'text' });
    const input = el('input', { type: 'text', value: f.value, oninput: e => update(e.target.value) });
    if (f.key === 'model') {
      input.setAttribute('list', 'models');
      return el('div', {}, input, el('datalist', { id: 'models' }, MODELS.map(m => el('option', { value: m }))));
    }
    if (f.type === 'list') input.placeholder = 'comma separated';
    return input;
  }

  function renderFields() {
    const d = state.detail;
    const grid = el('div', { className: 'fields' });
    state.draft.fields.forEach((f, i) => {
      grid.append(
        el('span', { className: 'key', title: f.key }, f.key),
        fieldInput(f, i),
        iconBtn('close', `Remove ${f.key}`, () => {
          state.draft.fields.splice(i, 1);
          renderMain();
        })
      );
    });
    const present = new Set(state.draft.fields.map(f => f.key));
    const options = d.knownFields.filter(k => !present.has(k));
    const keyInput = el('input', { type: 'text', placeholder: 'field name', list: 'known-fields' });
    const add = () => {
      const key = keyInput.value.trim();
      if (!key || present.has(key)) return;
      const type = key === 'description' ? 'text' : ['disable-model-invocation', 'user-invocable', 'keep-coding-instructions'].includes(key) ? 'boolean' : 'string';
      state.draft.fields.push({ key, type, value: type === 'boolean' ? false : '' });
      renderMain();
    };
    keyInput.addEventListener('keydown', e => e.key === 'Enter' && add());
    return el(
      'div',
      {},
      el('div', { className: 'group-label' }, 'Frontmatter'),
      state.draft.fields.length ? grid : el('div', { className: 'empty flush' }, 'No frontmatter'),
      el(
        'div',
        { className: 'add-field' },
        keyInput,
        el('datalist', { id: 'known-fields' }, options.map(k => el('option', { value: k }))),
        el('button', { className: 'secondary', onclick: add }, icon('add'), 'Add field')
      )
    );
  }

  function renderFiles() {
    const files = (state.detail.asset.files || []).filter(f => f !== 'SKILL.md');
    if (!files.length) return null;
    return el(
      'div',
      {},
      el('div', { className: 'group-label' }, `Files (${files.length})`),
      el(
        'div',
        { className: 'files' },
        files.map(f =>
          el('div', { className: 'file', onclick: () => command('openFile', { id: state.detail.asset.id, rel: f }) }, icon(/\.md$/i.test(f) ? 'markdown' : 'file'), f)
        )
      )
    );
  }

  const retirable = a =>
    (a.kind === 'skill' || a.kind === 'agent') && a.scope !== 'global' && (a.copies || []).some(c => c.same && (c.scope === 'global' || c.scope.startsWith('plugin:')));

  let headNode;
  function renderHead() {
    const d = state.detail;
    const cat = categoryOf(d.asset.kind);
    const dirty = isDirty();
    const canRename = RENAMABLE.includes(d.asset.kind);
    return el(
      'header',
      { className: 'main-head' },
      el('span', { className: 'big' }, icon(d.asset.kind === 'mcp' && SOURCES[d.asset.source] ? SOURCES[d.asset.source].icon : cat ? cat.icon : 'file')),
      el(
        'div',
        { className: 'title' },
        el('h1', {}, labelOf(d.asset), el('span', { className: 'tag' }, cat ? cat.label.replace(/s$/, '') : d.asset.kind), d.asset.scope !== 'global' && viewOf(d.asset.scope) ? el('span', { className: 'tag scope', title: viewOf(d.asset.scope).path }, icon('repo'), viewOf(d.asset.scope).label) : null, dirty ? el('span', { className: 'dirty', title: 'Unsaved changes' }) : null),
        el('div', { className: 'path', title: d.asset.file }, d.asset.file)
      ),
      el(
        'div',
        { className: 'toolbar' },
        d.asset.kind === 'mcp' && d.asset.source !== 'claude.ai' && d.asset.source !== 'plugin' ? iconBtn('copy', 'Copy as claude mcp add command', () => command('copyMcpAdd', { id: d.asset.id })) : null,
        canRename ? iconBtn('edit', 'Rename', () => command('rename', { id: d.asset.id })) : null,
        canRename ? iconBtn('copy', 'Duplicate', () => command('duplicate', { id: d.asset.id })) : null,
        iconBtn('go-to-file', 'Open in editor', () => command('openFile', { id: d.asset.id })),
        iconBtn('folder-opened', 'Reveal in File Explorer', () => command('reveal', { id: d.asset.id })),
        retirable(d.asset) ? iconBtn('archive', 'Retire this copy: back it up, then delete it', () => command('retire', { id: d.asset.id })) : null,
        canRename || (d.asset.kind === 'mcp' && d.asset.file && d.asset.jsonPath) ? iconBtn('trash', 'Delete', () => command('delete', { id: d.asset.id })) : null,
        d.asset.kind === 'plugin' ? iconBtn('trash', 'Uninstall plugin', () => command('uninstallPlugin', { id: d.asset.id })) : null
      ),
      editable()
        ? el(
            'div',
            { className: 'toolbar' },
            el(
              'button',
              {
                className: 'secondary',
                disabled: !dirty,
                onclick: () => {
                  state.draft = clone(state.detail);
                  renderMain();
                },
              },
              'Revert'
            ),
            el('button', { className: 'primary', disabled: !dirty, onclick: save, title: 'Ctrl+S' }, icon('save'), 'Save')
          )
        : null
    );
  }
  function refreshHead() {
    const next = renderHead();
    headNode.replaceWith(next);
    headNode = next;
  }

  function renderDetail() {
    const d = state.detail;
    const body = el('div', { className: 'main-body' });
    if (d.mode === 'markdown') {
      body.append(renderFields());
      if (d.asset.kind === 'rule') body.append(renderRuleInfo(d.asset));
      body.append(
        el(
          'div',
          { className: 'editor' },
          el('div', { className: 'group-label' }, 'Instructions'),
          el('textarea', {
            value: state.draft.body,
            spellcheck: false,
            oninput: e => {
              state.draft.body = e.target.value;
              refreshHead();
            },
          })
        )
      );
      const files = renderFiles();
      if (files) body.append(files);
    } else if (d.mode === 'code' || d.mode === 'settings') {
      body.append(
        el(
          'div',
          { className: 'editor' },
          el('div', { className: 'group-label' }, d.mode === 'settings' ? 'JSON' : 'Script'),
          el('textarea', {
            value: state.draft.body,
            spellcheck: false,
            oninput: e => {
              state.draft.body = e.target.value;
              refreshHead();
            },
          })
        )
      );
    } else if (d.mode === 'mcp') {
      body.append(renderMcp(d));
    } else if (d.mode === 'plugin') {
      body.append(
        el(
          'div',
          { className: 'switch' },
          el('input', { type: 'checkbox', id: 'plugin-enabled', checked: d.asset.enabled, onchange: () => command('togglePlugin', { id: d.asset.id }) }),
          el('label', { for: 'plugin-enabled' }, 'Enabled'),
          el('span', { className: 'desc' }, d.asset.description)
        )
      );
    } else {
      body.append(el('pre', { className: 'json' }, d.body));
    }
    headNode = renderHead();
    return el('section', { className: 'main' }, headNode, body);
  }

  function renderMcp(d) {
    const a = d.asset;
    const repo = a.scope !== 'global' && viewOf(a.scope);
    const info = state.mcpInfo[a.id];
    const facts = [
      ['Source', el('span', {}, icon(SOURCES[a.source] ? SOURCES[a.source].icon : 'server'), ' ', SOURCES[a.source] ? SOURCES[a.source].label : 'Config')],
      pluginOf(a) ? ['Plugin', pluginOf(a)] : null,
      ['Name in Claude', a.name],
      a.target ? ['Address', a.target] : null,
      a.status ? ['Status', a.status] : null,
    ].filter(Boolean);
    const box = el('div', { className: 'mcp' });
    box.append(
      el(
        'div',
        { className: 'switch' },
        el('input', { type: 'checkbox', id: 'mcp-enabled', checked: a.enabled !== false, onchange: () => command('toggleMcp', { id: a.id }) }),
        el('label', { for: 'mcp-enabled' }, repo ? `Enabled in ${repo.label}` : 'Enabled in every folder'),
        !repo && a.offIn ? el('span', { className: 'desc' }, `Off in ${a.offIn} of ${a.folders} folders. Switch on to enable it everywhere.`) : null
      ),
      el('div', { className: 'facts' }, facts.flatMap(([k, v]) => [el('span', { className: 'key' }, k), el('span', { className: 'value' }, v)]))
    );
    if (a.about) box.append(el('p', { className: 'about' }, a.about));
    if (!info) box.append(el('div', { className: 'empty flush' }, 'Asking the server for its tools...'));
    else if (info.error)
      box.append(
        el('div', { className: 'empty flush' }, info.error),
        el(
          'div',
          { className: 'toolbar' },
          info.signIn ? el('button', { className: 'primary', onclick: () => vscode.postMessage({ type: 'mcpSignIn', id: a.id }) }, icon('sign-in'), 'Sign in') : null,
          el('button', { className: 'secondary', onclick: () => vscode.postMessage({ type: 'mcpRetry', id: a.id }) }, icon('refresh'), 'Retry')
        )
      );
    else {
      box.append(
        el('div', { className: 'group-label' }, `Tools (${(info.tools || []).length})`),
        el(
          'div',
          { className: 'tool-list' },
          (info.tools || []).map(t => el('div', { className: 'tool' }, el('span', { className: 'name' }, t.name)))
        )
      );
    }
    if (d.body) box.append(el('div', { className: 'group-label' }, 'Config'), el('pre', { className: 'json' }, d.body));
    return box;
  }

  const clone = d => ({ fields: d.fields.map(f => Object.assign({}, f)), body: d.body });

  function renderMain() {
    const repo = state.repo && viewOf(state.repo);
    const main = state.detail
      ? renderDetail()
      : state.page === 'fleet'
        ? renderFleet()
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

  function render() {
    const scroll = app.querySelector('.list') ? app.querySelector('.list').scrollTop : 0;
    app.replaceChildren(renderSidebar());
    renderMain();
    app.querySelector('.list').scrollTop = scroll;
  }

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'state') {
      state.views = m.views || (m.categories ? [{ id: 'global', label: 'Global', path: '', categories: m.categories }] : []);
      const before = state.checks;
      state.checks = m.checks || {};
      const scroll = app.querySelector('.list') ? app.querySelector('.list').scrollTop : 0;
      const sidebar = renderSidebar();
      const current = app.querySelector('.sidebar');
      current ? current.replaceWith(sidebar) : render();
      app.querySelector('.list').scrollTop = scroll;
      if (state.repo && before[state.repo] && state.checks[state.repo] && before[state.repo].state !== state.checks[state.repo].state && !['running', 'unchecked'].includes(state.checks[state.repo].state))
        vscode.postMessage({ type: 'effective', scope: state.repo });
      if (state.page === 'fleet' && !state.detail) {
        clearTimeout(state.fleetTimer);
        state.fleetTimer = setTimeout(() => vscode.postMessage({ type: 'fleet' }), 400);
      }
      if (current && !state.detail && (state.repo || state.page === 'fleet')) renderMain();
    } else if (m.type === 'page') {
      if (m.repo) {
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
        state.init.result = m.data;
        state.init.applied = !!m.apply && m.data && !m.data.error;
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
})();
