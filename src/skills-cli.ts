// The skills CLI (`npx skills`, github.com/vercel-labs/skills) as the harness runs it: `check` and `update` work from the lock the CLI
// wrote (skillFolderHash in ~/.agents/.skill-lock.json, computedHash in a repo's skills-lock.json), and `experimental_install` restores a
// repo's skills from skills-lock.json. Every run takes the folder it runs in and the environment, so a test points it at a scratch home.
import { spawn } from 'child_process';
import * as os from 'os';
import type { Latest } from './distributor';

export interface CliRun {
  code: number | null;
  out: string;
}

export type CliRunner = (args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<CliRun>;

/** Runs `npx skills <args>` in `cwd`; the output is stdout and stderr together, without colour codes. */
export const runSkills: CliRunner = (args, cwd, env) =>
  new Promise(resolve => {
    const child = spawn('npx', ['--yes', 'skills', ...args], { cwd, env: { ...process.env, ...env, NO_COLOR: '1', CI: '1' }, shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (b: Buffer) => (out += b.toString());
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', e => resolve({ code: null, out: e.message }));
    child.on('close', code => resolve({ code, out: out.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '') }));
  });

/**
 * The folder a lock-recorded skill is checked and updated from: the repo for a project lock. The CLI treats a folder that holds .agents as a
 * project and then skips the global lock, so the global one runs in a neutral folder (the system temp folder, which it only reads).
 */
export const cwdOf = (scope: string, _claudeRoot: string): string => (scope.startsWith('repo:') ? scope.slice('repo:'.length) : os.tmpdir());

/**
 * What `npx skills check` says about the named skills. It prints `↑ <name> has an update` for each one that has a newer version. The exit
 * code is not read for that: on Windows the CLI can abort after printing, so the output is what counts. A run that could not start, or
 * printed nothing, is an error for every name.
 */
export async function checkViaCli(names: string[], cwd: string, run: CliRunner = runSkills, env?: NodeJS.ProcessEnv): Promise<Record<string, Latest>> {
  const r = await run(['check'], cwd, env);
  const out: Record<string, Latest> = {};
  if (r.code === null || !r.out.trim()) {
    const error = r.out.trim().split(/\r?\n/).filter(Boolean).pop() ?? `npx skills check printed nothing (exit code ${r.code})`;
    for (const n of names) out[n] = { state: 'error', error };
    return out;
  }
  for (const n of names) out[n] = new RegExp(`(^|[^\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} has an update`, 'm').test(r.out) ? { state: 'newer' } : { state: 'current' };
  return out;
}

/** The arguments of `npx skills update` for named skills: `-g` for the global lock, `-p` for a repo's, `-y` so it asks nothing. */
export const updateArgs = (names: string[], lock: 'global' | 'project'): string[] => ['update', lock === 'global' ? '-g' : '-p', '-y', ...names];

/** The arguments of `npx skills experimental_install`, which restores what skills-lock.json lists into .agents/skills. */
export const restoreArgs = (): string[] => ['experimental_install'];
