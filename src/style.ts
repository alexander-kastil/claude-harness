import { ChildProcess, execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { StyleScan } from './sessions';

export const STYLE_MODELS = ['sonnet', 'opus', 'haiku'] as const;
export type StyleModel = (typeof STYLE_MODELS)[number];

const SYSTEM = 'You write Claude Code output style files. Answer with the file only.';

/** The prompt sent to Claude: the scan's findings and the user's corrections, never code or whole replies. */
export function stylePrompt(scan: StyleScan): string {
  const r = scan.replies;
  return [
    'Write a Claude Code output style for this user, from the evidence of one session below.',
    'Answer with the complete markdown file and nothing else: YAML frontmatter with `name`, `description` (one line) and `keep-coding-instructions: true`, then the instructions in the body.',
    'The instructions say how replies should read: length, format, structure, language, and what to leave out. Base every rule on the evidence; invent none.',
    'Keep the file short: at most eight one-line rules, each under 20 words, no introduction, no explanation, no closing note.',
    'Give the style a name of its own; never reuse the name of the style that was active.',
    '',
    '## Evidence',
    `- Output style active in the session: ${scan.active.length ? scan.active.join(', ') : 'the default'}`,
    `- Prompts: ${scan.prompts}; replies interrupted by the user: ${scan.interrupts}`,
    `- Replies: ${r.count}, median ${r.medianWords} words, longest ${r.longest} words; ${r.headings} with headings, ${r.tables} with tables, ${r.lists} with lists`,
    '',
    '## Corrections the user made',
    ...(scan.corrections.length ? scan.corrections.slice(0, 20).map(c => `- (${c.kind}) ${c.text}`) : ['- none']),
  ].join('\n');
}

const quote = (arg: string) => (/^[\w@%+=:,./\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`);

/** Runs `claude -p` on the user's own Claude login, with no tools, MCP servers, skills, CLAUDE.md or saved session, so Claude sees the prompt only. */
export function draftStyle(prompt: string, model: StyleModel, cwd: string, timeoutMs = 300000, system = SYSTEM): Promise<{ text: string; cost?: number } | { error: string }> {
  const args = ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--setting-sources', 'project', '--system-prompt', system];
  const env = { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1' };
  const windows = process.platform === 'win32';
  return new Promise(resolve => {
    let child: ChildProcess;
    try {
      child = windows ? spawn(['claude', ...args].map(quote).join(' '), { cwd, env, shell: true, windowsHide: true }) : spawn('claude', args, { cwd, env, windowsHide: true });
    } catch (e) {
      resolve({ error: (e as Error).message });
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      if (windows && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
      else child.kill();
      resolve({ error: `Claude did not answer within ${Math.round(timeoutMs / 60000)} minutes.` });
    }, timeoutMs);
    child.stdout?.on('data', d => (out += d));
    child.stderr?.on('data', d => (err += d));
    child.on('error', e => {
      clearTimeout(timer);
      resolve({ error: `Could not start claude: ${e.message}` });
    });
    child.on('close', code => {
      clearTimeout(timer);
      let reply: { is_error?: boolean; result?: string; total_cost_usd?: number } | undefined;
      try {
        reply = JSON.parse(out);
      } catch {
        reply = undefined;
      }
      if (!reply || reply.is_error || code) resolve({ error: (reply?.result || err || out || `claude exited with code ${code}.`).trim().split('\n')[0].slice(0, 300) });
      else resolve({ text: reply.result ?? '', cost: reply.total_cost_usd });
    });
    child.stdin?.end(prompt);
  });
}

/**
 * Writes the draft into the scope's output-styles folder, never over an existing file and never under a
 * name in `taken`: a repo style named like the active global style would replace it in that repo.
 */
export function writeStyleDraft(root: string, reply: string, taken: string[] = []): string {
  const text = reply.trim().replace(/^```[a-z]*\n([\s\S]*?)\n```$/, '$1').trim();
  const drafted = /^---\r?\n[\s\S]*?^name:\s*(.+?)\s*$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, '');
  if (!text.startsWith('---') || !drafted) throw new Error('Claude did not answer with an output style file.');
  const dir = path.join(root, 'output-styles');
  const base = taken.some(t => t.toLowerCase() === drafted.toLowerCase()) ? `${drafted} draft` : drafted;
  const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'drafted-style';
  const nameAt = (n: number) => (n === 1 ? base : `${base} ${n}`);
  let n = 1;
  while (fs.existsSync(path.join(dir, `${slugOf(nameAt(n))}.md`))) n++;
  const name = nameAt(n);
  const file = path.join(dir, `${slugOf(name)}.md`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${name === drafted ? text : text.replace(/^(name:\s*).+$/m, `$1${name}`)}\n`);
  return file;
}
