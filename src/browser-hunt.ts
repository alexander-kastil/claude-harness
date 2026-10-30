import type { BrowserCard, BrowserKeep, BrowserProcedure, BrowserStep, BrowserTurn } from './shared/browser-hunt';

// The Browser Automation Hunter's conversation: the prompt Claude gets, its answer read back, and the procedure card that answer sets or changes.

export const BROWSER_HUNT_SYSTEM = 'You help a user develop recurring browser configuration procedures: prototype them on the desktop in the browser, then optimize them in code. Answer with one JSON object only.';

const KEEPS: BrowserKeep[] = ['api', 'cli', 'guided', 'tool'];

/** How a procedure is kept, read from the skill's words for it. */
export function keepOf(how: string): BrowserKeep {
  if (/script against|\bapi script/i.test(how)) return 'api';
  if (/guided|click path/i.test(how)) return 'guided';
  if (/command line|\bcli\b|\baz\b/i.test(how)) return 'cli';
  if (/\btools?\b/i.test(how)) return 'tool';
  return 'guided';
}

/** The rows of the procedure table of the skill file. */
export function parseProcedures(skill: string): BrowserProcedure[] {
  const out: BrowserProcedure[] = [];
  for (const line of skill.split(/\r?\n/)) {
    const cells = line.trim().match(/^\|(.+)\|$/)?.[1].split('|').map(c => c.trim());
    if (!cells || cells.length < 2 || /^-+$/.test(cells[0]) || /^procedure$/i.test(cells[0])) continue;
    out.push({ name: cells[0], keep: keepOf(cells[1]), how: cells[1] });
  }
  return out;
}

const HOW: Record<BrowserKeep, string> = {
  api: 'a script against the API',
  cli: 'the command line (az, Graph or a CLI import); the browser only for one-time approvals',
  guided: 'a guided browser run with the saved click path',
  tool: 'a tool instead of the browser',
};

export const KEEP_LABELS: Record<BrowserKeep, string> = { api: 'API script', cli: 'Command line', guided: 'Guided browser run', tool: 'A tool' };

/** The leaf of a procedure: its goal, stage, how it is kept and its steps with the manual ones marked. */
export function leafText(card: BrowserCard): string {
  return [
    `# ${card.name}`,
    '',
    card.goal,
    '',
    `Stage: ${card.stage === 'optimized' ? 'Optimized in code' : 'Prototype on desktop'}`,
    `Kept as: ${KEEP_LABELS[card.keep]}`,
    '',
    '## Steps',
    '',
    ...card.steps.filter(s => s.text.trim()).map((s, i) => `${i + 1}. ${s.text.trim()}${s.manual ? ' (manual)' : ''}`),
    '',
  ].join('\n');
}

/** The skill's table row of a procedure. */
export const rowText = (card: BrowserCard): string => `| ${card.name} | ${HOW[card.keep]}; steps in [references/${card.name}.md](references/${card.name}.md) |`;

/** The skill text with the card's row: a row of the same procedure is replaced, else the row ends the table (a new table when there is none). */
export function withRow(skill: string, card: BrowserCard): string {
  const eol = skill.includes('\r\n') ? '\r\n' : '\n';
  const lines = skill.split(/\r?\n/);
  const row = rowText(card);
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const same = lines.findIndex(l => isRow(l) && l.split('|')[1]?.trim().toLowerCase() === card.name.toLowerCase());
  if (same >= 0) lines[same] = row;
  else {
    let last = -1;
    lines.forEach((l, i) => isRow(l) && (last = i));
    if (last >= 0) lines.splice(last + 1, 0, row);
    else lines.push('', '| Procedure | Keep as |', '|---|---|', row, '');
  }
  return lines.join(eol);
}

const cardJson =(card: BrowserCard) => JSON.stringify({ name: card.name, goal: card.goal, keep: card.keep, stage: card.stage, steps: card.steps });

/** One turn of the conversation: the procedures the skill keeps, the card as it stands, the earlier turns and the owner's new message. */
export function chatPrompt(message: string, skill: string, card: BrowserCard | undefined, history: BrowserTurn[]): string {
  return [
    'The owner is developing a browser automation in a conversation with you. They describe a configuration they do in a web admin page; you turn it into a procedure card: the steps, which of them stay manual, and how the procedure is kept once it is optimized in code. They may ask you to change the card.',
    '',
    '## The skill that keeps their procedures',
    skill || '(no procedures are known yet)',
    '',
    '## The procedure card as it stands now',
    card ? cardJson(card) : 'none yet',
    '',
    '## The conversation so far',
    ...(history.length ? history.map(t => `${t.role === 'owner' ? 'Owner' : 'Claude'}: ${t.text}`) : ['(this is the first message)']),
    '',
    "## The owner's new message",
    message.trim(),
    '',
    '## Answer',
    'One JSON object and nothing else, in this shape:',
    '{"reply":"at most two short sentences","card":{"name":"lowercase-kebab-case procedure name","goal":"one sentence","keep":"api" or "cli" or "guided" or "tool","stage":"prototype" or "optimized","steps":[{"text":"one short imperative sentence","manual":true or false}]}}',
    '"keep" says how the procedure is kept once optimized: "api" a script against an API, "cli" the command line (az, Graph, a CLI import), "guided" a guided browser run with a saved click path, "tool" a tool instead of the browser. Prefer what the skill already says for a procedure it lists. "stage" is "prototype" until the owner says the procedure runs in code. "manual" is true only for sign-in, invite acceptance, MFA or an approval a person must give.',
    '"reply" is always there and at most two short sentences in plain words; never list the steps, the card shows them. "card" only when this turn sets or changes the procedure: it is then the whole card after this turn.',
  ].join('\n');
}

export interface Answered {
  name: string;
  goal: string;
  keep: string;
  stage: string;
  steps: BrowserStep[];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const shapeCard = (data: any): Answered | undefined => {
  if (!data || typeof data !== 'object' || !Array.isArray(data.steps)) return undefined;
  return {
    name: str(data.name),
    goal: str(data.goal),
    keep: str(data.keep),
    stage: str(data.stage),
    steps: data.steps.map((s: any) => ({ text: str(typeof s === 'string' ? s : s?.text), manual: !!(s && typeof s === 'object' && s.manual === true) })).filter((s: BrowserStep) => s.text),
  };
};

/** Claude's answer to one turn. Text that is not the JSON shape is taken as the reply itself, so a chat never dead-ends. */
export function parseTurn(text: string): { reply: string; card?: Answered } {
  let data: any;
  try {
    data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return { reply: text.trim() };
  }
  if (!data || typeof data !== 'object' || typeof data.reply !== 'string') return { reply: text.trim() };
  return { reply: data.reply.trim(), card: data.card && typeof data.card === 'object' ? shapeCard({ steps: [], ...data.card }) : undefined };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Claude's card for this turn against the card it belongs to. A new card when there is none; otherwise the card is updated in
 * place. A value changes only when Claude changed it from what it was sent (`sent`): one it echoes back keeps what the owner
 * has on the card now. Steps are Claude's whole list unless it sent none.
 */
export function applyCard(card: BrowserCard | undefined, answer: Answered, prompt: string, id: string, now: number, sent?: BrowserCard): BrowserCard {
  const keep = (KEEPS as string[]).includes(answer.keep) ? (answer.keep as BrowserKeep) : undefined;
  const stage = answer.stage === 'optimized' || answer.stage === 'prototype' ? answer.stage : undefined;
  if (!card) return { id, prompt, created: now, name: slug(answer.name), goal: answer.goal, keep: keep ?? 'guided', stage: stage ?? 'prototype', steps: answer.steps };
  const pick = <T>(next: T | undefined, was: T | undefined, now: T): T => (next !== undefined && next !== '' && next !== was ? next : now);
  return {
    ...card,
    name: pick(slug(answer.name), sent?.name, card.name),
    goal: pick(answer.goal, sent?.goal, card.goal),
    keep: pick(keep, sent?.keep, card.keep),
    stage: pick(stage, sent?.stage, card.stage),
    steps: answer.steps.length ? answer.steps : card.steps,
  };
}
