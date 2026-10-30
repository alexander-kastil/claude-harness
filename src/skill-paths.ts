// Absolute paths into a global skill folder (~/.claude/skills/<name>/...): they point nowhere once the skill ships in a plugin.

/** `~/.claude/skills/`, `$HOME/...`, `${HOME}/...`, `%USERPROFILE%\...`, `C:\Users\<user>\...` and a bare `.claude/skills/`. */
const PREFIX = String.raw`(?:(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%|[A-Za-z]:[\\/]Users[\\/][^\\/\s\x60'"()<>]+)[\\/]|(?<![\w.~$%\\/:-]))\.claude[\\/]skills[\\/]`;

/** A path to a global skill's folder; group 1 is the skill's name. A sentence's full stop after it is not part of the name. */
export const skillPathPattern = () => new RegExp(String.raw`${PREFIX}([\w](?:[\w.-]*[\w])?)(?![\w-]|\.[\w])`, 'g');

export interface SkillPathLeft {
  line: number;
  name: string;
  text: string;
}

/**
 * Rewrites the paths to global skill folders in a text. `decide` gets the skill's name and returns what replaces the path up to and
 * including the name (`<this skill>`, `<plugin:skill>`), null to keep the path as it is, or undefined to keep it and list its line in
 * `left`.
 */
export function rewriteSkillPaths(text: string, decide: (name: string) => string | null | undefined): { text: string; hits: number; left: SkillPathLeft[] } {
  let hits = 0;
  const left: SkillPathLeft[] = [];
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length;
  const lineText = (offset: number) => {
    const start = text.lastIndexOf('\n', offset - 1) + 1;
    const stop = text.indexOf('\n', offset);
    return text.slice(start, stop < 0 ? undefined : stop).trim();
  };
  const next = text.replace(skillPathPattern(), (m: string, name: string, offset: number) => {
    const to = decide(name);
    if (to === null) return m;
    if (to === undefined) {
      left.push({ line: lineAt(offset), name, text: lineText(offset) });
      return m;
    }
    hits++;
    return to;
  });
  return { text: next, hits, left };
}
