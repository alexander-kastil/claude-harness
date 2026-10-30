import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Args, Io, Stop, emit, fmtCount, fmtPct, fmtUsd, headline, one, table } from './cli-core';
import { projectSlug } from './repos-overview';
import { Account, AgentRun, SessionSummary, WeekEntry, accountWeek, findSession, listSessions, messageCost, readRecords, readSession, weekEntries } from './sessions';

// `usage` and `delegation --session`: one session's tokens, cost and agents, read from its transcript.

interface Target {
  repo: string;
  root: string;
  summary: SessionSummary;
}

interface ModelRow {
  model: string;
  tokens: number;
  usd: number;
}

/** A share as a whole percentage; a share above 0 and below 1% reads as `<1%`. */
const sharePct = (share: number) => (share > 0 && share < 0.01 ? '<1%' : fmtPct(share));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The session `--session` names: `latest`, `previous` (the one before it in the repo's list) or an id. */
function target(a: Args): Target {
  const id = one(a, 'session');
  if (!id) throw new Stop('--session is required: latest, previous or a session id.', 2);
  const repo = path.resolve(one(a, 'repo') ?? process.cwd());
  const root = path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));
  const summary = id === 'latest' ? listSessions(repo, root)[0] : id === 'previous' ? listSessions(repo, root)[1] : findSession(repo, root, id);
  if (!summary) throw new Stop(`No session ${id} in ${repo}.`, 1);
  return { repo, root, summary };
}

/** The transcripts of the agents a session launched, in its `subagents` folder. */
function subagentFiles(summary: SessionSummary): string[] {
  const dir = path.join(path.dirname(summary.file), summary.id, 'subagents');
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

const tokensOf = (u: WeekEntry['usage']) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);

/** Tokens and cost by model over the main transcript and the subagents' transcripts; a message id counts once. */
async function modelRows(summary: SessionSummary): Promise<ModelRow[]> {
  const seen = new Set<string>();
  const rows = new Map<string, ModelRow>();
  for (const file of [summary.file, ...subagentFiles(summary)]) {
    for (const e of weekEntries(await readRecords(file).catch(() => []))) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      const row = rows.get(e.model) ?? { model: e.model, tokens: 0, usd: 0 };
      row.tokens += tokensOf(e.usage);
      row.usd += messageCost(e.model, e.usage);
      rows.set(e.model, row);
    }
  }
  return [...rows.values()].sort((x, y) => y.usd - x.usd);
}

/** Launches and cost per agent type, costliest first. */
function typeRows(runs: AgentRun[]) {
  const rows = new Map<string, { type: string; launches: number; usd: number }>();
  for (const r of runs) {
    const row = rows.get(r.type) ?? { type: r.type, launches: 0, usd: 0 };
    row.launches += 1;
    row.usd += r.usage.cost;
    rows.set(r.type, row);
  }
  return [...rows.values()].sort((x, y) => y.usd - x.usd);
}

/** The week the session falls in, and its share of that week's cost. `week_pct` is the share of the week's used percentage. */
async function weekOf(root: string, usd: number, used: number | undefined) {
  const account: Account = { label: path.basename(root), root };
  const week = await accountWeek(account);
  const share = week.cost ? usd / week.cost : 0;
  return {
    since: new Date(week.since).toISOString(),
    until: new Date(week.until).toISOString(),
    usd: week.cost,
    share,
    ...(used === undefined ? {} : { week_pct: round3(share * used) }),
  };
}

export async function usageCommand(a: Args, io: Io): Promise<number> {
  const { root, summary } = target(a);
  const models = await modelRows(summary);
  const usd = models.reduce((n, m) => n + m.usd, 0);
  const agents = typeRows((await readSession(summary)).agents);
  let week: Awaited<ReturnType<typeof weekOf>> | undefined;
  if (a.flags.has('week')) {
    const used = one(a, 'week-used');
    const pct = used === undefined ? undefined : Number(used);
    if (pct !== undefined && !Number.isFinite(pct)) throw new Stop('--week-used needs a percentage, such as 40.', 2);
    week = await weekOf(root, usd, pct);
  }
  const json = {
    session: summary.id,
    models: models.map(m => ({ model: m.model, tokens: m.tokens, usd: m.usd, share: usd ? m.usd / usd : 0 })),
    agents,
    usd,
    week,
  };
  const text = [
    headline(`Usage · ${summary.id.slice(0, 8)} · ${fmtUsd(usd)}`),
    '',
    ...table(['Model', 'Tokens', 'Cost', 'Share'], json.models.map(m => [m.model, fmtCount(m.tokens), fmtUsd(m.usd), sharePct(m.share)]), [false, true, true, true]),
    '',
    ...table(['Agent type', 'Launches', 'Cost'], agents.map(g => [g.type, g.launches, fmtUsd(g.usd)]), [false, true, true]),
  ];
  if (week) {
    const span = `${week.since.slice(0, 10)} to ${week.until.slice(0, 10)}`;
    const pct = week.week_pct === undefined ? '' : `${week.week_pct.toFixed(3)}%`;
    text.push('', ...table(['Week', 'Cost', 'Share', 'Week %'], [[span, fmtUsd(week.usd), sharePct(week.share), pct]], [false, true, true, true]));
  }
  emit(io, a, json, text);
  return 0;
}

export async function delegationCommand(a: Args, io: Io): Promise<number> {
  const { repo, root, summary } = target(a);
  const detail = await readSession(summary);
  const events = await readRecords(path.join(root, 'projects', projectSlug(repo), summary.id, 'delegation-events.jsonl')).catch(() => []);
  const byHook: Record<string, number> = {};
  const byTone: Record<string, number> = {};
  for (const e of events) {
    if (typeof e.hook === 'string') byHook[e.hook] = (byHook[e.hook] ?? 0) + 1;
    if (typeof e.tone === 'string') byTone[e.tone] = (byTone[e.tone] ?? 0) + 1;
  }
  const slips = (await readRecords(path.join(root, 'delegation-errors.jsonl')).catch(() => [])).filter(s => s.session === summary.id);
  const byKind: Record<string, number> = {};
  for (const s of slips) {
    const kind = typeof s.kind === 'string' ? s.kind : 'unknown';
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  const open = slips.filter(s => s.status === 'open').length;
  const closed = slips.length - open;
  const agents = detail.agents.map(r => ({
    id: r.id,
    type: r.type,
    name: r.name ?? null,
    model: r.model ?? null,
    status: r.status,
    minutes: r.start !== undefined && r.end !== undefined ? round1((r.end - r.start) / 60000) : 0,
    turns: r.turns,
    tools: Object.values(r.tools).reduce((n, c) => n + c, 0),
    usd: r.usage.cost,
  }));
  const findings: string[] = [];
  const lookups = slips.filter(s => s.kind === 'lookup-on-main').length;
  if (lookups) findings.push(`The main thread did ${count(lookups, 'lookup')} that a fact-gatherer should have made.`);
  const generic = slips.filter(s => s.kind === 'generic-owned').length;
  if (generic) findings.push(`A general-purpose agent did ${count(generic, 'piece')} of work that a specialist owned.`);
  for (const r of detail.agents.filter(r => r.status !== 'done')) findings.push(`Agent ${r.name ?? r.type} (${r.id}) has status ${r.status}, not completed.`);
  const json = { session: summary.id, agents, decisions: { byHook, byTone }, slips: { open, closed, byKind }, findings };
  const text = [
    headline(`Delegation · ${agents.length} agents · ${events.length} decisions · ${open} open slips`),
    '',
    ...table(
      ['Agent', 'Type', 'Model', 'Status', 'Minutes', 'Turns', 'Tools', 'Cost'],
      agents.map(g => [g.name ?? g.id, g.type, g.model ?? '', g.status, g.minutes, g.turns, g.tools, fmtUsd(g.usd)]),
      [false, false, false, false, true, true, true, true],
    ),
    '',
    ...table(['Hook', 'Count'], Object.entries(byHook), [false, true]),
    '',
    ...table(['Tone', 'Count'], Object.entries(byTone), [false, true]),
    '',
    ...table(['Slip kind', 'Count'], Object.entries(byKind), [false, true]),
    '',
    ...(findings.length ? findings.map(f => `- ${f}`) : ['No delegation findings.']),
  ];
  emit(io, a, json, text);
  return 0;
}
