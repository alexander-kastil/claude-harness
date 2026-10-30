/**
 * Reading what a design system holds. The artifact server has no read tool for the PC, but Claude Code's own Artifact tool does, so
 * one headless `claude -p` run is given that tool alone and asked to list the files and read the README, the tokens and the
 * component index. The answer is JSON, cached per artifact and version; nothing runs without the owner's press.
 */
export interface DesignToken {
  group: string;
  name: string;
  value: string;
}
export interface DesignComponent {
  name: string;
  description: string;
}
export interface DesignRead {
  /** The artifact's type version when it was read: a newer version on claude.ai makes this read stale. */
  version: string;
  readAt: number;
  cost?: number;
  readme: string;
  tokens: DesignToken[];
  components: DesignComponent[];
  files: string[];
}

/** The only model the run uses: the cheapest. */
export const READ_MODEL = 'haiku';
/** The environment switch that gives a headless run the Artifact tool. */
export const READ_ENV = { CLAUDE_CODE_ARTIFACT: '1' };
export const READ_TOOL = 'Artifact';
export const READ_SYSTEM = 'You read design system artifacts with the Artifact tool. You only list and read; you never create, publish, pin, unpin, delete or change anything. Answer with JSON only.';

const CAPS = { readme: 6000, tokens: 120, components: 80, files: 300, text: 300 };

/** The prompt: the artifact's own address, the read-only steps and the exact answer shape. */
export function designReadPrompt(url: string, name: string): string {
  return [
    `Read the design system "${name}" at ${url} with the Artifact tool.`,
    'Use only the read actions of the tool: list the files of the artifact (the list action with scope files), then read the README, the token file or files, and the component index. Do not call create, publish, pin, unpin, write or delete, and do not change any file.',
    'Answer with one JSON object and nothing else, in exactly this shape:',
    '{"readme": "<the README text>", "tokens": [{"group": "colors|type|spacing|radius|other", "name": "<token name>", "value": "<token value>"}], "components": [{"name": "<component name>", "description": "<one line>"}], "files": ["<every file path listed>"]}',
    `Keep the README under ${CAPS.readme} characters (cut the end if longer), list at most ${CAPS.tokens} tokens, ${CAPS.components} components and ${CAPS.files} file paths. Use an empty string or an empty array for what the design system does not have.`,
  ].join('\n');
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');

/** Claude's answer as a read, or why not. The JSON may arrive in a fenced block or with a sentence around it. */
export function parseDesignRead(text: string, version: string, now: number = Date.now(), cost?: number): DesignRead | { error: string } {
  const body = text.trim().replace(/^```[a-z]*\n([\s\S]*?)\n```$/, '$1').trim();
  let raw: any;
  for (const candidate of [body, body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)]) {
    try {
      raw = JSON.parse(candidate);
      if (raw && typeof raw === 'object') break;
    } catch {}
    raw = undefined;
  }
  if (!raw) return { error: 'Claude did not answer with the design system as JSON.' };
  if (typeof raw.error === 'string' && raw.error) return { error: raw.error.slice(0, 200) };
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  return {
    version,
    readAt: now,
    ...(cost !== undefined && { cost }),
    readme: str(raw.readme, CAPS.readme),
    tokens: list(raw.tokens)
      .slice(0, CAPS.tokens)
      .map(t => ({ group: str(t?.group, 40) || 'other', name: str(t?.name, CAPS.text), value: str(t?.value, CAPS.text) }))
      .filter(t => t.name),
    components: list(raw.components)
      .slice(0, CAPS.components)
      .map(c => (typeof c === 'string' ? { name: c.slice(0, CAPS.text), description: '' } : { name: str(c?.name, CAPS.text), description: str(c?.description, CAPS.text) }))
      .filter(c => c.name),
    files: list(raw.files)
      .slice(0, CAPS.files)
      .map(f => (typeof f === 'string' ? f : str(f?.path, CAPS.text)))
      .filter(Boolean),
  };
}

/** The cache the extension keeps in its storage: one read per artifact id. */
export type DesignReads = Record<string, DesignRead>;
export const READS_KEY = 'designReads';
export const READ_REMEMBERED = 'designReadRemembered';

/** A read is stale when the artifact is on a newer version than the one that was read. */
export const isStale = (read: DesignRead, version: string): boolean => !!version && read.version !== version;
