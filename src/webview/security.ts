// @ts-nocheck
// The Security page: what in the Claude configuration on this PC could run foreign code, leak a secret or skip the permission
// prompts. The host scans (`securityRead`) and masks every secret; Resolve is offered only where the fix is mechanical and
// always asks first, in the house confirm card.
import { confirmAt } from './confirm';
import { showPage, state, vscode } from './core';
import { countHead, el, icon, iconBtn, plural, stateTag, tailPath } from './dom';
import { hideHover } from './hover';
import { renderMain } from './main';
import { tabBar } from './repo-page';

const SEVERITY = {
  high: ['High', 'error', 'fail', 'sev-bad', 'Runs foreign code, leaks a secret or switches the prompts off.'],
  medium: ['Medium', 'warning', 'warn', 'sev-warn', 'Risky in the wrong hands, or hard to judge from here.'],
  low: ['Low', 'info', 'none', 'sev-info', 'Worth knowing about; fine when you trust the source.'],
};
const CHECKS = {
  hook: ['Hooks', 'plug', 'Hooks that download and run code or read secrets.'],
  mcp: ['MCP servers', 'server-environment', 'Servers with a literal secret in env, headers, URL or arguments.'],
  permission: ['Permissions', 'lock', 'Rules that allow everything and modes that skip the prompts.'],
  source: ['Sources', 'package', 'Skills and plugins from outside a known marketplace, or that fetch and run remote code.'],
};

export const openSecurity = () => {
  vscode.postMessage({ type: 'securityRead' });
  showPage('security');
};

// The overview's entry: a plain button beside the tabs, since the check does not start Claude.
export const securityButton = () =>
  el('button', { className: 'secondary security-open', title: 'Security\nHooks that run downloaded code, MCP secrets written into files, rules that allow every command and skills from unknown sources.', 'aria-label': 'Security', onclick: openSecurity }, icon('shield'), el('span', {}, 'Security'));

const filterOf = () => state.securityFilter || { severity: 'all', check: 'all' };

function finding(f) {
  const [word, glyph, tone, cls, tip] = SEVERITY[f.severity] || SEVERITY.low;
  const [checkName, checkGlyph] = CHECKS[f.check] || ['Other', 'question'];
  const advice = [
    ['Why it matters', f.why],
    f.fix ? ['What Resolve does', f.fix.does] : ['What to do', 'Look at it yourself: the right fix depends on what you meant it to do.'],
  ];
  return el(
    'div',
    { className: `finding ${cls}`, role: 'listitem', 'data-check': f.check, 'data-severity': f.severity },
    el(
      'div',
      { className: 'finding-main' },
      el('div', { className: 'finding-kind' }, stateTag(word, tone, `${word}\n${tip}`), icon(checkGlyph), checkName),
      el('div', { className: 'finding-title' }, f.title),
      el('div', { className: 'finding-note', title: `${f.file}\nLine ${f.line}` }, `${f.where} · ${tailPath(f.file, 3)}:${f.line}`),
      f.evidence ? el('code', { className: 'security-evidence', title: 'Secret values are masked here.' }, f.evidence) : null,
      el('dl', { className: 'finding-advice' }, advice.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))
    ),
    f.fix
      ? confirmAt(
          el('button', { className: 'secondary finding-jump security-resolve', title: `Resolve\n${f.fix.does}\nAsks first and edits only that value.`, 'aria-label': `Resolve: ${f.title}`, onclick: () => (hideHover(), vscode.postMessage({ type: 'securityResolve', id: f.id })) }, icon('wrench'), 'Resolve'),
          'securityResolve',
          f.id
        )
      : null
  );
}

export function renderSecurity() {
  const report = state.securityReport;
  const all = report ? report.findings : [];
  const filter = filterOf();
  const set = patch => {
    state.securityFilter = { ...filterOf(), ...patch };
    hideHover();
    renderMain();
  };
  const shown = all.filter(f => (filter.severity === 'all' || f.severity === filter.severity) && (filter.check === 'all' || f.check === filter.check));
  const count = pred => all.filter(pred).length;
  const bySeverity = [['all', 'All', 'list-flat', 'Every finding.', all.length], ...Object.entries(SEVERITY).map(([id, [word, glyph, , , tip]]) => [id, word, glyph, tip, count(f => f.severity === id)])];
  const byCheck = [['all', 'Every check', 'checklist', 'Hooks, MCP servers, permissions and sources.'], ...Object.entries(CHECKS).map(([id, [word, glyph, tip]]) => [id, word, glyph, tip, count(f => f.check === id)])];
  const body = el('div', { className: 'main-body' });
  if (!report) body.append(el('div', { className: 'empty flush' }, 'Scanning the configuration...'));
  else {
    body.append(el('div', { className: 'security-filters' }, tabBar(bySeverity, filter.severity, id => set({ severity: id }), 'Severity'), tabBar(byCheck, filter.check, id => set({ check: id }), 'Check')));
    body.append(shown.length ? el('div', { className: 'findings', role: 'list' }, shown.map(finding)) : el('div', { className: 'empty flush' }, all.length ? 'No finding matches the filter' : 'No findings'));
  }
  return el(
    'section',
    { className: 'main' },
    countHead('shield', 'Security', report ? `${plural(all.length, 'finding')} · ${plural(report.scanned, 'file')} read` : 'Scanning...', iconBtn('refresh', 'Rescan\nReads the configuration again.', () => (hideHover(), vscode.postMessage({ type: 'securityRead' })))),
    body
  );
}
