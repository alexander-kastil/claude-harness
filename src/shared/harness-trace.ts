// Pure helpers of the repo page's Effective harness tab: which declared hooks failed in the repo's sessions, and which
// declared memory and rule files the newest session did not load. No DOM and no Node APIs, so the bundle and the tests share them.

export interface DeclaredHook {
  event: string;
  matcher: string;
  command: string;
}

export interface FailedHook {
  /** `Event:matcher` as Claude Code names a hook, or just the event. */
  hook: string;
  count: number;
  exitCode?: number;
  command?: string;
}

const same = (a?: string, b?: string) => !!a && !!b && a.trim() === b.trim();

const matchesTool = (matcher: string, tool: string) => {
  if (!matcher || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return matcher === tool;
  }
};

/**
 * The failures of each declared hook, by index. A failure that names the command it ran belongs to the declared hooks
 * with that command; one that does not, or whose command no declared hook has, belongs to the hooks of its event whose
 * matcher takes its tool.
 */
export function failuresByHook<F extends FailedHook>(hooks: DeclaredHook[], failures: F[]): Map<number, F[]> {
  const out = new Map<number, F[]>();
  const add = (i: number, f: F) => out.set(i, [...(out.get(i) ?? []), f]);
  for (const f of failures) {
    const byCommand = hooks.flatMap((h, i) => (same(h.command, f.command) ? [i] : []));
    if (byCommand.length) {
      byCommand.forEach(i => add(i, f));
      continue;
    }
    const cut = f.hook.indexOf(':');
    const event = cut < 0 ? f.hook : f.hook.slice(0, cut);
    const tool = cut < 0 ? '' : f.hook.slice(cut + 1);
    hooks.forEach((h, i) => h.event === event && (cut < 0 ? !h.matcher || h.matcher === '*' : matchesTool(h.matcher, tool)) && add(i, f));
  }
  return out;
}

/** The text of a failure marker: how often and the exit code, one line per failing hook name. */
export const failureText = (list: FailedHook[]): string =>
  list.map(f => `${f.hook} failed ${f.count} ${f.count === 1 ? 'time' : 'times'}${f.exitCode === undefined ? '' : `, exit ${f.exitCode}`}`).join('\n');

/** A path as two sessions would spell it the same: forward slashes, lower case, no trailing slash. */
export const samePath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** The declared files (given by path) that are not among the loaded paths. */
export function notLoaded(declared: string[], loaded: string[]): Set<string> {
  const have = new Set(loaded.map(samePath));
  return new Set(declared.filter(f => !have.has(samePath(f))));
}
