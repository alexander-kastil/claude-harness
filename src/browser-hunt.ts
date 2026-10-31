import type { BrowserCard, BrowserKeep, BrowserProcedure, BrowserStep, BrowserTurn } from './shared/browser-hunt';

// The Browser Automation Hunter's conversation: the prompt Claude gets, its answer read back, and the procedure card that answer sets or changes.

export const BROWSER_HUNT_SYSTEM = [
  'You are the Automation Hunter. You help the owner turn a configuration they repeat by hand, in a web page or a desktop app, into a kept procedure: prototyped once on the desktop, then optimized in code. You write the procedure card; the owner checks it and presses Create, which writes it into their automations skill.',
  '',
  '## What a procedure is',
  '',
  '- A recurring change with an outcome: an account, project, key, OAuth client, connector, setting, signature, profile or post created or changed in an admin console, a portal, a publishing site or a desktop app. Reading or researching a page is not a procedure.',
  "- A browser procedure runs in the owner's signed-in browser; a desktop procedure runs in a desktop app through computer use. The goal says so when it is a desktop app.",
  '',
  '## The card',
  '',
  '- name: service, object and action in lowercase kebab-case, e.g. google-analytics-oauth-client, outlook-desktop-signature, x-article-publish. A procedure the skill already lists keeps its name; never make a second card for it.',
  '- goal: one sentence naming the outcome and what it is for.',
  '- steps: 4 to 12, in the order they run, one short imperative sentence each. A step on a page starts with its deepest stable URL (console.cloud.google.com/auth/clients/create, not "the console") and names each control by its visible label. A step in a desktop app names the app, the window and the control.',
  '- Each lesson goes inside the step where it bites: a size or format limit, an editor quirk, a value shown only once, a wait until an upload finishes, a setting that cannot be changed later. Never a separate list of tips.',
  '- The last step checks that the result is live: the post page shows the post, a new message shows the signature, the client is listed, the server answers.',
  '- A step never holds a secret, key, password, token or client secret; it names where the value goes ("download the client JSON before closing the dialog").',
  '',
  '## Manual steps',
  '',
  '"manual" is true only for what a person must do themselves: sign-in, MFA, consent and OAuth approval screens (also past an unverified-app warning), granting a desktop app access, accepting an invite, saving a secret that is shown only once, and a final Post, Join or Publish click when a permission check stops the automation. Every other step is false.',
  '',
  '## How it is kept',
  '',
  '"keep" follows what the service offers, not how the procedure was done the first time:',
  '- "api" when a public API covers every step that is not manual; the reply names the API.',
  '- "cli" when a command line covers it (gcloud, az, Graph PowerShell, pac, gh), with the browser left only for one-time approvals.',
  '- "guided" when the steps exist only in a console or an editor (OAuth consent screens and desktop clients, mail signatures, social editors, admin toggles): a guided run with the saved click path in the browser or the desktop app.',
  '- "tool" when an existing tool or skill already does it; the reply names it.',
  'A procedure the skill already lists keeps what the skill says unless the owner changes it. When you are not sure an API covers it, choose "guided" and say in the reply what to check. "stage" stays "prototype" until the owner says the procedure runs in code.',
  '',
  '## How you talk',
  '',
  'Plain words, at most two short sentences. Ask one question only when the card cannot be right without the answer (which account, tenant, project or channel); otherwise make a sensible choice and say it. Answer with one JSON object only.',
].join('\n');

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

const unlink = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/** The skill's words for how a procedure is kept, as a sentence: links reduced to their text, the "; steps in ..." tail dropped, a capital and a period. */
export function howSentence(how: string): string {
  const s = unlink(how).replace(/;\s*steps in\b.*$/i, '').trim();
  if (!s) return '';
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}`;
}

/** Where a procedure's leaf is, relative to the skill's folder: the link in its row, else references/<name>.md. */
export const leafRel = (p: { name: string; how: string }): string => /\]\((references\/[^)\s]+\.md)\)/.exec(p.how)?.[1] ?? `references/${p.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.md`;

/** The goal of a leaf: its first paragraph under the H1. */
export function leafGoal(leaf: string): string {
  const lines = leaf.split(/\r?\n/);
  const h1 = lines.findIndex(l => /^#\s/.test(l));
  const para: string[] = [];
  for (const l of lines.slice(h1 + 1)) {
    if (!l.trim()) {
      if (para.length) break;
      continue;
    }
    if (/^#/.test(l)) break;
    para.push(l.trim());
  }
  return unlink(para.join(' '));
}

/** The hover text of a procedure: its goal when known, then how it is kept. */
export const procedureDesc = (p: { how: string }, goal?: string): string => [goal?.trim(), howSentence(p.how)].filter(Boolean).join('\n');

const HOW: Record<BrowserKeep, string> = {
  api: 'a script against the API',
  cli: 'the command line (az, Graph or a CLI import); the browser only for one-time approvals',
  guided: 'a guided run with the saved click path',
  tool: 'a tool instead of the browser',
};

export const KEEP_LABELS: Record<BrowserKeep, string> = { api: 'API script', cli: 'Command line', guided: 'Guided run', tool: 'A tool' };

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

/** The skill text with the card's name (hyphens as spaces) added to the `Triggers on ...` list of its front-matter description, so the skill loads on it. */
export function withTrigger(skill: string, card: BrowserCard): string {
  const eol = skill.includes('\r\n') ? '\r\n' : '\n';
  const lines = skill.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return skill;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  const at = lines.findIndex((l, i) => i > 0 && (end < 0 || i < end) && /^description:/.test(l));
  if (at < 0 || !/Triggers on/.test(lines[at])) return skill;
  const trigger = `"${card.name.trim().replace(/-+/g, ' ')}"`;
  if (lines[at].toLowerCase().includes(trigger.toLowerCase())) return skill;
  const m = lines[at].match(/\.(\s*)$/);
  if (!m) return skill;
  lines[at] = `${lines[at].slice(0, m.index)}, ${trigger}.${m[1]}`;
  return lines.join(eol);
}

const cardJson =(card: BrowserCard) => JSON.stringify({ name: card.name, goal: card.goal, keep: card.keep, stage: card.stage, steps: card.steps });

/** One turn of the conversation: the procedures the skill keeps, the card as it stands, the earlier turns and the owner's new message. */
export function chatPrompt(message: string, skill: string, card: BrowserCard | undefined, history: BrowserTurn[]): string {
  return [
    'The owner is developing a procedure with you. Follow the rules of your system prompt.',
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
