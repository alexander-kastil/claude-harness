import * as path from 'path';
import { pointerTokens } from './harness';
import { SLIM, SlimRef, SlimReport, bodyIsLong, descriptionLevel, houseDescriptionFlags, isReference, largestSections, sectionsOf, tokensOf } from './shared/slim';

// What a skill's size and spread say about it: the description, SKILL.md, and how its reference files are spread and
// linked. The thresholds and the pure measures are shared/slim.ts; this reads what SKILL.md points to.

export interface SkillText {
  id: string;
  name: string;
  description: string;
  /** SKILL.md without its frontmatter. */
  body: string;
  /** Every file under the skill's folder, relative, with `/`. */
  files: string[];
  /** The text of a file of the skill; undefined when it cannot be read. */
  read: (rel: string) => string | undefined;
  /** Whether a provider is installed: only then the house rule on descriptions is applied. */
  house: boolean;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

/**
 * The markdown files a text points to, as written: path tokens in code spans (the harness's pointer detection),
 * link targets, and any other `*.md` path in the text.
 */
export function pointedPaths(text: string): string[] {
  const out = new Set<string>();
  for (const t of pointerTokens(text)) if (t.kind === 'path') out.add(t.token);
  for (const m of text.matchAll(/\]\(\s*<?([^)\s>]+)/g)) if (!/^[a-z][a-z0-9+.-]*:/i.test(m[1])) out.add(m[1]);
  for (const m of text.matchAll(/[\w./\\-]+\.md\b/gi)) out.add(m[0]);
  return [...out].filter(t => /\.md(?:#.*)?$/i.test(t)).map(norm);
}

/** Which of the skill's reference files a text sitting at `from` points to: relative to its own folder, or as a path ending in the file's. */
export function pointedFiles(text: string, from: string, refs: string[]): Set<string> {
  const base = path.posix.dirname(from);
  const hit = new Set<string>();
  const byLower = new Map(refs.map(r => [r.toLowerCase(), r]));
  for (const t of pointedPaths(text)) {
    const candidates = [t, base === '.' ? t : path.posix.normalize(`${base}/${t}`)];
    for (const c of candidates) {
      const exact = byLower.get(c);
      if (exact) {
        hit.add(exact);
        continue;
      }
      if (!c.includes('/')) continue;
      for (const [lower, rel] of byLower) if (c.endsWith(`/${lower}`)) hit.add(rel);
    }
  }
  return hit;
}

export function analyzeSkill(s: SkillText): SlimReport {
  const bodyLines = s.body ? s.body.split(/\r?\n/).length : 0;
  const bodyTokens = tokensOf(s.body);
  const long = bodyIsLong(bodyLines, bodyTokens);
  const refFiles = s.files.filter(isReference);
  const texts = new Map(refFiles.map(r => [r, s.read(r) ?? '']));
  const direct = pointedFiles(s.body, 'SKILL.md', refFiles);
  const nestedTo = new Set<string>();
  for (const [rel, text] of texts) for (const hit of pointedFiles(text, rel, refFiles)) if (hit !== rel) nestedTo.add(hit);
  const refs: SlimRef[] = refFiles
    .map(rel => {
      const text = texts.get(rel) ?? '';
      const tokens = tokensOf(text);
      const ref: SlimRef = { rel, lines: text ? text.split(/\r?\n/).length : 0, tokens, link: direct.has(rel) ? 'skill' : nestedTo.has(rel) ? 'nested' : 'none' };
      if (tokens > SLIM.giant) ref.size = 'giant';
      else if (tokens < SLIM.tiny) ref.size = 'tiny';
      return ref;
    })
    .sort((a, b) => b.tokens - a.tokens || a.rel.localeCompare(b.rel));
  const tiny = refs.filter(r => r.size === 'tiny').map(r => r.rel);
  const spread = {
    giant: refs.filter(r => r.size === 'giant').map(r => r.rel),
    tiny,
    manyTiny: tiny.length >= SLIM.manyTiny,
    orphan: refs.filter(r => r.link === 'none').map(r => r.rel),
    nested: refs.filter(r => r.link === 'nested').map(r => r.rel),
  };
  const level = descriptionLevel(s.description);
  const house = s.house ? houseDescriptionFlags(s.description) : undefined;
  const findings = (level ? 1 : 0) + (house?.length ? 1 : 0) + (long ? 1 : 0) + spread.giant.length + (spread.manyTiny ? 1 : 0) + spread.orphan.length + spread.nested.length;
  return {
    id: s.id,
    name: s.name,
    description: { tokens: tokensOf(s.description), chars: s.description.length, ...(level ? { level } : {}), ...(house ? { house } : {}) },
    body: { tokens: bodyTokens, lines: bodyLines, long, sections: long ? largestSections(sectionsOf(s.body)) : [] },
    refs,
    spread,
    findings,
  };
}

/** The findings of the Size card, each with its own Resolve with Claude button. */
export type SizeFinding = 'description' | 'house' | 'body';

const descriptionLine = (r: SlimReport) => `The description is ${r.description.tokens} tokens (${r.description.chars} characters) and is paid in every session; ${r.description.level === 'over' ? `it is past the ${SLIM.descChars} character limit` : `aim for under ${SLIM.descLong} tokens`}.`;
const houseLine = (r: SlimReport) => `The description carries more than routing and trigger phrases (${(r.description.house ?? []).join('; ')}); move the detail into a references file and keep the routing and the trigger phrases.`;
const bodyFindingLines = (r: SlimReport) => [
  `SKILL.md has ${r.body.lines} lines (${r.body.tokens} tokens); the guidance is under ${SLIM.bodyLines} lines.`,
  ...(r.body.sections.length ? [`Largest sections to move into reference files: ${r.body.sections.map(s => `"${s.title}" (${s.tokens} tokens, from line ${s.line})`).join(', ')}.`] : []),
];

/** What the slimming prompt says about the findings, one line each; empty when nothing is flagged. */
export function findingLines(r: SlimReport): string[] {
  const out: string[] = [];
  const d = r.description;
  if (d.level) out.push(descriptionLine(r));
  if (d.house?.length) out.push(houseLine(r));
  if (r.body.long) out.push(...bodyFindingLines(r));
  if (r.spread.giant.length) out.push(`Giant reference files, split them by topic: ${r.spread.giant.map(g => `${g} (${r.refs.find(x => x.rel === g)?.tokens} tokens)`).join(', ')}.`);
  if (r.spread.manyTiny) out.push(`Many tiny reference files, merge those that belong together: ${r.spread.tiny.join(', ')}.`);
  if (r.spread.orphan.length) out.push(`SKILL.md does not point to ${r.spread.orphan.join(', ')}, so Claude never reads it: link it from SKILL.md, or remove it.`);
  if (r.spread.nested.length) out.push(`Only another reference file points to ${r.spread.nested.join(', ')}; link it from SKILL.md directly, one level deep.`);
  return out;
}

/** The prompt of Resolve with Claude on one finding of the Size card: the finding alone, and the order to fix only it. Empty when the report no longer holds it. */
export function resolvePrompt(r: SlimReport, finding: SizeFinding, file: string, files: string[], house: boolean): string {
  const lines = finding === 'description' ? (r.description.level ? [descriptionLine(r)] : []) : finding === 'house' ? (r.description.house?.length ? [houseLine(r)] : []) : r.body.long ? bodyFindingLines(r) : [];
  if (!lines.length) return '';
  const list = files.slice(0, 40).join(', ') + (files.length > 40 ? `, and ${files.length - 40} more` : '');
  return [
    `Resolve one finding on the skill ${r.name} at ${file}. Its files: ${list}.`,
    `Measuring found: ${lines.join(' ')}`,
    `Follow Anthropic's guidance: the description says what the skill does and when to use it, SKILL.md stays under ${SLIM.bodyLines} lines, and detail lives in reference files that SKILL.md links to directly, one level deep.`,
    house ? 'A description is an index entry: routing plus trigger phrases, with the detail in a file under references/.' : '',
    'Fix this one finding and nothing else. Keep the meaning, and tell me what moved where.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The prompt of Slim with Claude: names the skill's files and what the measuring found. */
export function slimPrompt(r: SlimReport, file: string, files: string[], house: boolean): string {
  const list = files.slice(0, 40).join(', ') + (files.length > 40 ? `, and ${files.length - 40} more` : '');
  const lines = findingLines(r);
  return [
    `Slim the skill ${r.name} at ${file}. Its files: ${list}.`,
    lines.length ? `Measuring found: ${lines.map((l, i) => `${i + 1}. ${l}`).join(' ')}` : 'Measuring found nothing past the guidance; look for what could still be shorter.',
    `Follow Anthropic's guidance: the description says what the skill does and when to use it, SKILL.md stays under ${SLIM.bodyLines} lines, and detail lives in reference files that SKILL.md links to directly, one level deep.`,
    house ? 'A description is an index entry: routing plus trigger phrases, with the detail in a file under references/.' : '',
    'Say which text moves where and what you would cut. Do not change any file until I agree.',
  ]
    .filter(Boolean)
    .join(' ');
}
