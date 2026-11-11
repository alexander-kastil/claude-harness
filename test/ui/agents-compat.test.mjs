// .agents compatibility in a real, isolated VS Code: what `npx skills add` leaves in .agents/skills and in a lock file, as the panel shows it.
// Scratch data only; no skills CLI runs (nothing here presses Check update, Update or Restore).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Session, sleep } from './harness.mjs';

const s = new Session({ livePid: process.pid });
s.waitMs = 20000;
const T = { timeout: 180000 };
const w = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const skill = (dir, name, extra = '') => w(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: The ${name} skill\n${extra}---\nBody.\n`);
const lockEntry = n => ({ source: 'owner/skills', sourceType: 'github', sourceUrl: 'https://github.com/owner/skills.git', skillPath: `skills/${n}/SKILL.md`, skillFolderHash: 'a'.repeat(40), installMode: 'copy' });

// The fixture is built inside start(); the seed runs when start() writes the settings, after the fixture and before VS Code opens.
function seed() {
  const home = path.join(s.root, 'home');
  skill(path.join(home, '.claude', 'skills'), 'loop-me', 'disable-model-invocation: true\n');
  skill(path.join(home, '.agents', 'skills'), 'loop-me');
  w(path.join(home, '.claude', 'skills', 'loop-me', 'agents', 'openai.yaml'), 'policy:\n  allow_implicit_invocation: false\n');
  skill(path.join(home, '.agents', 'skills'), 'find-skills');
  w(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({ version: 3, skills: { 'loop-me': lockEntry('loop-me'), 'find-skills': lockEntry('find-skills') } }));
  w(path.join(home, '.codex', 'AGENTS.md'), '# codex\n');
  const repo = path.join(s.root, 'repos', 'agents-repo');
  w(path.join(repo, 'CLAUDE.md'), '# repo\n');
  w(path.join(repo, 'AGENTS.override.md'), '# override\n');
  skill(path.join(repo, '.claude', 'skills'), 'repo-skill');
  skill(path.join(repo, '.agents', 'skills'), 'repo-skill');
  skill(path.join(repo, '.claude', 'skills'), 'Bad_Skill');
  const entry = n => ({ source: 'o/r', sourceType: 'github', skillPath: `skills/${n}/SKILL.md`, computedHash: 'b'.repeat(64) });
  w(path.join(repo, 'skills-lock.json'), JSON.stringify({ version: 1, skills: { 'repo-skill': entry('repo-skill'), 'restore-me': entry('restore-me') } }));
}
const settings = s.settings.bind(s);
let seeded = false;
s.settings = (...a) => {
  if (!seeded) {
    seeded = true;
    seed();
  }
  return settings(...a);
};

const open = async (selector, label) => {
  await s.ev(
    (D, selector, label) => {
      const e = [...D.querySelectorAll(selector)].find(x => !label || x.innerText.includes(label));
      e.setAttribute('data-probe', 'x');
      e.scrollIntoView({ block: 'center' });
      return 1;
    },
    selector,
    label
  );
  await sleep(400);
  await s.mouse('[data-probe="x"]');
  await s.ev(D => D.querySelector('[data-probe="x"]')?.removeAttribute('data-probe') ?? 1);
  await sleep(1800);
};
const main = () => s.ev(D => D.querySelector('.main').innerText);

before(async () => {
  await s.start();
  await s.openPanel();
  await s.waitFor(D => D.querySelector('.overview-tabs'));
  await s.chord('b', { ctrl: true });
  await sleep(3000);
});
after(() => s.stop());

test('a global skill in .claude and .agents shows once with its source, who loads it, and its Codex file', T, async () => {
  await open('.sidebar [data-nav="s|global|skill"]');
  const names = await s.ev(D => [...D.querySelectorAll('.main .at-name')].map(n => n.innerText.trim()));
  assert.equal(names.filter(n => n === 'loop-me').length, 1);
  await open('.main .at-name', 'loop-me');
  const text = await main();
  assert.match(text, /owner\/skills/);
  assert.match(text, /Loaded by\s*\n?5/);
  assert.match(text, /GitHub Copilot, Codex, Cursor, Gemini CLI, OpenCode/);
  assert.match(text, /Explicit only/);
  assert.match(text, /Spec\s*\n?Valid/);
  await s.click('.main [role=tab]', 'Codex');
  assert.match(await main(), /allow_implicit_invocation: false/);
});

test('a skill only in .agents/skills shows once, from its lock, as not loaded by Claude Code', T, async () => {
  await s.click('.main button', 'Back');
  await sleep(1200);
  const names = await s.ev(D => [...D.querySelectorAll('.main .at-name')].map(n => n.innerText.trim()));
  assert.equal(names.filter(n => n === 'find-skills').length, 1);
  await open('.main .at-name', 'find-skills');
  const text = await main();
  assert.match(text, /owner\/skills/);
  assert.match(text, /Not loaded\s*\n?only in \.agents\/skills/);
});

test('global AGENTS.md files other agents read are listed as not read by Claude Code', T, async () => {
  await open('.sidebar [data-nav="s|global|memory"]');
  const row = '.sidebar [data-nav="r|global|memory:~/.codex/AGENTS.md"]';
  // The head folds its rows when they were open: press it again then.
  if (!(await s.ev((D, row) => !!D.querySelector(row), row))) await open('.sidebar [data-nav="s|global|memory"]');
  await open(row);
  assert.match(await main(), /Not loaded\s*\n?Claude Code does not read this file/);
});

test('a repo shows its lock source, the AGENTS.override.md as not read, a spec problem, and a Restore command for a missing skill', T, async () => {
  await open('.sidebar .repo-head', 'agents-repo');
  const toolbar = await s.ev(D => [...D.querySelectorAll('.main-head .toolbar button')].map(b => (b.getAttribute('aria-label') || b.title || '').split('\n')[0]));
  assert.ok(toolbar.some(t => /^Restore skills/.test(t)), toolbar.join('|'));
  const rows = await s.ev(D => [...D.querySelectorAll('.main .at-name')].map(n => n.innerText.trim()));
  assert.ok(rows.includes('AGENTS.override.md') && rows.includes('repo-skill') && rows.includes('Bad_Skill'));
  await s.mouse('.main [role=row]', 'repo-skill');
  await sleep(1800);
  assert.match(await main(), /o\/r/);
  await s.mouse('.sidebar .repo-head', 'agents-repo');
  await sleep(1500);
  await s.mouse('.main [role=row]', 'Bad_Skill');
  await sleep(1800);
  assert.match(await main(), /Spec\s*\n?1\s*\n?1 problem/);
  await s.mouse('.sidebar .repo-head', 'agents-repo');
  await sleep(1500);
  await s.mouse('.main [role=row]', 'AGENTS.override.md');
  await sleep(1800);
  assert.match(await main(), /Not loaded/);
});

test('Restore asks first and names the missing skill', T, async () => {
  await s.mouse('.sidebar .repo-head', 'agents-repo');
  await sleep(1500);
  await s.mouse('.main-head .toolbar button', 'Restore skills');
  const card = await s.waitFor(D => {
    const t = D.body.innerText;
    return /Restore 1 skill/.test(t) && t;
  });
  assert.match(card, /restore-me/);
  assert.match(card, /experimental_install/);
  await s.mouse('.cf button', 'Cancel');
  await sleep(500);
  assert.equal(await s.ev(D => !!D.querySelector('.cf')), false);
});
