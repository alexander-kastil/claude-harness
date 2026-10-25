// How big a skill is and how its files are spread: the Slim card on the Instructions tab (description, SKILL.md and the
// sections to move out), the spread chart on the References tab, and the description cost columns of the Skills type page.
// The host measures (src/slim.ts, answering `slim`); the weight of a flag comes from the usage index, which this never builds.
import type { Asset } from '../harness';
import type { SlimReport } from '../shared/slim';
import { SLIM, descCost, descriptionLevel, houseDescriptionFlags, tokensOf } from '../shared/slim';
import { openAt, state, std, vscode } from './core';
import { card } from './detail-view';
import { el, fmtNum, icon, pressable, plural } from './dom';
import { fmtTokens } from './refs';
import { NOT_COUNTED, NOT_COUNTED_TIP, askTotals, totalOf, totalsKnown } from './usage-more';

const reports = new Map<string, SlimReport | false>();
const asked = new WeakSet<object>();

/** The report of a skill, once the host answered; undefined before, or for a skill without a folder. */
export const slimOf = (id: string): SlimReport | undefined => reports.get(id) || undefined;

/** Asks for the report and the uses of a skill once per loaded detail; the page repaints when the answer differs. */
export function askSlim(a: Asset): void {
  const d = state.detail;
  if (a.kind !== 'skill' || !d || asked.has(d)) return;
  asked.add(d);
  vscode.postMessage({ type: 'slim', id: a.id });
  askTotals('skill');
}

/** Stores the host's answer; true when the page showing the skill has something new to draw. */
export function storeSlim(m: { id: string; report?: SlimReport }): boolean {
  const before = JSON.stringify(reports.get(m.id));
  reports.set(m.id, m.report ?? false);
  return before !== JSON.stringify(reports.get(m.id));
}

type Tone = '' | 'warn' | 'bad' | 'quiet';

const indexed = () => totalsKnown('skill') === true;

/** Sessions the description was listed in and the skill's uses, from the usage index; undefined without one. */
const weightOf = (a: Asset) => {
  const t = indexed() ? totalOf(a) : undefined;
  // An index that holds no session for the skill says nothing about it: no "0 sessions", no "never ran".
  return t && (t.sessions || t.count) ? { sessions: t.sessions, uses: t.count } : undefined;
};

/** What the description costs: its tokens, and with an index those over every session it was listed in. */
export function descLine(a: Asset, r: SlimReport): string {
  const w = weightOf(a);
  const cost = descCost(r.description.tokens, w?.sessions);
  const base = `${fmtTokens(r.description.tokens)} tokens, ${r.description.chars} characters, in the list of every session`;
  return cost === undefined ? base : `${base}. Over ${plural(w!.sessions!, 'indexed session')}: about ${fmtNum(cost)} tokens.`;
}

/** What SKILL.md costs: its size, and with an index how often it ran, which is how often those tokens were paid. */
export function bodyLine(a: Asset, r: SlimReport): string {
  const w = weightOf(a);
  const base = `${plural(r.body.lines, 'line')}, ${fmtTokens(r.body.tokens)} tokens when the skill runs`;
  if (!w) return base;
  return w.uses ? `${base}. Ran ${plural(w.uses, 'time')}: about ${fmtNum(r.body.tokens * w.uses)} tokens.` : `${base}. Never ran in the indexed sessions.`;
}

/** The "Always loaded" and "On use" tiles' note and tone for a flagged description or SKILL.md. */
export function tileFlags(a: Asset, r: SlimReport | undefined): { desc?: { note: string; tone: Tone; tip: string }; body?: { note: string; tone: Tone; tip: string } } {
  if (!r) return {};
  const out: ReturnType<typeof tileFlags> = {};
  const w = weightOf(a);
  const cost = descCost(r.description.tokens, w?.sessions);
  if (r.description.level)
    out.desc = {
      note: `${r.description.level === 'over' ? `over ${SLIM.descChars} characters` : 'long'}${cost === undefined ? '' : ` · ~${fmtNum(cost)} in ${plural(w!.sessions!, 'session')}`}`,
      tone: 'warn',
      tip: `Long description\n${descLine(a, r)}. A description is paid in every session, so a long one costs the most. Say what the skill does and when to use it.`,
    };
  if (r.body.long)
    out.body = {
      note: `${plural(r.body.lines, 'line')}${w ? (w.uses ? ` · ran ${w.uses}x` : ' · never ran') : ''}`,
      tone: w && !w.uses ? 'quiet' : 'warn',
      tip: `SKILL.md is long\n${bodyLine(a, r)}. Anthropic's guidance is a body under ${SLIM.bodyLines} lines, with the rest in reference files that SKILL.md links to.`,
    };
  return out;
}

/** A relative path as text: the folders shrink with an ellipsis, the file name always stays whole. */
export function pathText(rel: string): HTMLElement {
  const cut = rel.lastIndexOf('/');
  return el('span', { className: 'path-text' }, cut >= 0 ? el('span', { className: 'path-dir' }, rel.slice(0, cut + 1)) : null, el('span', { className: 'path-name' }, rel.slice(cut + 1)));
}

type BarRow = { path?: boolean; glyph: string; label: string; tokens: number; max: number; tone: Tone; flags?: [string, string, Tone][]; title: string; open: () => void; sub?: string };

// One row per item in fixed columns: name, a bar whose length is its tokens, the tokens, the flags.
function barRow(r: BarRow): HTMLElement {
  const fill = el('span', { className: 'sl-fill' });
  fill.style.width = `${Math.max(2, Math.round((r.tokens / r.max) * 100))}%`;
  return el(
    'div',
    Object.assign({ className: `sl-bar-row${r.tone ? ` ${r.tone}` : ''}`, title: r.title }, pressable(r.open)),
    el('span', { className: 'sl-name' }, icon(r.glyph), r.path ? pathText(r.label) : el('span', {}, r.label)),
    el('span', { className: 'sl-track' }, fill),
    el('span', { className: 'sl-n' }, fmtTokens(r.tokens)),
    el('span', { className: 'sl-flags' }, (r.flags || []).map(([text, tip, tone]) => el('span', { className: `dv-chip sl-flag${tone ? ` ${tone}` : ''}`, title: tip }, text)))
  );
}

const flagRow = (glyph: string, tone: Tone, head: string, text: string, tip?: string) =>
  el('div', { className: `sl-row${tone ? ` ${tone}` : ''}`, title: tip }, icon(glyph), el('span', { className: 'sl-head' }, head), el('span', { className: 'sl-text' }, text));

/** The flags on the description and SKILL.md, with the sections to move into reference files. Null when neither is flagged. */
export function slimCard(a: Asset, r: SlimReport | undefined): HTMLElement | null {
  if (!r) return null;
  const house = std(undefined) && r.description.house?.length ? r.description.house : [];
  if (!r.description.level && !house.length && !r.body.long) return null;
  const w = weightOf(a);
  const sections = r.body.sections;
  const max = Math.max(1, ...sections.map(s => s.tokens));
  const count = (r.description.level ? 1 : 0) + (house.length ? 1 : 0) + (r.body.long ? 1 : 0);
  return card(
    'Size',
    count,
    r.description.level
      ? flagRow('layers', 'warn', r.description.level === 'over' ? 'Description past the limit' : 'Long description', descLine(a, r), `A description is paid in every session\nAnthropic's guidance: at most ${SLIM.descChars} characters, what the skill does and when to use it.`)
      : null,
    house.length
      ? flagRow('list-flat', 'warn', 'More than an index entry', `${house.join(' · ')}. A description is routing plus trigger phrases; the detail goes to a file under references/.`, 'House rule\nA description is an index entry: routing plus trigger phrases, with the detail in references/<leaf>.md.')
      : null,
    r.body.long
      ? flagRow('file', w && !w.uses ? 'quiet' : 'warn', 'SKILL.md is long', bodyLine(a, r), `Anthropic's guidance\nKeep the SKILL.md body under ${SLIM.bodyLines} lines and link reference files from it.`)
      : null,
    r.body.long && sections.length
      ? el(
          'div',
          { className: 'sl-sections' },
          el('div', { className: 'sl-sub' }, 'Largest sections, to move into reference files'),
          el(
            'div',
            { className: 'sl-bars' },
            sections.map(s => barRow({ glyph: 'symbol-string', label: s.title, tokens: s.tokens, max, tone: '', title: `${s.title}\nFrom line ${s.line}, ${plural(s.lines, 'line')}, ${fmtTokens(s.tokens)} tokens. Opens SKILL.md there.`, open: () => openAt(a.file, s.line) }))
          )
        )
      : null
  );
}

const FLAGS = {
  none: ['Not linked', "Not linked from SKILL.md\nNothing in SKILL.md points to this file, so Claude never reads it. Link it from SKILL.md, or remove it.", 'bad'],
  nested: ['Two levels deep', "Only another reference links to it\nAnthropic's guidance is to link reference files directly from SKILL.md, one level deep.", 'warn'],
  giant: ['Giant', `Over ${SLIM.giant} tokens\nClaude reads the whole file when it opens it. Split it by topic.`, 'warn'],
  tiny: ['Tiny', `Under ${SLIM.tiny} tokens\nA file this small costs a read of its own. Merge the ones that belong together.`, 'quiet'],
} as const;

/** The References tab: every reference file with its tokens, the largest first, and what is wrong with its place in the skill. */
export function spreadCard(a: Asset, r: SlimReport, open: (rel: string) => void): HTMLElement {
  const max = Math.max(1, ...r.refs.map(x => x.tokens));
  const total = r.refs.reduce((n, x) => n + x.tokens, 0);
  const chip = (glyph: string, text: string, tone: Tone = '', tip?: string) => el('span', { className: `dv-chip${tone ? ` ${tone}` : ''}`, title: tip }, icon(glyph), text);
  return card(
    'References',
    r.refs.length,
    el(
      'div',
      { className: 'sl-sum' },
      chip('files', `${fmtTokens(total)} tokens in all`),
      r.spread.orphan.length ? chip('debug-disconnect', `${r.spread.orphan.length} not linked`, 'bad', FLAGS.none[1]) : null,
      r.spread.nested.length ? chip('type-hierarchy', `${r.spread.nested.length} two levels deep`, 'warn', FLAGS.nested[1]) : null,
      r.spread.giant.length ? chip('arrow-both', `${r.spread.giant.length} giant`, 'warn', FLAGS.giant[1]) : null,
      r.spread.manyTiny ? chip('dash', `${r.spread.tiny.length} tiny`, 'warn', `Many tiny files\n${FLAGS.tiny[1].split('\n')[1]}`) : null
    ),
    el(
      'div',
      { className: 'sl-bars' },
      r.refs.map(x => {
        const flags = [x.link === 'none' ? FLAGS.none : x.link === 'nested' ? FLAGS.nested : undefined, x.size ? FLAGS[x.size] : undefined].filter(Boolean) as unknown as [string, string, Tone][];
        const tone: Tone = x.link === 'none' ? 'bad' : x.link === 'nested' || x.size === 'giant' ? 'warn' : x.size === 'tiny' ? 'quiet' : '';
        return barRow({ path: true, glyph: 'markdown', label: x.rel, tokens: x.tokens, max, tone, flags, title: `${x.rel}\n${plural(x.lines, 'line')}, ${fmtTokens(x.tokens)} tokens. Opens the file.`, open: () => open(x.rel) });
      })
    )
  );
}

// The Skills type page: the description's tokens, and what they cost over the sessions it was listed in.

/** Tokens of a skill's description, from the description the page already holds. */
export const descTokens = (a: Asset) => tokensOf(a.description || '');

/** Tokens times the sessions the skill was listed in; undefined without the usage index. */
export function descCostOf(a: Asset): number | undefined {
  if (totalsKnown(a.kind) !== true) return undefined;
  return descCost(descTokens(a), totalOf(a)?.sessions);
}

/** The Cost cell: tokens times sessions, or a dash while only the tokens are known. */
export function costText(a: Asset): string {
  const known = totalsKnown(a.kind);
  if (known === undefined) return '...';
  if (!known) return NOT_COUNTED;
  const c = descCostOf(a);
  return c === undefined ? '' : `~${fmtNum(c)}`;
}

export function costTip(a: Asset): string {
  const known = totalsKnown(a.kind);
  if (known === false) return `${NOT_COUNTED_TIP} Until then only the description tokens are shown.`;
  const t = totalOf(a);
  if (!t || t.sessions === undefined) return '';
  return `Description cost\n${fmtTokens(descTokens(a))} tokens in the list of each of ${plural(t.sessions, 'indexed session')}, whether the skill ran or not.`;
}

/** The "Long description" preset: more than the guidance's tokens. */
export const hasLongDescription = (a: Asset) => !!descriptionLevel(a.description || '');

/** The house preset: a description that carries more than routing and trigger phrases. Never matches without a provider. */
export const hasHeavyDescription = (a: Asset) => !!std(undefined) && houseDescriptionFlags(a.description || '').length > 0;

/** Order for the ranked preset: the dearest description first; by tokens alone while there is no index. */
export const byDescriptionCost = (x: Asset, y: Asset) => (descCostOf(y) ?? descTokens(y)) - (descCostOf(x) ?? descTokens(x)) || descTokens(y) - descTokens(x);
