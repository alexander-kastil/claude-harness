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
