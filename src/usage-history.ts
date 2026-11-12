// Usage history: what the work cost per day, per month and per project at API list prices, and which plan it would have fitted.
// No node imports: the host reader (usage-history-host.ts) and the webview both use these functions.

/** One day of one project folder: the cost of its responses at API list prices, and their tokens. */
export interface HistoryRow {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Folder under `projects/`, the repo's `projectSlug`. */
  folder: string;
  cost: number;
  tokens: number;
}

export interface AccountHistory {
  account: string;
  rows: HistoryRow[];
}

export interface HistoryReply {
  /** When the host read the transcripts. */
  until: number;
  accounts: AccountHistory[];
}

export type Period = '30d' | '90d' | '12m';

export const PERIODS: { id: Period; label: string; days: number }[] = [
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '12m', label: '12 months', days: 365 },
];

/** Months of history the host reads. */
export const HISTORY_MONTHS = 12;

export interface PlanPrice {
  id: 'pro' | 'max' | 'ultra';
  label: string;
  /** USD per month, billed monthly. */
  price: number;
  /** The plan's estimated weekly limit in USD at API list prices: the figure of PLANS in src/sessions.ts. */
  weeklyLimit: number;
  /** What the plan was called before Anthropic renamed it. */
  formerly?: string;
}

/** Plan prices as read on claude.com/pricing on 2026-11-12 (Pro $20 billed monthly, $17 with an annual subscription; Max $100; Ultra $200). */
export const PLAN_PRICES_READ_ON = '2026-11-12';
export const PLAN_PRICES_SOURCE = 'https://claude.com/pricing';
export const PLAN_PRICES: PlanPrice[] = [
  { id: 'pro', label: 'Pro', price: 20, weeklyLimit: 105 },
  { id: 'max', label: 'Max', price: 100, weeklyLimit: 523, formerly: 'Max 5x' },
  { id: 'ultra', label: 'Ultra', price: 200, weeklyLimit: 1643, formerly: 'Max 20x' },
];

/** What a plan's weekly limit allows over a month, in USD at API list prices. */
export const monthCapacity = (p: PlanPrice): number => (p.weeklyLimit * 52) / 12;

export interface Advice {
  /** The plan to take, or `api` when paying by the token costs less than the cheapest plan. */
  best: 'api' | PlanPrice['id'];
  /** True when the work is more than the best plan's limit allows in a month. */
  over: boolean;
  /** API price minus the best plan's price: what the plan saves in the month, 0 for `api`. */
  saves: number;
}

/** The cheapest plan that covers a month of work and costs less than paying by the token; the largest plan, flagged over, when none covers it. */
export function advise(apiCost: number): Advice {
  const fits = PLAN_PRICES.find(p => monthCapacity(p) >= apiCost);
  const plan = fits ?? PLAN_PRICES[PLAN_PRICES.length - 1];
  if (plan.price >= apiCost) return { best: 'api', over: false, saves: 0 };
  return { best: plan.id, over: !fits, saves: apiCost - plan.price };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar day of a time, `YYYY-MM-DD`. */
export const dayKey = (at: number): string => {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The first instant, in ms, the history covers: the first of the month `HISTORY_MONTHS - 1` months back. */
export const historySince = (now: number): number => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() - (HISTORY_MONTHS - 1), 1).getTime();
};

/** Adds one response to the rows of its day and folder. */
export function addRow(rows: Map<string, HistoryRow>, folder: string, at: number, cost: number, tokens: number): void {
  const day = dayKey(at);
  const k = `${day}|${folder}`;
  const row = rows.get(k) ?? { day, folder, cost: 0, tokens: 0 };
  row.cost += cost;
  row.tokens += tokens;
  rows.set(k, row);
}

/** The first day of a period, ending today: 30 and 90 days count back from today, 12 months start on the first of the month 11 months back. */
export function periodStart(period: Period, now: number): string {
  const d = new Date(now);
  if (period === '12m') return dayKey(new Date(d.getFullYear(), d.getMonth() - (HISTORY_MONTHS - 1), 1).getTime());
  const days = PERIODS.find(p => p.id === period)!.days;
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (days - 1)).getTime());
}

/** The rows of a period, narrowed to one project folder when given (compared in lower case). */
export const periodRows = (rows: HistoryRow[], period: Period, now: number, folder?: string): HistoryRow[] => {
  const from = periodStart(period, now);
  const f = folder?.toLowerCase();
  return rows.filter(r => r.day >= from && (!f || r.folder.toLowerCase() === f));
};

export interface Bucket {
  /** `YYYY-MM-DD` for a day, `YYYY-MM` for a month. */
  key: string;
  cost: number;
  tokens: number;
}

/** One bucket per calendar day from the period's first day to today, empty days included. */
export function byDay(rows: HistoryRow[], period: Period, now: number): Bucket[] {
  const sums = new Map<string, Bucket>();
  for (const r of rows) {
    const b = sums.get(r.day) ?? { key: r.day, cost: 0, tokens: 0 };
    b.cost += r.cost;
    b.tokens += r.tokens;
    sums.set(r.day, b);
  }
  const out: Bucket[] = [];
  const today = new Date(now);
  const [y, m, d] = periodStart(period, now).split('-').map(Number);
  for (let t = new Date(y, m - 1, d); t <= today; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    const key = dayKey(t.getTime());
    out.push(sums.get(key) ?? { key, cost: 0, tokens: 0 });
  }
  return out;
}

/** One bucket per calendar month that holds a day of the rows, oldest first; the months between are included. */
export function byMonth(rows: HistoryRow[], period: Period, now: number): Bucket[] {
  const sums = new Map<string, Bucket>();
  for (const r of rows) {
    const key = r.day.slice(0, 7);
    const b = sums.get(key) ?? { key, cost: 0, tokens: 0 };
    b.cost += r.cost;
    b.tokens += r.tokens;
    sums.set(key, b);
  }
  const out: Bucket[] = [];
  const end = new Date(now);
  const [y, m] = periodStart(period, now).split('-').map(Number);
  for (let t = new Date(y, m - 1, 1); t <= end; t = new Date(t.getFullYear(), t.getMonth() + 1, 1)) {
    const key = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
    out.push(sums.get(key) ?? { key, cost: 0, tokens: 0 });
  }
  return out;
}

export interface FolderTotal {
  folder: string;
  cost: number;
  tokens: number;
  /** Days with work. */
  days: number;
}

/** Cost per project folder, costliest first. */
export function byFolder(rows: HistoryRow[]): FolderTotal[] {
  const sums = new Map<string, FolderTotal>();
  for (const r of rows) {
    const t = sums.get(r.folder) ?? { folder: r.folder, cost: 0, tokens: 0, days: 0 };
    t.cost += r.cost;
    t.tokens += r.tokens;
    t.days += 1;
    sums.set(r.folder, t);
  }
  return [...sums.values()].sort((a, b) => b.cost - a.cost || a.folder.localeCompare(b.folder));
}
