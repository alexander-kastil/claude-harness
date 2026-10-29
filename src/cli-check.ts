import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Args, Io, Stop, emit, headline, list, load, one, table } from './cli-core';
import { backupStamp, pluginDirs } from './harness';
import { CheckResult, Finding, NO_PROVIDER, Provider, applyFix, checkRepo, findProvider, findPython, needsPython, previewFix } from './standard';

// `check`: the harness checks of the known repos (or the --repo ones) against the harness standard, as a view; `check fix` applies the fixes the checks offer for settings and hooks.

const SETTINGS = ['settings.json', 'settings.local.json'];

interface RepoRun {
  repo: string;
  result?: CheckResult;
  error?: string;
  git?: GitState;
}

/** The session files of Claude Code that stay out of git, and the comment line that opens their block in a .gitignore. */
const SESSION_FILES = ['.time/', '.claude/settings.local.json', '.claude/scheduled_tasks.lock'];
const SESSION_BLOCK = '# Claude Code session files: time ledger, personal settings, scheduler lock';

interface GitState {
  /** The entries .gitignore lacks. */
  missing: string[];
  /** The tracked files under the session files. */
  tracked: string[];
}

const ignoreKey = (line: string) => line.trim().replace(/^\//, '').replace(/\/$/, '');

/** What a git repo's .gitignore and index say about the session files; undefined for a folder that is not a git repo. */
function gitState(repo: string): GitState | undefined {
  if (!fs.existsSync(path.join(repo, '.git'))) return undefined;
  const ignore = path.join(repo, '.gitignore');
  const present = new Set((fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '').split(/\r?\n/).map(ignoreKey));
  const missing = SESSION_FILES.filter(f => !present.has(ignoreKey(f)));
  let tracked: string[] = [];
  try {
    tracked = execFileSync('git', ['ls-files', '-z', '--', ...SESSION_FILES.map(ignoreKey)], { cwd: repo, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0')
      .filter(Boolean);
  } catch {
    // Not a repo git can read: nothing is reported as tracked.
  }
  return missing.length || tracked.length ? { missing, tracked } : undefined;
}

/** The checks' findings for the git state: one for the missing entries, one for the tracked files; both are fixed by check fix. */
function gitDetails(g: GitState | undefined): string[] {
  return [
    ...(g?.missing.length ? [`.gitignore lacks ${g.missing.join(', ')}`] : []),
    ...(g?.tracked.length ? [`git tracks ${g.tracked.length} session file${g.tracked.length === 1 ? '' : 's'}: ${g.tracked.slice(0, 3).join(', ')}${g.tracked.length > 3 ? ', ...' : ''}`] : []),
  ];
}

interface RepoRow {
  repo: string;
  passed: boolean;
  failed: number;
  review: number;
  fixable: number;
  error: string | null;
}

interface Failure {
  repo: string;
  check: string;
  detail: string;
  fixable: boolean;
}

interface FixRow {
  repo: string;
  fixable: number;
  changes: string[];
  backup: string | null;
  error: string | null;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const rootOf = (a: Args) => path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));
/** A repo's name in the tables: its folder name, or its whole path when another repo has the same folder name. */
function labeler(dirs: string[]): (dir: string) => string {
  const names = dirs.map(d => path.basename(d));
  return dir => (names.filter(n => n === path.basename(dir)).length > 1 ? dir : path.basename(dir));
}
const detailOf = (f: Finding) => f.text.replace(/^(FAIL|REVIEW|INFO) /, '');
const failedOf = (r: CheckResult) => r.findings.filter(f => f.level === 'FAIL');

/** A settings or hooks finding is one the provider's fix can change: the extension's Fix settings and hooks action. */
const fixable = (provider: Provider, f: Finding) => !!provider.fix && /settings|hook/.test(`${f.code ?? ''} ${f.locations.map(l => l.file).join(' ')} ${f.text}`);

/** The provider plugin of the root's installed plugins: the harness standard the checks run against. */
function providerOf(a: Args): Provider {
  const provider = findProvider(pluginDirs(rootOf(a), true));
  if (!provider) throw new Stop(NO_PROVIDER);
  return provider;
}

/** The repos --repo and --repos name, checked even without a harness; without them, every known repo. */
function reposOf(a: Args): string[] {
  const named = [...(a.flags.get('repo') ?? []), ...list(a, 'repos')];
  return named.length ? [...new Set(named.map(d => path.resolve(d)))] : load(a).repos;
}

/** Python runs the provider's scripts when they are .py files; without it the checks cannot run at all. */
async function pythonOf(provider: Provider): Promise<string[] | undefined> {
  const scripts = [provider.check, provider.fix].filter((s): s is string => !!s);
  if (!scripts.some(needsPython)) return undefined;
  const py = await findPython();
  if (!py) throw new Stop('Python 3 was not found on PATH (python, py -3 or python3).');
  return py;
}

/** Each repo checked in turn; a repo whose check does not run keeps its error. */
async function checkAll(provider: Provider, py: string[] | undefined, repos: string[]): Promise<RepoRun[]> {
  const runs: RepoRun[] = [];
  for (const repo of repos) {
    const git = gitState(repo);
    try {
      runs.push({ repo, result: await checkRepo(provider, py, repo), git });
    } catch (e) {
      runs.push({ repo, error: (e as Error).message, git });
    }
  }
  return runs;
}

function summaryOf(provider: Provider, run: RepoRun): RepoRow {
  if (!run.result) return { repo: run.repo, passed: false, failed: 0, review: 0, fixable: 0, error: run.error ?? 'The check printed no result.' };
  const failed = failedOf(run.result);
  const git = gitDetails(run.git).length;
  return { repo: run.repo, passed: !failed.length && !git, failed: failed.length + git, review: run.result.review, fixable: failed.filter(f => fixable(provider, f)).length + git, error: null };
}

/** The failed checks of every repo; a repo whose check did not run is one failed check that names the error. */
function failuresOf(provider: Provider, runs: RepoRun[]): Failure[] {
  return runs.flatMap(run => [
    ...(run.result
      ? failedOf(run.result).map(f => ({ repo: run.repo, check: f.code ?? 'standard', detail: detailOf(f), fixable: fixable(provider, f) }))
      : [{ repo: run.repo, check: 'check', detail: run.error ?? 'The check printed no result.', fixable: false }]),
    ...(run.result ? gitDetails(run.git).map(detail => ({ repo: run.repo, check: 'gitignore', detail, fixable: true })) : []),
  ]);
}

/** Copies the settings files and the hooks a fix may change into the root's repo-sync-backups folder, under the repo's path; null when there is nothing to copy. */
function backupOf(root: string, repo: string, stamp: string): string | null {
  const dir = path.join(root, 'repo-sync-backups', stamp, repo.replace(/^[a-zA-Z]:/, '').replace(/^[\\/]+/, ''));
  let made = false;
  for (const name of [...SETTINGS, 'hooks']) {
    const src = path.join(repo, '.claude', name);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(dir, '.claude', name), { recursive: true });
    made = true;
  }
  return made ? dir : null;
}

/**
 * Adds the missing session entries to the repo's .gitignore (under the block's comment line) and untracks the tracked files, which stay on disk.
 * The .gitignore is backed up first; a dry run only names the changes. Returns the backup folder when one was made.
 */
function fixGit(root: string, repo: string, stamp: string, g: GitState, dry: boolean, changes: string[]): string | null {
  const ignore = path.join(repo, '.gitignore');
  const before = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  let backup: string | null = null;
  if (g.missing.length) {
    const eol = before.includes('\r\n') ? '\r\n' : '\n';
    const opens = !before.split(/\r?\n/).includes(SESSION_BLOCK);
    const lead = before && !before.endsWith('\n') ? eol : '';
    const text = before + lead + (before && opens ? eol : '') + (opens ? SESSION_BLOCK + eol : '') + g.missing.join(eol) + eol;
    changes.push(`.gitignore: added ${g.missing.join(', ')}`);
    if (!dry) {
      if (before) {
        backup = path.join(root, 'repo-sync-backups', stamp, repo.replace(/^[a-zA-Z]:/, '').replace(/^[\\/]+/, ''));
        fs.mkdirSync(backup, { recursive: true });
        fs.copyFileSync(ignore, path.join(backup, '.gitignore'));
      }
      fs.writeFileSync(ignore, text);
    }
  }
  if (g.tracked.length) {
    changes.push(`untracked ${g.tracked.length} file${g.tracked.length === 1 ? '' : 's'} (kept on disk): ${g.tracked.join(', ')}`);
    // git rm --cached takes the tracked paths; the files stay on disk.
    if (!dry) execFileSync('git', ['rm', '-r', '--cached', '-q', '--', ...g.tracked], { cwd: repo, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  }
  return backup;
}

export async function checkCommand(a: Args, io: Io): Promise<number> {
  const [, sub] = a.words;
  if (sub === 'fix') return fixCommand(a, io);
  if (sub) throw new Stop(`check needs nothing or fix, got "${sub}".`, 2);
  const provider = providerOf(a);
  const runs = await checkAll(provider, await pythonOf(provider), reposOf(a));
  const label = labeler(runs.map(r => r.repo));
  const repos = runs.map(run => summaryOf(provider, run));
  const failures = failuresOf(provider, runs);
  const json = { repos, failures };
  const text = [
    headline(`Check · ${count(repos.length, 'repo')} · ${count(failures.length, 'failed check')}`),
    '',
    ...table(
      ['Repo', 'Passed', 'Failed', 'Fixable'],
      repos.length ? repos.map(r => [label(r.repo), r.error ? 'error' : r.passed ? 'yes' : 'no', r.failed, r.fixable]) : [['(none)', '', '', '']],
      [false, false, true, true]
    ),
    '',
    ...table(
      ['Repo', 'Check', 'Detail', 'Fix available'],
      failures.length ? failures.map(f => [label(f.repo), f.check, f.detail, f.fixable ? 'yes' : 'no']) : [['(none)', '', '', '']]
    ),
  ];
  emit(io, a, json, text);
  return 0;
}

async function fixCommand(a: Args, io: Io): Promise<number> {
  const dry = !!one(a, 'dry-run');
  const root = rootOf(a);
  const provider = providerOf(a);
  if (!provider.fix) throw new Stop(`${provider.name} has no fix.`);
  const settings = path.join(root, 'settings.json');
  const stamp = backupStamp();
  const py = await pythonOf(provider);
  const repos = reposOf(a);
  const label = labeler(repos);
  const rows: FixRow[] = [];
  for (const run of await checkAll(provider, py, repos)) {
    const fixes = run.result ? failedOf(run.result).filter(f => fixable(provider, f)).length : 0;
    const git = run.git && gitDetails(run.git).length;
    if (run.result && !fixes && !git) continue;
    const row: FixRow = { repo: run.repo, fixable: fixes + (git || 0), changes: [], backup: null, error: run.error ?? null };
    rows.push(row);
    if (!run.result) continue;
    try {
      if (!fixes) {
        // Only the git state needs a fix.
      } else if (dry) {
        const preview = await previewFix(provider, py, run.repo, false, settings);
        fs.rmSync(preview.temp, { recursive: true, force: true });
        row.changes = preview.changes;
      } else {
        row.backup = backupOf(root, run.repo, stamp);
        row.changes = await applyFix(provider, py, run.repo, false, settings);
      }
    } catch (e) {
      row.error = (e as Error).message;
    }
    if (run.git) {
      try {
        row.backup = fixGit(root, run.repo, stamp, run.git, dry, row.changes) ?? row.backup;
      } catch (e) {
        row.error = [row.error, (e as Error).message].filter(Boolean).join(' ');
      }
    }
  }
  const changed = rows.reduce((n, r) => n + r.changes.length, 0);
  const changes = rows.flatMap(r => (r.error ? [[label(r.repo), `error: ${r.error}`]] : r.changes.map(c => [label(r.repo), c])));
  const json = { repos: rows };
  const text = [
    headline(`Check fix${dry ? ' (dry run)' : ''} · ${count(rows.length, 'repo')} · ${count(changed, 'change')}`),
    '',
    ...table(
      ['Repo', 'Fixable', 'Changes', 'Backup'],
      rows.length ? rows.map(r => [label(r.repo), r.fixable, r.changes.length, r.backup ?? '']) : [['(none)', '', '', '']],
      [false, true, true, false]
    ),
    '',
    ...table(['Repo', 'Change'], changes.length ? changes : [['(none)', '']]),
    ...(dry ? rows.flatMap(r => r.changes.map(c => `[dry-run] ${label(r.repo)}: ${c}`)) : []),
  ];
  emit(io, a, json, text, !dry && changed > 0);
  return rows.some(r => r.error) ? 1 : 0;
}
