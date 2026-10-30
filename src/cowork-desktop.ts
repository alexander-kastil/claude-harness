import * as fs from 'fs';
import * as path from 'path';
import { projectUrl } from './cowork-scheduled';

// Cowork projects as the Claude desktop app keeps them on this PC. Read-only: only the fields shown are read.
// <Claude-Data>\<claude_id>\local-agent-mode-sessions\<account>\<org>\ holds spaces.json (local spaces linked to a cloud project),
// local_<id>.json (one session each, linked to a space by spaceId or by folder) and spaces\<spaceId>\memory\ (memory entries).
// A project's instructions and context files are not stored by the app; the space's folder is the nearest thing on disk.

export interface CoworkSession {
  title: string;
  model: string;
  lastActivity: number;
  archived: boolean;
}

export interface CoworkProject {
  /** The local space id; the key of the details page. */
  id: string;
  name: string;
  folder: string;
  /** The cloud project the space was migrated to, null when it is not linked. */
  projectUuid: string | null;
  projectUrl: string | null;
  sessions: number;
  /** Epoch milliseconds of the newest session, or the space's own update time when it has no session. */
  lastActivity: number | null;
  /** Where this space's data lives; used to read its memory. */
  orgDir: string;
}

export interface CoworkDesktop {
  /** The Claude-Data profile folder, null when the app's data is not on this PC. */
  dataRoot: string | null;
  projects: CoworkProject[];
}

export interface MemoryEntry {
  file: string;
  name: string;
  description: string;
  type: string;
  updated: number;
}

export interface FileEntry {
  name: string;
  directory: boolean;
  size: number;
}

export interface UsageCount {
  name: string;
  count: number;
  /** Connectors only: the tools called on it, by name. */
  tools?: UsageCount[];
}

/** What the project's sessions on this PC called, counted from the tool_use records of each session's audit.jsonl (tool name and the Skill call's skill field only). */
export interface ProjectUsage {
  skills: UsageCount[];
  connectors: UsageCount[];
  tools: UsageCount[];
}

export interface ProjectContents {
  usage: ProjectUsage;
  sessions: CoworkSession[];
  memory: { path: string; index: boolean; entries: MemoryEntry[] };
  instructions: { path: string; size: number; updated: number; excerpt: string } | null;
  grounding: { folder: string; entries: FileEntry[]; more: number } | null;
}

const EXCERPT = 1200;
const GROUNDING_CAP = 200;
const SKIP_FOLDERS = new Set(['node_modules']);

const readJson = (file: string): any => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

const dirs = (p: string): string[] => {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
};

const norm = (p: string): string => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

/** The Claude-Data profile folder (claude_<id>), found by pattern under %LOCALAPPDATA%\Claude-Data; null when absent. */
export const findDataRoot = (localAppData: string | undefined = process.env.CLAUDE_HARNESS_LOCALAPPDATA || process.env.LOCALAPPDATA): string | null => {
  if (!localAppData) {
    return null;
  }
  const base = path.join(localAppData, 'Claude-Data');
  const hit = dirs(base).find(d => /^claude_/i.test(d) && isDir(path.join(base, d, 'local-agent-mode-sessions')));
  return hit ? path.join(base, hit) : null;
};

/** Every <account>\<org> folder under the sessions root that holds a spaces.json. */
export const orgDirs = (dataRoot: string): string[] => {
  const root = path.join(dataRoot, 'local-agent-mode-sessions');
  const out: string[] = [];
  for (const account of dirs(root)) {
    for (const org of dirs(path.join(root, account))) {
      const dir = path.join(root, account, org);
      if (fs.existsSync(path.join(dir, 'spaces.json'))) {
        out.push(dir);
      }
    }
  }
  return out;
};

export interface RawSession {
  /** The session's folder name next to its json file (local_<id>); its audit.jsonl records the tool calls. */
  dir: string;
  /** connector uuid -> name, from the session's remote MCP server list. */
  connectors: Record<string, string>;
  spaceId: string;
  folders: string[];
  title: string;
  model: string;
  lastActivity: number;
  archived: boolean;
}

export const readSessions = (orgDir: string): RawSession[] => {
  let names: string[] = [];
  try {
    names = fs.readdirSync(orgDir).filter(n => /^local_.+\.json$/.test(n));
  } catch {
    return [];
  }
  const out: RawSession[] = [];
  for (const n of names) {
    const j = readJson(path.join(orgDir, n));
    if (!j) {
      continue;
    }
    const connectors: Record<string, string> = {};
    for (const c of Array.isArray(j.remoteMcpServersConfig) ? j.remoteMcpServersConfig : []) {
      if (typeof c?.uuid === 'string' && typeof c?.name === 'string') {
        connectors[c.uuid] = c.name;
      }
    }
    out.push({
      dir: path.join(orgDir, n.replace(/\.json$/, '')),
      connectors,
      spaceId: typeof j.spaceId === 'string' ? j.spaceId : '',
      folders: Array.isArray(j.userSelectedFolders) ? j.userSelectedFolders.filter((f: unknown): f is string => typeof f === 'string').map((f: string) => path.resolve(orgDir, f)) : [],
      title: typeof j.title === 'string' ? j.title : '',
      model: typeof j.model === 'string' ? j.model : '',
      lastActivity: typeof j.lastActivityAt === 'number' ? j.lastActivityAt : typeof j.createdAt === 'number' ? j.createdAt : 0,
      archived: j.isArchived === true,
    });
  }
  return out;
};

const spaceFolder = (orgDir: string, s: any): string => {
  const first = Array.isArray(s.folders) ? s.folders[0] : null;
  const p = first && typeof first.path === 'string' ? first.path : '';
  return p && !path.isAbsolute(p) ? path.join(orgDir, p) : p;
};

const sessionsOf = (all: RawSession[], id: string, folder: string): RawSession[] => {
  const f = folder ? norm(folder) : '';
  return all.filter(s => s.spaceId === id || (!s.spaceId && f !== '' && s.folders.some(x => norm(x) === f)));
};

/** The local spaces that are linked to a cloud project. A missing data folder gives an empty list and a null root. */
export const loadCoworkProjects = (dataRoot: string | null = findDataRoot()): CoworkDesktop => {
  if (!dataRoot || !isDir(dataRoot)) {
    return { dataRoot: null, projects: [] };
  }
  const projects: CoworkProject[] = [];
  for (const orgDir of orgDirs(dataRoot)) {
    const spaces = readJson(path.join(orgDir, 'spaces.json'))?.spaces;
    if (!Array.isArray(spaces)) {
      continue;
    }
    const sessions = readSessions(orgDir);
    for (const s of spaces) {
      const uuid = typeof s?.migration?.projectUuid === 'string' && s.migration.projectUuid ? s.migration.projectUuid : null;
      if (!uuid || typeof s.id !== 'string') {
        continue;
      }
      const folder = spaceFolder(orgDir, s);
      const mine = sessionsOf(sessions, s.id, folder);
      const newest = mine.reduce((m, x) => Math.max(m, x.lastActivity), 0);
      const updated = typeof s.updatedAt === 'number' ? s.updatedAt : 0;
      projects.push({
        id: s.id,
        name: typeof s.name === 'string' && s.name ? s.name : s.id,
        folder,
        projectUuid: uuid,
        projectUrl: projectUrl(uuid),
        sessions: mine.length,
        lastActivity: newest || updated || null,
        orgDir,
      });
    }
  }
  projects.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  return { dataRoot, projects };
};

const frontmatter = (text: string): Record<string, string> => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) {
    return out;
  }
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/i.exec(line);
    if (kv) {
      out[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
};

const readMemory = (project: CoworkProject): ProjectContents['memory'] => {
  const dir = path.join(project.orgDir, 'spaces', project.id, 'memory');
  const out: ProjectContents['memory'] = { path: dir, index: false, entries: [] };
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter(n => /\.md$/i.test(n));
  } catch {
    return out;
  }
  for (const n of names) {
    if (n.toLowerCase() === 'memory.md') {
      out.index = true;
      continue;
    }
    let head = '';
    let updated = 0;
    try {
      const file = path.join(dir, n);
      updated = fs.statSync(file).mtimeMs;
      head = fs.readFileSync(file, 'utf8').slice(0, 2000);
    } catch {
      continue;
    }
    const fm = frontmatter(head);
    out.entries.push({ file: n, name: fm.name || n.replace(/\.md$/i, ''), description: fm.description || '', type: fm.type || '', updated });
  }
  out.entries.sort((a, b) => b.updated - a.updated);
  return out;
};

const readInstructions = (folder: string): ProjectContents['instructions'] => {
  const file = path.join(folder, 'CLAUDE.md');
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) {
      return null;
    }
    const text = fs.readFileSync(file, 'utf8');
    return { path: file, size: st.size, updated: st.mtimeMs, excerpt: text.slice(0, EXCERPT) };
  } catch {
    return null;
  }
};

const readGrounding = (folder: string): ProjectContents['grounding'] => {
  if (!folder || !isDir(folder)) {
    return null;
  }
  let list: fs.Dirent[] = [];
  try {
    list = fs.readdirSync(folder, { withFileTypes: true }).filter(e => !e.name.startsWith('.') && !SKIP_FOLDERS.has(e.name));
  } catch {
    return null;
  }
  list.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const entries: FileEntry[] = list.slice(0, GROUNDING_CAP).map(e => {
    let size = 0;
    if (!e.isDirectory()) {
      try {
        size = fs.statSync(path.join(folder, e.name)).size;
      } catch {
        size = 0;
      }
    }
    return { name: e.name, directory: e.isDirectory(), size };
  });
  return { folder, entries, more: Math.max(0, list.length - entries.length) };
};

const MAX_AUDIT = 60 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ranked = (m: Map<string, number>): UsageCount[] =>
  [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

const readUsage = (list: RawSession[]): ProjectUsage => {
  const skills = new Map<string, number>();
  const tools = new Map<string, number>();
  const conns = new Map<string, Map<string, number>>();
  for (const s of list) {
    const file = path.join(s.dir, 'audit.jsonl');
    let text = '';
    try {
      if (fs.statSync(file).size > MAX_AUDIT) {
        continue;
      }
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.includes('"tool_use"')) {
        continue;
      }
      let j: any;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      if (j?.type !== 'assistant' || !Array.isArray(j.message?.content)) {
        continue;
      }
      for (const c of j.message.content) {
        if (c?.type !== 'tool_use' || typeof c.name !== 'string') {
          continue;
        }
        const mcp = /^mcp__(.+?)__(.+)$/.exec(c.name);
        if (mcp) {
          const server = UUID.test(mcp[1]) ? s.connectors[mcp[1]] ?? mcp[1] : mcp[1];
          const per = conns.get(server) ?? new Map<string, number>();
          per.set(mcp[2], (per.get(mcp[2]) ?? 0) + 1);
          conns.set(server, per);
          continue;
        }
        tools.set(c.name, (tools.get(c.name) ?? 0) + 1);
        if (c.name === 'Skill' && typeof c.input?.skill === 'string') {
          skills.set(c.input.skill, (skills.get(c.input.skill) ?? 0) + 1);
        }
      }
    }
  }
  const connectors: UsageCount[] = [...conns]
    .map(([name, per]) => {
      const t = ranked(per);
      return { name, count: t.reduce((n, x) => n + x.count, 0), tools: t };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { skills: ranked(skills), connectors, tools: ranked(tools) };
};

/** Usage, Sessions, Memory, Instructions and Grounding of one project, read on demand when its page opens. */
export const loadProjectContents = (project: CoworkProject): ProjectContents => {
  const mine = sessionsOf(readSessions(project.orgDir), project.id, project.folder);
  const sessions = mine
    .map(s => ({ title: s.title, model: s.model, lastActivity: s.lastActivity, archived: s.archived }))
    .sort((a, b) => b.lastActivity - a.lastActivity);
  return {
    usage: readUsage(mine),
    sessions,
    memory: readMemory(project),
    instructions: project.folder ? readInstructions(project.folder) : null,
    grounding: readGrounding(project.folder),
  };
};
