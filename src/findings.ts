import type { HookFailure } from './events';
import type { AgentRun, SessionEvent, SessionFinding } from './sessions';

/** The tools that write a file; the sessions reader counts the main thread's with the same set. */
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** The main thread must have made this many edits, and more than all agents together, before the edit count is a finding. */
export const EDITS_FLOOR = 10;

/** A prompt this close before a stop is read as the reason for it. */
const STOP_REASON_MS = 10 * 60000;

const shortType = (type: string) => type.split(':').pop() ?? type;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** 42 s, 3 min, 1 h 5 min: how long before a stop, in the words the page uses elsewhere. */
export function span(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${Math.max(s, 1)} s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const label = (a: AgentRun) => `${shortType(a.type)}${a.description ? ` "${a.description}"` : ''}`;

export interface FindingInput {
  /** In launch order, children after their parent. */
  agents: AgentRun[];
  events: SessionEvent[];
  prompts: { at: number; text: string }[];
  hookFailures: HookFailure[];
  /** File edits the main thread made. */
  mainEdits: number;
}

/**
 * What stands out in a session, each finding with the evidence, why it matters and what to do about it. The time and
 * tokens a finding cost are not stored: the page reads them from the runs a finding names (`runs`), the same figures
 * the map rows show. Warnings come before notes.
 */
export function buildFindings(input: FindingInput): SessionFinding[] {
  const { agents, events, prompts, mainEdits } = input;
  const out: SessionFinding[] = [];
  for (const a of agents) {
    if (a.status === 'failed') {
      const first = a.error ? a.error.split('\n')[0].slice(0, 200) : '';
      out.push({
        level: 'warn',
        kind: 'failed',
        agent: a.id,
        runs: [a.id],
        text: `${label(a)} failed${first ? `: ${first}` : ''}`,
        why: 'Its work is missing from the result, and the main thread may have carried on without it.',
        fix: /not found|unknown|no such|invalid/i.test(first)
          ? `Check the agent name "${shortType(a.type)}" against the Agents page, then launch it again.`
          : 'Read the error in its report, correct the brief or the agent, and launch it again.',
      });
    } else if (a.status === 'stopped') {
      const stop = events.find(e => e.kind === 'stop' && e.agent === a.id);
      const asked = stop && prompts.filter(p => p.at >= (a.launchedAt ?? a.start ?? 0) && p.at <= stop.at).pop();
      const successor = stop && agents.find(o => o !== a && o.type === a.type && (o.launchedAt ?? o.start ?? 0) > (a.launchedAt ?? a.start ?? 0) && o.status === 'done');
      const note = !stop
        ? 'It ended as stopped, but the session holds no stop request for it.'
        : asked && stop.at - asked.at <= STOP_REASON_MS
          ? `Stopped ${span(stop.at - asked.at)} after your prompt "${clip(asked.text.replace(/\s+/g, ' '), 70)}", so most likely on purpose.`
          : 'Claude stopped it without a prompt of yours shortly before.';
      out.push({
        level: successor ? 'info' : 'warn',
        kind: 'stopped',
        agent: a.id,
        runs: [a.id],
        text: `${label(a)} was stopped${successor ? ' and run again' : ''}`,
        note: successor ? `${note} ${shortType(successor.type)}${successor.description ? ` "${successor.description}"` : ''} finished the job afterwards.` : note,
        why: successor ? 'The work was redone, so the time and tokens of this run bought nothing.' : 'No later run finished this job, so its work is probably missing.',
        fix: successor ? 'Fine when you stopped it on purpose. If the brief was the cause, fix it in the agent or its prompt so the next launch starts right.' : 'Launch it again with a corrected brief, or finish the work on the main thread.',
      });
    } else if (a.status === 'unknown') {
      out.push({
        level: 'warn',
        kind: 'silent',
        agent: a.id,
        runs: [a.id],
        text: `${label(a)} never reported back`,
        note: a.turns === 0 ? 'It left no transcript, so it probably never started.' : `Its transcript ends after ${plural(a.turns, 'turn')} without a final report.`,
        why: 'Nobody knows whether it finished, and its result never reached the main thread.',
        fix: 'Open its transcript on the map: if the work is there, ask for the result, otherwise launch it again.',
      });
    }
    if (a.type === 'general-purpose')
      out.push({
        level: 'info',
        kind: 'general',
        agent: a.id,
        runs: [a.id],
        text: `${label(a)} ran as general-purpose`,
        why: 'A general-purpose agent has no role, tool limits or rules of its own, so the brief has to carry all of that.',
        fix: 'If one of your agents covers this work, launch it by name.',
      });
    const firstReport = a.reports[0];
    const resumed = firstReport === undefined ? 0 : events.filter(e => e.kind === 'message' && e.agent === a.id && e.at > firstReport).length;
    if (resumed)
      out.push({
        level: 'info',
        kind: 'resumed',
        agent: a.id,
        runs: [a.id],
        text: `${label(a)} got ${resumed} ${resumed === 1 ? 'message' : 'messages'} after it reported`,
        why: 'Its report did not settle the job, and each message restarts the agent on its whole history.',
        fix: 'Put the check you applied afterwards into the brief, so the first report is the last.',
      });
  }
  const groups = new Map<string, AgentRun[]>();
  for (const a of agents) if (a.description) groups.set(`${a.type}|${a.description}`, [...(groups.get(`${a.type}|${a.description}`) ?? []), a]);
  for (const [key, runs] of groups) {
    if (runs.length < 2) continue;
    const lost = runs.filter(r => r.status !== 'done').length;
    out.push({
      level: 'info',
      kind: 'repeated',
      agent: runs[0].id,
      runs: runs.map(r => r.id),
      text: `${shortType(key.split('|')[0])} "${key.split('|').slice(1).join('|')}" was launched ${runs.length} times`,
      note: `Runs: ${runs.map(r => r.status).join(', ')}.`,
      why: lost ? `${plural(lost, 'run')} did not finish, so the job was paid for again.` : 'Every run finished, so the same job was paid for each time.',
      fix: lost ? 'Fix the cause named in the finding for that run before you launch the job again.' : 'Reuse the first result, or message the agent instead of starting a new run.',
    });
  }
  for (const f of input.hookFailures)
    out.push({
      level: 'warn',
      kind: 'hook',
      text: `Hook ${f.hook} failed ${plural(f.count, 'time')}${f.exitCode === undefined ? '' : `, exit ${f.exitCode}`}`,
      why: 'Whatever the hook checks or records was skipped on those calls.',
      fix: f.command ? `Run it by hand to see the error: ${clip(f.command, 120)}` : "Run the hook's command by hand to see the error.",
    });
  const agentEdits = agents.reduce((n, a) => n + Object.entries(a.tools).reduce((m, [tool, c]) => m + (EDIT_TOOLS.has(tool) ? c : 0), 0), 0);
  if (agents.length && mainEdits >= EDITS_FLOOR && mainEdits > agentEdits)
    out.push({
      level: 'info',
      kind: 'edits',
      text: `The main thread made ${mainEdits} file ${mainEdits === 1 ? 'edit' : 'edits'} itself`,
      note: `${Math.round((mainEdits / (mainEdits + agentEdits)) * 100)}% of the session's ${mainEdits + agentEdits} edits. The ${plural(agents.length, 'agent')} made ${agentEdits}.`,
      why: "Every edit grows the context the main thread reads again on each later turn; an agent's context is dropped when it ends.",
      fix: 'Hand the next batch of edits to an agent and keep the main thread for planning and review.',
    });
  return [...out.filter(f => f.level === 'warn'), ...out.filter(f => f.level !== 'warn')];
}

export interface Specialist {
  /** The `subagent_type` that launches it. */
  use: string;
  name: string;
  description: string;
}

const STOP = new Set(
  'about above after also another because been before being between both could does done each else from have here into just like make many more most much must need only other over same should since some such than that their them then there these they this those through under until used uses using very want what when where which while whom will with would your agent agents task tasks work file files'.split(' ')
);

const wordsOf = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w)));

/** A name word that says what the specialist is, not that it is one. */
const NAME_FILLER = new Set(['agent', 'agents', 'expert', 'helper', 'specialist', 'assistant', 'worker', 'runner']);

/**
 * The specialist whose name says the subject of a run (`dotnet-expert` for a job about dotnet, `article-writer` for an
 * article): a distinctive word of its name is in the run's description, which names the job. Description words are not
 * compared: prose like "request" or "code" matches every run. Staying silent beats naming a specialist that does not fit.
 */
export function fitSpecialist(a: AgentRun, specialists: Specialist[]): { specialist: Specialist; shared: string[] } | undefined {
  const wanted = wordsOf(a.description);
  let best: { specialist: Specialist; shared: string[] } | undefined;
  for (const s of specialists) {
    const shared = [...wordsOf(s.name.replace(/-/g, ' '))].filter(w => !NAME_FILLER.has(w) && (wanted.has(w) || wanted.has(`${w}s`)));
    if (shared.length && (!best || shared.length > best.shared.length)) best = { specialist: s, shared };
  }
  return best;
}

/**
 * The general-purpose findings, narrowed to the runs whose description names the subject of a specialist in the roster: those name
 * the specialist, the others are dropped, because nothing in the roster is shown to fit.
 */
export function fitGeneralFindings(findings: SessionFinding[], agents: AgentRun[], specialists: Specialist[]): SessionFinding[] {
  return findings.flatMap(f => {
    if (f.kind !== 'general') return [f];
    const run = agents.find(a => a.id === f.agent);
    const fit = run && fitSpecialist(run, specialists);
    if (!fit) return [];
    return [
      {
        ...f,
        note: `Its description mentions ${fit.shared.map(w => `"${w}"`).join(', ')}, what ${fit.specialist.name} is for: ${clip(fit.specialist.description.replace(/\s+/g, ' '), 110)}`,
        fix: `Launch it as ${fit.specialist.use} next time; that agent brings its own role, tools and rules.`,
      },
    ];
  });
}
