import * as fs from 'fs';
import * as path from 'path';
import { chatById, loadChat } from './cowork-chats';
import { loadCoworkProjects, loadProjectContents } from './cowork-desktop';
import type { ScheduledTask } from './cowork-scheduled';
import type { DrawKind } from './drawing';

// Draw with Claude on the Cowork pages that are no element of a scope: a scheduled task, a chat and a connector. Each is
// drawn from what its page already holds and this PC keeps: the scheduled list the panel read, the desktop app's chat
// folders, the Cowork skills on disk. Nothing here contacts claude.ai or a connector's server, and no login is read.

export const TASK_PREFIX = 'cowork-task:';
export const CHAT_PREFIX = 'cowork-chat:';

export interface CoworkSource {
  kind: DrawKind;
  name: string;
  text: string;
  /** What Claude gets, in the confirm card's words. */
  from: string;
}

const INSTRUCTIONS_CAP = 6000;
const MESSAGES = 60;
const MESSAGE_CHARS = 500;
const LISTED = 40;

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}...` : text);
const lines = (title: string, rows: string[]) => (rows.length ? `### ${title}\n${rows.join('\n')}` : '');
const join = (parts: string[]) => parts.filter(Boolean).join('\n\n');

export function taskText(t: ScheduledTask): string {
  return join([
    [
      `Name: ${t.name}`,
      `Status: ${t.status}`,
      `Repeats: ${t.repeats}${t.cron ? ` (${t.cron})` : ''}`,
      `Runs on: ${t.runsOn}`,
      `Permissions: ${t.permissions}`,
      `Created in: ${t.source}`,
      t.projectId ? 'Belongs to a project.' : '',
      t.lastRunStatus ? `Last run: ${t.lastRunStatus}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    lines('Connectors', t.connectorNames.map(n => `- ${n}`)),
    lines('Plugins', t.pluginNames.map(n => `- ${n}`)),
    lines('Marketplaces', t.marketplaceNames.map(n => `- ${n}`)),
    t.instructions ? `### Instructions\n${clip(t.instructions, INSTRUCTIONS_CAP)}` : '',
  ]);
}

const counted = (rows: { name: string; count: number }[], cap = LISTED) => rows.slice(0, cap).map(r => `- ${r.name}: ${r.count}`);

const sizeText = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

// Reading a chat's conversation walks audit files of up to 60 MB; a page asks twice (both perspectives) and a
// press asks again, so the text of an id is kept for a short while.
const kept = new Map<string, { at: number; value: CoworkSource | undefined }>();
const KEEP_MS = 30000;
const remember = (id: string, make: () => CoworkSource | undefined, now = Date.now()): CoworkSource | undefined => {
  const hit = kept.get(id);
  if (hit && now - hit.at < KEEP_MS) return hit.value;
  const value = make();
  kept.set(id, { at: now, value });
  return value;
};

/** Forgets the kept texts (tests change the folders between calls). */
export const forgetCoworkDraws = () => kept.clear();

function chatSource(id: string): CoworkSource | undefined {
  const chat = chatById(id);
  if (!chat) return undefined;
  const c = loadChat(chat);
  const turns = c.messages.slice(0, MESSAGES).map(m => `${m.role === 'you' ? 'You' : 'Claude'}: ${clip(m.text.replace(/\s+/g, ' '), MESSAGE_CHARS)}`);
  const text = join([
    `Title: ${chat.title}\nModel: ${chat.model.replace(/^claude-/, '') || 'unknown'}`,
    lines('Files given to the chat', c.files.filter(f => f.kind === 'uploaded').slice(0, LISTED).map(f => `- ${f.name} (${sizeText(f.size)})`)),
    lines('Files the chat produced', c.files.filter(f => f.kind === 'produced').slice(0, LISTED).map(f => `- ${f.name} (${sizeText(f.size)})`)),
    lines(`Conversation${c.messages.length + c.more > turns.length ? ` (the first ${turns.length} of ${c.messages.length + c.more} messages)` : ''}`, turns),
  ]);
  return { kind: 'chat', name: chat.title, text, from: "the chat's title, the names of its files and the text of its conversation" };
}

/** What a drawing id of a scheduled task or chat is drawn from, or undefined when the id is none of those or the thing is gone. */
export function coworkSource(base: string, tasks: ScheduledTask[] | undefined): CoworkSource | undefined {
  if (base.startsWith(TASK_PREFIX)) {
    const t = tasks?.find(x => x.id === base.slice(TASK_PREFIX.length));
    return t ? { kind: 'task', name: t.name, text: taskText(t), from: "the task's schedule, where it runs, its permissions, its instructions and the names of the connectors and plugins it uses" } : undefined;
  }
  if (base.startsWith(CHAT_PREFIX)) return remember(base, () => chatSource(base.slice(CHAT_PREFIX.length)));
  return undefined;
}

const sameName = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A Cowork connector drawn from who uses it: the scheduled tasks that list it, the projects whose sessions called it, and the Cowork skills that name it. */
export function connectorSource(name: string, tasks: ScheduledTask[] | undefined, skills: { name: string; file: string }[]): CoworkSource {
  // The text depends on the lists it is built from, so a list that was not loaded yet when it was first asked does not stay.
  return remember(`connector:${name}:${(tasks ?? []).map(t => t.id).join(',')}:${skills.map(s => s.name).join(',')}`, () => {
    const users = (tasks ?? []).filter(t => t.connectorNames.some(n => sameName(n, name))).map(t => `- ${t.name} (${t.repeats})`);
    const projects: string[] = [];
    for (const p of loadCoworkProjects().projects) {
      const hit = loadProjectContents(p).usage.connectors.find(k => sameName(k.name, name));
      if (hit) projects.push(`- ${p.name}: ${hit.count} calls${hit.tools?.length ? ` (${hit.tools.slice(0, 6).map(t => `${t.name} ${t.count}`).join(', ')})` : ''}`);
    }
    const named = skills
      .filter(s => {
        try {
          return fs.readFileSync(s.file, 'utf8').toLowerCase().includes(name.toLowerCase());
        } catch {
          return false;
        }
      })
      .map(s => `- ${s.name}`);
    const text = join([`Connector: ${name}`, lines('Scheduled tasks that use it', users), lines('Projects whose sessions called it', projects), lines('Skills that name it', named)]);
    return { kind: 'connector', name, text, from: 'the names of the scheduled tasks, projects and skills that use the connector, and the tools the projects called on it' };
  }) as CoworkSource;
}
