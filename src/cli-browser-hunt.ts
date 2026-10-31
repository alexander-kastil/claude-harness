import * as os from 'os';
import * as path from 'path';
import { candidateTable, digestsOf, findSessions, parsePeriod, plain } from './automation-sessions';
import { Args, Io, Stop, emit, headline, load, one, table } from './cli-core';
import { KEEP_LABELS, parseProcedures } from './browser-hunt';
import { CardPlan, SKILL, locateSkill, planCardWrite, writeCard } from './browser-hunt-skill';
import { BROWSER_KEEPS } from './shared/browser-hunt';
import type { BrowserCard, BrowserKeep } from './shared/browser-hunt';

// The Browser Automation Hunter on the command line: the procedures of the browser-automations skill, and a procedure card written into it.
// The page's cards and its chat with Claude live in VS Code's own storage and are not readable here.

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `browser-hunt procedures`: the rows of the skill's procedure table. */
function procedures(a: Args, io: Io): number {
  const w = load(a);
  const s = locateSkill(w.views, w.plugins, w.root);
  const list = parseProcedures(s.text);
  const lines = [
    headline(`Browser automation procedures: ${list.length}${s.file ? ` (${s.file})` : ''}`),
    '',
    ...(s.file || list.length ? (list.length ? table(['Procedure', 'Keep as', 'How'], list.map(p => [p.name, KEEP_LABELS[p.keep], p.how])) : [`${SKILL} lists no procedure yet.`]) : [`No ${SKILL} skill was found in Global, a repo or an installed plugin.`]),
    ...(s.problem ? ['', s.problem] : []),
  ];
  emit(io, a, { source: s.file ?? null, problem: s.problem ?? null, procedures: list }, lines);
  return 0;
}

function cardOf(a: Args): BrowserCard {
  const name = one(a, 'name');
  if (!name || !NAME.test(name)) throw new Stop('browser-hunt needs --name <procedure> in lowercase kebab-case.', 2);
  const keep = one(a, 'keep') ?? 'guided';
  if (!BROWSER_KEEPS.some(k => k.id === keep)) throw new Stop(`--keep takes ${BROWSER_KEEPS.map(k => k.id).join(', ')}, got "${keep}".`, 2);
  const stage = one(a, 'stage') ?? 'prototype';
  if (stage !== 'prototype' && stage !== 'optimized') throw new Stop(`--stage takes prototype or optimized, got "${stage}".`, 2);
  // A step that ends in "(manual)" stays with the person: sign-in, invite acceptance, MFA, an approval.
  const steps = (a.flags.get('step') ?? []).map(s => s.trim()).filter(Boolean).map(s => ({ text: s.replace(/\s*\(manual\)$/i, ''), manual: /\(manual\)$/i.test(s) }));
  return { id: `cli-${Date.now().toString(36)}`, prompt: '', created: Date.now(), name, goal: one(a, 'goal') ?? '', keep: keep as BrowserKeep, stage, steps };
}

interface CardOut {
  name: string;
  source: string | null;
  location: string;
  files: string[];
  backups: string[];
  plugin: string | null;
  installed: boolean;
  version: string | null;
  steps: number;
  problem: string | null;
  /** What the write said; null on a plan. */
  result: string | null;
}

const cardLines = (o: CardOut, dry: boolean): string[] => [
  headline(`${dry ? '[dry-run] ' : ''}Procedure ${o.name} into ${SKILL}`),
  '',
  ...table(['Field', 'Value'], [['Location', o.location || '-'], ['Steps', String(o.steps)], ['Plugin', o.plugin ? `${o.plugin}${o.version ? ` -> ${o.version}` : ''}${o.installed ? ' (installed, updated)' : ''}` : '-']]),
  '',
  ...(o.files.length ? table(['File', 'Backed up'], o.files.map(f => [f, o.backups.some(b => f.endsWith(b)) ? 'yes' : '-'])) : []),
  ...(o.problem ? [o.problem] : []),
  ...(o.result ? ['', o.result] : []),
];

/** `browser-hunt plan|create`: a procedure card as the page's Create writes it. */
async function card(a: Args, io: Io, dry: boolean): Promise<number> {
  const w = load(a);
  const c = cardOf(a);
  const s = locateSkill(w.views, w.plugins, w.root);
  const plan: CardPlan = planCardWrite(s, c, { root: w.root, views: w.views });
  const out: CardOut = { name: c.name, source: s.file ?? null, location: plan.location, files: plan.files, backups: plan.backups, plugin: plan.plugin ?? null, installed: plan.installed, version: plan.bump?.version ?? null, steps: c.steps.length, problem: plan.problem ?? null, result: null };
  if (!dry) {
    if (plan.problem) throw new Stop(`Nothing was written: ${plan.problem}`);
    out.result = await writeCard(w.root, s, c, plan);
  }
  emit(io, a, out, cardLines(out, dry), !dry);
  return 0;
}

/** `browser-hunt sessions`: the sessions of a period that used a browser page or a desktop app, found by the prefilter. */
async function sessions(a: Args, io: Io): Promise<number> {
  const spec = one(a, 'period');
  const period = spec === undefined ? undefined : parsePeriod(spec);
  if (spec !== undefined && !period) throw new Stop(`--period takes this week, last week or week N, got "${spec}".`, 2);
  const source = one(a, 'source');
  if (source !== undefined && source !== 'cowork' && source !== 'code') throw new Stop(`--source takes cowork or code, got "${source}".`, 2);
  const limit = one(a, 'limit') === undefined ? undefined : Number(one(a, 'limit'));
  if (limit !== undefined && !(limit > 0)) throw new Stop(`--limit takes a number above 0, got "${one(a, 'limit')}".`, 2);
  const root = path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));
  const found = await findSessions({ root, period, source, limit });
  const digests = one(a, 'digest') ? await digestsOf(found) : undefined;
  const lines = [
    headline(`Browser and desktop sessions: ${found.length} (${period?.label ?? 'all'})`),
    '',
    ...(found.length ? candidateTable(found) : ['No session used a browser page or a desktop app in this period.']),
    ...(digests ? ['', ...digests.map(d => `${d.text}\n`)] : []),
  ];
  emit(io, a, { period: period?.label ?? null, from: period?.from ?? null, to: period?.to ?? null, candidates: found.map(plain), ...(digests ? { digests } : {}) }, lines);
  return 0;
}

export async function browserHuntCommand(a: Args, io: Io): Promise<number> {
  const [, sub] = a.words;
  if (sub === 'sessions') return sessions(a, io);
  if (sub === 'procedures') return procedures(a, io);
  if (sub === 'plan') return card(a, io, true);
  if (sub === 'create') return card(a, io, !!one(a, 'dry-run'));
  throw new Stop('browser-hunt needs a subcommand: browser-hunt procedures | sessions | plan | create.', 2);
}
