import * as os from 'os';
import * as path from 'path';
import { Args, Io, Stop, emit, headline, one, table } from './cli-core';
import { EventSource, UNNAMED_MOD, eventLayers, findEventSources, transcriptLayers } from './events';
import { pluginDirs } from './harness';
import { findSession, listSessions, readSession, SessionSummary } from './sessions';
import type { ModEvent } from './shared/messages';

// `mods`: which mods and guards acted in one session, what each one decided, and the denials and holds with their reason.

type Decision = 'allowed' | 'denied' | 'held' | 'context' | 'failed' | 'other';

interface ModRow {
  name: string;
  plugin: string;
  events: number;
  allowed: number;
  denied: number;
  held: number;
  context: number;
  failed: number;
  other: number;
  last: string;
}

interface Denial {
  at: string;
  mod: string;
  decision: 'denied' | 'held';
  hook: string;
  reason: string;
}

/** What an event decided, from its chip label: `denied`, `blocked` (the hook held the step), `context`, `output` (the hook let the step pass), `failed`. */
function decisionOf(e: ModEvent): Decision {
  if (e.label === 'denied') return 'denied';
  if (e.label === 'blocked') return 'held';
  if (e.label === 'context') return 'context';
  if (e.label === 'failed') return 'failed';
  if (e.label === 'output') return 'allowed';
  return 'other';
}

/** The session `--session` names, resolved as `usage` resolves it: `latest`, `previous` or an id, in the repo's folder. */
function sessionOf(a: Args): { root: string; summary: SessionSummary } {
  const id = one(a, 'session');
  if (!id) throw new Stop('--session is required: latest, previous or a session id.', 2);
  const repo = path.resolve(one(a, 'repo') ?? process.cwd());
  const root = path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));
  const summary = id === 'latest' ? listSessions(repo, root)[0] : id === 'previous' ? listSessions(repo, root)[1] : findSession(repo, root, id);
  if (!summary) throw new Stop(`No session ${id} in ${repo}.`, 1);
  return { root, summary };
}

/** The plugin behind a layer: the plugin of its events manifest, or the mod's own name when it has none. */
const pluginOf = (label: string, sources: EventSource[]) => sources.find(s => s.label === label)?.plugin ?? (label === UNNAMED_MOD ? '' : label);

/** A time as the local day and clock, `2026-10-28 14:37:16`. */
function when(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** The first line of a reason, cut to 120 characters for the table. */
function cut(text: string): string {
  const line = text.split('\n')[0].trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

export async function modsCommand(a: Args, io: Io): Promise<number> {
  const { root, summary } = sessionOf(a);
  const detail = await readSession(summary);
  const sources = findEventSources(pluginDirs(root, true));
  const logs = eventLayers(sources, summary.file, summary.id);
  const layers = [...logs, ...transcriptLayers(detail.hooks, logs, sources)];
  const rows = new Map<string, ModRow>();
  const denials: Denial[] = [];
  for (const layer of layers) {
    for (const e of layer.events) {
      const kind = decisionOf(e);
      const row: ModRow = rows.get(layer.label) ?? { name: layer.label, plugin: pluginOf(layer.label, sources), events: 0, allowed: 0, denied: 0, held: 0, context: 0, failed: 0, other: 0, last: e.at };
      row.events += 1;
      row[kind] += 1;
      if (Date.parse(e.at) > Date.parse(row.last)) row.last = e.at;
      rows.set(layer.label, row);
      if (kind === 'denied' || kind === 'held') denials.push({ at: e.at, mod: layer.label, decision: kind, hook: e.hook, reason: e.detail?.trim() || e.text });
    }
  }
  const mods = [...rows.values()].sort((x, y) => y.events - x.events || x.name.localeCompare(y.name));
  denials.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  const json = { session: summary.id, mods, denials };
  const text = [
    headline(`Mods · ${summary.id.slice(0, 8)} · ${mods.length} acted · ${denials.length} denied or held`),
    '',
    ...table(
      ['Mod', 'Plugin', 'Events', 'Allowed', 'Denied', 'Held', 'Context', 'Failed', 'Other', 'Last'],
      mods.length ? mods.map(m => [m.name, m.plugin, m.events, m.allowed, m.denied, m.held, m.context, m.failed, m.other, when(m.last)]) : [['(none)', '', '', '', '', '', '', '', '', '']],
      [false, false, true, true, true, true, true, true, true, false]
    ),
    '',
    ...table(
      ['When', 'Mod', 'Decision', 'Hook', 'Reason'],
      denials.length ? denials.map(d => [when(d.at), d.mod, d.decision === 'denied' ? 'Denied' : 'Held', d.hook, cut(d.reason)]) : [['(none)', '', '', '', '']]
    ),
  ];
  emit(io, a, json, text);
  return 0;
}
