// The repo page's harness standard card: what the provider plugin's check found, in plain words, with the
// findings that open the file at the spot, the fixes the provider offers, and the provider's own standard
// document, so a reader can see which rules were applied.
import type { CheckSummary } from '../constitution';
import type { ScopeView } from '../harness';
import { command, openAt, state, std, vscode } from './core';
import { aiGroup, el, icon, iconBtn, plural } from './dom';
import { renderMarkdown } from './markdown';

type Finding = NonNullable<CheckSummary['findings']>[number];

const STATUS: Record<string, [string, string, string]> = {
  pass: ['pass-filled', 'ok', 'Passes'],
  fail: ['error', 'bad', 'Needs fixes'],
  review: ['warning', 'warn', 'Lines to review'],
  running: ['sync', 'muted', 'Checking...'],
  unchecked: ['circle-large-outline', 'muted', 'Not checked yet'],
  error: ['circle-slash', 'bad', 'The check failed'],
  'no-plugin': ['circle-slash', 'muted', 'No provider plugin'],
  'no-python': ['circle-slash', 'muted', 'Python 3 not found'],
};

const GROUPS: [string, string, string][] = [
  ['FAIL', 'To fix', 'error'],
  ['REVIEW', 'To review', 'warning'],
  ['INFO', 'Notes', 'info'],
];

const where = (f: Finding) => (f.file ? `${f.file.split(/[\\/]/).slice(-2).join('/').replace(/^[^/]*\/(?=CLAUDE\.md$)/, '')}${f.line ? `:${f.line}` : ''}` : '');

function findingRow(f: Finding): HTMLElement {
  const open = f.file ? () => openAt(f.file, f.line) : undefined;
  return el(
    f.file ? 'button' : 'div',
    { type: f.file ? 'button' : undefined, className: `std-finding ${f.level.toLowerCase()}`, onclick: open, title: f.file ? `Open ${f.file}${f.line ? ` at line ${f.line}` : ''}` : undefined },
    icon(f.level === 'FAIL' ? 'error' : f.level === 'REVIEW' ? 'warning' : 'info'),
    el('span', { className: 'std-text' }, f.text.replace(/^(FAIL|REVIEW|INFO) /, '')),
    el('span', { className: 'std-where' }, where(f))
  );
}

// A finding with, beside it when the provider is there, Fix with Claude: a terminal at the repo asked to fix this one.
function findingItem(view: ScopeView, f: Finding): HTMLElement {
  const row = findingRow(f);
  if (!std(undefined)) return row;
  const text = f.text.replace(/^(FAIL|REVIEW|INFO) /, '');
  return el(
    'div',
    { className: 'std-item' },
    row,
    aiGroup('compact', iconBtn('lightbulb', 'Fix\nA new Claude in a terminal at the repo, asked to fix this one finding.', () => vscode.postMessage({ type: 'fixFinding', scope: view.id, text, file: f.file, line: f.line }), false))
  );
}

export function standardCard(view: ScopeView): HTMLElement | null {
  const s = state.standard;
  if (!s) return null;
  const eff = state.effective[view.id];
  const live = state.checks[view.id];
  const c: CheckSummary | undefined = eff && eff.check && (!live || eff.check.state === live.state) ? eff.check : live;
  const st = c ? c.state : 'unchecked';
  const [glyph, tone, label] = STATUS[st] || STATUS.unchecked;
  const findings = (c && c.findings) || [];
  const fail = c?.fail || 0;
  const review = c?.review || 0;
  // A finished check says its result in the pill and the group heads below; only the other states need a sentence.
  const sentence =
    st === 'pass' || st === 'fail' || st === 'review'
      ? ''
      : st === 'running'
          ? `${s.name} is checking the repo.`
          : st === 'unchecked'
            ? `${s.name} has not checked this repo yet.`
            : c?.error || label;
  const touches = (re: RegExp) => findings.some(f => re.test(`${f.code || ''} ${f.file || ''} ${f.text}`));
  const actions = el(
    'div',
    { className: 'std-actions' },
    el('button', { className: 'secondary', onclick: () => command('checkRepos', { scope: view.id }) }, icon('refresh'), st === 'unchecked' ? 'Check now' : 'Check again'),
    s.align && touches(/CLAUDE\.md|sections|lines|em-dash|pointer|restated|boilerplate/) ? aiGroup('', el('button', { className: 'secondary', onclick: () => command('alignClaudeMd', { scope: view.id }) }, icon('markdown'), 'Align CLAUDE.md...')) : null,
    s.fix && touches(/settings|hook/) ? el('button', { className: 'secondary', onclick: () => command('fixSettings', { scope: view.id }) }, icon('wrench'), 'Fix settings and hooks...') : null,
    s.doc ? el('button', { className: 'link', onclick: () => openAt(s.doc, undefined) }, icon('go-to-file'), 'Open the standard') : null
  );
  const facts = el(
    'div',
    { className: 'dv-chips' },
    c?.kind ? el('span', { className: 'dv-chip', title: `The standard applies different rules to each kind of repo; ${s.name} filed this one as a ${c.kind} repo. The document below says what each kind needs.` }, icon('repo'), el('span', { className: 'k' }, 'Kind'), c.kind) : null,
    typeof c?.lines === 'number' ? el('span', { className: 'dv-chip' }, icon('markdown'), el('span', { className: 'k' }, 'CLAUDE.md'), plural(c.lines, 'line')) : null,
    typeof c?.emDashes === 'number' ? el('span', { className: `dv-chip${c.emDashes ? ' warn' : ''}` }, el('span', { className: 'k' }, 'Em dashes'), String(c.emDashes)) : null
  );
  const groups = GROUPS.map(([level, title, gl]) => [level, title, gl, findings.filter(f => f.level === level)] as const).filter(g => g[3].length);
  const doc = s.docText
    ? el(
        'details',
        { className: 'std-doc' },
        el('summary', {}, icon('book'), 'What the standard checks'),
        renderMarkdown(s.docText, { link: (href, ev) => (/^https?:/i.test(href) ? false : (ev.preventDefault(), true)) }).node
      )
    : null;
  return el(
    'section',
    { className: 'dv-hero std-card' },
    el('div', { className: 'dv-kicker' }, el('span', {}, 'Harness standard'), el('span', { className: 'dv-origin' }, s.name)),
    el('div', { className: 'std-status' }, el('span', { className: `std-pill ${tone}` }, icon(glyph), label), sentence ? el('p', { className: 'dv-desc' }, sentence) : null),
    facts,
    groups.map(([, title, gl, list]) => el('div', { className: 'std-group' }, el('div', { className: 'std-group-head' }, icon(gl), el('span', {}, title), el('span', { className: 'dv-count' }, String(list.length))), list.map(f => findingItem(view, f)))),
    actions,
    doc
  );
}
