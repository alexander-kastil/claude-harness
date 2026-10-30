import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Args, Io, Stop, emit, headline, one, table } from './cli-core';
import { CloudSessions, CoworkChat, chatById, fetchCloudSessions, loadChat, loadChats } from './cowork-chats';
import { HandoverCard, HandoverPlan, HandoverSeed, applyHandover, listDownloads, planHandover, seedFromChat, seedFromCloud, seedFromDownload, seedFromLink } from './cowork-handover';
import { runUrl } from './cowork-scheduled';

// The Cowork chats, artifacts and handover pages on the command line. Read-only on the Cowork side: the desktop app's data is only read.
// `cowork handover create` writes into a repo of yours; `cowork handover plan` is its dry run.

const rootOf = (a: Args): string => path.resolve(one(a, 'root') ?? path.join(os.homedir(), '.claude'));

const stamp = (t: number): string => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '-');

/** Bytes as 436, 12K, 1.2M. */
const bytes = (n: number): string => (n < 1024 ? String(n) : n < 1048576 ? `${Math.round(n / 1024)}K` : `${Number((n / 1048576).toFixed(1))}M`);

const modelOf = (m: string): string => m.replace(/^claude-/, '') || '-';

const has = (query: string | undefined, ...texts: string[]): boolean => !query || texts.some(t => t.toLowerCase().includes(query.toLowerCase()));

function limited<T>(a: Args, rows: T[]): T[] {
  const n = one(a, 'limit');
  if (n === undefined) return rows;
  if (!/^\d+$/.test(n)) throw new Stop(`--limit takes a number, got "${n}".`, 2);
  return rows.slice(0, Number(n));
}

/** A chat by its id, an unambiguous start of it, or its exact title. */
function findChat(ref: string | undefined): CoworkChat {
  if (!ref) throw new Stop('Name the chat: its id from `harness cowork chats`.', 2);
  const all = loadChats();
  if (!all.found) throw new Stop("The Claude desktop app's data is not on this PC, so no chat is listed here.");
  const exact = chatById(ref) ?? all.chats.find(c => c.title.toLowerCase() === ref.toLowerCase());
  if (exact) return exact;
  const starts = all.chats.filter(c => c.id.toLowerCase().startsWith(ref.toLowerCase()));
  if (starts.length === 1) return starts[0];
  if (starts.length > 1) throw new Stop(`${ref} starts ${starts.length} chats; give more of the id.`, 2);
  throw new Stop(`No Cowork chat ${ref} on this PC. Run: harness cowork chats`);
}

const NO_DATA = "The Claude desktop app's data is not on this PC, so no chat is listed here.";

const chatRows = (chats: CoworkChat[]): (string | number)[][] => chats.map(c => [c.id, c.title, modelOf(c.model), c.produced, c.uploaded, stamp(c.lastActivity)]);
const CHAT_HEAD = ['Id', 'Chat', 'Model', 'Out', 'In', 'Last activity'];
const CHAT_RIGHT = [false, false, false, true, true, false];

const sessionRows = (s: CloudSessions): (string | number)[][] => s.sessions.map(x => [x.id, x.title, x.status, x.messages, stamp(x.updated ?? 0)]);
const SESSION_HEAD = ['Id', 'Session', 'Status', 'Messages', 'Updated'];
const SESSION_RIGHT = [false, false, false, true, false];

function sessionLines(s: CloudSessions, rows: (string | number)[][]): string[] {
  if (s.state !== 'ok') return [headline('Cowork sessions on claude.ai'), '', s.note];
  return [headline(`Cowork sessions on claude.ai: ${rows.length}`), '', ...(rows.length ? table(SESSION_HEAD, rows, SESSION_RIGHT) : ['claude.ai lists no Cowork session.'])];
}

/** `cowork chats`: the chats on this PC and the Cowork sessions claude.ai lists. */
async function chats(a: Args, io: Io): Promise<number> {
  const query = one(a, 'query');
  const all = loadChats();
  const mine = limited(a, all.chats.filter(c => has(query, c.title, c.model)));
  const cloud = await fetchCloudSessions(rootOf(a));
  const sessions = { ...cloud, sessions: limited(a, cloud.sessions.filter(x => has(query, x.title, x.status))) };
  const lines = [headline(`Cowork chats on this PC: ${mine.length}`), '', ...(!all.found ? [NO_DATA] : mine.length ? table(CHAT_HEAD, chatRows(mine), CHAT_RIGHT) : [query ? 'No chat matches.' : 'No Cowork chat has run on this PC.']), '', ...sessionLines(sessions, sessionRows(sessions))];
  emit(io, a, { found: all.found, chats: mine, sessions }, lines);
  return 0;
}

/** `cowork chat <id>`: one chat with its details, its files and its conversation. */
function chat(a: Args, io: Io): number {
  const c = findChat(a.words[2]);
  const d = loadChat(c);
  const shown = limited(a, d.messages);
  const lines = [
    headline(`Cowork chat ${c.title}`),
    '',
    ...table(['Field', 'Value'], [['Id', c.id], ['Model', modelOf(c.model)], ['Last activity', stamp(c.lastActivity)], ['Archived', c.archived ? 'yes' : 'no'], ['Files', `${c.produced} produced, ${c.uploaded} given`]]),
    '',
    headline(`Files: ${d.files.length}`),
    '',
    ...(d.files.length ? table(['File', 'Kind', 'Size', 'Path'], d.files.map(f => [f.name, f.kind === 'produced' ? 'Produced' : 'Given', bytes(f.size), f.file]), [false, false, true, false]) : ['The chat produced and received no files.']),
    '',
    headline(`Conversation: ${d.messages.length + d.more}`),
    ...(shown.length ? shown.flatMap(m => ['', `**${m.role === 'you' ? 'You' : 'Claude'}**`, m.text]) : ['', 'The chat has no text on this PC.']),
    ...(d.more ? ['', `${d.more} more messages not shown.`] : []),
  ];
  emit(io, a, { chat: c, files: d.files, messages: shown, more: d.more + (d.messages.length - shown.length) }, lines);
  return 0;
}

/** `cowork artifacts`: the files the chats produced. */
function artifacts(a: Args, io: Io): number {
  const query = one(a, 'query');
  const all = loadChats();
  const rows = limited(a, all.artifacts.filter(x => has(query, x.name, x.chat)));
  const lines = [headline(`Cowork artifacts on this PC: ${rows.length}`), '', ...(!all.found ? [NO_DATA.replace('no chat', 'no artifact')] : rows.length ? table(['File', 'Chat', 'Size', 'Updated', 'Path'], rows.map(x => [x.name, x.chat, bytes(x.size), stamp(x.updated), x.file]), [false, false, true, false, false]) : [query ? 'No artifact matches.' : 'No Cowork chat produced a file on this PC.'])];
  emit(io, a, { found: all.found, artifacts: rows }, lines);
  return 0;
}

// ---- handover ----

/** `cowork handover sources`: what a handover card can start from. */
async function sources(a: Args, io: Io): Promise<number> {
  const query = one(a, 'query');
  const downloads = listDownloads().filter(f => has(query, f.name));
  const all = loadChats();
  const mine = limited(a, all.chats.filter(c => has(query, c.title, c.model)));
  const cloud = await fetchCloudSessions(rootOf(a));
  const sessions = { ...cloud, sessions: limited(a, cloud.sessions.filter(x => has(query, x.title, x.status))) };
  const lines = [
    headline(`Handover sources: ${mine.length} chats, ${sessions.sessions.length} sessions, ${downloads.length} files`),
    '',
    headline('Desktop chats (--source chat --id <Id>)'),
    '',
    ...(!all.found ? [NO_DATA] : mine.length ? table(CHAT_HEAD, chatRows(mine), CHAT_RIGHT) : ['No chat.']),
    '',
    ...sessionLines(sessions, sessionRows(sessions)).map((l, i) => (i === 0 ? headline('Cowork sessions (--source cloud --id <Id>)') : l)),
    '',
    headline('Files in Downloads, last 14 days (--source download --id <File>)'),
    '',
    ...(downloads.length ? table(['File', 'Size', 'Updated', 'Path'], downloads.map(f => [f.name, bytes(f.size), stamp(f.updated), f.file]), [false, true, false, false]) : ['No file of the last 14 days.']),
    '',
    'An artifact link is --source link --link <https://...>.',
  ];
  emit(io, a, { chats: mine, sessions, downloads }, lines);
  return 0;
}

const lines = (a: Args, key: string): string => (a.flags.get(key) ?? []).map(s => s.trim()).filter(Boolean).join('\n');

async function seedOf(a: Args): Promise<HandoverSeed> {
  const source = one(a, 'source');
  const id = one(a, 'id');
  if (source === 'chat') {
    const c = findChat(id);
    return seedFromChat(c, loadChat(c));
  }
  if (source === 'download') {
    const f = listDownloads().find(x => id && (x.name === id || path.resolve(x.file).toLowerCase() === path.resolve(id).toLowerCase()));
    if (!f) throw new Stop(`${id ?? 'That file'} is not in Downloads from the last 14 days. Run: harness cowork handover sources`);
    return seedFromDownload(f);
  }
  if (source === 'cloud') {
    if (!id || !/^[\w-]+$/.test(id)) throw new Stop('--source cloud needs --id <session id>.', 2);
    const found = (await fetchCloudSessions(rootOf(a))).sessions.find(x => x.id === id);
    return seedFromCloud(found?.title ?? 'Cowork session', runUrl(id));
  }
  if (source === 'link') {
    const link = (one(a, 'link') ?? '').trim();
    if (!/^https?:\/\/\S+$/.test(link)) throw new Stop('--source link needs --link <address of the artifact, starting with https://>.', 2);
    return seedFromLink(link);
  }
  throw new Stop('cowork handover needs --source chat|download|cloud|link.', 2);
}

interface HandoverOut {
  title: string;
  source: string;
  folder: string;
  problems: string[];
  files: { name: string; from: string; to: string; missing: boolean }[];
  prompt: string;
  context: string;
  /** Names of the files that did not exist and were not copied; empty on a plan. */
  missing: string[];
}

const handoverLines = (o: HandoverOut, dry: boolean): string[] => [
  headline(`${dry ? '[dry-run] ' : ''}Handover ${o.title} to ${o.folder}`),
  '',
  ...(o.files.length ? table(['File', 'From', 'To', 'State'], o.files.map(f => [f.name, f.from, f.to, f.missing ? 'missing' : dry ? 'copy' : 'copied'])) : ['No file comes along.']),
  ...(o.problems.length ? ['', headline('Problems'), '', ...o.problems.map(p => `- ${p}`)] : []),
  '',
  headline('First prompt for Claude Code'),
  '',
  o.prompt,
];

/** `cowork handover plan|create`: the card from a source and the options, planned and, for create, written beside a CONTEXT.md. */
async function handover(a: Args, io: Io, dry: boolean): Promise<number> {
  const seed = await seedOf(a);
  const repos = a.flags.get('repo') ?? [];
  if (repos.length !== 1) throw new Stop('cowork handover needs one --repo <dir>: the repository the work moves to.', 2);
  const repo = path.resolve(repos[0]);
  const skip = (one(a, 'skip') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const card: HandoverCard = {
    title: one(a, 'title') ?? seed.title,
    source: seed.source,
    link: seed.link,
    snapshot: one(a, 'snapshot') ?? seed.snapshot,
    files: seed.files.map(f => ({ ...f, include: !skip.includes(f.name) && !skip.includes(`files/${f.name}`) })),
    repo,
    folder: one(a, 'folder') ?? '',
    task: one(a, 'task') ?? '',
    rules: lines(a, 'rule'),
    exists: lines(a, 'exists'),
    todo: lines(a, 'todo'),
  };
  const known = new Set(seed.files.map(f => path.resolve(f.file).toLowerCase()));
  const plan: HandoverPlan = planHandover(card, r => fs.existsSync(r) && fs.statSync(r).isDirectory(), f => known.has(path.resolve(f).toLowerCase()));
  const out: HandoverOut = { title: card.title, source: card.source, folder: plan.folder, problems: plan.problems, files: plan.copy.map(c => ({ name: c.name, from: c.from, to: c.to, missing: c.missing })), prompt: plan.prompt, context: plan.context, missing: [] };
  if (!dry) {
    if (plan.problems.length) throw new Stop(`Nothing was handed over: ${plan.problems.join(' ')}`);
    out.missing = applyHandover(plan);
  }
  emit(io, a, out, handoverLines(out, dry), !dry);
  return 0;
}

const USAGE = 'cowork chats [--query <text>] [--limit <n>] | cowork chat <id> [--limit <n>] | cowork artifacts [--query <text>] [--limit <n>] | cowork handover sources|plan|create.';

/** The Cowork read commands and the handover; `cowork pull` stays in cli-cowork.ts. */
export async function coworkPagesCommand(a: Args, io: Io): Promise<number> {
  const [, sub, third] = a.words;
  if (sub === 'chats') return chats(a, io);
  if (sub === 'chat') return chat(a, io);
  if (sub === 'artifacts') return artifacts(a, io);
  if (sub === 'handover') {
    if (third === 'sources') return sources(a, io);
    if (third === 'plan') return handover(a, io, true);
    if (third === 'create') return handover(a, io, !!one(a, 'dry-run'));
    throw new Stop('cowork handover needs sources, plan or create.', 2);
  }
  throw new Stop(`cowork needs a subcommand: cowork pull, ${USAGE}`, 2);
}
