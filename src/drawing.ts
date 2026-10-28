import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Draw with Claude: the drawing of what a skill does, shown above its info card. Kept in the extension's own storage, one file
// per skill id, with the hash of the SKILL.md it was drawn from: an edited SKILL.md no longer matches, so the drawing is gone.

export const DRAW_SYSTEM = 'You draw SVG diagrams of what a Claude Code skill does. Answer with one svg element only.';

const MAX_CHARS = 30000;

/** The prompt sent to Claude: the SKILL.md text and the drawing rules. */
export function drawPrompt(name: string, skillMd: string): string {
  return [
    `Draw what the skill "${name}" does, from its SKILL.md below, for someone who has never seen the skill.`,
    'Show what happens: when it applies, the decisions it makes, the branches, and what each branch produces. Do not turn the routing description into boxes, and do not copy its trigger phrases.',
    'Answer with one complete <svg> element and nothing else: no markdown fence, no prose before or after.',
    'Rules for the svg:',
    '- Use a viewBox of about 800 by 240 and no width or height attributes. Short labels, at least 13 px text, font-family inherit.',
    '- Draw only with the editor theme colours, set as presentation attributes (fill="...", stroke="..."), never style attributes and never a fixed colour such as #fff or red.',
    '- Text, lines and outlines: currentColor. Box fills: fill="none", or a theme variable with a low fill-opacity.',
    '- Allowed theme variables: var(--vscode-editor-foreground), var(--vscode-descriptionForeground), var(--vscode-textLink-foreground), var(--vscode-charts-blue), var(--vscode-charts-green), var(--vscode-charts-orange), var(--vscode-charts-purple), var(--vscode-editorWidget-background), var(--vscode-editorWidget-border).',
    '- Plain shapes, text, paths, lines and marker arrowheads only. No script, no style element, no foreignObject, no image, no links, no event attributes, no animation.',
    '',
    '## SKILL.md',
    skillMd.length > MAX_CHARS ? `${skillMd.slice(0, MAX_CHARS)}\n[cut]` : skillMd,
  ].join('\n');
}

/** The svg element of Claude's answer, whatever surrounds it; undefined when there is none. */
export function extractSvg(reply: string): string | undefined {
  const m = /<svg[\s>][\s\S]*<\/svg>/i.exec(reply);
  return m ? m[0] : undefined;
}

export const contentHash = (text: string) => crypto.createHash('sha1').update(text).digest('hex');

const fileFor = (dir: string, id: string) => path.join(dir, `${crypto.createHash('sha1').update(id).digest('hex').slice(0, 20)}.json`);

/** The stored drawing of the skill when it was drawn from this exact SKILL.md. */
export function readDrawing(dir: string, id: string, hash: string): string | undefined {
  try {
    const stored = JSON.parse(fs.readFileSync(fileFor(dir, id), 'utf8')) as { hash?: string; svg?: string };
    return stored.hash === hash && typeof stored.svg === 'string' ? stored.svg : undefined;
  } catch {
    return undefined;
  }
}

export function writeDrawing(dir: string, id: string, hash: string, svg: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fileFor(dir, id), JSON.stringify({ id, hash, svg }));
}
