import { Args, Io, emit, headline, load, table } from './cli-core';
import { RepoOverviewRow, repoOverviewRow } from './repos-overview';
import { pluginDirs } from './harness';
import { CheckResult, Provider, checkRepo, findProvider, findPython, needsPython } from './standard';

// `repos`: one row per repo, the GitHub Repo overview without VS Code: the same columns, read from the same files and checked by the same standard provider.

export interface RepoOverviewLine extends RepoOverviewRow {
  error?: string;
}

export interface ReposOut {
  standard: string | null;
  rows: RepoOverviewLine[];
  counts: { repos: number; pass: number; review: number; fail: number; error: number };
}

interface Checked {
  state: string;
  result?: CheckResult;
  error?: string;
}

interface Column {
  head: string;
  right?: boolean;
  cell: (r: RepoOverviewLine) => string | number;
}

/** The Standard cell, in the words the GitHub Repo overview shows for a check state. */
export function standardText(r: RepoOverviewLine): string {
  if (r.checkState === 'pass') return 'pass';
  if (r.checkState === 'fail') return `fail ${r.check?.fail ?? 0}${r.check?.review ? ` · review ${r.check.review}` : ''}`;
  if (r.checkState === 'review') return `review ${r.check?.review ?? 0}`;
  return (r.error ?? r.checkState).replace(/\s+/g, ' ');
}

/** The GitHub Repo overview's columns; the Layout, Standard, Em dashes and Review columns appear only with a provider, as they do in the extension. */
function columnsOf(standard: boolean): Column[] {
  const checked: Column[] = [
    { head: 'Layout', cell: r => r.layout ?? '' },
    { head: 'Standard', cell: r => standardText(r) },
  ];
  const measured: Column[] = [
    { head: 'Em dashes', right: true, cell: r => r.emDashes ?? '' },
    { head: 'Review', right: true, cell: r => r.check?.review ?? '' },
  ];
  return [
    { head: 'Repo', cell: r => r.label },
    ...(standard ? checked : []),
    { head: 'Lines', right: true, cell: r => r.lines },
    ...(standard ? measured : []),
    { head: 'Plugins', right: true, cell: r => r.plugins.length },
    { head: 'Hook copies', right: true, cell: r => r.hookCopies },
    { head: 'Copies', right: true, cell: r => r.copies },
  ];
}

/** Checks one repo as the extension's Constitution does: a failure beats a review, a review beats a pass. */
async function checkOf(provider: Provider | undefined, py: string[] | undefined, dir: string): Promise<Checked> {
  if (!provider) return { state: 'no-plugin' };
  if (needsPython(provider.check) && !py) return { state: 'no-python', error: 'Python 3 was not found on PATH (python, py -3 or python3).' };
  try {
    const result = await checkRepo(provider, py, dir);
    return { state: result.fail ? 'fail' : result.review ? 'review' : 'pass', result };
  } catch (e) {
    return { state: 'error', error: (e as Error).message };
  }
}

export async function reposCommand(a: Args, io: Io): Promise<number> {
  const w = load(a);
  const provider = findProvider(pluginDirs(w.root, true));
  const py = provider && needsPython(provider.check) ? await findPython() : undefined;
  const rows: RepoOverviewLine[] = [];
  for (const view of w.views.filter(v => v.id !== 'global')) {
    const checked = await checkOf(provider, py, view.path);
    rows.push({ ...repoOverviewRow(view, checked), error: checked.error });
  }
  const state = (s: string) => rows.filter(r => r.checkState === s).length;
  const counts = {
    repos: rows.length,
    pass: state('pass'),
    review: state('review'),
    fail: state('fail'),
    error: rows.filter(r => r.checkState === 'error' || r.checkState === 'no-python').length,
  };
  const out: ReposOut = { standard: provider?.name ?? null, rows, counts };
  const columns = columnsOf(!!provider);
  const body = rows.length ? rows.map(r => columns.map(c => c.cell(r))) : [['(none)', ...columns.slice(1).map(() => '')]];
  const summary = provider ? ` · ${counts.fail} fail · ${counts.review} review` : ' · no standard provider';
  emit(io, a, out, [
    headline(`Repos · ${rows.length}${summary}`),
    '',
    ...table(
      columns.map(c => c.head),
      body,
      columns.map(c => !!c.right)
    ),
  ]);
  return 0;
}
