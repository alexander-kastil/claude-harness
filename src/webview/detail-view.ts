// View mode of the detail page: one harness element as a small dashboard in the session page's card language.
// A summary card (what it is, where it comes from, what it says, its frontmatter as chips) and KPI tiles on what it
// costs in context sit on top; below them one view at a time behind tabs: the document, references, files, connections, tools.
import type { Asset, ScopeView } from '../harness';
import type { Detail } from '../shared/messages';
import { isReference } from '../shared/slim';
import { agentColorClass, command, editable, kindLabel, labelOf, mcpFailed, metaOf, openAt, persist, pluginOf, skillPluginOf, sourceName, state, std, tidyError, viewOf, vscode } from './core';
import { cmd, cmdBox, renderRuleInfo } from './detail';
import { distNotice, updateBanner } from './dist';
import { askDrawing, drawingFigure } from './drawing';
import { aiGroup, el, fmtAgo, icon, plural } from './dom';
import { hideHover, placeCard } from './hover';
import { mcpStatusWord } from './kind-page';
import { renderMain } from './main';
import { eventsCard } from './map';
import { modActivityOf } from './trace';
import { renderMarkdown } from './markdown';
import type { MdHeading } from './markdown';
import { fmtTokens, mentionedBy, mentionsOf, originText, refChip, refRow, resolve, resolveSpan, splitDescription, tokens } from './refs';
import type { Entry } from './refs';
import { tabBar } from './repo-page';
import type { Draft } from './state';
import { askSlim, pathText, slimCard, slimOf, spreadCard, tileFlags } from './slim';
import { groupHead } from './tables';
import { askMore, moreOf } from './usage-more';
import { askFired, askUsage, firedTab, hasFiredTab, hasUsageTab, pluginUsageTab, usageTab, usedRefList } from './usage-tab';
import { weekAgentChip } from './week-tile';

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

// A labelled fact: the label in a fixed column, its value beside it. The info card is made of these, grouped by what they describe.
const fact = (label: string, value: Child, glyph?: string | null, tip?: string, cls = '') =>
  el('div', { className: `dv-fact${cls ? ` ${cls}` : ''}`, title: tip }, el('span', { className: 'k' }, glyph ? icon(glyph) : null, label), el('span', { className: 'v' }, value));

const group = (caption: string, rows: (HTMLElement | null)[]) => {
  const live = rows.filter((r): r is HTMLElement => !!r);
  return live.length ? el('div', { className: 'dv-group' }, el('div', { className: 'dv-group-cap' }, caption), live) : null;
};

// A figure with its note: the figure in the text color, the note muted. A note is cut to the row's width; the hover card
// carries the label, the whole note and the tip.
const UNKNOWN = new Set(['Unknown', '...', '-']);
const tile = (n: string, label: string, glyph: string, note: string, tone?: string, tip?: string) =>
  fact(label, [el('span', { className: `n${UNKNOWN.has(n) ? ' unk' : ''}` }, n), el('span', { className: `kpi-note${tone ? ` ${tone}` : ''}` }, note)], glyph, [label, note, tip].filter(Boolean).join('\n'));

const stats = (caption: string, cells: (HTMLElement | null)[]) => group(caption, cells);

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

// Frontmatter as labelled facts, each in words a reader understands at a glance.
function factRows(a: Asset, draft: Draft): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const f of draft.fields) {
    if (DONE_KEYS.has(f.key)) continue;
    const v = f.value;
    const text = String(v);
    if (f.key === 'model') rows.push(fact('Model', text, 'chip'));
    else if (f.key === 'color') rows.push(fact('Color', [el('span', { className: `swatch dv-dot ${agentColorClass(text)}` }), text]));
    else if (f.key === 'disable-model-invocation') rows.push(fact('Invocation', v === true ? 'Manual only' : 'Model can invoke', v === true ? 'lock' : 'unlock', v === true ? 'Invocation\nClaude never starts it on its own; only you can, by name.' : undefined));
    else if (f.key === 'user-invocable') rows.push(fact('Slash menu', v === false ? 'Hidden' : 'Listed', v === false ? 'eye-closed' : 'eye'));
    else if (f.key === 'keep-coding-instructions') rows.push(fact('Coding instructions', v === true ? 'Kept' : 'Replaced', 'code'));
    else if (f.key === 'agent') {
      const e = resolve(text, a);
      rows.push(fact('Runs in', e ? refChip(e) : text, 'hubot'));
    } else if (f.key === 'paths') {
      if (a.kind !== 'rule') rows.push(fact('Paths', String(listField(v).length || 1), 'filter', `Paths\n${listField(v).join('\n')}`));
    } else if (f.key === 'argument-hint') rows.push(fact('Arguments', text, 'symbol-parameter'));
    else if (f.key === 'license') rows.push(fact('License', text, 'law'));
    else rows.push(fact(f.key, el('span', { className: 'ell' }, text), null, text.length > 40 ? `${f.key}\n${text}` : undefined));
  }
  const version = fieldOf(draft, 'version');
  if (version) rows.unshift(fact('Version', String(version), 'tag'));
  return rows;
}

// `rows` are the facts of the element, `measures` its group of figures; the notices (`extra`) sit between the description and the groups.
function hero(a: Asset, v: ScopeView | undefined, draft: Draft | undefined, description: string, extra: Child[] = [], rows: HTMLElement[] = [], measures: HTMLElement | null = null): HTMLElement | null {
  const { text, groups } = splitDescription(description);
  const missing = !text && ['skill', 'agent', 'command'].includes(a.kind);
  // Where it lives is the header's badge; what the badge cannot say (a plugin, a source, a version, linked repos) is the Origin fact.
  const rest = originText(a, v).split(' · ').slice(1).join(' · ');
  const details = group('Details', [rest ? fact('Origin', rest, 'source-control') : null, ...(draft ? factRows(a, draft) : []), ...rows]);
  // Memory and rules say when they load in their Loads and Always loaded rows, and the other kinds have no description to miss.
  const noDesc = !['skill', 'agent', 'command', 'outputStyle'].includes(a.kind);
  const body = [text ? descBlock(text) : noDesc ? null : el('p', { className: `dv-desc muted${missing ? ' warn' : ''}` }, missing ? 'No description, so Claude cannot tell when to use it.' : 'No description.'), groups.map(([label, phrases]) => phraseGroup(label, phrases)), extra];
  const cols = details || measures ? el('div', { className: 'dv-cols' }, details, measures) : null;
  if (!cols && !body.flat(Infinity).some(Boolean)) return null;
  return el('section', { className: 'dv-hero' }, (body as unknown[]).flat(Infinity), cols);
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
    el('button', { type: 'button', className: 'dv-file', title: f, onclick: () => command('openFile', { id: a.id, rel: f }) }, icon((FILE_ICONS.find(([re]) => re.test(f)) || [null, 'file'])[1] as string), pathText(top ? f.slice(top.length + 1) : f));
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
      editable() ? edit : null
    ),
    body.trim() ? doc : el('div', { className: 'dv-empty' }, 'Empty.')
  );
}

export function setMode(mode: 'view' | 'edit') {
  state.detailMode = mode;
  persist();
  renderMain();
}

// The Files tile counts every file; its sub-line names the parts the References and Files tabs list: SKILL.md, the references, the scripts and the rest.
function fileParts(files: string[]): string {
  const refs = files.filter(isReference).length;
  const plain = files.filter(f => f !== 'SKILL.md' && !isReference(f));
  const scripts = plain.filter(f => /^scripts\//.test(f)).length;
  const other = plain.length - scripts;
  return ['SKILL.md', `${plural(refs, 'reference')}`, `${plural(scripts, 'script')}`, other ? `${other} other` : ''].filter(Boolean).join(' · ');
}

// What it costs in context: the description sits in every session's list; the body loads when it is used.
function kpisFor(a: Asset, draft: Draft, description: string, mentions: Entry[], mentioned: Entry[], tools: string[]): HTMLElement | null {
  const body = draft.body;
  const desc = `${fmtTokens(tokens(description))} tokens`;
  const connections = tile(String(mentions.length + mentioned.length), 'Connections', 'references', `refers to ${mentions.length} · referred to by ${mentioned.length}`);
  const toolTile = tile(tools.length ? String(tools.length) : 'All', 'Tools', 'tools', tools.length ? `${tools.filter(t => t.startsWith('mcp__')).length} from MCP servers` : 'no tools list: inherits all');
  const always = metaOf(a).paths ? false : true;
  const flags = tileFlags(a, a.kind === 'skill' ? slimOf(a.id) : undefined);
  const set: Record<string, HTMLElement[]> = {
    skill: [
      tile(desc.replace(' tokens', ''), 'Always loaded', 'layers', flags.desc?.note ?? 'tokens: the description, in every session', flags.desc?.tone, flags.desc?.tip),
      tile(fmtTokens(tokens(body)), 'On use', 'play', flags.body?.note ?? 'tokens: SKILL.md when the skill runs', flags.body?.tone, flags.body?.tip),
      tile(String(Math.max(1, (a.files || []).length)), 'Files', 'files', fileParts(a.files || [])),
      connections,
    ],
    agent: [tile(desc.replace(' tokens', ''), 'Always loaded', 'layers', 'tokens: the description, in the agent list'), tile(fmtTokens(tokens(body)), 'System prompt', 'hubot', 'tokens, when the agent starts'), toolTile, connections],
    command: [tile(desc.replace(' tokens', ''), 'Always loaded', 'layers', 'tokens: the description'), tile(fmtTokens(tokens(body)), 'On use', 'play', `tokens, when you run /${a.name}`), tile(String(tools.length), 'Pre-approved', 'tools', 'tools that run without asking'), connections],
    rule: [
      tile(always ? 'Always' : 'On match', 'Loads', 'law', always ? 'in every session' : 'when Claude reads a matching file'),
      tile(fmtTokens(tokens(body)), 'Size', 'symbol-ruler', 'tokens'),
      tile(String((metaOf(a).paths || []).length), 'Paths', 'filter', 'globs in the frontmatter', undefined, (metaOf(a).paths || []).join('\n')),
      connections,
    ],
    memory: [
      tile(fmtTokens(tokens(body)), 'Always loaded', 'layers', 'tokens, in every session here'),
      tile(String(lines(body)), 'Lines', 'list-flat', plural(words(body), 'word')),
      tile(String((body.match(/^@\S+/gm) || []).length), 'Imports', 'references', '@-lines that pull in more files'),
      connections,
    ],
    outputStyle: [
      tile(fmtTokens(tokens(body)), 'Size', 'symbol-ruler', 'tokens, replacing the default style'),
      tile(fieldOf(draft, 'keep-coding-instructions') === true ? 'Kept' : 'Replaced', 'Coding instructions', 'code', 'of the default system prompt'),
      connections,
    ],
  };
  return stats('Context cost', set[a.kind] || [connections]);
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
  const usedIn = hasUsageTab(a) ? usageTab(a) : null;
  if (usedIn) askUsage(a, state.detailTabs[a.kind] === 'usage');
  // A skill's size and spread: asked once per loaded page, and the page repaints when the answer differs.
  askSlim(a);
  const slim = a.kind === 'skill' ? slimOf(a.id) : undefined;
  const slimNote = slimCard(a, slim);
  const flagged = slim ? slim.spread.orphan.length + slim.spread.nested.length + slim.spread.giant.length + (slim.spread.manyTiny ? 1 : 0) : 0;
  askDrawing(a);
  return [
    drawingFigure(a),
    // A skill's page has no info card: the drawing says what it does; only the sync notices that card carried stay.
    a.kind === 'skill' ? distNotice(a) : hero(a, v, draft, description, [], a.kind === 'agent' ? [weekAgentChip(a)] : [], kpisFor(a, draft, description, mentions, mentioned, tools)),
    a.kind === 'skill' ? updateBanner(a) : null,
    tabbed(a, [
      {
        id: 'doc',
        label: DOC_TITLE[a.kind] || 'Content',
        glyph: 'book',
        about: DOC_ABOUT[a.kind] || 'The file as Claude reads it.',
        body: () => (outline ? el('div', { className: 'dv-grid' }, el('div', { className: 'dv-main' }, slimNote, docCard(a, draft.body, doc)), el('aside', { className: 'dv-side' }, outline)) : [slimNote, docCard(a, draft.body, doc)]),
      },
      usedIn,
      a.kind === 'skill' && references.length
        ? {
            id: 'references',
            label: 'References',
            glyph: 'library',
            about: 'The markdown files beside SKILL.md that Claude reads when the instructions send it there, with their tokens and what is wrong with their place in the skill.',
            count: flagged ? `${references.length} · ${flagged} flagged` : references.length,
            body: () => (slim && slim.refs.length ? spreadCard(a, slim, rel => command('openFile', { id: a.id, rel })) : filesCard(a, 'References', references)),
          }
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
  // Calls per tool from the usage index, when one exists; tool names in transcripts have anything but letters, digits, _ and - replaced by _.
  askMore(a, false);
  const usage = moreOf(a.id)?.more;
  const calls = usage ? usage.total : undefined;
  const callsOf = (name: string) => (usage ? (usage.tools || []).find(x => x.name === name.replace(/[^A-Za-z0-9_-]/g, '_'))?.count ?? 0 : undefined);
  const callsChip = (n: number | undefined) =>
    n === undefined ? null : el('span', { className: `dv-tool-calls${n ? '' : ' none'}`, title: n ? `Called ${plural(n, 'time')} in recorded sessions` : 'Never called in a recorded session' }, n ? plural(n, 'call') : 'no calls');
  const enabled = el(
    'label',
    { className: 'dv-switch' },
    el('input', { type: 'checkbox', checked: a.enabled !== false, onchange: () => command('toggleMcp', { id: a.id }) }),
    el('span', {}, v && v.id !== 'global' ? `In ${v.label}` : 'In every folder')
  );
  const off = a.enabled === false;
  const busy = state.mcpBusy[a.id] === 'busy';
  const problem = info && info.error && !off;
  const needsSignIn = !!(info && info.error && info.signIn) || /auth/i.test(a.status || '');
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
  // The status is one line: icon, word, the server's own message, and Sign in and Retry at its right end. The text from
  // `claude mcp list` is the line's hover card.
  const word = mcpStatusWord(a);
  const wordText = word === 'Sign-in' || (word === '-' && needsSignIn && !off) ? 'Needs sign-in' : word === '-' ? (info ? 'Unknown' : '...') : word || (info ? 'Unknown' : '...');
  const listed = a.status && a.status !== word ? tidyError(a.status) : '';
  const tone = off ? 'warn' : problem || mcpFailed(a) ? 'bad' : word === 'Connected' ? 'ok' : 'warn';
  const message = off
    ? `Switched off ${v && v.id !== 'global' ? `in ${v.label}` : 'in every folder'}. Switch it on to connect, sign in or retry.`
    : problem
      ? (state.mcpBusy[a.id] === 'done' ? 'Checked again: ' : '') + tidyError(info.error)
      : '';
  const sameAsWord = message.replace(/\.$/, '').toLowerCase() === wordText.toLowerCase();
  const statusText = off || (problem && sameAsWord) ? message : problem ? `${wordText} · ${message}` : listed ? `${wordText} · ${listed}` : wordText;
  const statusLine = el(
    'div',
    { className: `dv-notice line ${tone}`, role: tone === 'bad' ? 'alert' : 'status', title: problem && listed ? `${wordText}\n${listed}` : undefined },
    icon(off ? 'circle-slash' : tone === 'ok' ? 'pass' : tone === 'bad' ? 'error' : 'warning'),
    el('span', { className: 'dv-notice-text' }, statusText),
    problem
      ? el(
          'div',
          { className: 'cmd-row' },
          aiGroup('', info.signIn ? cmd('sign-in', 'Sign in', 'Sign in\nA Claude in a terminal runs /mcp, where the server asks you to sign in.', () => vscode.postMessage({ type: 'mcpSignIn', id: a.id })) : null),
          cmdBox(
            'Server',
            '',
            cmd(busy ? 'loading' : 'refresh', busy ? 'Retrying...' : 'Retry', 'Retry\nAsk the server for its tools again.', () => {
              state.mcpBusy[a.id] = 'busy';
              vscode.postMessage({ type: 'mcpRetry', id: a.id });
              renderMain();
            }, { disabled: busy })
          )
        )
      : null
  );
  const unknown = !!(info && info.error) || off;
  const why = off ? 'switched off' : needsSignIn ? 'until you sign in' : 'the server did not answer';
  // Tools and Tool list both say Unknown for the same reason: one cell then, with both in its hover card.
  const cells = unknown
    ? [tile('Unknown', 'Tools and tool list', 'tools', why, undefined, `The server's tools, and what its tool list costs in tokens each session, are unknown ${why}.`)]
    : [
        tile(info ? String(toolList.length) : '...', 'Tools', 'tools', info ? `${info.server || labelOf(a)}${info.version ? ` ${info.version}` : ''}` : 'asking the server'),
        tile(info ? fmtTokens(toolList.reduce((n, t) => n + tokens(`${t.name} ${t.description}`), 0)) : '...', 'Tool list', 'layers', !info ? 'asking the server' : calls === undefined ? 'tokens of names and descriptions' : `tokens every session, ${plural(calls, 'call')}`),
      ];
  // The Scope tile said what the header's origin and the Source chip already say, so it is gone.
  const heroCard = hero(a, v, undefined, a.about || where, [fact('Status', statusLine, null, undefined, 'wide')], [
    fact('Source', sourceName(a), 'source-control'),
    a.target ? fact('Address', el('span', { className: 'ell' }, a.target), 'link', `Address
${a.target}`) : null,
    pluginOf(a) ? fact('Plugin', pluginOf(a), 'extensions') : null,
    fact('Enabled', [enabled, !v && a.offIn ? el('span', { className: 'dv-note' }, `Off in ${a.offIn} of ${plural(a.folders, 'folder')}.`) : null], 'check'),
  ].filter((c): c is HTMLElement => !!c), stats('Tools offered', cells));
  const tools = () =>
    card(
      'Tools',
      info && !info.error ? toolList.length : null,
      !info
        ? el('div', { className: 'dv-empty' }, 'Asking the server for its tools...')
        : info.error
          ? el('div', { className: 'dv-empty' }, off ? 'No tool list while the server is switched off.' : needsSignIn ? 'The tool list is unknown until you sign in.' : 'No tool list while the server does not answer.')
          : el('div', { className: 'dv-tool-cards' }, toolList.map(t => el('div', { className: 'dv-tool-card' }, el('div', { className: 'dv-tool-head' }, el('span', { className: 'dv-tool-name' }, t.name), callsChip(callsOf(t.name))), t.description ? el('span', { className: 'dv-tool-desc', title: t.description }, t.description) : null)))
    );
  const instructions = info && info.instructions ? info.instructions : '';
  return [
    heroCard,
    tabbed(a, [
      { id: 'tools', label: 'Tools', glyph: 'tools', about: 'Every tool the server offers, with the description Claude reads.', count: info && !info.error ? toolList.length : undefined, body: tools },
      instructions ? { id: 'instructions', label: 'Server instructions', glyph: 'book', about: 'What the server tells Claude about using its tools.', body: () => card('Server instructions', null, renderMarkdown(instructions).node) } : null,
      d.body ? { id: 'config', label: 'Config', glyph: 'json', about: 'The entry that registers the server.', body: () => card('Config', null, el('pre', { className: 'md-pre' }, el('code', {}, d.body))) } : null,
    ]),
  ];
}

// The events a plugin with an events manifest produced across the newest sessions, one row per event label. The tab is
// named for the class of plugin, never for a plugin's own layer name, and exists only once the host reports a manifest.
function modActivityTab(a: Asset): Tab | null {
  if (!std(undefined)) return null;
  const data = modActivityOf(a.id);
  if (!data?.label) return null;
  const TONE_ICON = { act: 'plug', warn: 'warning', quiet: 'circle-outline' };
  const rows = data.groups.map(g => {
    const row = el(
      'div',
      { className: 'row', tabindex: '0' },
      icon(TONE_ICON[g.tone]),
      el('span', { className: 'name' }, g.label),
      el('span', { className: 'desc' }, `${plural(g.count, 'event')} · ${plural(g.sessions, 'session')} · last ${fmtAgo(Date.parse(g.last))}`)
    );
    const open = () => {
      const r = row.getBoundingClientRect();
      placeCard(`activity:${a.id}:${g.label}`, () => eventsCard(g.label, [{ label: data.label as string, events: g.events }]), { x: r.left + 24, y: r.bottom - 4 });
    };
    row.addEventListener('mouseenter', open);
    row.addEventListener('focus', open);
    row.addEventListener('mouseleave', hideHover);
    row.addEventListener('blur', hideHover);
    return row;
  });
  const total = data.groups.reduce((n, g) => n + g.count, 0);
  return {
    id: 'activity',
    label: 'Mod activity',
    glyph: 'plug',
    about: 'What the plugin did across your newest sessions, grouped by what it did.',
    count: total,
    body: () => card('Mod activity', total, rows.length ? rows : el('div', { className: 'dv-empty' }, `No event in the newest ${plural(data.sessions, 'session')}.`)),
  };
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
  // Every render asks how often its elements were used, so the counts fill in from an existing index; open on the tab, it builds one.
  askMore(a, state.detailTabs[a.kind] === 'usage');
  const toggle = el(
    'label',
    { className: 'dv-switch' },
    el('input', { type: 'checkbox', checked: !!a.enabled, onchange: () => command('togglePlugin', { id: a.id }) }),
    el('span', {}, 'For your user')
  );
  // The counts are the Contains rows; the sentence they once repeated stays only for a disabled plugin, where it says why they are empty.
  const heroCard = hero(
    a,
    state.views[0],
    undefined,
    '',
    [a.enabled ? null : el('p', { className: 'dv-desc' }, 'Disabled: none of its skills, agents or servers load. Enable it to see them here.')],
    [market ? fact('Marketplace', market, 'extensions') : null, version ? fact('Version', `v${version}`, 'tag') : null, fact('Enabled', toggle, 'check')].filter((c): c is HTMLElement => !!c),
    stats('Contains', [tile(String(skills.length), 'Skills', 'mortar-board', 'in every session'), tile(String(agents.length), 'Agents', 'hubot', 'Claude can delegate to'), tile(String(servers.length), 'MCP servers', 'server', 'started with Claude Code')])
  );
  return [
    heroCard,
    tabbed(a, [
      { id: 'skills', label: 'Skills', glyph: 'mortar-board', about: 'The skills the plugin adds to every session, with how often each was used.', count: skills.length, live: true, body: () => card('Skills', skills.length, usedRefList(a, skills, a.enabled ? 'No skills.' : 'Enable the plugin to list them.', 'use', refRow)) },
      { id: 'agents', label: 'Agents', glyph: 'hubot', about: 'The agents the plugin adds, which Claude can delegate to, with how often each was launched.', count: agents.length, live: true, body: () => card('Agents', agents.length, usedRefList(a, agents, a.enabled ? 'No agents.' : 'Enable the plugin to list them.', 'agent', refRow)) },
      pluginUsageTab(a, skills, agents),
      { id: 'servers', label: 'MCP servers', glyph: 'server', about: 'The MCP servers the plugin starts with Claude Code.', count: servers.length, body: () => card('MCP servers', servers.length, refList(servers, 'No MCP servers.')) },
      modActivityTab(a),
    ]),
  ];
}

function codeView(d: Detail, body: string): Child[] {
  const a = d.asset;
  // Every render asks where the hook ran, so the badge fills in from an existing index; open on the tab, it builds one.
  const fired = hasFiredTab(a) ? firedTab(a) : null;
  if (fired) askFired(a, state.detailTabs[a.kind] === 'fired');
  const label = d.mode === 'settings' ? 'JSON' : d.mode === 'json' ? 'Config' : 'Script';
  return [
    // The header badges already name the kind and the scope; the card appears when there is a description or an origin to add.
    hero(a, viewOf(a.scope) || undefined, undefined, a.description || ''),
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
              d.mode === 'json' || !editable() ? null : el('button', { type: 'button', className: 'link', onclick: () => setMode('edit') }, icon('edit'), 'Edit')
            ),
            el('pre', { className: 'md-pre dv-code' }, el('code', {}, body))
          ),
      },
      fired,
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
