import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { analyzeSkill, findingLines, pointedFiles, pointedPaths, slimPrompt } from '../../src/slim';
import { SLIM, bodyIsLong, descCost, descriptionLevel, houseDescriptionFlags, isReference, largestSections, sectionsOf, tokensOf } from '../../src/shared/slim';
import { USAGE_VERSION } from '../../src/usage';
import type { FileEntry, IndexData } from '../../src/usage';
import { sessionsListed, usageTotals } from '../../src/usage-rows';
import type { UsageTarget } from '../../src/usage-rows';

const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');
const para = (tokens: number) => 'x'.repeat(tokens * 4);

test('tokens are four characters, and only markdown outside the plain-file folders is a reference', () => {
  assert.equal(tokensOf('x'.repeat(400)), 100);
  assert.equal(tokensOf(''), 0);
  assert.ok(isReference('references/a.md'));
  assert.ok(isReference('guide.md'));
  assert.ok(!isReference('SKILL.md'));
  assert.ok(!isReference('templates/a.md'));
  assert.ok(!isReference('evals/e.md'));
  assert.ok(!isReference('scripts/run.ps1'));
});

test('a description is long past 200 tokens and over past 1024 characters', () => {
  assert.equal(descriptionLevel('x'.repeat(800)), undefined);
  assert.equal(descriptionLevel('x'.repeat(804)), 'long');
  assert.equal(descriptionLevel('x'.repeat(1024)), 'long');
  assert.equal(descriptionLevel('x'.repeat(1025)), 'over');
});

test('SKILL.md is long past 500 lines or 5000 tokens', () => {
  assert.ok(!bodyIsLong(500, 100));
  assert.ok(bodyIsLong(501, 100));
  assert.ok(bodyIsLong(10, 5001));
});

test('the description cost is tokens times sessions, and nothing without a session count', () => {
  assert.equal(descCost(120, 30), 3600);
  assert.equal(descCost(120, undefined), undefined);
  assert.equal(descCost(120, 0), 0);
});

test('sections: the ## headings outside code fences, up to the next heading of their level or above', () => {
  const body = ['# Title', 'intro', '## One', para(300), '### Sub', para(50), '```', '## not a heading', '```', '## Two', para(20), '# Other', '## Three', para(250)].join('\n');
  const s = sectionsOf(body);
  assert.deepEqual(
    s.map(x => [x.title, x.line]),
    [
      ['One', 3],
      ['Two', 10],
      ['Three', 13],
    ]
  );
  assert.ok(s[0].tokens > 300 && s[0].tokens < 370, `one is ${s[0].tokens}`);
  assert.equal(s[0].lines, 7);
  assert.equal(s[1].lines, 2);
});

test('the largest sections are the ones worth 200 tokens, biggest first, five at most', () => {
  const sections = [10, 500, 300, 100, 900, 250, 260, 210].map((t, i) => ({ title: `s${i}`, line: i + 1, lines: 5, tokens: t }));
  const top = largestSections(sections);
  assert.deepEqual(
    top.map(x => x.tokens),
    [900, 500, 300, 260, 250]
  );
  assert.deepEqual(largestSections([{ title: 'a', line: 1, lines: 1, tokens: SLIM.sectionMin - 1 }]), []);
});

test('house rule: routing and trigger phrases pass, a description that carries more is flagged', () => {
  assert.deepEqual(houseDescriptionFlags('Build and sideload our VS Code extension. Triggers on "sideload", "install from vsix", "the panel is blank".'), []);
  assert.deepEqual(houseDescriptionFlags('Short routing line with no trigger words'), []);
  const detail = houseDescriptionFlags('Covers A. Covers B. Covers C. Covers D. Covers E. Triggers on: "x".');
  assert.deepEqual(detail, ['5 sentences before the trigger phrases']);
  assert.deepEqual(houseDescriptionFlags(`${words(95)}. Use when "x".`), ['95 words of routing']);
  assert.deepEqual(houseDescriptionFlags(`${words(85)}. Use when "x".`), []);
  assert.deepEqual(houseDescriptionFlags('Read the ONE matching reference in references/sideload.md or references/update.md. Triggers on: "x".'), ['names 2 paths or code spans']);
  assert.deepEqual(houseDescriptionFlags('Runs `npm test` and `npm run compile`. Triggers on: "x".'), ['names 2 paths or code spans']);
  // One path or code span can be the routing itself.
  assert.deepEqual(houseDescriptionFlags('Routes to `claude-learn`. Triggers on: "x".'), []);
  // The trigger phrases themselves may name anything.
  assert.deepEqual(houseDescriptionFlags('Routes to the right reference. Triggers on: "references/a.md", `code`, "x. Y. Z. W. V."'), []);
});

test('pointers: code-span paths, link targets and plain .md paths, with anchors and ./ dropped', () => {
  const text = ['See `references/a.md` and [the b guide](./references/b.md#top).', 'Also read references/c.md before starting, and `scripts/run.ps1`.', '[site](https://example.com/d.md)'].join('\n');
  const found = pointedPaths(text);
  assert.ok(found.includes('references/a.md'));
  assert.ok(found.includes('references/b.md'));
  assert.ok(found.includes('references/c.md'));
  assert.ok(!found.some(f => f.includes('run.ps1')));
});

test('a text points to a reference relative to its own folder, or by a path that ends in the file', () => {
  const refs = ['references/a.md', 'references/deep/b.md', 'guide.md'];
  assert.deepEqual([...pointedFiles('Read `references/a.md` first', 'SKILL.md', refs)], ['references/a.md']);
  assert.deepEqual([...pointedFiles('See [b](deep/b.md)', 'references/a.md', refs)], ['references/deep/b.md']);
  assert.deepEqual([...pointedFiles('Read `guide.md`', 'SKILL.md', refs)], ['guide.md']);
  assert.deepEqual([...pointedFiles('Read `skills/mine/references/a.md`', 'SKILL.md', refs)], ['references/a.md']);
  // A bare name does not reach into a folder from the skill's root.
  assert.deepEqual([...pointedFiles('Read `a.md`', 'SKILL.md', refs)], []);
  assert.deepEqual([...pointedFiles('Read `REFERENCES/A.MD`', 'SKILL.md', refs)], ['references/a.md']);
});

const skill = (over: Partial<Parameters<typeof analyzeSkill>[0]> & { texts?: Record<string, string> }) => {
  const texts = over.texts ?? {};
  return analyzeSkill({
    id: 's',
    name: 'scratch',
    description: 'Does a thing. Triggers on: "do it".',
    body: '# Scratch\nShort.',
    files: ['SKILL.md', ...Object.keys(texts)],
    read: rel => texts[rel],
    house: false,
    ...over,
  });
}

test('a lean skill is flagged for nothing', () => {
  const r = skill({ body: 'See `references/a.md`.', texts: { 'references/a.md': para(400) } });
  assert.equal(r.findings, 0);
  assert.equal(r.description.level, undefined);
  assert.equal(r.body.long, false);
  assert.deepEqual(r.body.sections, []);
  assert.equal(r.refs[0].link, 'skill');
  assert.equal(r.description.house, undefined);
});

test('a long SKILL.md is flagged with the largest sections, and a long description with its level', () => {
  const body = ['# Big', '## A', ...Array.from({ length: 300 }, () => 'a line of instructions that is long enough'), '## B', ...Array.from({ length: 250 }, () => 'another line of instructions here'), '## Small', 'tiny'].join('\n');
  const r = skill({ body, description: 'x'.repeat(900) });
  assert.equal(r.body.long, true);
  assert.equal(r.body.lines, 555);
  assert.deepEqual(
    r.body.sections.map(s => s.title),
    ['A', 'B']
  );
  assert.equal(r.description.level, 'long');
  assert.equal(r.findings, 2);
  const lines = findingLines(r);
  assert.ok(lines.some(l => l.includes("555 lines")));
  assert.ok(lines.some(l => l.includes('"A"')));
});

test('references: an orphan nothing points to, one reached only through another, a giant and many tiny ones', () => {
  const texts = {
    'references/linked.md': `${para(300)} then see \`references/deep.md\``,
    'references/deep.md': para(300),
    'references/orphan.md': para(300),
    'references/giant.md': para(SLIM.giant + 100),
    'references/t1.md': para(20),
    'references/t2.md': para(20),
    'references/t3.md': para(20),
  };
  const body = 'Read `references/linked.md`, [giant](references/giant.md), `references/t1.md`, `references/t2.md`, `references/t3.md`.';
  const r = skill({ body, texts });
  const by = Object.fromEntries(r.refs.map(x => [x.rel, x]));
  assert.equal(by['references/linked.md'].link, 'skill');
  assert.equal(by['references/deep.md'].link, 'nested');
  assert.equal(by['references/orphan.md'].link, 'none');
  assert.deepEqual(r.spread.orphan, ['references/orphan.md']);
  assert.deepEqual(r.spread.nested, ['references/deep.md']);
  assert.deepEqual(r.spread.giant, ['references/giant.md']);
  assert.equal(r.spread.manyTiny, true);
  assert.equal(r.spread.tiny.length, 3);
  assert.equal(r.refs[0].rel, 'references/giant.md');
  assert.equal(r.findings, 1 + 1 + 1 + 1);
  const lines = findingLines(r).join('\n');
  assert.ok(lines.includes('never reads it'));
  assert.ok(lines.includes('one level deep'));
});

test('two tiny files are not many', () => {
  const r = skill({ body: '`references/t1.md` `references/t2.md`', texts: { 'references/t1.md': para(10), 'references/t2.md': para(10) } });
  assert.equal(r.spread.manyTiny, false);
  assert.equal(r.findings, 0);
});

test('the house rule is measured only with a provider', () => {
  const heavy = 'Covers A. Covers B. Covers C. Covers D. Triggers on: "x".';
  assert.equal(skill({ description: heavy }).description.house, undefined);
  const r = skill({ description: heavy, house: true });
  assert.deepEqual(r.description.house, ['4 sentences before the trigger phrases']);
  assert.equal(r.findings, 1);
  assert.deepEqual(skill({ house: true }).description.house, []);
});

test('the slimming prompt names the skill, its files and what was found, and changes nothing before the owner agrees', () => {
  const r = skill({ body: Array.from({ length: 600 }, () => 'line').join('\n'), texts: { 'references/orphan.md': para(300) } });
  const prompt = slimPrompt(r, 'C:/x/SKILL.md', ['SKILL.md', 'references/orphan.md'], false);
  assert.ok(prompt.includes('Slim the skill scratch at C:/x/SKILL.md'));
  assert.ok(prompt.includes('SKILL.md, references/orphan.md'));
  assert.ok(prompt.includes('600 lines'));
  assert.ok(prompt.includes('references/orphan.md, so Claude never reads it'));
  assert.ok(prompt.includes('Do not change any file until I agree'));
  assert.ok(!prompt.includes('index entry'));
  assert.ok(slimPrompt(r, 'C:/x/SKILL.md', [], true).includes('index entry'));
  assert.ok(!/[`"$%^&|<>]/.test(prompt.replace(/"/g, '')), 'nothing a shell would read except the quotes the caller strips');
});

const entry = (over: Partial<FileEntry>): FileEntry => ({ size: 1, mtime: 1, ino: 1, birth: 1, offset: 1, hits: [], ...over });

test('sessions listed: every main session for a global skill, the repo ones for an own skill, minus repos with their own copy', () => {
  const repoA = path.resolve('/work/a');
  const repoB = path.resolve('/work/b');
  const data: IndexData = {
    version: USAGE_VERSION,
    files: {
      '/p/a1.jsonl': entry({ cwd: repoA }),
      '/p/a2.jsonl': entry({ cwd: path.join(repoA, 'sub') }),
      '/p/b1.jsonl': entry({ cwd: repoB }),
      '/p/none.jsonl': entry({}),
      '/p/a1/subagents/agent-1.jsonl': entry({ main: '/p/a1.jsonl' }),
    },
  };
  const cwds = Object.values(data.files).filter(e => !e.main).map(e => e.cwd);
  const norm = (c?: string) => (c ? (process.platform === 'win32' ? path.resolve(c).toLowerCase() : path.resolve(c)) : undefined);
  const list = cwds.map(norm);
  const global: UsageTarget = { kind: 'skill', name: 's', outside: [] };
  assert.equal(sessionsListed(list, global), 4);
  assert.equal(sessionsListed(list, global, repoA), 2);
  assert.equal(sessionsListed(list, { ...global, outside: [repoA] }), 2);
  assert.equal(sessionsListed(list, { ...global, inside: repoB }), 1);
  const totals = usageTotals(data, [{ id: 'g', target: global }, { id: 'a', target: global, dir: repoA }], true);
  assert.equal(totals.g.sessions, 4);
  assert.equal(totals.a.sessions, 2);
  assert.equal(usageTotals(data, [{ id: 'g', target: global }]).g.sessions, undefined);
});
