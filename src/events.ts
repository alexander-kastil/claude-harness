import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse as parseJsonc } from 'jsonc-parser';
import type { EventLayer, ModEvent } from './shared/messages';

/** A plugin that ships `.claude-plugin/harness-events.json` adds an event layer to the session views. */
export interface EventSource {
  plugin: string;
  dir: string;
  /** The layer name the UI shows. */
  label: string;
  /** Path template of the per-session event log: {sessionDir}, {sessionId} and {home}, forward slashes. */
  events: string;
}

export const EVENTS_MANIFEST = path.join('.claude-plugin', 'harness-events.json');

const readJson = (file: string): Record<string, unknown> => {
  try {
    const value = parseJsonc(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

export function eventSourceAt(dir: string, plugin = path.basename(dir)): EventSource | undefined {
  const m = readJson(path.join(dir, EVENTS_MANIFEST));
  const label = typeof m.label === 'string' ? m.label.trim() : '';
  const events = typeof m.events === 'string' ? m.events.trim() : '';
  return label && events ? { plugin, dir, label, events } : undefined;
}

/** Every plugin with an events manifest, one per plugin name; a directory-marketplace source wins over an installed copy. */
export function findEventSources(dirs: { dir: string; installed: boolean; plugin?: string }[]): EventSource[] {
  const out = new Map<string, EventSource>();
  for (const d of [...dirs.filter(x => !x.installed), ...dirs.filter(x => x.installed)]) {
    const plugin = d.plugin ?? path.basename(d.dir);
    if (out.has(plugin)) continue;
    const found = eventSourceAt(d.dir, plugin);
    if (found) out.set(plugin, found);
  }
  return [...out.values()];
}

/** The log of one session: the template with its placeholders filled; a relative result resolves against the plugin folder. */
export function eventLogPath(source: EventSource, transcript: string, sessionId: string, home = os.homedir()): string {
  const filled = source.events
    .replace(/\{sessionDir\}/g, transcript.replace(/\.jsonl$/i, ''))
    .replace(/\{sessionId\}/g, sessionId)
    .replace(/\{home\}/g, home);
  return path.resolve(source.dir, path.normalize(filled));
}

const TONES = new Set(['act', 'warn', 'quiet']);

/** One log line as an event, or undefined when it is not JSON or lacks `at`, `hook` or `text`. Unknown fields are dropped. */
export function parseEvent(line: string): ModEvent | undefined {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
  if (typeof o.at !== 'string' || Number.isNaN(Date.parse(o.at)) || typeof o.hook !== 'string' || typeof o.text !== 'string') return undefined;
  const e: ModEvent = { at: o.at, hook: o.hook, text: o.text };
  if (typeof o.label === 'string' && o.label) e.label = o.label;
  if (typeof o.tone === 'string' && TONES.has(o.tone)) e.tone = o.tone as ModEvent['tone'];
  if (typeof o.agentId === 'string' && o.agentId) e.agentId = o.agentId;
  if (typeof o.detail === 'string' && o.detail) e.detail = o.detail;
  return e;
}

/** The events of a log in time order, skipping malformed lines; none when the file is missing. */
export function readEventLog(file: string): ModEvent[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const events = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(parseEvent)
    .filter((e): e is ModEvent => !!e);
  return events.map((e, i) => ({ e, i })).sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at) || a.i - b.i).map(x => x.e);
}

/** One layer per source whose log for this session exists and holds events. */
export function eventLayers(sources: EventSource[], transcript: string, sessionId: string, home = os.homedir()): EventLayer[] {
  return sources.flatMap(s => {
    const events = readEventLog(eventLogPath(s, transcript, sessionId, home));
    return events.length ? [{ label: s.label, events }] : [];
  });
}

/** A hook's trace in a session transcript: the mod that named itself in the text, and the event, `detail` uncut. */
export interface TranscriptHook {
  mod?: string;
  event: ModEvent;
}

type Rec = Record<string, any>;

/** The `<name>: ` a mod opens its text with, a lowercase name like `my-plugin`. */
const MOD_PREFIX = /^([a-z0-9][a-z0-9._-]*): /;
/** The denial Claude Code writes for a hook that blocked a tool call. */
const HOOK_DENIAL = /^([A-Za-z]+:[^\s:]+) hook error: /;
const DETAIL_CAP = 2000;
/** The label of the events whose text names no mod. */
export const UNNAMED_MOD = 'Hooks';

const textOf = (v: unknown): string =>
  typeof v === 'string' ? v : Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : x && typeof x.text === 'string' ? x.text : '')).filter(Boolean).join('\n') : '';

const where = (hookEvent: unknown, tool: string | undefined) =>
  hookEvent === 'PostToolUse' && tool ? ` after ${tool}` : hookEvent === 'PreToolUse' && tool ? ` before ${tool}` : hookEvent === 'UserPromptSubmit' ? ' on the prompt' : hookEvent === 'SessionStart' ? ' at session start' : '';

/**
 * The hook traces of one transcript: every `hook_*` attachment, and every tool call a hook denied, either with the
 * `<name>: ` text a mod answers with or with Claude Code's own `<event>:<tool> hook error: `. Traces from a subagent's
 * transcript carry its id. Records without a readable time are skipped.
 */
export function transcriptHooks(records: Rec[], agentId?: string): TranscriptHook[] {
  const tools = new Map<string, string>();
  for (const o of records) if (o.type === 'assistant' && Array.isArray(o.message?.content)) for (const b of o.message.content) if (b?.type === 'tool_use' && b.id) tools.set(b.id, String(b.name));
  const out: TranscriptHook[] = [];
  const add = (o: Rec, event: Omit<ModEvent, 'at'>) => {
    if (typeof o.timestamp !== 'string' || Number.isNaN(Date.parse(o.timestamp))) return;
    const e: ModEvent = { at: o.timestamp, ...event };
    if (agentId) e.agentId = agentId;
    if (!e.detail) delete e.detail;
    out.push({ mod: e.detail ? MOD_PREFIX.exec(e.detail)?.[1] : undefined, event: e });
  };
  for (const o of records) {
    const a = o.attachment;
    if (o.type === 'attachment' && a && typeof a.type === 'string' && a.type.startsWith('hook_')) {
      const hook = String(a.hookName || a.hookEvent || 'hook');
      const tool = tools.get(String(a.toolUseID ?? '').replace(/-context$/, ''));
      const at = where(a.hookEvent, tool);
      const content = textOf(a.content).trim();
      if (a.type === 'hook_additional_context') add(o, { hook, text: `Added context${at}.`, label: 'context', detail: content });
      else if (a.type === 'hook_success') {
        const said = content || textOf(a.stdout).trim();
        add(o, { hook, text: said ? `Wrote output${at}.` : `Ran${at}, said nothing.`, label: 'output', detail: said, ...(said ? {} : { tone: 'quiet' as const }) });
      } else if (a.type === 'hook_system_message') add(o, { hook, text: `Showed a message${at}.`, label: 'message', detail: content });
      else if (a.type === 'hook_blocking_error') add(o, { hook, text: `Sent a blocking error${at}.`, label: 'blocked', tone: 'warn', detail: textOf(a.blockingError?.blockingError ?? a.blockingError).trim() });
      else if (a.type === 'hook_non_blocking_error')
        add(o, { hook, text: `Failed${at}${typeof a.exitCode === 'number' ? `, exit code ${a.exitCode}` : ''}.`, label: 'failed', tone: 'warn', detail: (textOf(a.stderr) || textOf(a.stdout)).trim() });
      else {
        const kind = a.type.slice(5).replace(/_/g, ' ');
        add(o, { hook, text: `${kind.charAt(0).toUpperCase()}${kind.slice(1)}${at}.`, label: kind, detail: (content || textOf(a.stderr) || textOf(a.stdout)).trim() });
      }
      continue;
    }
    if (o.type !== 'user' || !Array.isArray(o.message?.content)) continue;
    for (const b of o.message.content) {
      if (b?.type !== 'tool_result' || !b.is_error) continue;
      const raw = textOf(b.content).trim();
      const wrapped = /^<tool_use_error>([\s\S]*?)<\/tool_use_error>$/.exec(raw);
      const text = (wrapped ? wrapped[1] : raw).trim();
      const tool = tools.get(String(b.tool_use_id));
      const native = HOOK_DENIAL.exec(text);
      if (native) add(o, { hook: native[1], text: `Denied ${tool ?? 'a tool'}.`, label: 'denied', tone: 'warn', detail: text.slice(native[0].length).trim() });
      else if (wrapped && MOD_PREFIX.test(text)) add(o, { hook: tool ?? 'tool', text: `Denied ${tool ?? 'a tool'}.`, label: 'denied', tone: 'warn', detail: text });
    }
  }
  return out;
}

/**
 * The transcript's hook traces as one layer per mod. A trace whose text equals the detail of an event a log already
 * holds is left out, so a mod with a log shows once. A trace whose mod is the plugin of an events manifest joins that
 * manifest's label; one that names no mod joins {@link UNNAMED_MOD}. Details are cut for the panel.
 */
export function transcriptLayers(hooks: TranscriptHook[], logs: EventLayer[], sources: EventSource[] = []): EventLayer[] {
  const logged = new Set(logs.flatMap(l => l.events.map(e => e.detail?.trim()).filter((d): d is string => !!d)));
  const out = new Map<string, ModEvent[]>();
  for (const h of hooks) {
    if (h.event.detail && logged.has(h.event.detail.trim())) continue;
    const label = (h.mod && sources.find(s => s.plugin === h.mod)?.label) || h.mod || UNNAMED_MOD;
    const e = h.event.detail && h.event.detail.length > DETAIL_CAP ? { ...h.event, detail: `${h.event.detail.slice(0, DETAIL_CAP)}\n...` } : h.event;
    out.set(label, [...(out.get(label) ?? []), e]);
  }
  return [...out].map(([label, events]) => ({ label, events: events.map((e, i) => ({ e, i })).sort((x, y) => Date.parse(x.e.at) - Date.parse(y.e.at) || x.i - y.i).map(x => x.e) }));
}
