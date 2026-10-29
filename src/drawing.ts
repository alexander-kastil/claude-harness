import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Asset, Kind, jsonAt, readMarkdown } from './harness';

// Draw with Claude: the drawing of what a skill, agent, command, workflow, plugin, hook or MCP server does and how its parts
// connect, shown above its details. Kept in the extension's own storage, one file per element id, with the hash of the source
// it was drawn from: an edited source no longer matches, so the drawing is gone. A skill's source is its SKILL.md as it is on
// disk, so a skill drawn before stays valid.

export const DRAW_SYSTEM =
  'You draw SVG diagrams of the elements of a Claude Code harness: their named parts and actors and how they connect. Every text is a short label, never a sentence. No line crosses another line or passes through a box. Answer with one svg element only.';

const MAX_CHARS = 30000;

// Per kind: what to draw, what the drawing shows, the heading of the source in the prompt, and what Claude gets in the confirm
// card's words.
const SUBJECTS: Record<DrawKind, (name: string) => { draw: string; show: string; title: string; from: string }> = {
  skill: name => ({
    draw: `Draw what the skill "${name}" does, from its SKILL.md below, for someone who has never seen the skill.`,
    show: 'Show what happens: when it applies, the decisions it makes, the branches, and what each branch produces. Do not turn the routing description into boxes, and do not copy its trigger phrases.',
    title: 'SKILL.md',
    from: 'SKILL.md',
  }),
  agent: name => ({
    draw: `Draw what the agent "${name}" does, from its definition below, for someone who has never seen the agent.`,
    show: 'Show when Claude hands work to it, the steps it takes, the tools, skills and MCP servers it works with, and what it hands back. Do not turn the routing description into boxes, and do not copy its trigger phrases.',
    title: 'Agent file',
    from: 'the agent file',
  }),
  command: name => ({
    draw: `Draw what the slash command "/${name}" does, from its file below, for someone who has never run it.`,
    show: 'Show what you type, the steps its prompt makes Claude take, the tools and agents it uses, and what comes out.',
    title: 'Command file',
    from: 'the command file',
  }),
  workflow: name => ({
    draw: `Draw what the workflow "${name}" does, from its script below.`,
    show: 'Show its phases, the agents it starts, what runs in parallel, and what it returns.',
    title: 'Workflow script',
    from: 'the workflow script',
  }),
  plugin: name => ({
    draw: `Draw what the plugin "${name}" brings to Claude Code, from its manifest and contents below.`,
    show: 'Show the parts it has (skills, agents, commands, MCP servers, hooks), how they connect to each other, and where each meets a Claude Code session.',
    title: 'Plugin',
    from: "the plugin's manifest, its hook and server configs, and the names and descriptions of its skills, agents and commands",
  }),
  // A mod is a plugin with hook modules; its page is the plugin's.
  mod: name => SUBJECTS.plugin(name),
  hook: name => ({
    draw: `Draw what the hook "${name}" does, from its entry in the settings file below.`,
    show: 'Show the event that fires it, the tools its matcher selects, the commands that run, and what they decide.',
    title: 'Hook entry',
    from: "the hook's entry in the settings file",
  }),
  mcp: name => ({
    draw: `Draw what the MCP server "${name}" is, from its entry below.`,
    show: 'Show how Claude Code starts or reaches it (a command or an address), what it connects to, and what it offers Claude.',
    title: 'Server entry',
    from: "the server's entry",
  }),
};

/** The kinds a drawing helps with; the others have no Draw with Claude. */
export type DrawKind = 'skill' | 'agent' | 'command' | 'workflow' | 'plugin' | 'mod' | 'hook' | 'mcp';

export const drawable = (kind: Kind): kind is DrawKind => kind in SUBJECTS;

/** The prompt sent to Claude: what to draw for the element's kind, the drawing rules, and the source. */
export function drawPrompt(kind: DrawKind, name: string, source: string): string {
  const k = SUBJECTS[kind](name);
  return [
    k.draw,
    k.show,
    'Answer with one complete <svg> element and nothing else: no markdown fence, no prose before or after.',
    'Rules for the content:',
    '- Every element is a named part or actor (a skill, agent, tool, file, event, step, decision, result) drawn as a box with a short label: a name or a noun phrase of at most four words.',
    '- No sentences, no captions, no notes, no legends, no title and no free-standing text. A line may carry a label of one to three words.',
    '- Draw only the parts that exist in the source: no box, label or placeholder for a part that is absent or none.',
    'Rules for the layout:',
    '- Place the boxes in columns so every line flows one way, left to right, from one column to the next; order the boxes inside each column so the lines between two columns do not cross.',
    '- No line crosses another line, and no line passes through or behind a box: route every line in the gaps between boxes, with right-angle bends where it must turn.',
    '- Lines that run from one box to the same target, or side by side between the same two columns, merge into one line.',
    'Rules for the svg:',
    '- Use a viewBox of about 800 by 240 and no width or height attributes. At least 13 px text, font-family inherit.',
    '- Draw only with the editor theme colours, set as presentation attributes (fill="...", stroke="..."), never style attributes and never a fixed colour such as #fff or red.',
    '- Text, lines and outlines: currentColor. Box fills: fill="none", or a theme variable with a low fill-opacity.',
    '- Allowed theme variables: var(--vscode-editor-foreground), var(--vscode-descriptionForeground), var(--vscode-textLink-foreground), var(--vscode-charts-blue), var(--vscode-charts-green), var(--vscode-charts-orange), var(--vscode-charts-purple), var(--vscode-editorWidget-background), var(--vscode-editorWidget-border).',
    '- Plain shapes, text, paths, lines and marker arrowheads only. No script, no style element, no foreignObject, no image, no links, no event attributes, no animation.',
    '',
    `## ${k.title}`,
    source.length > MAX_CHARS ? `${source.slice(0, MAX_CHARS)}\n[cut]` : source,
  ].join('\n');
}

const oneLine = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

// A plugin as Claude reads it to draw: the manifest, each skill, agent and command by name and description, and the hook and
// server configs. The bodies stay out: the drawing is about how the parts fit, and each part has its own page and drawing.
export function pluginText(dir: string): string {
  const read = (rel: string) => {
    const file = path.join(dir, rel);
    return fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8').trim() : '';
  };
  const manifestText = read(path.join('.claude-plugin', 'plugin.json'));
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(manifestText) ?? {};
  } catch {
    manifest = {};
  }
  const listed = (folder: string, skills: boolean) => {
    const base = path.join(dir, folder);
    if (!fs.existsSync(base)) return '';
    return fs
      .readdirSync(base, { withFileTypes: true })
      .map(e => (skills ? (e.isDirectory() ? path.join(base, e.name, 'SKILL.md') : '') : e.isFile() && /\.md$/i.test(e.name) ? path.join(base, e.name) : ''))
      .filter(file => file && fs.existsSync(file))
      .sort((a, b) => a.localeCompare(b))
      .map(file => `- ${skills ? path.basename(path.dirname(file)) : path.basename(file, path.extname(file))}: ${oneLine(readMarkdown(file).data.description)}`)
      .join('\n');
  };
  const sections: [string, string][] = [
    ['.claude-plugin/plugin.json', manifestText],
    ['Skills', listed('skills', true)],
    ['Agents', listed('agents', false)],
    ['Commands', listed('commands', false)],
    ['Hooks', read(typeof manifest.hooks === 'string' ? manifest.hooks : path.join('hooks', 'hooks.json'))],
    ['MCP servers', read('.mcp.json')],
  ];
  return sections
    .filter(([, body]) => body)
    .map(([title, body]) => `### ${title}\n${body}`)
    .join('\n\n');
}

/**
 * What the element is drawn from, and what its drawing is keyed by: its file, its entry in a settings or MCP file, a listed
 * server's name and address, or a plugin's manifest and contents (`pluginDir`, its folder on disk). Undefined for a kind
 * without Draw with Claude, or when there is nothing on disk to draw from.
 */
export function drawSource(asset: Asset, pluginDir?: string): { text: string; from: string } | undefined {
  if (!drawable(asset.kind)) return undefined;
  const { from } = SUBJECTS[asset.kind](asset.name);
  try {
    if (asset.kind === 'plugin') return pluginDir && fs.existsSync(pluginDir) ? { text: pluginText(pluginDir), from } : undefined;
    if (asset.file && asset.jsonPath) return { text: JSON.stringify(jsonAt(asset.file, asset.jsonPath) ?? {}, null, 2), from };
    if (asset.kind === 'mcp' && !asset.file) return { text: JSON.stringify({ name: asset.name, source: asset.source, address: asset.target, about: asset.about }, null, 2), from: "the server's name and address" };
    return asset.file ? { text: fs.readFileSync(asset.file, 'utf8'), from } : undefined;
  } catch {
    return undefined;
  }
}

/** The drawing id of a plugin's process perspective: the plugin's id with this suffix; its drawing is stored under that id. */
export const PROCESS_SUFFIX = '#process';

export const PROCESS_SYSTEM =
  'You draw SVG process diagrams of Claude Code plugins: what runs in which order, with what input and output, and what each hook module does. Answer with one svg element only.';

const MOD_CHARS = 6000;

// The process perspective reads the plugin as the harness perspective does, plus the hook modules themselves: a mod's code is
// where what it does is written down.
export function processText(dir: string): string {
  const base = pluginText(dir);
  const hooks = path.join(dir, 'hooks');
  if (!fs.existsSync(hooks)) return base;
  const mods = fs
    .readdirSync(hooks, { withFileTypes: true })
    .filter(e => e.isFile() && /\.(mjs|js)$/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => {
      const text = fs.readFileSync(path.join(hooks, e.name), 'utf8');
      return `### Mod ${e.name}\n${text.length > MOD_CHARS ? `${text.slice(0, MOD_CHARS)}\n[cut]` : text}`;
    });
  return [base, ...mods].filter(Boolean).join('\n\n');
}

/** The prompt for a plugin's process perspective: numbered stage cards in run order, the shared files, the loops and the mods. */
export function processPrompt(name: string, source: string): string {
  return [
    `Draw the plugin "${name}" as a process, from its manifest, contents and hook modules below: what runs in which order, and what each mod does.`,
    'Answer with one complete <svg> element and nothing else: no markdown fence, no prose before or after.',
    'What to draw:',
    '- A vertical stack of numbered stage cards in run order (use 5a and 5b for stages that run side by side). A stage is a step of the plugin: a skill, an agent, a script or a gate. Take the order from what the skills, agents and mods say; when the plugin has no sequence, stack the parts by when they fire (session start, prompt, tool call).',
    '- Each card: the number and a stage name of at most three words in bold; one muted line of at most ten words on what it does; then "Runs:" (main thread, background, or the agent name), "Model:" (only when the source names one), "Exit:" (the condition that ends the stage, only when the source states it); and a small chip with the file it writes, when it writes one. Leave out a line the source does not support: no placeholder.',
    '- When stages hand files to each other, a narrow "Shared ledger" column at the right lists each stage\'s output file: a solid arrow from the stage to the ledger, a dashed arrow from the ledger to the next stage that reads it.',
    '- Where a later stage sends work back to an earlier one (a gate that fails, a loop), an arrow in var(--vscode-textLink-foreground) from the later card back to the earlier, labelled with the fault in two to four words. A stage that repeats gets a small loop marker beside it with what repeats it.',
    '- An input that several stages use (a voice or brand skill, a shared reference) is one purple box with purple arrows into the stages that use it.',
    '- Under the stack, one line per hook module: its file name in bold, then at most fourteen words on what it does, from its code (what it watches, what it holds, what it changes).',
    '- Draw only what exists in the source.',
    'Rules for the layout:',
    '- Use a viewBox 900 wide and as tall as the stack needs, with no width or height attributes. Cards are about 560 wide, centered or left, with the ledger and return arrows in the free columns. No line crosses a card or another line; route lines in the gaps with right-angle bends.',
    '- At least 13 px text for card titles, at least 12 px for the other lines, font-family inherit.',
    'Rules for the svg:',
    '- Draw only with the editor theme colours, set as presentation attributes (fill="...", stroke="..."), never style attributes and never a fixed colour such as #fff or red.',
    '- Text and outlines: currentColor; muted lines: var(--vscode-descriptionForeground). Card fills: fill="none", or a theme variable with a low fill-opacity.',
    '- Allowed theme variables: var(--vscode-editor-foreground), var(--vscode-descriptionForeground), var(--vscode-textLink-foreground), var(--vscode-charts-blue), var(--vscode-charts-green), var(--vscode-charts-orange), var(--vscode-charts-purple), var(--vscode-editorWidget-background), var(--vscode-editorWidget-border).',
    '- Plain shapes, text, paths, lines and marker arrowheads only. No script, no style element, no foreignObject, no image, no links, no event attributes, no animation.',
    '',
    '## Plugin',
    source.length > MAX_CHARS ? `${source.slice(0, MAX_CHARS)}\n[cut]` : source,
  ].join('\n');
}

/** The svg element of Claude's answer, whatever surrounds it; undefined when there is none. */
export function extractSvg(reply: string): string | undefined {
  const m = /<svg[\s>][\s\S]*<\/svg>/i.exec(reply);
  return m ? m[0] : undefined;
}

export const contentHash = (text: string) => crypto.createHash('sha1').update(text).digest('hex');

const fileFor = (dir: string, id: string) => path.join(dir, `${crypto.createHash('sha1').update(id).digest('hex').slice(0, 20)}.json`);

/** The stored drawing of the element when it was drawn from this exact source. */
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
