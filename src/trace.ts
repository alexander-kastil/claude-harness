import { EventSource, eventLayers, hookFailures, transcriptLayers } from './events';
import type { HookFailure } from './events';
import { loadedFiles } from './session-flags';
import { SessionSummary, readSession } from './sessions';
import type { ModActivity, ModEvent, RepoTrace } from './shared/messages';
import { toneOfAll } from './shared/event-layers';

/** Sessions with a hook failure that are read in full for the repo page; the rest of the list stays unread. */
const FAILURE_SESSIONS = 8;
/** Sessions read for a plugin's Mod activity tab. */
const ACTIVITY_SESSIONS = 30;
const EVENTS_PER_GROUP = 8;

/** The newest session's loaded files, and the hook failures of the newest sessions the cheap scan flagged. `sessions` is newest first. */
export async function repoTrace(sessions: SessionSummary[]): Promise<RepoTrace> {
  const newest = sessions[0];
  const flagged = sessions.filter(s => s.hookFailed).slice(0, FAILURE_SESSIONS);
  const total = new Map<string, HookFailure>();
  for (const s of flagged) {
    for (const f of hookFailures((await readSession(s)).hooks)) {
      const have = total.get(f.hook);
      total.set(f.hook, have ? { hook: f.hook, count: have.count + f.count, exitCode: have.exitCode ?? f.exitCode, command: have.command ?? f.command } : f);
    }
  }
  return {
    session: newest ? { id: newest.id, start: newest.start } : undefined,
    loaded: newest ? loadedFiles(newest.file) : undefined,
    failures: [...total.values()].sort((a, b) => b.count - a.count || a.hook.localeCompare(b.hook)),
    scanned: flagged.length,
  };
}

/** What a plugin with an events manifest did in the newest sessions: its log and the hooks that name it, grouped by event label. */
export async function modActivity(source: EventSource | undefined, sources: EventSource[], sessions: SessionSummary[]): Promise<ModActivity> {
  if (!source) return { sessions: 0, groups: [] };
  const read = [...sessions].sort((a, b) => b.end - a.end).slice(0, ACTIVITY_SESSIONS);
  const groups = new Map<string, { events: ModEvent[]; sessions: number }>();
  for (const s of read) {
    const logs = eventLayers([source], s.file, s.id);
    const layers = [...logs, ...transcriptLayers((await readSession(s)).hooks, logs, sources)].filter(l => l.label === source.label);
    const seen = new Set<string>();
    for (const e of layers.flatMap(l => l.events)) {
      const key = e.label || 'event';
      const g = groups.get(key) ?? { events: [], sessions: 0 };
      g.events.push(e);
      if (!seen.has(key)) {
        seen.add(key);
        g.sessions++;
      }
      groups.set(key, g);
    }
  }
  return {
    label: source.label,
    sessions: read.length,
    groups: [...groups]
      .map(([label, g]) => {
        const events = g.events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        return { label, count: events.length, sessions: g.sessions, tone: toneOfAll(events), last: events[events.length - 1].at, events: events.slice(-EVENTS_PER_GROUP) };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}
