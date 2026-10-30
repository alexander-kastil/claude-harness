import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Args, Io, Stop, emit, headline, one, table } from './cli-core';
import { SessionSummary, findSession, listSessions, renameSession } from './sessions';

// `sessions`: a repo's sessions in /resume order; `sessions rename` renames one the way /rename does.

const LIMIT = 20;

const round1 = (n: number) => Math.round(n * 10) / 10;
const pad = (n: number) => String(n).padStart(2, '0');

/** Local time as `2026-10-28 09:41`, how a person reads a start time. */
function when(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** From the first record to the last write, in minutes. */
const minutesOf = (s: SessionSummary) => (s.start === undefined ? 0 : round1((s.end - s.start) / 60000));

/** The session `--session` names, as `usage` reads it: `latest`, `previous` (the one before it in the repo's list) or an id. */
function resolve(a: Args): { repo: string; root: string; summary: SessionSummary } {
  const id = one(a, 'session');
  if (!id) throw new Stop('--session is required: latest, previous or a session id.', 2);
  const repo = path.resolve(one(a, 'repo') ?? process.cwd());
  const root = path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));
  const summary = id === 'latest' ? listSessions(repo, root)[0] : id === 'previous' ? listSessions(repo, root)[1] : findSession(repo, root, id);
  if (!summary) throw new Stop(`No session ${id} in ${repo}.`, 1);
  return { repo, root, summary };
}

function list(a: Args, io: Io): number {
  const repo = path.resolve(one(a, 'repo') ?? process.cwd());
  const root = path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));
  const limit = one(a, 'limit') === undefined ? LIMIT : Number(one(a, 'limit'));
  if (!Number.isInteger(limit) || limit < 1) throw new Stop('--limit needs a whole number of 1 or more, such as 20.', 2);
  const all = listSessions(repo, root);
  const shown = all.slice(0, limit);
  const json = {
    repo,
    total: all.length,
    sessions: shown.map(s => ({
      id: s.id,
      title: s.title,
      started: s.start === undefined ? null : new Date(s.start).toISOString(),
      minutes: minutesOf(s),
      agents: s.agents,
      live: s.live ?? null,
    })),
  };
  const rows = shown.map(s => [s.title, s.id, s.start === undefined ? '' : when(s.start), minutesOf(s), s.agents, s.live ?? '']);
  const text = [
    headline(`Sessions · ${shown.length} of ${all.length} · ${repo}`),
    '',
    ...table(['Session', 'Id', 'Started', 'Minutes', 'Agents', 'Status'], rows.length ? rows : [['(none)', '', '', '', '', '']], [false, false, false, true, true, false]),
  ];
  emit(io, a, json, text);
  return 0;
}

function rename(a: Args, io: Io): number {
  const title = (one(a, 'title') ?? '').trim();
  if (!title) throw new Stop('sessions rename needs --title <name>.', 2);
  const { summary } = resolve(a);
  const from = summary.title;
  const changed = title !== from;
  const dry = !!one(a, 'dry-run');
  const json = { session: summary.id, file: summary.file, from, to: title };
  if (changed && !dry) renameSession(summary.file, title);
  const text = [
    headline(`Rename · ${summary.id.slice(0, 8)} · ${!changed ? 'unchanged' : dry ? 'dry run' : 'renamed'}`),
    '',
    ...table(['Id', 'From', 'To'], [[summary.id, from, title]]),
  ];
  if (changed && dry) text.push('', `[dry-run] append the name to ${summary.file}`, `[dry-run] write ${path.join(path.dirname(summary.file), summary.id, 'custom-title.json')}`);
  if (changed && summary.live) text.push('', 'This session is running. Claude Code writes its own name again at exit and after compaction, which undoes this rename.');
  emit(io, a, json, text, changed && !dry);
  return 0;
}

/** The extension's id: a URI of this authority reaches its URI handler. */
export const EXTENSION_ID = 'integrations-at.claude-harness';

/** Whether a VS Code window is running, where the process list can say so (Windows); elsewhere it is assumed. */
function codeRunning(): boolean {
  if (process.platform !== 'win32') return true;
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Code.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
  return r.status !== 0 || /Code\.exe/i.test(r.stdout ?? '');
}

/** Whether the extension is installed in the user's VS Code extensions folder. */
function extensionInstalled(): boolean {
  const dir = path.join(os.homedir(), '.vscode', 'extensions');
  try {
    return fs.readdirSync(dir).some(n => n.toLowerCase().startsWith(`${EXTENSION_ID}-`));
  } catch {
    return false;
  }
}

/** Hands a URI to VS Code, which routes it to the extension's URI handler; replaced in tests. */
export const launcher = {
  open(uri: string): { ok: boolean; why?: string } {
    const r = spawnSync('code', ['--open-url', uri], { encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
    return r.status === 0 ? { ok: true } : { ok: false, why: 'the code command is not on the PATH' };
  },
  running: codeRunning,
  installed: extensionInstalled,
};

/** Opens a session on its page in the Claude Harness panel of the running VS Code window. */
function open(a: Args, io: Io): number {
  const { repo, summary } = resolve(a);
  const uri = `vscode://${EXTENSION_ID}/session?id=${encodeURIComponent(summary.id)}&repo=${encodeURIComponent(repo)}`;
  const dry = !!one(a, 'dry-run');
  let reason: string | undefined;
  if (!dry) {
    if (!launcher.installed()) reason = 'the Claude Harness extension is not installed in VS Code';
    else if (!launcher.running()) reason = 'VS Code is not running';
    else {
      const r = launcher.open(uri);
      if (!r.ok) reason = r.why;
    }
  }
  const opened = !dry && !reason;
  const line = dry ? `[dry-run] would open ${uri}` : opened ? `Opened session "${summary.title}" in the Claude Harness panel.` : `Could not open the session in the Claude Harness panel: ${reason}.`;
  emit(io, a, { session: summary.id, title: summary.title, uri, opened, reason: reason ?? null }, [line], opened);
  return opened || dry ? 0 : 1;
}

export async function sessionsCommand(a: Args, io: Io): Promise<number> {
  const [, sub] = a.words;
  if (sub === 'open') return open(a, io);
  if (sub === 'rename') return rename(a, io);
  if (sub) throw new Stop(`sessions takes no ${sub}; use sessions or sessions rename.`, 2);
  return list(a, io);
}
