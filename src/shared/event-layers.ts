// Pure helpers of the Delegation map's Full timeline that the unit tests reach: the prompt line on a step and the
// binding of an event layer to the map's rows. No DOM and no Node APIs, so the webview bundle and the tests share them.
import type { ModEvent } from './messages';

export type Tone = 'act' | 'warn' | 'quiet';

export const toneOf = (e: ModEvent): Tone => (e.tone === 'warn' || e.tone === 'quiet' ? e.tone : 'act');

const timeOf = (e: ModEvent) => Date.parse(e.at);

const byTime = (a: ModEvent, b: ModEvent) => timeOf(a) - timeOf(b);

export interface PromptPart {
  kind: 'text' | 'pasted';
  text: string;
}

/**
 * A prompt split into the user's own words and the blocks they pasted, in order. A pasted block whose closing tag the
 * reader's length cap cut off runs to the end. Empty parts are left out.
 */
export function promptParts(text: string): PromptPart[] {
  const parts: PromptPart[] = [];
  const add = (kind: PromptPart['kind'], s: string) => {
    const t = s.trim();
    if (t) parts.push({ kind, text: t });
  };
  const source = String(text || '');
  const paste = /<pasted_content\b[^>]*>([\s\S]*?)(?:<\/pasted_content\b[^>]*>|$)/g;
  let from = 0;
  for (let m = paste.exec(source); m; m = paste.exec(source)) {
    add('text', source.slice(from, m.index));
    add('pasted', m[1]);
    from = m.index + m[0].length;
  }
  add('text', source.slice(from));
  return parts;
}

/** The first line of a prompt for its step, without pasted blocks. Empty when nothing but pasted text is left. */
export function promptLine(text: string): string {
  return (
    promptParts(text)
      .filter(p => p.kind === 'text')
      .flatMap(p => p.text.split(/\r?\n/))
      .map(l => l.replace(/\s+/g, ' ').trim())
      .find(Boolean) ?? ''
  );
}

export interface BoundEvents {
  /** Events by step index, in time order. */
  steps: ModEvent[][];
  /** Events by agent id, in time order. */
  agents: Record<string, ModEvent[]>;
}

/**
 * Binds one layer's events to rows: an event with the id of an agent on the map belongs to that agent's row; any other
 * event belongs to the prompt whose window [prompt time, next prompt time) holds its time. An event before the first
 * prompt, or with no readable time, belongs to no row.
 */
export function bindEvents(events: ModEvent[], promptTimes: number[], agentIds: Iterable<string>): BoundEvents {
  const ids = new Set(agentIds);
  const steps: ModEvent[][] = promptTimes.map(() => []);
  const agents: Record<string, ModEvent[]> = {};
  for (const e of [...events].sort(byTime)) {
    if (e.agentId && ids.has(e.agentId)) {
      (agents[e.agentId] ??= []).push(e);
      continue;
    }
    const t = timeOf(e);
    if (Number.isNaN(t)) continue;
    let at = -1;
    for (let i = 0; i < promptTimes.length; i++) if (promptTimes[i] <= t && (i + 1 === promptTimes.length || t < promptTimes[i + 1])) at = i;
    if (at >= 0) steps[at].push(e);
  }
  return { steps, agents };
}

/** The strongest tone of a set: warn over act over quiet. */
export const toneOfAll = (events: ModEvent[]): Tone => (events.some(e => toneOf(e) === 'warn') ? 'warn' : events.some(e => toneOf(e) === 'act') ? 'act' : 'quiet');

/**
 * A chip's text: the distinct labels of the events that did something (not quiet), in time order, at most `max`, then
 * `+N` for the rest. An event without a label shows only in the hover card. When none of them has a label, the chip
 * counts the events instead.
 */
export function chipText(events: ModEvent[], max = 3): string {
  const labels = [
    ...new Set(
      events
        .filter(e => toneOf(e) !== 'quiet' && e.label)
        .sort(byTime)
        .map(e => e.label as string)
    ),
  ];
  if (!labels.length) return `${events.length} ${events.length === 1 ? 'event' : 'events'}`;
  return (labels.length > max ? [...labels.slice(0, max), `+${labels.length - max}`] : labels).join(' · ');
}
