// The status line builder's fields, shared by the host (which writes the script) and the page (which previews the line).

export type StatuslineField = 'model' | 'context' | 'fiveHour' | 'weekly' | 'cost' | 'branch' | 'folder';

/** The fields in the order the builder lists them; each says what it shows and where Claude Code gets it. */
export const STATUSLINE_FIELDS: { id: StatuslineField; label: string; hint: string }[] = [
  { id: 'model', label: 'Model', hint: 'The model of the session, by its display name, from model.display_name.' },
  { id: 'context', label: 'Context used', hint: 'The share of the context window in use, from context_window.used_percentage.' },
  { id: 'fiveHour', label: '5-hour limit', hint: 'The share of the 5-hour limit used, from rate_limits.five_hour. When Claude Code sends none, the script asks the usage endpoint the way the status bar item does and keeps the answer for five minutes.' },
  { id: 'weekly', label: 'Weekly limit', hint: 'The share of the weekly limit used, from rate_limits.seven_day, with the same fallback as the 5-hour limit.' },
  { id: 'cost', label: 'Session cost', hint: 'The estimated cost of the session in US dollars, from cost.total_cost_usd.' },
  { id: 'branch', label: 'Git branch', hint: 'The branch of the working directory, from the worktree of the session or git itself.' },
  { id: 'folder', label: 'Folder', hint: 'The name of the working directory, from workspace.current_dir.' },
];

/** The part of the JSON Claude Code passes to the status line command that the fields read. */
export interface StatuslineInput {
  model?: { display_name?: string };
  workspace?: { current_dir?: string };
  cwd?: string;
  cost?: { total_cost_usd?: number };
  context_window?: { used_percentage?: number | null };
  rate_limits?: { five_hour?: { used_percentage?: number }; seven_day?: { used_percentage?: number } };
}

const pct = (v: unknown): string | undefined => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)}%` : undefined);

/** The line the generated script prints for `input`; the unit tests hold the script to this. `branch` is what git answered. */
export function statuslineText(fields: string[], input: StatuslineInput, branch = ''): string {
  const dir = String(input.workspace?.current_dir || input.cwd || '').replace(/[\\/]+$/, '');
  const part: Record<StatuslineField, string | undefined> = {
    model: input.model?.display_name || undefined,
    context: pct(input.context_window?.used_percentage) && `ctx ${pct(input.context_window?.used_percentage)}`,
    fiveHour: pct(input.rate_limits?.five_hour?.used_percentage) && `5h ${pct(input.rate_limits?.five_hour?.used_percentage)}`,
    weekly: pct(input.rate_limits?.seven_day?.used_percentage) && `wk ${pct(input.rate_limits?.seven_day?.used_percentage)}`,
    cost: typeof input.cost?.total_cost_usd === 'number' ? `$${input.cost.total_cost_usd.toFixed(2)}` : undefined,
    branch: branch || undefined,
    folder: dir ? dir.split(/[\\/]/).pop() : undefined,
  };
  return fields.map(f => part[f as StatuslineField]).filter(Boolean).join(' | ');
}
