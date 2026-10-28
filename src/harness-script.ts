import { HELP } from './cli';
import { Candidate, candidates } from './cli-complete';

// What the editor needs to know about a .harness script line without VS Code: the completion candidates and the HELP text for a hover.

/** The verbs a script line may start with. */
export const SCRIPT_VERBS = ['repo', 'add', 'generate', 'g', 'new', 'update'];
/** Flags the command line accepts everywhere but a script line does not. */
const NOT_IN_SCRIPTS = new Set(['--root', '--repos', '--repo', '--json', '--help', '--dry-run', '--user-config']);

export interface Completion {
  /** Where the word being completed starts in the line, and what it replaces. */
  start: number;
  candidates: Candidate[];
}

/** The candidates for the end of `before`, the text of a script line up to the cursor. */
export function scriptCandidates(before: string): Completion {
  const start = (/\s(?=\S*$)/.exec(before)?.index ?? -1) + 1;
  if (!/\s/.test(before.trimStart())) {
    const lead = before.length - before.trimStart().length;
    return { start: lead, candidates: SCRIPT_VERBS.filter(v => v.startsWith(before.trimStart())).map(text => ({ text, kind: 'command' as const, description: '' })) };
  }
  if (/^\s*repo\s/.test(before)) return { start, candidates: [] };
  const found = candidates(`harness ${before.trimStart()}`).filter(c => !NOT_IN_SCRIPTS.has(c.text.split('=')[0]));
  return { start, candidates: found };
}

export interface HelpEntry {
  /** The words after `harness`, or `--flag` for an option. */
  key: string;
  usage: string;
  text: string;
}

/** HELP split into one entry per command and per option. */
export function helpEntries(): HelpEntry[] {
  const out: HelpEntry[] = [];
  const lines = HELP.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^ {2}\S/.test(line)) continue;
    const option = /^ {2}(--[a-z-]+)\s+(.*)$/.exec(line);
    if (option) {
      out.push({ key: option[1], usage: option[1], text: option[2] });
      continue;
    }
    const words: string[] = [];
    for (const t of line.slice(2).split(/\s+/)) {
      if (!/^[a-z]+$/.test(t)) break;
      words.push(t);
    }
    if (!words.length) continue;
    const description: string[] = [];
    // Usage can carry its description on the same line after a wide gap, or on the indented lines below.
    const inline = /^ {2}(.*?\S) {2,}(\S.*)$/.exec(line);
    const usage = inline ? inline[1] : line.trim();
    if (inline) description.push(inline[2]);
    while (/^ {6,}\S/.test(lines[i + 1] ?? '')) description.push(lines[++i].trim());
    out.push({ key: words.join(' '), usage, text: description.join(' ') });
  }
  return out;
}

/** The HELP entries a hover on `word` at `index` of a script line shows: the option, else the line's command. */
export function hoverFor(line: string, word: string): HelpEntry[] {
  const entries = [{ key: 'repo', usage: 'repo <dir>', text: 'Sets the repo folder that the lines after it apply to.' }, ...helpEntries()];
  const words = line.trim().split(/\s+/);
  const head = words[0] === 'g' ? 'generate' : words[0];
  const command = entries.find(e => e.key === `${head} ${words[1]}`) ?? entries.find(e => e.key === head);
  const flag = word.startsWith('--') ? entries.find(e => e.key === word.split('=')[0]) : undefined;
  return [...(flag ? [flag] : []), ...(command ? [command] : [])];
}
