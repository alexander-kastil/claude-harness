// Sync instructions across tools: CLAUDE.md is the source, the other tools' instruction files are the targets. This file plans
// and writes; the host (sync-tools-host.ts) asks first. Formats, from each tool's docs:
//   AGENTS.md                        (Cursor, Codex, Copilot read it; plain markdown, no frontmatter)
//   .cursor/rules/*.mdc              (https://cursor.com/docs/context/rules: .mdc with description, globs, alwaysApply frontmatter)
//   .github/copilot-instructions.md  (GitHub Copilot repository-wide instructions)
//   ~/.codex/AGENTS.md               (Codex global, see harness.ts otherAgentsMd), ~/.agents/AGENTS.md (Cline)
//   ~/.gemini/GEMINI.md              (Gemini CLI global context file)
//   ~/.copilot/copilot-instructions.md (Copilot CLI user-level instructions)
import * as fs from 'fs';
import * as path from 'path';
import { AgentsLoad, agentsMdLoad, importsOf, otherAgentsMd } from './harness';

export type SyncState = 'missing' | 'same' | 'differs';

export interface SyncTarget {
  /** Stable id the webview sends back: the path below the folder, with forward slashes. */
  id: string;
  tool: string;
  /** The path as shown: relative for a repo, with `~` for a global file. */
  label: string;
  file: string;
  exists: boolean;
  state: SyncState;
  /** Set on a repo AGENTS.md: whether Claude Code loads it, from harness.ts. */
  load?: AgentsLoad;
  /** What the sync writes. */
  expected: string;
}

export interface SyncSource {
  file: string;
  label: string;
  exists: boolean;
  chars: number;
  /** @imports in it: the other tools do not follow them. */
  imports: number;
}

export interface SyncPlan {
  scope: string;
  global: boolean;
  source: SyncSource;
  targets: SyncTarget[];
}

/** What the webview gets: the plan without the texts. */
export interface SyncToolsData {
  scope: string;
  global: boolean;
  source: SyncSource;
  targets: Omit<SyncTarget, 'expected'>[];
  /** Files written by the last Sync, relative ids. */
  wrote?: string[];
  /** Set when the scope has no folder to read. */
  error?: string;
}

const norm = (text: string) => text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

/** The Cursor rule for CLAUDE.md: always applied, so Cursor loads it as Claude Code loads CLAUDE.md. */
export const cursorRule = (source: string) => `---\ndescription: Project instructions, synced from CLAUDE.md\nglobs:\nalwaysApply: true\n---\n\n${source.replace(/\r\n/g, '\n').trimEnd()}\n`;
const plain = (source: string) => `${source.replace(/\r\n/g, '\n').trimEnd()}\n`;

/** The CLAUDE.md of a repo: its root file, else .claude/CLAUDE.md. */
export function repoSource(dir: string): string {
  const root = path.join(dir, 'CLAUDE.md');
  return !fs.existsSync(root) && fs.existsSync(path.join(dir, '.claude', 'CLAUDE.md')) ? path.join(dir, '.claude', 'CLAUDE.md') : root;
}

const tilde = (file: string, home: string) => (file.startsWith(home) ? `~${file.slice(home.length).split(path.sep).join('/')}` : file);

/** Where each target of a folder (a repo, or `claudeRoot` for the global scope) stands against its CLAUDE.md. */
export function planSyncTools(scope: string, dir: string | undefined, home: string, claudeRoot: string): SyncPlan {
  const global = !dir;
  const file = global ? path.join(claudeRoot, 'CLAUDE.md') : repoSource(dir);
  const text = read(file);
  const source: SyncSource = { file, label: global ? '~/.claude/CLAUDE.md' : path.relative(dir, file).split(path.sep).join('/'), exists: text !== undefined, chars: text?.length ?? 0, imports: text ? importsOf(text).length : 0 };
  const targets: SyncTarget[] = [];
  const add = (id: string, tool: string, label: string, target: string, expected: string, load?: AgentsLoad) => {
    const have = read(target);
    const state: SyncState = have === undefined ? 'missing' : norm(have) === norm(expected) ? 'same' : 'differs';
    targets.push({ id, tool, label, file: target, exists: have !== undefined, state, load, expected });
  };
  if (text !== undefined) {
    if (dir) {
      add('AGENTS.md', 'Codex, Cursor, Copilot', 'AGENTS.md', path.join(dir, 'AGENTS.md'), plain(text), agentsMdLoad(dir, 'AGENTS.md'));
      add('.cursor/rules/claude.mdc', 'Cursor', '.cursor/rules/claude.mdc', path.join(dir, '.cursor', 'rules', 'claude.mdc'), cursorRule(text));
      add('.github/copilot-instructions.md', 'GitHub Copilot', '.github/copilot-instructions.md', path.join(dir, '.github', 'copilot-instructions.md'), plain(text));
    } else {
      const codex = otherAgentsMd(home);
      for (const o of codex) add(o.name, o.name.includes('codex') ? 'Codex' : 'Cline', o.name, o.file, plain(text));
      const gemini = path.join(home, '.gemini', 'GEMINI.md');
      add('~/.gemini/GEMINI.md', 'Gemini CLI', tilde(gemini, home), gemini, plain(text));
      const copilot = path.join(home, '.copilot', 'copilot-instructions.md');
      add('~/.copilot/copilot-instructions.md', 'Copilot CLI', tilde(copilot, home), copilot, plain(text));
    }
  }
  return { scope, global, source, targets };
}

export const syncToolsData = (plan: SyncPlan, wrote?: string[]): SyncToolsData => ({
  scope: plan.scope,
  global: plan.global,
  source: plan.source,
  targets: plan.targets.map(({ expected: _e, ...t }) => t),
  wrote,
});

/** Writes the chosen targets, each existing file copied under `backupDir` first. Returns the ids written. */
export function writeSyncTools(plan: SyncPlan, ids: string[], backupDir: string): string[] {
  const done: string[] = [];
  for (const t of plan.targets) {
    if (!ids.includes(t.id) || t.state === 'same') continue;
    if (t.exists) {
      const to = path.join(backupDir, t.id.replace(/^~[\\/]/, '').replace(/[\\/]/g, '__'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(t.file, to);
    }
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    fs.writeFileSync(t.file, t.expected);
    done.push(t.id);
  }
  return done;
}
