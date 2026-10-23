// View mode of the detail page: one harness element as a small dashboard in the session page's card language.
// A summary card (what it is, where it comes from, what it says, its frontmatter as chips) and KPI tiles on what it
// costs in context sit on top; below them one view at a time behind tabs: the document, references, files, connections, tools.
import type { Asset, ScopeView } from '../harness';
import type { Detail } from '../shared/messages';
import { agentColorClass, command, kindLabel, labelOf, metaOf, openAt, persist, pluginOf, skillPluginOf, sourceName, state, viewOf, vscode } from './core';
import { renderRuleInfo } from './detail';
import { el, icon, plural } from './dom';
import { hideHover } from './hover';
import { mcpStatusWord } from './kind-page';
import { renderMain } from './main';
import { renderMarkdown } from './markdown';
import type { MdHeading } from './markdown';
import { fmtTokens, mentionedBy, mentionsOf, originText, refChip, refRow, resolve, resolveSpan, splitDescription, tokens } from './refs';
import type { Entry } from './refs';
import { tabBar } from './repo-page';
import type { Draft } from './state';
import { groupHead } from './tables';
import { askUsage, usageTab } from './usage-tab';

type Child = Node | string | null | undefined | false | Child[];

export interface Tab {
  id: string;
  label: string;
  glyph: string;
  about: string;
  count?: number | string;
  body: () => Child;
  /** Runs when the reader picks the tab. */
  onOpen?: () => void;
  /** Its count and body change when data arrives later; see refreshUsage. */
  live?: boolean;
}

// The tab bar and panel of the page on screen when one of its tabs is live.
let redrawLive: (() => void) | undefined;

/** Where the element was used arrived: the Used in badge, and the list when that tab is open, update in place. */
export const refreshUsage = () => redrawLive?.();

// The views under the top info, one at a time behind a tab bar, the way the session page groups its delegation
// views. The tab is remembered per kind; switching swaps the panel in place so the page keeps its scroll.
function tabbed(a: Asset, tabs: (Tab | null)[]): HTMLElement {
  const list = tabs.filter((t): t is Tab => !!t);
  const current = () => list.find(t => t.id === state.detailTabs[a.kind]) || list[0];
  const panelOf = () => el('div', { className: 'dv-panel', role: 'tabpanel' }, ([current().body()] as unknown[]).flat(Infinity));
  const barOf = () => tabBar(list.map(t => [t.id, t.label, t.glyph, t.about, t.count]), current().id, pick, `${kindLabel(a.kind)} views`);
  let bar = list.length > 1 ? barOf() : null;
  let panel = panelOf();
  if (list.some(t => t.live))
    redrawLive = () => {
      if (!panel.isConnected) return;
      const focused = !!bar && bar.contains(document.activeElement);
      const nextBar = barOf();
      bar?.replaceWith(nextBar);
      bar = nextBar;
      if (current().live) {
        const nextPanel = panelOf();
        panel.replaceWith(nextPanel);
        panel = nextPanel;
      }
      if (focused) (bar.querySelector('.view-tab.active') as HTMLElement | null)?.focus();
    };
  function pick(id: string, focus?: boolean) {
    list.find(t => t.id === id)?.onOpen?.();
    state.detailTabs[a.kind] = id;
    persist();
    hideHover();
    const nextBar = barOf();
    const nextPanel = panelOf();
    bar?.replaceWith(nextBar);
    panel.replaceWith(nextPanel);
    bar = nextBar;
    panel = nextPanel;
    if (focus) (bar.querySelector('.view-tab.active') as HTMLElement | null)?.focus();
  }
  return el('div', { className: 'recent dv-tabs' }, el('div', { className: 'group-label' }, 'Contents'), bar, panel);
}

// `el` flattens one level only; a card body nests groups of rows, so it is flattened fully first.
export const card = (title: string, count: number | string | null, ...body: Child[]) =>
  el('section', { className: 'dv-card' }, el('div', { className: 'dv-card-head' }, el('span', { className: 'dv-card-title' }, title), count === null ? null : el('span', { className: 'dv-count' }, String(count))), (body as unknown[]).flat(Infinity));

const tile = (n: string, label: string, glyph: string, note: string, tone?: string) =>
  el('div', { className: 'tile static' }, el('span', { className: 'n' }, n), el('span', { className: 'l' }, icon(glyph), label), el('span', { className: `kpi-note${tone ? ` ${tone}` : ''}` }, note));

const chip = (glyph: string | null, label: string, value?: string, title?: string, extra = '') =>
  el('span', { className: `dv-chip${extra ? ` ${extra}` : ''}`, title }, glyph ? icon(glyph) : null, value === undefined ? label : [el('span', { className: 'k' }, label), value]);

const fieldOf = (draft: Draft, key: string) => draft.fields.find(f => f.key === key)?.value;
const listField = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[,\n]/) : []).map(s => s.trim()).filter(Boolean);
const lines = (text: string) => (text ? text.split('\n').length : 0);
const words = (text: string) => (text.match(/\S+/g) || []).length;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The description, clamped when long, with a toggle that keeps the layout from jumping.
function descBlock(text: string): HTMLElement {
  const p = el('p', { className: 'dv-desc' }, text);
  if (text.length < 360) return p;
  p.classList.add('clamped');
  const toggle = el('button', { type: 'button', className: 'link dv-more', 'aria-expanded': 'false' }, 'Show more');
  toggle.addEventListener('click', () => {
    const open = p.classList.toggle('clamped') === false;
    toggle.textContent = open ? 'Show less' : 'Show more';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  return el('div', {}, p, toggle);
}

// Trigger phrases and example tasks as chips; past twelve, a "+N more" chip opens the rest.
function phraseGroup(label: string, phrases: string[]): HTMLElement {
  const shown = 12;
  const chips = phrases.map((t, i) => el('span', { className: `dv-phrase${i >= shown ? ' extra' : ''}` }, t));
  const box = el('div', { className: 'dv-phrases collapsed' }, el('span', { className: 'dv-phrases-label' }, label), chips);
  if (phrases.length > shown) {
    const more = el('button', { type: 'button', className: 'dv-phrase more', 'aria-expanded': 'false' }, `+${phrases.length - shown} more`);
    more.addEventListener('click', () => {
      box.classList.remove('collapsed');
      more.remove();
    });
    box.append(more);
  }
  return box;
}

const DONE_KEYS = new Set(['name', 'description', 'tools', 'allowed-tools', 'disallowedTools', 'skills', 'version', 'metadata']);

// Frontmatter as chips, each in words a reader understands at a glance.
function factChips(a: Asset, draft: Draft): HTMLElement | null {
  const chips: HTMLElement[] = [];
  for (const f of draft.fields) {
    if (DONE_KEYS.has(f.key)) continue;
    const v = f.value;
    const text = String(v);
    if (f.key === 'model') chips.push(chip('chip', 'Model', text));
    else if (f.key === 'color') chips.push(el('span', { className: 'dv-chip' }, el('span', { className: `swatch dv-dot ${agentColorClass(text)}` }), el('span', { className: 'k' }, 'Color'), text));
    else if (f.key === 'disable-model-invocation') chips.push(v === true ? chip('lock', 'Manual only', undefined, 'Claude never starts it on its own; only you can, by name.') : chip('unlock', 'Model can invoke'));
    else if (f.key === 'user-invocable') chips.push(v === false ? chip('eye-closed', 'Hidden from the / menu') : chip('eye', 'In the / menu'));
    else if (f.key === 'keep-coding-instructions') chips.push(chip('code', v === true ? 'Keeps coding instructions' : 'Replaces coding instructions'));
    else if (f.key === 'agent') {
      const e = resolve(text, a);
      chips.push(el('span', { className: 'dv-chip' }, icon('hubot'), el('span', { className: 'k' }, 'Runs in'), e ? refChip(e) : text));
    } else if (f.key === 'paths') chips.push(chip('filter', 'Paths', String(listField(v).length || 1), listField(v).join('\n')));
    else if (f.key === 'argument-hint') chips.push(chip('symbol-parameter', 'Arguments', text));
    else if (f.key === 'license') chips.push(chip('law', 'License', text));
    else chips.push(chip(null, f.key, text.length > 40 ? `${text.slice(0, 37)}...` : text, text.length > 40 ? text : undefined));
  }
  const version = fieldOf(draft, 'version');
  if (version) chips.unshift(chip('tag', 'Version', String(version)));
  return chips.length ? el('div', { className: 'dv-chips' }, chips) : null;
}

function hero(a: Asset, v: ScopeView | undefined, draft: Draft | undefined, description: string, extra: Child[] = []): HTMLElement {
  const { text, groups } = splitDescription(description);
  const missing = !text && ['skill', 'agent', 'command'].includes(a.kind);
  const repo = v && v.id !== 'global' ? v.label : '';
  // Memory and rules have no description: say when Claude reads them instead.
  const when =
    a.kind === 'memory'
      ? repo
        ? `Loaded into every session in ${repo}, before the first prompt.`
        : 'Loaded into every Claude Code session on this machine, before the first prompt.'
      : a.kind === 'rule'
        ? metaOf(a).paths
          ? 'Loaded when Claude reads a file that matches its paths.'
          : `Loaded into every session${repo ? ` in ${repo}` : ''}, like memory.`
        : '';
  return el(
    'section',
    { className: 'dv-hero' },
    el('div', { className: 'dv-kicker' }, el('span', {}, kindLabel(a.kind)), el('span', { className: 'dv-origin' }, originText(a, v))),
    text ? descBlock(text) : when ? el('p', { className: 'dv-desc' }, when) : el('p', { className: `dv-desc muted${missing ? ' warn' : ''}` }, missing ? 'No description, so Claude cannot tell when to use it.' : 'No description.'),
    groups.map(([label, phrases]) => phraseGroup(label, phrases)),
    draft ? factChips(a, draft) : null,
    extra
  );
}

// A reference list: rows that hover-preview and open the element.
const refList = (entries: Entry[], empty: string) => (entries.length ? el('div', { className: 'ref-list' }, entries.map(refRow)) : el('div', { className: 'dv-empty' }, empty));

// A permission rule like `Bash(git:*)` reads as the tool and, muted, what it is limited to.
const toolChip = (t: string) => {
  const m = /^([^(]+)\((.*)\)$/.exec(t);
  return el('span', { className: 'dv-tool' }, m ? [m[1], el('span', { className: 'dv-tool-arg' }, m[2])] : t);
};

// Tools grouped the way a reader thinks of them: Claude's own tools, then each MCP server's.
function toolGroups(tools: string[]): HTMLElement[] {
  const groups = new Map<string, string[]>();
  for (const t of tools) {
    const m = /^mcp__(.+?)__(.+)$/.exec(t);
    const key = m ? m[1] : '';
    groups.set(key, [...(groups.get(key) || []), m ? m[2] : t]);
  }
  const mcpServer = (key: string) =>
    state.views
      .flatMap(view => (view.categories.find(c => c.kind === 'mcp')?.items || []).map(x => ({ a: x, v: view })))
      .find(e => labelOf(e.a).replace(/[^A-Za-z0-9_-]/g, '_') === key || e.a.name.replace(/[^A-Za-z0-9_-]/g, '_') === key);
  const section = (key: string, names: string[]) => {
    const server = key ? mcpServer(key) : undefined;
    return el(
      'div',
      { className: 'dv-tools' },
      el(
        'div',
        { className: 'dv-tools-head' },
        icon(key ? 'server' : 'tools'),
        server ? refChip(server, key) : el('span', {}, key || 'Claude Code'),
        el('span', { className: 'dv-count' }, String(names.length))
      ),
      el('div', { className: 'dv-tool-chips' }, names.map(toolChip))
    );
  };
  const order = [...groups.keys()].sort((x, y) => (x ? 1 : 0) - (y ? 1 : 0) || x.localeCompare(y));
  return order.map(k => section(k, groups.get(k) as string[]));
}

function toolsCard(a: Asset, tools: string[], blocked: string[]): HTMLElement {
  if (!tools.length && !blocked.length)
    return card('Tools', 'all', el('div', { className: 'dv-empty' }, `Inherits every tool of the session${a.kind === 'agent' ? ' that starts it' : ''}.`));
  return card(
    'Tools',
    tools.length,
    toolGroups(tools),
    blocked.length ? el('div', { className: 'dv-tools blocked' }, el('div', { className: 'dv-tools-head' }, icon('circle-slash'), el('span', {}, 'Blocked'), el('span', { className: 'dv-count' }, String(blocked.length))), el('div', { className: 'dv-tool-chips' }, blocked.map(n => el('span', { className: 'dv-tool' }, n)))) : null
  );
}

// Claude Code's own tools, counted when the text names one in a code span or as "the Read tool"; MCP tools by full name.
const BUILTIN_TOOLS = 'Agent|AskUserQuestion|Bash|CronCreate|Edit|EnterPlanMode|EnterWorktree|ExitPlanMode|Glob|Grep|LSP|Monitor|MultiEdit|NotebookEdit|PowerShell|Read|SendMessage|Skill|Task|TaskStop|TodoWrite|ToolSearch|WebFetch|WebSearch|Workflow|Write';
const NAMED_TOOL = new RegExp('`(' + BUILTIN_TOOLS + ')(?:\\([^`]*\\))?`|\\b(' + BUILTIN_TOOLS + ') tool\\b|\\b(mcp__[A-Za-z0-9_-]+?__[A-Za-z0-9_*-]+)', 'g');
const namedTools = (body: string) => [...new Set([...body.matchAll(NAMED_TOOL)].map(m => m[1] || m[2] || m[3]))];

// A skill's or command's allowed-tools only pre-approves: every other tool stays available under the permission
// settings. So the tab shows that list beside the tools the instructions name, and the agent's tools when it runs forked.
function allowedToolsCard(a: Asset, allowed: string[], named: string[], draft: Draft): HTMLElement {
  const skill = a.kind === 'skill';
  const fork = fieldOf(draft, 'context') === 'fork';
  const agentName = String(fieldOf(draft, 'agent') ?? 'general-purpose');
  const agent = resolve(agentName, a, 'agent');
  const agentTools = agent ? metaOf(agent.a).tools || [] : [];
  return el(
    'div',
    { className: 'dv-columns' },
    card(
      'Pre-approved',
      allowed.length,
      allowed.length
        ? [el('p', { className: 'dv-note' }, `Run without a permission prompt while the ${skill ? 'skill is active' : 'command runs'}. Every other tool stays available under your permission settings.`), toolGroups(allowed)]
        : el('div', { className: 'dv-empty' }, 'None. Claude asks before any tool your permission settings do not already allow.')
    ),
    card(skill ? 'Named in SKILL.md' : 'Named in the prompt', named.length, named.length ? toolGroups(named) : el('div', { className: 'dv-empty' }, `The ${skill ? 'instructions name' : 'prompt names'} no tool.`)),
    fork
      ? card(
          'Runs in',
          null,
          el('div', { className: 'dv-tools-head' }, icon('hubot'), agent ? refChip(agent) : el('span', {}, agentName)),
          el('p', { className: 'dv-note' }, !agent ? 'A forked subagent of this built-in type, with its own tool set.' : agentTools.length ? "A forked subagent, limited to this agent's tools:" : 'A forked subagent that inherits every tool of the session.'),
          agentTools.length ? toolGroups(agentTools) : null
        )
      : null
  );
}

const FILE_ICONS: [RegExp, string][] = [
  [/\.md$/i, 'markdown'],
  [/\.(py|js|mjs|cjs|ts|ps1|sh|cs)$/i, 'file-code'],
  [/\.(json|ya?ml|toml)$/i, 'json'],
  [/\.(png|jpe?g|webp|gif|svg)$/i, 'file-media'],
];

// A path in the document that is one of the skill's own files: opens it in the editor.
const fileChip = (a: Asset, rel: string) =>
  el('button', { type: 'button', className: 'ref ref-file', title: `Open ${rel}`, onclick: () => command('openFile', { id: a.id, rel }) }, icon((FILE_ICONS.find(([re]) => re.test(rel)) || [null, 'file'])[1] as string), el('span', {}, rel));

// Markdown beside SKILL.md that Claude reads when the instructions send it there; templates, assets, examples and
// evals are plain files.
const isReference = (f: string) => f !== 'SKILL.md' && /\.md$/i.test(f) && !/^(templates|assets|examples|evals?)\//i.test(f);

// A skill's files under one collapsible header per top folder; a click opens the file.
function filesCard(a: Asset, title: string, files: string[]): HTMLElement | null {
  if (!files.length) return null;
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const top = f.includes('/') ? f.split('/')[0] : '';
    groups.set(top, [...(groups.get(top) || []), f]);
  }
  const order = [...groups.keys()].sort((x, y) => (x ? 0 : 1) - (y ? 0 : 1) || x.localeCompare(y));
  const row = (f: string, top: string) =>
    el('button', { type: 'button', className: 'dv-file', title: f, onclick: () => command('openFile', { id: a.id, rel: f }) }, icon((FILE_ICONS.find(([re]) => re.test(f)) || [null, 'file'])[1] as string), el('span', {}, top ? f.slice(top.length + 1) : f));
  return card(
    title,
    files.length,
    order.map(top => {
      const list = groups.get(top) as string[];
      if (!top || order.length === 1) return list.map(f => row(f, order.length === 1 ? top : ''));
      const key = `${title.toLowerCase()}|${a.id}|${top}`;
      const folded = state.foldedGroups.has(key);
      return [groupHead('origin-label dv-folder', key, folded, 'folder', top, list.length, renderMain), folded ? null : list.map(f => row(f, top))];
    })
  );
}

function outlineCard(headings: MdHeading[]): HTMLElement | null {
  const list = headings.filter(h => h.level <= 3);
  if (list.length < 3) return null;
  const top = Math.min(...list.map(h => h.level));
  return card(
    'Outline',
    null,
    el(
      'nav',
      { className: 'dv-outline', 'aria-label': 'Outline' },
      list.map(h =>
        el(
          'button',
          {
            type: 'button',
            className: `dv-outline-item depth-${h.level - top}`,
            onclick: () => document.getElementById(h.id)?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }),
          },
          h.text
        )
      )
    )
  );
}

// Relative links open the file they point at, beside the element's own file.
function linkHook(a: Asset) {
  return (href: string, ev: MouseEvent): boolean => {
    if (/^https?:/i.test(href)) return false;
    ev.preventDefault();
    if (href.startsWith('#')) {
      document.getElementById(`md-${href.slice(1)}`)?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      return true;
    }
    const rel = href.split('#')[0];
    if (a.dir && !/^[\\/]|^[a-z]:/i.test(rel)) command('openFile', { id: a.id, rel: normalize(rel) });
    else {
      const abs = normalize(/^[\\/]|^[a-z]:/i.test(rel) ? rel : `${a.file.replace(/[\\/][^\\/]*$/, '')}/${rel}`);
      openAt(/^[a-z]:/i.test(abs) ? abs : `/${abs}`, undefined);
    }
    return true;
  };
}

const normalize = (rel: string) => {
  const out: string[] = [];
  for (const part of rel.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
};

const DOC_TITLE: Record<string, string> = { skill: 'Instructions', agent: 'System prompt', command: 'Prompt', rule: 'Rule', memory: 'Memory', outputStyle: 'Style' };
const DOC_ABOUT: Record<string, string> = {
  skill: 'SKILL.md as Claude reads it when the skill runs.',
  agent: 'The system prompt the agent starts with.',
  command: 'The prompt the command sends.',
  rule: 'The rule as Claude reads it.',
  memory: 'The file as every session here reads it.',
  outputStyle: 'The style that replaces the default one.',
};

function docCard(a: Asset, body: string, doc: HTMLElement): HTMLElement {
  const edit = el('button', { type: 'button', className: 'link', onclick: () => setMode('edit') }, icon('edit'), 'Edit');
  return el(
    'section',
    { className: 'dv-card dv-doc' },
    el(
      'div',
      { className: 'dv-card-head' },
      el('span', { className: 'dv-card-title' }, DOC_TITLE[a.kind] || 'Content'),
      el('span', { className: 'dv-count' }, `${plural(lines(body), 'line')} · ${plural(words(body), 'word')} · ${fmtTokens(tokens(body))} tokens`),
      el('span', { className: 'dv-spacer' }),
      edit
    ),
    body.trim() ? doc : el('div', { className: 'dv-empty' }, 'Empty.')
  );
}

export function setMode(mode: 'view' | 'edit') {
  state.detailMode = mode;
  persist();
  renderMain();
}

// What it costs in context: the description sits in every session's list; the body loads when it is used.
function kpisFor(a: Asset, draft: Draft, description: string, mentions: Entry[], mentioned: Entry[], tools: string[]): HTMLElement {
  const body = draft.body;
  const desc = `${fmtTokens(tokens(description))} tokens`;
  const connections = tile(String(mentions.length + mentioned.length), 'Connections', 'references', `refers to ${mentions.length} · referred to by ${mentioned.length}`);
  const toolTile = tile(tools.length ? String(tools.length) : 'All', 'Tools', 'tools', tools.length ? `${tools.filter(t => t.startsWith('mcp__')).length} from MCP servers` : 'no tools list: inherits all');
  const always = metaOf(a).paths ? false : true;
  const set: Record<string, HTMLElement[]> = {
    skill: [
      tile(desc.replace(' tokens', ''), 'Always loaded', 'layers', 'tokens: the description, in every session'),
      tile(fmtTokens(tokens(body)), 'On use', 'play', 'tokens: SKILL.md when the skill runs'),
      tile(String(Math.max(1, (a.files || []).length)), 'Files', 'files', `${(a.files || []).filter(isReference).length} references · ${(a.files || []).filter(f => /^scripts\//.test(f)).length} scripts`),
      connections,
    ],
    agent: [tile(desc.replace(' tokens', ''), 'Always loaded', 'layers', 'tokens: the description, in the agent list'), tile(fmtTokens(tokens(body)), 'System prompt', 'hubot', 'tokens, when the agent starts'), toolTile, connections],
    command: [tile(desc.replace(' tokens', ''), 'Always loaded', 'layers', 'tokens: the description'), tile(fmtTokens(tokens(body)), 'On use', 'play', `tokens, when you run /${a.name}`), tile(String(tools.length), 'Pre-approved', 'tools', 'tools that run without asking'), connections],
    rule: [
      tile(always ? 'Always' : 'On match', 'Loads', 'law', always ? 'in every session' : 'when Claude reads a matching file'),
      tile(fmtTokens(tokens(body)), 'Size', 'symbol-ruler', 'tokens'),
      tile(String((metaOf(a).paths || []).length), 'Paths', 'filter', 'globs in the frontmatter'),
      connections,
    ],
    memory: [
      tile(fmtTokens(tokens(body)), 'Always loaded', 'layers', 'tokens, in every session here'),
      tile(String(lines(body)), 'Lines', 'list-flat', `${words(body)} words`),
      tile(String((body.match(/^@\S+/gm) || []).length), 'Imports', 'references', '@-lines that pull in more files'),
      connections,
    ],
    outputStyle: [
      tile(fmtTokens(tokens(body)), 'Size', 'symbol-ruler', 'tokens, replacing the default style'),
      tile(fieldOf(draft, 'keep-coding-instructions') === true ? 'Kept' : 'Replaced', 'Coding instructions', 'code', 'of the default system prompt'),
      connections,
    ],
  };
  return el('div', { className: 'kpis' }, set[a.kind] || [connections]);
}

function markdownView(d: Detail, draft: Draft): Child[] {
  const a = d.asset;
  const v = viewOf(a.scope) || state.views[0];
  const description = String(fieldOf(draft, 'description') ?? a.description ?? '');
  const tools = listField(fieldOf(draft, 'tools') ?? fieldOf(draft, 'allowed-tools'));
  const blocked = listField(fieldOf(draft, 'disallowedTools'));
  const mentions = mentionsOf(a);
  const mentioned = mentionedBy(a);
  const files = new Set(a.files || []);
  const { node: doc, headings } = renderMarkdown(draft.body, {
    code: text => {
      const e = resolveSpan(text, a);
      if (e) return refChip(e, text);
      const rel = text.replace(/^\.\//, '');
      return files.has(rel) ? fileChip(a, rel) : undefined;
    },
    link: linkHook(a),
  });
  const skills = listField(fieldOf(draft, 'skills'));
  const outline = outlineCard(headings);
  const references = (a.files || []).filter(isReference);
  const plain = (a.files || []).filter(f => f !== 'SKILL.md' && !isReference(f));
  const paths = metaOf(a).paths || [];
  const toolsTab = { id: 'tools', label: 'Tools', glyph: 'tools', about: 'The tools it may use: Claude Code\'s own, then each MCP server\'s.', count: tools.length || 'all', body: () => toolsCard(a, tools, blocked) };
  const named = namedTools(draft.body);
  const allowedCount = new Set([...tools.map(t => t.replace(/\(.*$/, '')), ...named]).size;
  const allowedToolsTab = { id: 'tools', label: 'Tools', glyph: 'tools', about: 'The tools it runs without asking, and the ones its instructions name.', count: allowedCount || undefined, body: () => allowedToolsCard(a, tools, named, draft) };
  // Every render asks where it was used, so the badge fills in from an existing index; open on the tab, it builds one.
  const usedIn = a.kind === 'agent' || a.kind === 'skill' ? usageTab(a) : null;
  if (usedIn) askUsage(a, state.detailTabs[a.kind] === 'usage');
  return [
    hero(a, v, draft, description),
    kpisFor(a, draft, description, mentions, mentioned, tools),
    tabbed(a, [
      {
        id: 'doc',
        label: DOC_TITLE[a.kind] || 'Content',
        glyph: 'book',
        about: DOC_ABOUT[a.kind] || 'The file as Claude reads it.',
        body: () => (outline ? el('div', { className: 'dv-grid' }, el('div', { className: 'dv-main' }, docCard(a, draft.body, doc)), el('aside', { className: 'dv-side' }, outline)) : docCard(a, draft.body, doc)),
      },
      usedIn,
      a.kind === 'skill' && references.length
        ? { id: 'references', label: 'References', glyph: 'library', about: 'The markdown files beside SKILL.md that Claude reads when the instructions send it there.', count: references.length, body: () => filesCard(a, 'References', references) }
        : null,
      a.kind === 'skill' && plain.length ? { id: 'files', label: 'Files', glyph: 'files', about: 'The scripts, templates and other files beside SKILL.md.', count: plain.length, body: () => filesCard(a, 'Files', plain) } : null,
      a.kind === 'agent' ? toolsTab : a.kind === 'command' ? allowedToolsTab : null,
      skills.length
        ? {
            id: 'skills',
            label: 'Preloaded skills',
            glyph: 'mortar-board',
            about: 'Skills loaded into the agent when it starts.',
            count: skills.length,
            body: () =>
              card(
                'Preloaded skills',
                skills.length,
                el(
                  'div',
                  { className: 'ref-list' },
                  skills.map(s => {
                    const e = resolve(s, a);
                    return e ? refRow(e) : el('div', { className: 'dv-empty warn' }, `${s}: no skill with this name`);
                  })
                )
              ),
          }
        : null,
      a.kind === 'rule' ? { id: 'paths', label: 'Paths', glyph: 'filter', about: 'The globs that load the rule, and the files each one matches.', count: paths.length, body: () => card('Paths', null, renderRuleInfo(a, false)) } : null,
      {
        id: 'connections',
        label: 'Connections',
        glyph: 'references',
        about: 'The skills, agents and commands it names, and the ones that name it.',
        count: mentions.length + mentioned.length,
        body: () =>
          el(
            'div',
            { className: 'dv-columns' },
            card('Refers to', mentions.length, refList(mentions, 'Names no other skill, agent or command.')),
            card('Referred to by', mentioned.length, refList(mentioned, 'Nothing in the harness names it.'))
          ),
      },
      a.kind === 'skill' ? allowedToolsTab : null,
    ]),
  ];
}

function mcpView(d: Detail): Child[] {
  const a = d.asset;
  const v = viewOf(a.scope);
  const info = state.mcpInfo[a.id];
  const toolList = info && !info.error ? info.tools || [] : [];
  const enabled = el(
    'label',
    { className: 'dv-switch' },
    el('input', { type: 'checkbox', checked: a.enabled !== false, onchange: () => command('toggleMcp', { id: a.id }) }),
    el('span', {}, v && v.id !== 'global' ? `Enabled in ${v.label}` : 'Enabled in every folder')
  );
  const problem = info && info.error;
  const repo = v && v.id !== 'global' ? v.label : '';
  // MCP servers rarely describe themselves: say where it is registered and when Claude Code starts it.
  const where =
    a.source === 'claude.ai'
      ? 'A connector of your claude.ai account; Claude Code connects to it in every session.'
      : a.source === 'plugin'
        ? `Started by the ${pluginOf(a)} plugin in every session while the plugin is enabled.`
        : a.source === 'project'
          ? `Registered in ${repo || 'the repo'}'s .mcp.json, so everyone who clones the repo gets it.`
          : a.source === 'local'
            ? `Registered for ${repo || 'one repo'} only, in your ~/.claude.json.`
            : 'Registered in your ~/.claude.json; Claude Code starts it in every session.';
  const heroCard = hero(a, v, undefined, a.about || where, [
    el('div', { className: 'dv-chips' }, chip(null, 'Source', sourceName(a)), a.target ? chip('link', 'Address', a.target.length > 60 ? `${a.target.slice(0, 57)}...` : a.target, a.target) : null, pluginOf(a) ? chip('extensions', 'Plugin', pluginOf(a)) : null),
    el('div', { className: 'dv-actions' }, enabled, !v && a.offIn ? el('span', { className: 'dv-note' }, `Off in ${a.offIn} of ${a.folders} folders.`) : null),
    problem
      ? el(
          'div',
          { className: 'dv-notice' },
          icon('warning'),
          el('span', {}, info.error),
          info.signIn ? el('button', { className: 'primary', onclick: () => vscode.postMessage({ type: 'mcpSignIn', id: a.id }) }, icon('sign-in'), 'Sign in') : null,
          el('button', { className: 'secondary', onclick: () => vscode.postMessage({ type: 'mcpRetry', id: a.id }) }, icon('refresh'), 'Retry')
        )
      : null,
  ]);
  const word = mcpStatusWord(a);
  const kpis = el(
    'div',
    { className: 'kpis' },
    tile(word, 'Status', word === 'Connected' ? 'pass' : word === 'Off' ? 'circle-slash' : 'warning', a.status && a.status !== word ? a.status : 'from claude mcp list', word === 'Connected' || word === 'Off' ? '' : 'warn'),
    tile(info ? (info.error ? '-' : String(toolList.length)) : '...', 'Tools', 'tools', info ? (info.error ? 'the server did not answer' : `${info.server || labelOf(a)}${info.version ? ` ${info.version}` : ''}`) : 'asking the server'),
    tile(info && !info.error ? fmtTokens(toolList.reduce((n, t) => n + tokens(`${t.name} ${t.description}`), 0)) : '...', 'Tool list', 'layers', 'tokens of names and descriptions'),
    tile(v && v.id !== 'global' ? v.label : 'Global', 'Scope', v && v.id !== 'global' ? 'repo' : 'globe', sourceName(a))
  );
  const tools = () =>
    card(
      'Tools',
      info && !info.error ? toolList.length : null,
      !info
        ? el('div', { className: 'dv-empty' }, 'Asking the server for its tools...')
        : info.error
          ? el('div', { className: 'dv-empty' }, 'No tool list while the server does not answer.')
          : el('div', { className: 'dv-tool-cards' }, toolList.map(t => el('div', { className: 'dv-tool-card' }, el('span', { className: 'dv-tool-name' }, t.name), t.description ? el('span', { className: 'dv-tool-desc', title: t.description }, t.description) : null)))
    );
  const instructions = info && info.instructions ? info.instructions : '';
  return [
    heroCard,
    kpis,
    tabbed(a, [
      { id: 'tools', label: 'Tools', glyph: 'tools', about: 'Every tool the server offers, with the description Claude reads.', count: info && !info.error ? toolList.length : undefined, body: tools },
      instructions ? { id: 'instructions', label: 'Server instructions', glyph: 'book', about: 'What the server tells Claude about using its tools.', body: () => card('Server instructions', null, renderMarkdown(instructions).node) } : null,
      d.body ? { id: 'config', label: 'Config', glyph: 'json', about: 'The entry that registers the server.', body: () => card('Config', null, el('pre', { className: 'md-pre' }, el('code', {}, d.body))) } : null,
    ]),
  ];
}

function pluginView(d: Detail): Child[] {
  const a = d.asset;
  const [short, market] = a.name.split('@');
  const global = state.views[0];
  const items = (kind: string) => (global?.categories.find(c => c.kind === kind)?.items || []).filter(x => x.source === 'plugin' && skillPluginOf(x) === short).map(x => ({ a: x, v: global }));
  const skills = items('skill');
  const agents = items('agent');
  const servers = (global?.categories.find(c => c.kind === 'mcp')?.items || []).filter(x => pluginOf(x) === short).map(x => ({ a: x, v: global }));
  const version = a.description.split(' · ')[1] || '';
  const toggle = el(
    'label',
    { className: 'dv-switch' },
    el('input', { type: 'checkbox', checked: !!a.enabled, onchange: () => command('togglePlugin', { id: a.id }) }),
    el('span', {}, a.enabled ? 'Enabled for your user' : 'Disabled')
  );
  const heroCard = el(
    'section',
    { className: 'dv-hero' },
    el('div', { className: 'dv-kicker' }, el('span', {}, 'Plugin'), el('span', { className: 'dv-origin' }, [market ? `from ${market}` : '', version ? `v${version}` : ''].filter(Boolean).join(' · '))),
    el('p', { className: 'dv-desc' }, a.enabled ? `Adds ${[plural(skills.length, 'skill'), plural(agents.length, 'agent'), plural(servers.length, 'MCP server')].join(', ')} to every session.` : 'Disabled: none of its skills, agents or servers load. Enable it to see them here.'),
    el('div', { className: 'dv-actions' }, toggle)
  );
  return [
    heroCard,
    el('div', { className: 'kpis' }, tile(String(skills.length), 'Skills', 'mortar-board', 'in every session'), tile(String(agents.length), 'Agents', 'hubot', 'Claude can delegate to'), tile(String(servers.length), 'MCP servers', 'server', 'started with Claude Code'), tile(version || '-', 'Version', 'tag', market || '')),
    tabbed(a, [
      { id: 'skills', label: 'Skills', glyph: 'mortar-board', about: 'The skills the plugin adds to every session.', count: skills.length, body: () => card('Skills', skills.length, refList(skills, a.enabled ? 'No skills.' : 'Enable the plugin to list them.')) },
      { id: 'agents', label: 'Agents', glyph: 'hubot', about: 'The agents the plugin adds, which Claude can delegate to.', count: agents.length, body: () => card('Agents', agents.length, refList(agents, a.enabled ? 'No agents.' : 'Enable the plugin to list them.')) },
      { id: 'servers', label: 'MCP servers', glyph: 'server', about: 'The MCP servers the plugin starts with Claude Code.', count: servers.length, body: () => card('MCP servers', servers.length, refList(servers, 'No MCP servers.')) },
    ]),
  ];
}

function codeView(d: Detail, body: string): Child[] {
  const a = d.asset;
  const label = d.mode === 'settings' ? 'JSON' : d.mode === 'json' ? 'Config' : 'Script';
  return [
    el(
      'section',
      { className: 'dv-hero' },
      el('div', { className: 'dv-kicker' }, el('span', {}, kindLabel(a.kind)), el('span', { className: 'dv-origin' }, originText(a, viewOf(a.scope) || undefined))),
      a.description ? el('p', { className: 'dv-desc' }, a.description) : null
    ),
    tabbed(a, [
      {
        id: 'doc',
        label,
        glyph: 'json',
        about: '',
        body: () =>
          el(
            'section',
            { className: 'dv-card dv-doc' },
            el(
              'div',
              { className: 'dv-card-head' },
              el('span', { className: 'dv-card-title' }, label),
              el('span', { className: 'dv-count' }, plural(lines(body), 'line')),
              el('span', { className: 'dv-spacer' }),
              d.mode === 'json' ? null : el('button', { type: 'button', className: 'link', onclick: () => setMode('edit') }, icon('edit'), 'Edit')
            ),
            el('pre', { className: 'md-pre dv-code' }, el('code', {}, body))
          ),
      },
    ]),
  ];
}

/** The body of the detail page in view mode; a dirty draft renders here as its preview. */
export function renderView(d: Detail, draft: Draft | undefined): Child[] {
  if (d.mode === 'markdown') return markdownView(d, draft || { fields: d.fields, body: d.body });
  if (d.mode === 'mcp') return mcpView(d);
  if (d.mode === 'plugin') return pluginView(d);
  return codeView(d, draft ? draft.body : d.body);
}
