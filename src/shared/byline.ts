// The second line of a harness item: at most three short facts per kind, each with a hover text that says what it is. One
// implementation for the webview sidebar and the native tree. No DOM and no Node APIs; what only one side knows (the usage
// counts, a duplicate, a plugin's item count) comes in through `BylineContext`.
import type { Asset } from '../harness';

export interface Fact {
  text: string;
  /** Heading on the first line, the sentence after it. */
  tip: string;
  tone?: 'bad' | 'warn';
}

export interface BylineContext {
  /** The total uses and the last one, once the usage index has been read; undefined while unknown. */
  uses?: (a: Asset) => { count: number; last: number } | undefined;
  /** Where the same server is also registered, as a reader's line; empty when nowhere. */
  twin?: (a: Asset) => string;
  /** The items a plugin ships, when the caller knows them. */
  pluginItems?: (a: Asset) => number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : /(s|x|z|ch|sh)$/.test(word) ? 'es' : 's'}`;

/** The kinds whose uses the usage index counts. */
export const COUNTED_KINDS = ['agent', 'skill', 'command'];

// A server's error or status text as one reader line: a repeated code prefix reads once ("ECONNREFUSED: ECONNREFUSED: x"), and the
// user's profile folder is shortened to ~ (an npm log prints the whole path).
export const tidyError = (text: unknown): string =>
  String(text || '')
    .replace(/\b([A-Z][A-Z0-9_]{2,}):\s+\1:\s*/g, '$1: ')
    .replace(/[a-z]:[\\/]users[\\/][^\\/\s"')]+/gi, '~')
    .replace(/(^|[\s"'(])\/(?:home|Users)\/[^/\s"')]+/g, '$1~');

/** An enabled server that did not connect: an error, where a server that only needs a sign-in is a warning. */
export const mcpFailed = (a: Pick<Asset, 'enabled' | 'status'>): boolean => a.enabled !== false && /fail|refused|econn|timed? ?out|exited|error/i.test(a.status || '');

/** 5m ago, 3h ago, 3d ago, 2mo ago, 1y ago: the short form for a row that is one line wide. */
export const shortAgo = (t: number): string => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  const d = Math.round(m / 1440);
  if (d < 60) return `${d}d ago`;
  if (d < 730) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
};

const modified = (a: Asset, what = 'file'): Fact | undefined =>
  a.mtime ? { text: shortAgo(a.mtime), tip: `Last modified\nThe ${what} changed ${new Date(a.mtime).toLocaleString()}.` } : undefined;

const usesFact = (a: Asset, ctx: BylineContext): Fact | undefined => {
  const t = COUNTED_KINDS.includes(a.kind) ? ctx.uses?.(a) : undefined;
  if (!t) return undefined;
  return { text: plural(t.count, 'use'), tip: t.count ? `Used ${plural(t.count, 'time')}\nLast ${t.last ? new Date(t.last).toLocaleString() : 'at an unknown time'}` : 'Never used\nNot in a recorded session.' };
};

const lines = (a: Asset): Fact | undefined => (a.lines ? { text: plural(a.lines, 'line'), tip: `Size\n${plural(a.lines, 'line')} in the file.` } : undefined);

const files = (a: Asset): Fact | undefined => {
  const n = (a.files || []).length;
  return n ? { text: plural(n, 'file'), tip: `Files\n${plural(n, 'file')} in the skill folder: SKILL.md, references and scripts.` } : undefined;
};

const tools = (a: Asset): Fact | undefined => {
  const list = a.meta?.tools;
  return list ? { text: plural(list.length, 'tool'), tip: `Tools\nLimited to ${plural(list.length, 'tool')}: ${list.join(', ')}.` } : undefined;
};

const mcpState = (a: Asset): Fact => {
  const s = a.status || '';
  const full = tidyError(s);
  if (a.enabled === false) return { text: 'disabled', tip: 'Connection\nSwitched off: Claude does not start this server.' };
  if (/^connected/i.test(s)) return { text: 'connected', tip: `Connection\n${full}` };
  if (/auth/i.test(s)) return { text: 'needs sign-in', tip: `Connection\n${full || 'The server needs a sign-in before it connects.'}`, tone: 'warn' };
  if (mcpFailed(a)) return { text: 'failed', tip: `Connection\n${full}`, tone: 'bad' };
  if (/not configured/i.test(s)) return { text: 'not configured', tip: `Connection\n${full}`, tone: 'warn' };
  return { text: s ? full.split(/\s/).slice(0, 2).join(' ') : 'not checked', tip: `Connection\n${full || 'No status yet: the server list has not been read.'}` };
};

const TRANSPORT_TIP: Record<string, string> = {
  connector: 'A claude.ai connector, run by Claude.',
  http: 'A remote server over HTTP.',
  stdio: 'A local process Claude starts and talks to over stdin and stdout.',
};

const mcpFacts = (a: Asset, ctx: BylineContext): (Fact | undefined)[] => {
  const t = a.target || '';
  const transport = a.source === 'claude.ai' ? 'connector' : /^https?:/i.test(t) ? 'http' : t ? 'stdio' : '';
  const twin = ctx.twin?.(a);
  return [
    mcpState(a),
    transport ? { text: transport, tip: `Transport\n${TRANSPORT_TIP[transport]}` } : undefined,
    twin
      ? { text: 'duplicate', tip: `Duplicate\nThe same server is also registered as ${twin}.`, tone: 'warn' }
      : a.offIn
        ? { text: `off in ${a.offIn}`, tip: `Switched off\nOff in ${plural(a.offIn, 'folder')}.` }
        : undefined,
  ];
};

/** At most three facts, in the order they are read: when it changed, how much it is used, its size or shape. A fact not known yet is left out. */
export function factsOf(a: Asset, ctx: BylineContext = {}): Fact[] {
  let facts: (Fact | undefined)[];
  switch (a.kind) {
    case 'skill':
      facts = [modified(a, 'skill'), usesFact(a, ctx), files(a)];
      break;
    case 'agent':
      facts = [modified(a, 'agent file'), usesFact(a, ctx), { text: a.meta?.model || 'inherit', tip: `Model\n${a.meta?.model ? `Runs on ${a.meta.model}.` : 'Inherits the model of the session that launches it.'}` }];
      break;
    case 'command':
      facts = [modified(a, 'command file'), usesFact(a, ctx), tools(a)];
      break;
    case 'rule': {
      const paths = a.meta?.paths;
      facts = [modified(a, 'rule file'), paths ? { text: plural(paths.length, 'path'), tip: `Loads\nOnly when Claude works on files matching ${paths.join(', ')}.` } : { text: 'always', tip: 'Loads\nIn every session of its scope.' }, lines(a)];
      break;
    }
    case 'memory':
      facts = [modified(a, 'file'), lines(a)];
      break;
    case 'outputStyle':
      facts = [modified(a, 'output style file'), lines(a)];
      break;
    case 'workflow':
      facts = [modified(a, 'workflow script')];
      break;
    case 'hookScript':
      facts = [modified(a, 'script'), lines(a)];
      break;
    case 'hook': {
      const n = a.description ? a.description.split(' | ').length : 0;
      facts = [n ? { text: plural(n, 'command'), tip: `Commands\n${plural(n, 'command')} run when this event and matcher fire.` } : undefined, modified(a, 'settings file it is defined in')];
      break;
    }
    case 'mcp':
      facts = mcpFacts(a, ctx);
      break;
    case 'plugin': {
      const version = a.description.split(' · ')[1];
      const n = ctx.pluginItems?.(a) || 0;
      facts = [
        { text: a.enabled ? 'enabled' : 'disabled', tip: `State\n${a.enabled ? 'Enabled: its skills, agents, hooks and servers load.' : 'Disabled: nothing it ships loads.'}` },
        version ? { text: `v${version}`, tip: `Version\nThe installed version, ${version}.` } : undefined,
        n ? { text: plural(n, 'item'), tip: `Items\n${plural(n, 'item')} it ships: skills, agents, commands, hooks and servers.` } : undefined,
      ];
      break;
    }
    case 'settings':
      facts = [modified(a, 'settings file'), a.description ? { text: a.description, tip: `Keys\n${a.description} at the top level of the file.` } : undefined];
      break;
    default:
      facts = [];
  }
  return facts.filter((f): f is Fact => !!f).slice(0, 3);
}
