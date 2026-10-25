// Measuring a skill's size and spread: the thresholds, the report the host sends and the pure helpers the webview and the
// unit tests share. No DOM and no Node APIs. Reading the files and finding what SKILL.md points to is src/slim.ts.

/**
 * Where a size becomes a flag. Description and SKILL.md follow Anthropic's public guidance for skills: a description of
 * at most 1024 characters, a SKILL.md body under 500 lines (and about 5000 tokens), further detail in reference files
 * that SKILL.md links to directly, one level deep.
 */
export const SLIM = {
  /** Tokens: a description this long is paid in every session; worth a look. */
  descLong: 200,
  /** Characters: the limit of the Agent Skills format. */
  descChars: 1024,
  bodyLines: 500,
  bodyTokens: 5000,
  /** Tokens: one reference file this big is read whole whenever Claude opens it. */
  giant: 5000,
  /** Tokens: a file this small does not earn a file of its own. */
  tiny: 150,
  /** How many tiny files make "many tiny ones". */
  manyTiny: 3,
  /** Tokens: a `##` section below this is not worth moving out. */
  sectionMin: 200,
  sectionsShown: 5,
} as const;

/** Same estimate as the pages use everywhere: four characters to a token. */
export const tokensOf = (text: string) => Math.round((text || '').length / 4);

/** Markdown beside SKILL.md that Claude reads when the instructions send it there; templates, assets, examples and evals are plain files. */
export const isReference = (f: string) => f !== 'SKILL.md' && /\.md$/i.test(f) && !/^(templates|assets|examples|evals?)\//i.test(f);

export interface SlimSection {
  title: string;
  /** Line of the `##` heading in the body, from 1. */
  line: number;
  lines: number;
  tokens: number;
}

export interface SlimRef {
  rel: string;
  lines: number;
  tokens: number;
  /** `skill`: SKILL.md points to it. `nested`: only another reference does, two levels deep. `none`: nothing does, so Claude never reads it. */
  link: 'skill' | 'nested' | 'none';
  size?: 'giant' | 'tiny';
}

export interface SlimReport {
  id: string;
  name: string;
  /** Always loaded: the description is in every session's skill list. */
  description: { tokens: number; chars: number; level?: 'long' | 'over'; /** House rule: what the description carries beyond routing and trigger phrases; set only with a provider. */ house?: string[] };
  /** On use: SKILL.md without its frontmatter. `sections` are the largest `##` sections, biggest first. */
  body: { tokens: number; lines: number; long: boolean; sections: SlimSection[] };
  refs: SlimRef[];
  spread: { giant: string[]; tiny: string[]; manyTiny: boolean; orphan: string[]; nested: string[] };
  /** How many things are flagged, the Slim with Claude button's reason to show. */
  findings: number;
}

export const descriptionLevel = (description: string): 'long' | 'over' | undefined =>
  description.length > SLIM.descChars ? 'over' : tokensOf(description) > SLIM.descLong ? 'long' : undefined;

/** Whether SKILL.md is past the guidance: 500 lines, or about 5000 tokens. */
export const bodyIsLong = (lines: number, tokens: number) => lines > SLIM.bodyLines || tokens > SLIM.bodyTokens;

/** The `##` sections of a body outside code fences, each up to the next heading of its level or above. */
export function sectionsOf(body: string): SlimSection[] {
  const all = body.split(/\r?\n/);
  const out: SlimSection[] = [];
  let fence = false;
  let open: { title: string; line: number; from: number } | undefined;
  const close = (end: number) => {
    if (!open) return;
    const text = all.slice(open.from, end).join('\n');
    out.push({ title: open.title, line: open.line, lines: end - open.from, tokens: tokensOf(text) });
    open = undefined;
  };
  all.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const h = /^(#{1,2})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!h) return;
    close(i);
    if (h[1] === '##') open = { title: h[2], line: i + 1, from: i };
  });
  close(all.length);
  return out;
}

/** The sections worth moving into a reference file: the largest first, none below the minimum. */
export const largestSections = (sections: SlimSection[]): SlimSection[] =>
  sections
    .filter(s => s.tokens >= SLIM.sectionMin)
    .sort((a, b) => b.tokens - a.tokens || a.line - b.line)
    .slice(0, SLIM.sectionsShown);

const TRIGGER = /\b(?:triggers?(?:\s+(?:on|include|phrases?))?|use (?:this )?(?:skill )?when)\b/i;

/**
 * House rule: a description is an index entry, meaning routing plus trigger phrases, with the detail in a reference
 * leaf. What it says about a description that carries more: the routing part (everything before the trigger phrases)
 * runs past a few sentences, past 60 words, or names paths and code. Returns the reasons, none for a clean one.
 */
export function houseDescriptionFlags(description: string): string[] {
  const at = description.search(TRIGGER);
  const routing = (at > 0 ? description.slice(0, at) : description).trim();
  const out: string[] = [];
  const sentences = routing.split(/[.!?]\s+(?=[A-Z`])/).filter(s => s.trim()).length;
  const words = (routing.match(/\S+/g) || []).length;
  if (sentences > 3) out.push(`${sentences} sentences before the trigger phrases`);
  if (words > 90) out.push(`${words} words of routing`);
  // One path or code span can be the routing itself ("the vscode-extension skill"); two or more are detail.
  const named = (routing.match(/`[^`]+`|\b[\w-]+\/[\w.-]+|\b[\w-]+\.(?:md|ps1|ts|mjs|py|json)\b/g) || []).length;
  if (named >= 2) out.push(`names ${named} paths or code spans`);
  return out;
}

/** Cost of the description over the sessions it was listed in; undefined without a session count. */
export const descCost = (tokens: number, sessions: number | undefined) => (sessions === undefined ? undefined : tokens * sessions);
