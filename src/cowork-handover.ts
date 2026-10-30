import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChatContents, CoworkChat } from './cowork-chats';

// The Handover tool: what a Cowork chat, an artifact or a file of the desktop app hands to Claude Code. The owner ticks the card,
// Claude drafts its task and rules, and Continue in terminal copies the ticked files beside a CONTEXT.md and opens Claude Code there.
// Read only on the Cowork side: the sources are never changed, and what this PC or the Claude Code login cannot read is said so.

export type HandoverSource = 'link' | 'cloud' | 'chat' | 'download';

export interface HandoverFile {
  /** The name shown, and the name under files/ in the target. */
  name: string;
  file: string;
  include: boolean;
  /** Not on disk when the source was read; the card shows it and offers Locate. */
  missing?: boolean;
}

/** What picking a source puts on the card. */
export interface HandoverSeed {
  title: string;
  source: HandoverSource;
  link?: string;
  snapshot: string;
  files: HandoverFile[];
  /** One line on what could not be read, shown on the card. */
  note?: string;
}

export interface DownloadFile {
  name: string;
  file: string;
  size: number;
  updated: number;
}

export interface HandoverRepo {
  label: string;
  base: string;
}

/** The card as the page has it when Continue in terminal is pressed. */
export interface HandoverCard {
  title: string;
  source: HandoverSource;
  link?: string;
  snapshot: string;
  files: HandoverFile[];
  repo: string;
  folder: string;
  task: string;
  /** One rule, one item of what exists and one item of what is still to write per line. */
  rules: string;
  exists: string;
  todo: string;
}

export interface HandoverDraft {
  task: string;
  rules: string;
  exists: string;
  todo: string;
}

export interface HandoverPlan {
  folder: string;
  copy: { from: string; to: string; name: string; missing: boolean }[];
  context: string;
  prompt: string;
  problems: string[];
}

const SNAPSHOT_CAP = 8000;
const DAYS = 14;
const DOWNLOAD_CAP = 20;
const KEEP = /\.(md|txt|html?|docx?|pdf|png|jpe?g|gif|svg|zip|xlsx?|pptx?|csv|json|skill)$/i;

export const downloadsDir = (): string => process.env.CLAUDE_HARNESS_DOWNLOADS || path.join(os.homedir(), 'Downloads');

/** The files the owner saved from the apps lately: the newest of the Downloads folder, partial downloads left out. */
export function listDownloads(dir: string = downloadsDir(), now: number = Date.now()): DownloadFile[] {
  let names: fs.Dirent[] = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DownloadFile[] = [];
  for (const e of names) {
    if (!e.isFile() || !KEEP.test(e.name)) continue;
    const file = path.join(dir, e.name);
    try {
      const st = fs.statSync(file);
      if (now - st.mtimeMs <= DAYS * 86400000) out.push({ name: e.name, file, size: st.size, updated: st.mtimeMs });
    } catch {
      // gone while reading
    }
  }
  return out.sort((a, b) => b.updated - a.updated).slice(0, DOWNLOAD_CAP);
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'handover';

const tail = (text: string): string => (text.length > SNAPSHOT_CAP ? `...${text.slice(text.length - SNAPSHOT_CAP)}` : text);

export function seedFromChat(chat: CoworkChat, contents: ChatContents): HandoverSeed {
  const text = contents.messages.map(m => `${m.role === 'you' ? 'You' : 'Claude'}: ${m.text}`).join('\n\n');
  return {
    title: chat.title,
    source: 'chat',
    snapshot: tail(text),
    files: contents.files.map(f => ({ name: `${f.kind === 'uploaded' ? 'uploads' : 'outputs'}/${f.name}`, file: f.file, include: true })),
    note: contents.messages.length ? undefined : 'The chat has no text on this PC.',
  };
}

export const seedFromDownload = (d: DownloadFile): HandoverSeed => ({ title: d.name.replace(/\.[^.]+$/, ''), source: 'download', snapshot: '', files: [{ name: d.name, file: d.file, include: true }] });

export const seedFromCloud = (title: string, link: string): HandoverSeed => ({
  title,
  source: 'cloud',
  link,
  snapshot: '',
  files: [],
  note: 'The messages and files of a claude.ai session are not readable with the Claude Code sign-in. Paste the text you need into the snapshot.',
});

export const seedFromLink = (link: string): HandoverSeed => ({
  title: decodeURIComponent(link.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || 'Artifact'),
  source: 'link',
  link,
  snapshot: '',
  files: [],
  note: 'The content of an artifact link is not readable from here: claude.ai needs your browser sign-in. Paste the artifact text into the snapshot, and add the files with Locate.',
});

export const HANDOVER_SYSTEM = 'You prepare the handover of work from a Claude chat to Claude Code. Answer with one JSON object only.';

/** The prompt that asks Claude for the card's task, rules, what exists and what is still to write, from the snapshot and the file names. */
export function draftPrompt(card: Pick<HandoverCard, 'title' | 'snapshot' | 'files'>): string {
  return [
    'The owner worked on something in a Claude chat and now continues it in Claude Code, in a repository on their PC.',
    '',
    `## Title\n${card.title}`,
    '',
    `## Files that come along\n${card.files.filter(f => f.include).map(f => f.name).join('\n') || '(none)'}`,
    '',
    `## Text snapshot of the chat or artifact\n${card.snapshot.trim() ? tail(card.snapshot.trim()) : '(none)'}`,
    '',
    '## Answer',
    'One JSON object and nothing else, in this shape:',
    '{"task":"one sentence: what Claude Code does next","rules":["a rule the chat set, in the words it used, for example every draft image is used"],"exists":["what already exists, one short item each"],"todo":["what is still to write, one short item each"]}',
    'Use only what the snapshot and the file names say. An empty list is fine; never invent a rule or a file.',
  ].join('\n');
}

const lines = (v: unknown): string => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()).join('\n') : typeof v === 'string' ? v.trim() : '');

/** Claude's answer as card fields; text that is not the JSON shape is the task itself, so a draft never dead-ends. */
export function parseDraft(text: string): HandoverDraft {
  try {
    const data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (data && typeof data === 'object' && typeof data.task === 'string') return { task: data.task.trim().split('\n')[0], rules: lines(data.rules), exists: lines(data.exists), todo: lines(data.todo) };
  } catch {
    // not JSON
  }
  return { task: text.trim().split('\n')[0].slice(0, 300), rules: '', exists: '', todo: '' };
}

const bullets = (text: string): string[] => text.split('\n').map(l => l.trim()).filter(Boolean).map(l => `- ${l}`);

/** What continuing does: the ticked files copied under files/ beside a CONTEXT.md, and the first prompt. */
export function planHandover(card: HandoverCard, repoOk: (repo: string) => boolean, fileOk: (file: string) => boolean): HandoverPlan {
  const problems: string[] = [];
  if (!card.repo || !path.isAbsolute(card.repo) || !repoOk(card.repo)) problems.push('Pick a repository of yours as the target.');
  const rel = card.folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || `handover/${slug(card.title)}`;
  if (rel.split('/').some(p => p === '..' || p === '.') || /^[a-z]:/i.test(rel)) problems.push('The folder must lie inside the repository.');
  const folder = path.join(card.repo || '.', rel);
  const picked = card.files.filter(f => f.include);
  const refused = picked.filter(f => !fileOk(f.file));
  if (refused.length) problems.push(`${refused.map(f => f.name).join(', ')} did not come from a source of this page.`);
  const copy = picked.map(f => ({ from: f.file, to: path.join(folder, 'files', f.name), name: `files/${f.name}`, missing: !fs.existsSync(f.file) }));
  if (copy.some(c => path.relative(path.join(folder, 'files'), c.to).startsWith('..'))) problems.push('A file name leaves the folder.');
  const context = [
    `# ${card.title}`,
    '',
    `Handed over from ${{ link: 'an artifact link', cloud: 'a Cowork session', chat: 'a Cowork chat', download: 'a file from the apps' }[card.source]}.${card.link ? ` Source: ${card.link}` : ''}`,
    '',
    '## Task',
    '',
    card.task.trim() || 'Continue the work.',
    ...(card.rules.trim() ? ['', '## Rules the chat set', '', ...bullets(card.rules)] : []),
    ...(card.exists.trim() ? ['', '## What exists', '', ...bullets(card.exists)] : []),
    ...(card.todo.trim() ? ['', '## Still to write', '', ...bullets(card.todo)] : []),
    ...(copy.length ? ['', '## Files', '', ...copy.map(c => `- ${c.name}${c.missing ? ' (missing on the PC, not copied)' : ''}`)] : []),
    ...(card.snapshot.trim() ? ['', '## Text snapshot', '', card.snapshot.trim()] : []),
    '',
  ].join('\n');
  const prompt = `${card.task.trim() || 'Continue the work of this handover.'} Read ${rel}/CONTEXT.md first: it holds the rules, what exists and what is still to write${copy.length ? `, and the files are in ${rel}/files` : ''}. Say in a few lines where the work stands, then wait for my go.`;
  return { folder, copy, context, prompt, problems };
}

/** Writes the plan: the files that exist are copied, CONTEXT.md is written. Returns the names of files that were missing. */
export function applyHandover(plan: HandoverPlan): string[] {
  const missing: string[] = [];
  fs.mkdirSync(plan.folder, { recursive: true });
  for (const c of plan.copy) {
    if (c.missing) {
      missing.push(c.name);
      continue;
    }
    fs.mkdirSync(path.dirname(c.to), { recursive: true });
    fs.copyFileSync(c.from, c.to);
  }
  fs.writeFileSync(path.join(plan.folder, 'CONTEXT.md'), plan.context);
  return missing;
}
