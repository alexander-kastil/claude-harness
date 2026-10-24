// @ts-nocheck
// Webview state, asset helpers and navigation shared by every page.
import { saved, vscode } from './bridge';
import { el, icon, plural } from './dom';
import { render } from './main';
import type { State } from './state';

export { saved, vscode };

export const state: State = {
  views: [],
  openRepos: new Set(saved.openRepos || []),
  detail: undefined,
  repo: undefined,
  draft: undefined,
  filter: saved.filter || '',
  overviewFilter: '',
  expanded: new Set(saved.expanded || []),
  listViews: Object.assign({ mcp: saved.mcpView, skill: saved.skillView }, saved.listViews),
  foldedGroups: new Set(saved.foldedGroups || []),
  repoSort: saved.repoSort || 'recent',
  mcpInfo: {},
  mcpBusy: {},
  checks: {},
  page: undefined,
  fleet: undefined,
  effective: {},
  ruleInfo: {},
  usage: {},
  markets: undefined,
  init: undefined,
  sessions: {},
  allSessions: new Set(),
  session: undefined,
  sessionView: saved.sessionView || 'timeline',
  decisionMode: saved.decisionView || 'timeline',
  mapMode: saved.mapMode || 'timeline',
  mapPrompts: saved.mapPrompts === true,
  mapMods: saved.mapMods !== false,
  billing: saved.billing || 'api',
  styleModel: saved.styleModel || 'sonnet',
  reviewTab: saved.reviewTab || '',
  repoTab: saved.repoTab || 'overview',
  overviewTab: saved.overviewTab || 'sessions',
  detailMode: saved.detailMode || 'view',
  detailTabs: saved.detailTabs || {},
  history: [],
};

export const app = document.getElementById('app') as HTMLElement;

export const persist = () => vscode.setState({ filter: state.filter, expanded: [...state.expanded], openRepos: [...state.openRepos], listViews: state.listViews, foldedGroups: [...state.foldedGroups], repoSort: state.repoSort, sessionView: state.sessionView, decisionView: state.decisionMode, mapMode: state.mapMode, mapPrompts: state.mapPrompts, mapMods: state.mapMods, billing: state.billing, styleModel: state.styleModel, reviewTab: state.reviewTab, repoTab: state.repoTab, overviewTab: state.overviewTab, detailMode: state.detailMode, detailTabs: state.detailTabs });

export const SOURCES = {
  user: { icon: 'account', label: 'Your config (~/.claude.json)' },
  local: { icon: 'lock', label: 'Local to this repo (~/.claude.json)' },
  project: { icon: 'repo', label: 'Repo .mcp.json' },
  'claude.ai': { icon: 'cloud', label: 'claude.ai connector' },
  plugin: { icon: 'extensions', label: 'Plugin' },
};

export const SOURCE_ORDER = Object.keys(SOURCES);

export const labelOf = a =>
  a.kind !== 'mcp' ? a.name : a.source === 'claude.ai' ? a.name.replace(/^claude\.ai /, '') : a.source === 'plugin' ? a.name.split(':').slice(2).join(':') : a.name;

export const pluginOf = a => (a.source === 'plugin' ? a.name.split(':')[1] : '');

// A server's error or status text as one reader line: a repeated code prefix reads once ("ECONNREFUSED: ECONNREFUSED: x"), and the
// user's profile folder is shortened to ~ (an npm log prints the whole path).
export const tidyError = text =>
  String(text || '')
    .replace(/\b([A-Z][A-Z0-9_]{2,}):\s+\1:\s*/g, '$1: ')
    .replace(/[a-z]:[\\/]users[\\/][^\\/\s"')]+/gi, '~')
    .replace(/(^|[\s"'(])\/(?:home|Users)\/[^/\s"')]+/g, '$1~');

// An enabled server that did not connect: an error, where a server that only needs a sign-in is a warning.
export const mcpFailed = a => a.enabled !== false && /fail|refused|econn|timed? ?out|exited|error/i.test(a.status || '');

export const mcpDesc = a => [pluginOf(a) && pluginLabel(pluginOf(a)), a.enabled === false ? 'off' : a.offIn ? `off in ${plural(a.offIn, 'folder')}` : '', tidyError(a.status) || a.target].filter(Boolean).join(' · ');

// A global item with a copy in a repo reads as the global one; a repo's own item keeps "also in".
export const copiesText = a =>
  a.copies && a.copies.length ? `${state.views[0] && a.scope === state.views[0].id ? 'global, with a copy in' : 'also in'} ${a.copies.map(c => `${c.label} (${c.same ? 'identical' : 'differs'})`).join(', ')}` : '';

export const assetDesc = a => [a.version && `v${a.version}`, copiesText(a), a.description].filter(Boolean).join(' · ');

export const statusRank = a => (a.enabled === false ? 9 : /^connected/i.test(a.status || '') ? 0 : /auth/i.test(a.status || '') ? 1 : /not configured/i.test(a.status || '') ? 3 : 2);

export const byLabel = (a, b) => labelOf(a).localeCompare(labelOf(b)) || a.name.localeCompare(b.name);

export const SORTS = {
  name: byLabel,
  source: (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || pluginOf(a).localeCompare(pluginOf(b)) || byLabel(a, b),
  status: (a, b) => statusRank(a) - statusRank(b) || byLabel(a, b),
};

// Where an MCP server comes from: registered by hand (your config, local, .mcp.json), a claude.ai connector, or a plugin.
export const ORIGINS = [
  ['manual', 'Registered manually', 'account'],
  ['claude.ai', 'claude.ai connectors', 'cloud'],
  ['plugin', 'From plugins', 'extensions'],
];

export const originOf = a => (a.source === 'claude.ai' || a.source === 'plugin' ? a.source : 'manual');

export const mcpKey = a => labelOf(a).toLowerCase().replace(/[^a-z0-9]/g, '');

// The same server registered twice, such as a claude.ai connector and a plugin server of one name.
export const twinsOf = a => {
  if (a.kind !== 'mcp') return [];
  const view = viewOf(a.scope) || state.views[0];
  const cat = view && view.categories.find(c => c.kind === 'mcp');
  return (cat ? cat.items : []).filter(b => b !== a && mcpKey(b) === mcpKey(a) && (b.source !== a.source || pluginOf(b) !== pluginOf(a)));
};

export const sourceName = a => (a.source === 'plugin' ? pluginLabel(pluginOf(a)) : a.source === 'claude.ai' ? 'claude.ai connector' : a.source === 'project' ? '.mcp.json' : a.source === 'local' ? 'local config' : '~/.claude.json');

export const twinText = a => twinsOf(a).map(sourceName).join(', ');

export const skillPluginOf = a => (a.source === 'plugin' && String(a.scope).startsWith('plugin:') ? a.scope.slice('plugin:'.length).split('@')[0] : '');

// The folder a linked skill lives in: the repo above `.claude`, else the folder above `skills` (such as ~/.agents).
export const linkName = file => {
  const parts = String(file).split(/[\\/]/).filter(Boolean);
  const at = parts.indexOf('.claude') > 0 ? parts.indexOf('.claude') : parts.lastIndexOf('skills');
  return at > 0 ? parts[at - 1] : parts.slice(-2, -1).join('');
};

export const pluginLabel = name => `${name.replace(/-plugin$/, '')} plugin`;

// The second line of a skill row: facts only, never the trigger-phrase description (that is in the hover card).
export const skillByline = a =>
  [
    skillPluginOf(a) && pluginLabel(skillPluginOf(a)),
    a.link && `linked from ${linkName(a.link)}`,
    a.version && `v${a.version}`,
    (a.files || []).length > 1 && `${a.files.length} files`,
    copiesText(a),
  ]
    .filter(Boolean)
    .join(' · ');

export const byName = (a, b) => a.name.localeCompare(b.name);

export const byRecent = (a, b) => (b.mtime || 0) - (a.mtime || 0) || byName(a, b);

export const RULE_GROUPS = [
  ['always', 'Always loaded', 'law'],
  ['scoped', 'Path-scoped', 'filter'],
];

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Notification', 'SubagentStop', 'Stop', 'PreCompact', 'SessionEnd'];

export const eventOf = a => a.name.split(' · ')[0];

export const eventRank = e => (HOOK_EVENTS.includes(e) ? HOOK_EVENTS.indexOf(e) : HOOK_EVENTS.length);

export const marketOf = a => a.name.split('@')[1] || 'local';

// Where an item lives, which decides where it loads: Global, an enabled plugin, a claude.ai connector, or a repo.
export const whereOf = a => (a.source === 'plugin' || a.source === 'claude.ai' ? a.source : a.scope);

// Global first, then the connectors and plugins it loads, then the repos in the sidebar's order, the open workspace first.
export const whereGroups = items => {
  const ids = new Set(items.map(whereOf));
  const [global, ...repos] = state.views;
  const known = [
    global && [global.id, global.label, 'globe'],
    ['claude.ai', 'claude.ai connectors', 'cloud'],
    ['plugin', 'From plugins', 'extensions'],
    ...repos.map(v => [v.id, v.local ? `This repo · ${v.label}` : v.label, 'repo']),
  ].filter(Boolean);
  const rest = [...ids].filter(id => !known.some(g => g[0] === id)).map(id => [id, (viewOf(id) || { label: id }).label, 'folder']);
  return [...known.filter(g => ids.has(g[0])), ...rest];
};

const where = within => ({ of: whereOf, groups: whereGroups, within });

const byPlugin = (a, b) => skillPluginOf(a).localeCompare(skillPluginOf(b)) || byName(a, b);

const mcpOrder = (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || pluginOf(a).localeCompare(pluginOf(b)) || byLabel(a, b);

// Grouped lists, in the sidebar and on the type pages. Per grouping, `of` names an item's group, `groups(items)` lists
// the groups in order as [id, label, glyph], `within` orders a group. A list starts on `group`; the View: picker offers
// every grouping, then each sort.
export const LIST_VIEWS = {
  mcp: { group: 'where', groupings: { where: where(mcpOrder), origin: { of: originOf, groups: () => ORIGINS, within: mcpOrder } }, sorts: { name: SORTS.name, status: SORTS.status } },
  skill: { group: 'where', groupings: { where: where(byPlugin) }, sorts: { name: byName, recent: byRecent } },
  agent: { group: 'where', groupings: { where: where(byPlugin) }, sorts: { name: byName, recent: byRecent } },
  command: { group: 'where', groupings: { where: where(byName) }, sorts: {} },
  rule: {
    group: 'where',
    groupings: { where: where(byName), loading: { of: a => (a.meta && a.meta.paths ? 'scoped' : 'always'), groups: () => RULE_GROUPS, within: byName } },
    sorts: { name: byName, recent: byRecent },
  },
  outputStyle: { group: 'where', groupings: { where: where(byName) }, sorts: {} },
  workflow: { group: 'where', groupings: { where: where(byName) }, sorts: {} },
  hookScript: { group: 'where', groupings: { where: where(byName) }, sorts: {} },
  hook: {
    group: 'where',
    groupings: {
      where: where(byName),
      event: { of: eventOf, groups: items => [...new Set(items.map(eventOf))].sort((x, y) => eventRank(x) - eventRank(y) || x.localeCompare(y)).map(e => [e, e, 'zap']), within: byName },
    },
    sorts: { name: byName },
  },
  plugin: {
    group: 'marketplace',
    groupings: { marketplace: { of: marketOf, groups: items => [...new Set(items.map(marketOf))].sort().map(m => [m, m, 'package']), within: byName } },
    sorts: { name: byName, state: (a, b) => Number(!!b.enabled) - Number(!!a.enabled) || byName(a, b) },
  },
};

export const listModes = kind => [...Object.keys(LIST_VIEWS[kind].groupings), ...Object.keys(LIST_VIEWS[kind].sorts)];

export const listMode = kind => (listModes(kind).includes(state.listViews[kind]) ? state.listViews[kind] : LIST_VIEWS[kind].group);

export const isGrouped = kind => !!LIST_VIEWS[kind] && !!LIST_VIEWS[kind].groupings[listMode(kind)];

// The grouping in use; a sorted list still groups on its type page, by the grouping it starts on.
const groupingOf = kind => LIST_VIEWS[kind].groupings[isGrouped(kind) ? listMode(kind) : LIST_VIEWS[kind].group];

// Groups present in a list, each with its items in order: [[id, label, glyph], items][].
export const groupItems = (kind, items, of = x => x) => {
  const g = groupingOf(kind);
  return g
    .groups(items.map(of))
    .map(head => [head, items.filter(x => g.of(of(x)) === head[0]).sort((x, y) => g.within(of(x), of(y)))])
    .filter(group => group[1].length);
};

export const sortList = (kind, items) => {
  if (!LIST_VIEWS[kind]) return items;
  if (!isGrouped(kind)) return items.sort(LIST_VIEWS[kind].sorts[listMode(kind)]);
  return groupItems(kind, items).flatMap(g => g[1]);
};

// What a plugin ships is read-only: an update overwrites the installed copy.
export const readOnly = a => !!a && (a.source === 'plugin' || String(a.scope).startsWith('plugin:'));

export const editable = () => state.detail && ['markdown', 'code', 'settings'].includes(state.detail.mode) && !readOnly(state.detail.asset);

export const snapshot = d => JSON.stringify({ fields: d.fields, body: d.body });

export const isDirty = () => !!(state.draft && state.detail && snapshot(state.draft) !== snapshot(state.detail));

export const pending = () => (isDirty() ? { id: state.detail.asset.id, fields: state.draft.fields, body: state.draft.body } : undefined);

export const categoryOf = kind => (state.views[0] ? state.views[0].categories.find(c => c.kind === kind) : undefined);

export const viewOf = id => state.views.find(v => v.id === id);

export const RENAMABLE = ['agent', 'skill', 'command', 'outputStyle', 'rule', 'workflow'];

export const TOOL_FIELDS = ['tools', 'disallowedTools', 'allowed-tools'];

export const MODELS = ['inherit', 'sonnet', 'opus', 'haiku', 'fable'];

// Opening an element from a list starts a fresh trail; following a reference (refs.ts goTo) extends it.
export const select = id => {
  if (state.detail && state.detail.asset.id === id) return;
  state.history = [];
  vscode.postMessage({ type: 'select', id, pending: pending() });
};

export const showRepo = id => {
  state.repo = id;
  state.page = undefined;
  if (id) state.effective[id] = undefined;
  if (id) state.sessions[id] = undefined;
  if (state.detail) select(undefined);
  else render();
};

export const showPage = (page, extra) => {
  state.page = page;
  state.repo = undefined;
  if (page === 'init') state.init = { dir: extra, form: { summary: '', areas: [{ name: '', globs: '', owner: '' }], rules: '' }, data: undefined, result: undefined };
  if (page === 'fleet') vscode.postMessage({ type: 'fleet' });
  if (page === 'marketplaces') vscode.postMessage({ type: 'marketplaces' });
  if (page === 'init') vscode.postMessage({ type: 'initForm', dir: extra });
  if (state.detail) select(undefined);
  else render();
};

export const CHECK = {
  pass: ['pass', 'ok', 'Passes the harness standard'],
  fail: ['error', 'bad', 'Fails the harness standard'],
  review: ['warning', 'warn', 'Lines to review'],
  running: ['sync', 'muted', 'Checking...'],
  error: ['circle-slash', 'bad', 'Check failed'],
  'no-plugin': ['circle-slash', 'muted', 'No provider plugin'],
  'no-python': ['circle-slash', 'muted', 'Python 3 not found'],
};

export const checkText = c =>
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

export const std = feature => (state.standard && (!feature || state.standard[feature]) ? state.standard : undefined);

export const checkBadge = c => {
  if (!c || !CHECK[c.state]) return null;
  const [glyph, tone, title] = CHECK[c.state];
  return el('span', { className: `check-badge ${tone}`, title: c.error || `${title}${c.fail !== undefined ? ` (fail ${c.fail}, review ${c.review})` : ''}` }, icon(glyph));
};

export const command = (cmd, extra) => vscode.postMessage(Object.assign({ type: 'command', command: cmd }, extra));

export const save = () => {
  if (isDirty()) vscode.postMessage({ type: 'save', pending: pending() });
};

export const matches = (a, q) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || (a.about || '').toLowerCase().includes(q);

export const total = view => view.categories.reduce((n, c) => n + c.items.length, 0);

export const singular = cat => cat.label.replace(/s$/, '');

export const kindLabel = kind => (categoryOf(kind) ? singular(categoryOf(kind)) : kind);

// Type pages: every element of one kind in a table, narrowed by a search, preset filters and facets.
export const metaOf = a => a.meta || {};

export const openAt = (file, line) => vscode.postMessage({ type: 'openAt', file, line });

// Claude Code's agent colors; an agent definition's `color` field or a teammate's spawn color wins over the palette.
export const AGENT_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];

/** A color code the picker accepts and the file keeps: #rgb or #rrggbb. */
export const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// A color that is not one of the eight names (a hex code, a CSS color name) is drawn as itself: the page style sheet gets
// one rule per value, the same declarations the .ac-* rules have, so every surface that puts a class on a mark paints it.
// A constructed style sheet, because the page's CSP allows no inline style.
let customSheet;
const customDone = new Set();

/** The class that paints an agent's color: `ac-<name>` for the eight, `ac-x-<value>` for any other color; '' when it is no color. */
export const agentColorClass = value => {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!v) return '';
  if (AGENT_COLORS.includes(v)) return `ac-${v}`;
  if (!HEX_COLOR.test(v) && !(/^[a-z]+$/.test(v) && CSS.supports('color', v))) return '';
  const cls = `ac-x-${v.replace('#', 'h')}`;
  if (!customDone.has(cls)) {
    customDone.add(cls);
    if (!customSheet) {
      customSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, customSheet];
    }
    customSheet.insertRule(`.tl .${cls}, .swatch.${cls} { --tone: ${v}; fill: ${v}; stroke: ${v}; background: ${v}; }`, customSheet.cssRules.length);
  }
  return cls;
};
