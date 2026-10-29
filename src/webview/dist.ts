// @ts-nocheck
// Skills from a distributor (skills.sh, GitHub): the Origin cell, the line that reports what a command did, the Skills page's
// buttons and the skill page's commands. The host does the downloading and the questions (src/dist-host.ts); this module shows what it found.
import { command, pluginLabel, skillPluginOf, state } from './core';
import { confirmAt } from './confirm';
import { el, fmtAgo, icon } from './dom';
import { hideHover } from './hover';
import { renderMain } from './main';

export const isTracked = a => !!a.origin;

export const checkOf = a => state.dist[a.id];

export const hasUpdate = a => checkOf(a)?.state === 'newer';

const WORDS = { current: 'current', newer: 'update', gone: 'gone' };

// The Sync cell: one token for what the last Check updates found; empty for a skill without a source.
export const syncText = a => (!a.origin ? '' : WORDS[checkOf(a)?.state] || 'unchecked');

const SYNC_HEADS = { current: 'Up to date', update: 'Update available', gone: 'Gone from the source', unchecked: 'Not checked' };

export const syncTip = a => {
  if (!a.origin) return '';
  const c = checkOf(a);
  const token = syncText(a);
  return [
    `Sync · ${SYNC_HEADS[token]}`,
    `Source ${a.origin.source}`,
    c && c.at ? `Checked ${fmtAgo(c.at)}` : 'Never checked in this session',
    a.version || (c && c.version) ? `Local ${a.version ? `v${a.version}` : 'no version'}, source ${c && c.version ? `v${c.version}` : 'no version'}` : '',
    c && c.state === 'error' ? `Could not check: ${c.error || 'unknown error'}. The skill itself is fine.` : '',
    'Check updates asks GitHub whether the skill folder changed. An update is installed from the skill page.',
  ]
    .filter(Boolean)
    .join('\n');
};

// The Origin token, one closed vocabulary for every kind: global, repo, linked, marketplace, distributor.
export const originText = a => (a.source === 'plugin' || String(a.scope).startsWith('plugin:') ? 'marketplace' : a.link ? 'linked' : a.origin ? 'distributor' : a.scope === 'global' ? 'global' : 'repo');

export const originTip = a => {
  const token = originText(a);
  const head = { marketplace: 'Marketplace', linked: 'Linked', distributor: 'Distributor', global: 'Global', repo: 'Repo' }[token];
  const plugin = String(a.scope).startsWith('plugin:') ? String(a.scope).slice('plugin:'.length) : '';
  const detail =
    token === 'marketplace'
      ? `Shipped by the plugin ${plugin || pluginLabel(skillPluginOf(a))}`
      : token === 'linked'
        ? `Linked to ${a.link}`
        : token === 'distributor'
          ? `Connected to ${a.origin.source}\n${a.origin.path}${checkOf(a) && checkOf(a).at ? `\nLast check ${fmtAgo(checkOf(a).at)}` : '\nNot checked yet'}`
          : token === 'global'
            ? 'Authored in ~/.claude, no source'
            : 'Authored in this repo\'s .claude, no source';
  return `Origin · ${head}\n${detail}`;
};

// Not being able to reach GitHub is no fault of the skill: only a skill gone from its repository is red.
export const sourceTone = a => (hasUpdate(a) ? 'warn' : checkOf(a)?.state === 'gone' ? 'bad' : '');

const day = iso => (iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '');

export const sourceTip = a => {
  if (!a.origin) return '';
  const c = checkOf(a);
  const found = !c
    ? "Not checked yet. Check updates asks GitHub whether the skill's folder changed."
    : c.state === 'current'
      ? `Up to date, checked ${fmtAgo(c.at)}.`
      : c.state === 'newer'
        ? `A newer version is at the source${c.version ? `: v${c.version}${a.version ? `, you have v${a.version}` : ''}` : ''}. Checked ${fmtAgo(c.at)}.`
        : c.state === 'gone'
          ? 'The repository no longer has this skill.'
          : `Could not check: ${c.error || 'unknown error'}. The skill itself is fine.`;
  return [`From ${a.origin.source}`, a.origin.path, a.origin.updatedAt ? `Installed from there ${day(a.origin.updatedAt)}.` : '', found].filter(Boolean).join('\n');
};

const norm = p => String(p).replace(/\\/g, '/').toLowerCase();

// The repos whose `.claude/skills/<name>` is still a link to this global skill (made by an older version).
export const linkedRepos = a => {
  if (a.scope !== 'global') return [];
  const mine = new Set([a.dir, a.link].filter(Boolean).map(norm));
  return state.views
    .filter(v => v.id !== 'global' && !String(v.id).startsWith('plugin:'))
    .filter(v => v.categories.some(c => c.kind === 'skill' && c.items.some(s => s.name === a.name && s.link && mine.has(norm(s.link)))))
    .map(v => v.label);
};

const NOTE_GLYPHS = { ok: 'check', bad: 'error', info: 'info', busy: 'loading' };

// What the last distributor command did, in place of a notification: on the Skills page and on a skill's page.
export const distNotice = skill => {
  const n = state.distNote;
  if (!n) return null;
  // On a skill that shows the update banner, the check's "newer version" line would say it twice.
  if (skill && n.tone === 'info' && hasUpdate(skill)) return null;
  const mark = icon(NOTE_GLYPHS[n.tone] || 'info');
  if (n.tone === 'busy') mark.classList.add('codicon-modifier-spin');
  return el(
    'div',
    { className: `dist-note ${n.tone}`, role: n.tone === 'bad' ? 'alert' : 'status' },
    mark,
    el('span', { className: 'dist-note-text' }, n.text),
    n.action ? el('button', { className: 'secondary', onclick: () => (hideHover(), command(n.action.command, n.action.id ? { id: n.action.id } : undefined)) }, n.action.label) : null,
    n.tone === 'busy'
      ? null
      : el('button', { className: 'icon-btn', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => ((state.distNote = undefined), renderMain()) }, icon('close'))
  );
};

// On a skill's page: a newer version at the source.
export const updateBanner = a => {
  if (!hasUpdate(a)) return null;
  const c = checkOf(a);
  return el(
    'div',
    { className: 'dist-note update', role: 'status' },
    icon('arrow-circle-down'),
    el('span', { className: 'dist-note-text' }, `A newer version is at ${a.origin.source}${c.version ? (a.version === c.version ? `: its files changed, the version number is still v${c.version}` : a.version ? `: v${a.version} to v${c.version}` : `: v${c.version}`) : ''}. Press Update in the toolbar above to install it; the old files are backed up.`)
  );
};

// The Skills page header: add a skill from an address, ask the distributors, update what changed.
export const distButtons = skills => {
  const tracked = skills.filter(isTracked);
  const newer = tracked.filter(hasUpdate);
  return [
    confirmAt(
      el('button', { className: 'secondary', title: 'Add from skills.sh or GitHub\nPaste the address of a skill. Its files are downloaded into ~/.claude/skills, and the source is recorded so checks and updates know where to look.', onclick: () => (hideHover(), command('addSkillFromUrl')) }, icon('cloud-download'), 'Add from skills.sh'),
      'panel',
      'add'
    ),
    tracked.length
      ? el(
          'button',
          { className: 'secondary', disabled: state.distRunning, title: `Check updates\nAsks GitHub whether the ${tracked.length} skills installed from a distributor changed. One request per repository, nothing is downloaded.`, onclick: () => (hideHover(), command('checkSkillUpdates')) },
          icon(state.distRunning ? 'loading' : 'sync'),
          state.distRunning ? 'Checking...' : 'Check updates'
        )
      : null,
    newer.length
      ? confirmAt(
          el('button', { className: 'secondary', title: `Update all\n${newer.map(a => a.name).join(', ')}.`, onclick: () => (hideHover(), command('updateSkill')) }, icon('arrow-circle-down'), `Update ${newer.length}`),
          'panel',
          'update-all'
        )
      : null,
  ];
};

// A skill page's commands for a global skill; `cmd` is the command bar's button. The command bar shows glyphs and a hover card,
// as for every kind, so each command here has a glyph of its own.
export const distCommands = (a, cmd) => {
  if (a.scope !== 'global' || a.source === 'plugin') return [];
  const c = checkOf(a);
  return [
    a.origin ? cmd('sync', 'Check update', `Check update\nAsks GitHub whether ${a.origin.source} changed this skill since it was installed.`, () => (hideHover(), command('checkSkillUpdates', { id: a.id })), { disabled: state.distRunning }) : null,
    a.origin && hasUpdate(a)
      ? confirmAt(cmd('arrow-circle-down', 'Update', `Update\nReplace the files with the newer version from ${a.origin.source}${c.version ? `: ${a.version ? `v${a.version} to ` : ''}v${c.version}` : ''}. The old files are backed up.`, () => (hideHover(), command('updateSkill', { id: a.id }))), 'panel', 'update')
      : null,
    !a.origin
      ? confirmAt(cmd('plug', 'Connect to source', `Connect to source\nName the skills.sh or GitHub address ${a.name} comes from. Its files are replaced by the distributor's, the current ones are backed up, and checks and updates work from then on.`, () => (hideHover(), command('connectSkillSource', { id: a.id }))), 'panel', 'link')
      : null,
    confirmAt(cmd('repo', 'Move into repo', `Move into repo\nPick a repo that gets this skill as .claude/skills/${a.name}. The folder leaves the global skills, so only that repo has it afterwards.${linkedRepos(a).length ? ` Still linked from an older version: ${linkedRepos(a).join(', ')}.` : ''}`, () => (hideHover(), command('linkSkillToRepo', { id: a.id }))), 'panel', 'link-repo'),
  ];
};
