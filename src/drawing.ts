import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Asset, Kind, jsonAt, readMarkdown } from './harness';

// Draw with Claude: the drawing of what a skill, agent, command, workflow, plugin, hook or MCP server does and how its parts
// connect, shown above its details. Every element has two: the Harness perspective (its parts and how they connect) and the
// Process perspective (what runs in which order), stored under the element's id and under the id plus PROCESS_SUFFIX. Kept in
// the extension's own storage, one file per drawing id, with the hash of the source it was drawn from: an edited source no
// longer matches, so the drawing is gone. A skill's source is its SKILL.md as it is on disk, so a skill drawn before stays valid.

export const DRAW_SYSTEM =
  'You draw SVG diagrams of the elements of a Claude Code harness: their named parts and actors and how they connect. Every text is a short label, never a sentence. No line crosses another line or passes through a box. The drawing is wide and short and uses the width it is given. Answer with one svg element only.';

const MAX_CHARS = 30000;

// Per kind: what to draw, what the drawing shows, the heading of the source in the prompt, what Claude gets in the confirm
// card's words, and the Process perspective: its opening sentence, then what to draw.
const SUBJECTS: Record<DrawKind, (name: string) => { draw: string; show: string; title: string; from: string; process: string[] }> = {
  skill: name => ({
    draw: `Draw what the skill "${name}" does, from its SKILL.md below, for someone who has never seen the skill.`,
    show: 'Show what happens: when it applies, the decisions it makes, the branches, and what each branch produces. Do not turn the routing description into boxes, and do not copy its trigger phrases.',
    title: 'SKILL.md',
    from: 'SKILL.md',
    process: [
      `Draw the skill "${name}" as a process, from its SKILL.md below: the steps it makes Claude take, in the order they run.`,
      '- What starts it, then each step as a numbered card: a name of at most four words in bold and one muted line of at most ten words on what it does.',
      '- A decision is a diamond with its branches labelled in one to three words; a branch that ends the run ends in a result card.',
      '- On a step, a small chip for each script it runs or reference it reads, by file name, only when the SKILL.md names it.',
      '- Where a step sends the run back (a check that fails, a retry), an arrow in var(--vscode-textLink-foreground) back to the step it returns to, labelled in two to four words.',
      '- At the end, what the run produces. Do not turn the routing description into steps, and do not copy its trigger phrases.',
    ],
  }),
  agent: name => ({
    draw: `Draw what the agent "${name}" does, from its definition below, for someone who has never seen the agent.`,
    show: 'Show when Claude hands work to it, the steps it takes, the tools, skills and MCP servers it works with, and what it hands back. Do not turn the routing description into boxes, and do not copy its trigger phrases.',
    title: 'Agent file',
    from: 'the agent file',
    process: [
      `Draw the agent "${name}" as a process, from its definition below: its run from the moment Claude hands work to it until it reports back.`,
      '- What it receives, then its steps in run order as numbered cards: a name of at most four words in bold and one muted line of at most ten words; on a step, small chips for the tools, skills and MCP servers it uses there.',
      '- A check it must pass or a loop it repeats is an arrow in var(--vscode-textLink-foreground) back to the step it returns to, labelled in two to four words.',
      '- At the end, what it hands back. Do not turn the routing description into steps, and do not copy its trigger phrases.',
    ],
  }),
  command: name => ({
    draw: `Draw what the slash command "/${name}" does, from its file below, for someone who has never run it.`,
    show: 'Show what you type, the steps its prompt makes Claude take, the tools and agents it uses, and what comes out.',
    title: 'Command file',
    from: 'the command file',
    process: [
      `Draw the slash command "/${name}" as a process, from its file below: what happens from the moment it is typed until its result.`,
      '- What you type, with its arguments when the file names them; then the steps its prompt makes Claude take, in run order, as numbered cards: a name of at most four words in bold and one muted line of at most ten words; small chips for the tools, agents and files a step uses.',
      '- A decision is a diamond with its branches labelled; a step that sends the run back gets an arrow in var(--vscode-textLink-foreground) to the step it returns to.',
      '- At the end, what comes out.',
    ],
  }),
  workflow: name => ({
    draw: `Draw what the workflow "${name}" does, from its script below.`,
    show: 'Show its phases, the agents it starts, what runs in parallel, and what it returns.',
    title: 'Workflow script',
    from: 'the workflow script',
    process: [
      `Draw the workflow "${name}" as a process, from its script below: its phases in the order they run.`,
      '- Each phase as a numbered card: a name of at most four words in bold and one muted line of at most ten words; the agents a phase starts as small boxes under its card, with a count when it starts many of one kind.',
      '- Work that runs in parallel sits side by side, joined again where the workflow waits for all of it.',
      '- A loop or retry is an arrow in var(--vscode-textLink-foreground) back to the phase it repeats, labelled with what repeats it.',
      '- At the end, what the workflow returns.',
    ],
  }),
  plugin: name => ({
    draw: `Draw what the plugin "${name}" brings to Claude Code, from its manifest and contents below.`,
    show: 'Show the parts it has (skills, agents, commands, MCP servers, hooks), how they connect to each other, and where each meets a Claude Code session.',
    title: 'Plugin',
    from: "the plugin's manifest, its hook and server configs, and the names and descriptions of its skills, agents and commands",
    process: [
      `Draw the plugin "${name}" as a process, from its manifest, contents, the links between its parts and its hook modules below: what runs in which order, how its parts hand work to each other, and what each mod does.`,
      '- First decide whether the plugin runs in an order: a pipeline its skills or agents describe step by step, or a mod that watches and gates a run. Only then draw numbered stages; never invent an order for parts that are used one at a time.',
      '- A plugin without an order gets no stages and no numbers: draw its parts as cards and, from the "Links between parts" lines, an arrow wherever one part loads, calls or hands work to another (an agent that loads a skill, a skill or command that hands work to an agent, a mod that gates a part), labelled with what passes in two to four words. The parts that work with none sit together in a grid without arrows.',
      '- A plugin with an order: numbered stage cards in run order (use 5a and 5b for stages that run side by side), at most four cards in a row. A stage is a step of the plugin: a skill, an agent, a script or a gate.',
      '- Each stage card: the number and a stage name of at most three words in bold (a part card: its name and kind); one muted line of at most ten words on what it does; then "Runs:" (main thread, background, or the agent name), "Model:" (only when the source names one), "Exit:" (the condition that ends the stage, only when the source states it); and a small chip with the file it writes, when it writes one. Leave out a line the source does not support: no placeholder.',
      '- When stages hand files to each other, a "Shared ledger" band under the stages lists each stage\'s output file: a solid arrow from the stage to the ledger, a dashed arrow from the ledger to the next stage that reads it.',
      '- Where a later stage sends work back to an earlier one (a gate that fails, a loop), an arrow in var(--vscode-textLink-foreground) from the later card back to the earlier, labelled with the fault in two to four words. A stage that repeats gets a small loop marker beside it with what repeats it.',
      '- An input that several stages use (a voice or brand skill, a shared reference) is one purple box with purple arrows into the stages that use it.',
      '- When the plugin has hook modules, under the cards the modules side by side across the width: each one\'s file name in bold, then at most fourteen words on what it does, from its code (what it watches, what it holds, what it changes).',
    ],
  }),
  // A mod is a plugin with hook modules; its page is the plugin's.
  mod: name => SUBJECTS.plugin(name),
  hook: name => ({
    draw: `Draw what the hook "${name}" does, from its entry in the settings file below.`,
    show: 'Show the event that fires it, the tools its matcher selects, the commands that run, and what they decide.',
    title: 'Hook entry',
    from: "the hook's entry in the settings file",
    process: [
      `Draw the hook "${name}" as a process, from its entry in the settings file below: what happens from the event that fires it to what Claude Code does next.`,
      '- The event, the matcher with the tools it selects, then each command in the order it runs as a card: its name in bold and one muted line of at most ten words on what it checks or does.',
      '- What a command can decide (allow, block, ask, add context, change the input) as labelled branches, and what Claude Code does next on each.',
      '- A timeout or an async run as a muted chip on its command, only when the entry sets one.',
    ],
  }),
  mcp: name => ({
    draw: `Draw what the MCP server "${name}" is, from its entry below.`,
    show: 'Show how Claude Code starts or reaches it (a command or an address), what it connects to, and what it offers Claude.',
    title: 'Server entry',
    from: "the server's entry",
    process: [
      `Draw the MCP server "${name}" as a process, from its entry below: how a Claude Code session uses it, from start to answer.`,
      '- In run order: how Claude Code starts or reaches it (the command or the address), a sign-in step only when the entry sets auth or headers, the tools it lists, then one call from Claude through the server to what it connects to, and the answer back.',
      '- Each step a card: a name of at most four words in bold and one muted line of at most ten words; the transport (stdio, http, sse) as a chip on the line between Claude Code and the server.',
    ],
  }),
  // The Cowork pages that are no element of a scope: each is drawn from what the page already holds (src/cowork-draw.ts).
  connector: name => ({
    draw: `Draw how the Cowork connector "${name}" is used, from the lists below.`,
    show: 'Show the connector in the middle and, around it, the scheduled tasks, the projects (with the tools they called on it) and the skills that use it, each as its own box. Leave out a group that is empty.',
    title: 'Connector',
    from: 'the names of the scheduled tasks, projects and skills that use the connector, and the tools the projects called on it',
    process: [
      `Draw the Cowork connector "${name}" as a process, from the lists below: who reaches it and with what, from the scheduled task or project session that calls it to the tools it answers.`,
      '- Each caller (scheduled task, project, skill) as a card: its name in bold and a muted line of at most ten words on how it uses the connector; the tools a project called as small chips on the line to the connector.',
      '- The connector as one card at the right end that every caller points to, with the tool names it answered.',
      '- Draw only the callers listed below.',
    ],
  }),
  task: name => ({
    draw: `Draw what the Cowork scheduled task "${name}" is and what it works with, from its details below.`,
    show: 'Show when it runs (its schedule), where it runs, what its instructions make Claude do, the connectors and plugins it uses, and what it can do (permissions). Do not copy the instructions: name their steps.',
    title: 'Scheduled task',
    from: "the task's schedule, where it runs, its permissions, its instructions and the names of the connectors and plugins it uses",
    process: [
      `Draw the Cowork scheduled task "${name}" as a process, from its details below: one run from the schedule that starts it to what it leaves behind.`,
      '- What starts it (the schedule in words), where it runs, then the steps its instructions make Claude take, in run order, as numbered cards: a name of at most four words in bold and one muted line of at most ten words; small chips for the connectors and plugins a step uses, only when the instructions name them.',
      '- A decision is a diamond with its branches labelled. At the end, what the run produces.',
      '- Do not copy the instructions and draw no step they do not state.',
    ],
  }),
  chat: name => ({
    draw: `Draw the Cowork chat "${name}", from its conversation and files below.`,
    show: 'Show what the person asked, what Claude did in answer, the files the chat was given and the files it produced, as boxes joined in the order they happened. Do not copy the messages: name their topics.',
    title: 'Chat',
    from: "the chat's title, the names of its files and the text of its conversation",
    process: [
      `Draw the Cowork chat "${name}" as a process, from its conversation below: the exchange in the order it ran.`,
      '- The files the chat was given at the start, then each turn as a numbered card: who spoke (You or Claude) and a topic of at most six words in bold, and one muted line of at most ten words; the files a turn produced as small chips on its card, only when the conversation names them.',
      '- At the end, the files the chat produced.',
      '- Do not copy the messages and draw no turn that is not listed below.',
    ],
  }),
  // A marketplace is not an element of a scope: its page draws it from the plugins it lists (`marketText`), its process from the
  // lines where one plugin names another (`marketProcessText`).
  market: name => ({
    draw: `Draw what the plugin marketplace "${name}" offers Claude Code, from the plugins it lists below.`,
    show: 'Show its plugins grouped by what they are for, each plugin as its own box with what it brings to a session (skills, agents, commands, MCP servers, hooks) as counts or a few names, and which plugins work together. The groups sit side by side across the width, wrapping into a second row when they do not fit, and the plugin boxes inside a group form a grid: never one long column of plugins.',
    title: 'Marketplace',
    from: "the marketplace's plugins: each one's description and the names of its skills, agents, commands, hooks and servers",
    process: [
      `Draw the plugin marketplace "${name}" as a process, from the links between its plugins below: how the plugins work with each other, which one calls, hands work to, gates, extends or plugs into which other.`,
      '- Each plugin that takes part in a link is a card: its name in bold and at most six words on what it is for.',
      '- One arrow per pair of plugins that work together, from the plugin whose files name the other, read from the quoted lines: it calls the other (runs its skill, agent or command), hands work to it (a file, a draft, a brief), gates it (holds its output until a check passes), is extended by it (an optional plug-in it runs when installed), or plugs into it. Label each arrow with what passes in two to five words; when a hook or mod causes the link, put its event or mod name in the label.',
      '- A line that only mentions the other plugin in passing (an example, a rename note, a list of names) is no link: leave it out. When more links remain than read well, keep the ones that carry work (calls, hand-offs, gates, plug-ins).',
      '- Place the cards so the work flows left to right: a plugin that hands work on sits left of the one that takes it; plugins of one flow sit together, separate flows side by side or as rows across the width.',
      '- Under the drawing, one short muted line naming the plugins that work with no other plugin.',
      '- Do not draw session events as columns or a timeline: the drawing is about the plugins and the links between them.',
    ],
  }),
};

// The svg rules both perspectives share: theme colours only, and nothing executable.
const SVG_RULES = [
  'Rules for the svg:',
  '- Draw only with the editor theme colours, set as presentation attributes (fill="...", stroke="..."), never style attributes and never a fixed colour such as #fff or red.',
  '- Text, lines and outlines: currentColor; muted lines: var(--vscode-descriptionForeground). Box fills: fill="none", or a theme variable with a low fill-opacity.',
  '- Allowed theme variables: var(--vscode-editor-foreground), var(--vscode-descriptionForeground), var(--vscode-textLink-foreground), var(--vscode-charts-blue), var(--vscode-charts-green), var(--vscode-charts-orange), var(--vscode-charts-purple), var(--vscode-editorWidget-background), var(--vscode-editorWidget-border).',
  '- Plain shapes, text, paths, lines and marker arrowheads only. No script, no style element, no foreignObject, no image, no links, no event attributes, no animation.',
];

// The page shows a drawing across the panel's width and never larger than its viewBox, so the viewBox is wide and short.
const WIDE = '- The drawing is shown across a wide panel: use a viewBox 1400 wide and only as tall as the content needs, with no width or height attributes. Let the content decide the shape and use the whole width: never one tall column of boxes.';

const cut = (source: string) => (source.length > MAX_CHARS ? `${source.slice(0, MAX_CHARS)}\n[cut]` : source);

/** The kinds a drawing helps with; the others have no Draw with Claude. */
export type DrawKind = 'skill' | 'agent' | 'command' | 'workflow' | 'plugin' | 'mod' | 'hook' | 'mcp' | 'market' | 'connector' | 'task' | 'chat';

export const drawable = (kind: Kind): kind is Extract<DrawKind, Kind> => kind in SUBJECTS;

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
    WIDE,
    '- Where parts connect, place the boxes in columns so every line flows one way, left to right, from one column to the next; order the boxes inside each column so the lines between two columns do not cross. Where many parts sit side by side with no order between them, lay them out as a grid of rows across the width.',
    '- No line crosses another line, and no line passes through or behind a box: route every line in the gaps between boxes, with right-angle bends where it must turn.',
    '- Lines that run from one box to the same target, or side by side between the same two columns, merge into one line.',
    '- At least 14 px text, font-family inherit; a label longer than its box wraps onto a second line inside it.',
    ...SVG_RULES,
    '',
    `## ${k.title}`,
    cut(source),
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

/** The drawing id of an element's process perspective: the element's id with this suffix; its drawing is stored under that id. */
export const PROCESS_SUFFIX = '#process';

export const PROCESS_SYSTEM =
  'You draw SVG process diagrams of the elements of a Claude Code harness: what runs in which order, with what input and output, and what each hook module does. Every text is short. The layout follows the content and uses the width it is given. Answer with one svg element only.';

const MOD_CHARS = 6000;

// Where one part of a plugin names another part of it: one line per pair, so a plugin whose parts run in no order is drawn as its
// parts working with each other. A plain name such as "angular" counts only in backticks or as "<name> skill|agent|command".
const partLinks = (dir: string): string => {
  const mods = fs.existsSync(path.join(dir, 'mods')) ? fs.readdirSync(path.join(dir, 'mods'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : [];
  const parts = [...new Set([...namesIn(dir, 'skills', true), ...namesIn(dir, 'agents', false), ...namesIn(dir, 'commands', false), ...mods])];
  const ownerOf = (rel: string) => {
    const m = /^(?:skills|mods)\/([^/]+)\/|^(?:agents|commands)\/([^/]+)\.md$|^hooks\/([^/]+)\.(?:mjs|cjs|js|ts)$/i.exec(rel);
    return m ? m[1] ?? m[2] ?? m[3] : undefined;
  };
  const pattern = (part: string) =>
    /[-_]/.test(part) ? `(?<![\\w-])${escape(part)}(?![\\w-])` : `\`/?${escape(part)}\`|(?<![\\w-])${escape(part)} (?:skill|agent|command)`;
  const matchers = parts.map(part => ({ part, re: new RegExp(pattern(part)) }));
  const found = new Map<string, string>();
  for (const rel of workingFiles(dir)) {
    const from = ownerOf(rel);
    if (!from) continue;
    let text = '';
    try {
      text = fs.readFileSync(path.join(dir, rel), 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      for (const { part, re } of matchers) {
        const key = `${from} ${part}`;
        if (part === from || found.has(key) || !re.test(line)) continue;
        found.set(key, `- ${from} names ${part} in ${rel}: ${line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}...` : line}`);
      }
    }
  }
  return found.size ? `### Links between parts\n${[...found.values()].join('\n')}` : '';
};

// The process perspective reads the plugin as the harness perspective does, plus the lines where its parts name each other and
// the hook modules themselves: a mod's code is where what it does is written down.
export function processText(dir: string): string {
  const base = pluginText(dir);
  const hooks = path.join(dir, 'hooks');
  const scripts = (folder: string) =>
    fs.existsSync(folder)
      ? fs
          .readdirSync(folder, { withFileTypes: true })
          .filter(e => e.isFile() && /\.(mjs|js|ts)$/i.test(e.name))
          .map(e => path.join(folder, e.name))
      : [];
  // hooks/hooks.json lists module files relative to hooks/ (`../mods/<mod>/register.ts`); the files beside a module belong to the mod.
  const declared = fs.existsSync(path.join(hooks, 'hooks.json')) ? jsonAt(path.join(hooks, 'hooks.json'), []) : undefined;
  const modules = Array.isArray((declared as { modules?: unknown } | undefined)?.modules) ? ((declared as { modules: unknown[] }).modules.map(String)) : [];
  const files = [...new Set([...scripts(hooks), ...modules.flatMap(m => scripts(path.dirname(path.resolve(hooks, m))))])].sort((a, b) => a.localeCompare(b));
  const mods = files.map(file => {
    const text = fs.readFileSync(file, 'utf8');
    return `### Mod ${path.relative(dir, file).split(path.sep).join('/')}\n${text.length > MOD_CHARS ? `${text.slice(0, MOD_CHARS)}\n[cut]` : text}`;
  });
  return [base, partLinks(dir), ...mods].filter(Boolean).join('\n\n');
}

/**
 * What the element's process perspective is drawn from: a plugin's manifest and contents with its hook modules (`processText`),
 * every other element from the same source as its harness perspective (`drawSource`), stored under its own id.
 */
export function processSource(asset: Asset, pluginDir?: string): { text: string; from: string } | undefined {
  if (asset.kind !== 'plugin') return drawSource(asset, pluginDir);
  return pluginDir && fs.existsSync(pluginDir) ? { text: processText(pluginDir), from: "the plugin's manifest, contents and hook modules" } : undefined;
}

/** The prompt for an element's process perspective: what runs in which order for its kind, laid out as its content needs. */
export function processPrompt(kind: DrawKind, name: string, source: string): string {
  const k = SUBJECTS[kind](name);
  const [draw, ...what] = k.process;
  return [
    draw,
    'Answer with one complete <svg> element and nothing else: no markdown fence, no prose before or after.',
    'What to draw:',
    ...what,
    '- Draw only what exists in the source.',
    'Rules for the layout:',
    WIDE,
    '- A sequence runs left to right and wraps into the next row, in reading order, when it does not fit; steps that run side by side sit one above the other in the same column; parts with no order between them form a grid across the width. Where steps are numbered, the numbers follow the arrows.',
    '- No title, no caption and no card for a part the source does not have (no "none" or "not set" boxes).',
    '- No line crosses a card or another line; route lines in the gaps with right-angle bends.',
    '- At least 14 px text for names, at least 13 px for the other lines, font-family inherit; a line longer than its card wraps inside it.',
    ...SVG_RULES,
    '',
    `## ${k.title}`,
    cut(source),
  ].join('\n');
}

/** The drawing id of a marketplace: this prefix and its name; its Process perspective adds PROCESS_SUFFIX like a plugin's. */
export const MARKET_PREFIX = 'market:';

/** A plugin a marketplace lists, as its page shows it (`MarketPlugin` in fleet.ts). */
export interface MarketPart {
  name: string;
  dir?: string;
  description?: string;
}

// A plugin's hook config: the file its manifest names, else hooks/hooks.json; undefined when it has none.
const hooksOf = (dir: string) => {
  const manifest = jsonAt(path.join(dir, '.claude-plugin', 'plugin.json'), []) as Record<string, unknown>;
  const file = path.join(dir, typeof manifest.hooks === 'string' ? manifest.hooks : path.join('hooks', 'hooks.json'));
  const config = fs.existsSync(file) ? (jsonAt(file, []) as { hooks?: Record<string, unknown>; modules?: unknown[] }) : undefined;
  return { manifest, file: config ? file : undefined, config };
};

const byName = (plugins: MarketPart[]) => [...plugins].sort((a, b) => a.name.localeCompare(b.name));

// A module listed as `../mods/<mod>/register.ts` is named by its folder, one beside hooks.json by its file.
const modName = (m: string) => {
  const parent = path.basename(path.dirname(m));
  return parent && !['.', '..', 'hooks'].includes(parent) ? parent : path.basename(m).replace(/\.[^.]+$/, '');
};

// The names in a plugin folder: skill folders with a SKILL.md, or the .md files of agents and commands.
const namesIn = (dir: string, folder: string, skills: boolean) => {
  const base = path.join(dir, folder);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter(e => (skills ? e.isDirectory() && fs.existsSync(path.join(base, e.name, 'SKILL.md')) : e.isFile() && /\.md$/i.test(e.name)))
    .map(e => (skills ? e.name : e.name.replace(/\.md$/i, '')))
    .sort((a, b) => a.localeCompare(b));
};

// A marketplace as Claude reads it to draw: each plugin by its description and the names of its skills, agents, commands, hook
// events, mods and servers. Names only, so a marketplace of twenty plugins fits the prompt; each plugin has its own drawing. No
// versions, and the plugins by name, not in the page's order (updates first): the drawing is dropped when its text changes, and a
// marketplace's plugins move their versions all the time.
export function marketText(plugins: MarketPart[]): string {
  return byName(plugins)
    .map(p => {
      const dir = p.dir && fs.existsSync(p.dir) ? p.dir : undefined;
      const { manifest, config } = dir ? hooksOf(dir) : { manifest: {} as Record<string, unknown>, config: undefined };
      const mcp = dir ? (jsonAt(path.join(dir, '.mcp.json'), []) as Record<string, unknown>) : {};
      const servers = [...Object.keys((mcp.mcpServers ?? mcp) as object), ...(manifest.mcpServers && typeof manifest.mcpServers === 'object' ? Object.keys(manifest.mcpServers) : [])];
      const modules = Array.isArray(config?.modules) ? config.modules.map(m => modName(String(m))) : [];
      const line = (label: string, list: string[]) => (list.length ? `${label}: ${[...new Set(list)].join(', ')}` : '');
      return [
        `### ${p.name}`,
        oneLine(p.description ?? manifest.description),
        dir ? line('Skills', namesIn(dir, 'skills', true)) : '',
        dir ? line('Agents', namesIn(dir, 'agents', false)) : '',
        dir ? line('Commands', namesIn(dir, 'commands', false)) : '',
        line('Hook events', Object.keys(config?.hooks ?? {})),
        line('Mods', modules),
        line('MCP servers', servers),
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

// The files that say how a plugin works with the others: its manifest and README, each SKILL.md, agent and command, and its hook
// configs and mods. A skill's reference leaves and scripts stay out: they quote other plugins as examples and incidents.
const WORKING_FILE = /^(\.claude-plugin\/plugin\.json|README\.md|skills\/[^/]+\/SKILL\.md|agents\/[^/]+\.md|commands\/[^/]+\.md|(hooks|mods)\/.+\.(json|mjs|cjs|js|ts))$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '__tests__', 'dist', 'out', 'coverage']);
// One line per pair of plugins keeps a marketplace of thirty plugins inside the prompt.
const LINE_CHARS = 160;
const LINES_PER_LINK = 1;

// A plugin's working files, relative to its folder with forward slashes, in a fixed order.
const workingFiles = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (rel: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && depth < 4) walk(child, depth + 1);
      else if (e.isFile() && WORKING_FILE.test(child) && fs.statSync(path.join(dir, child)).size <= 256 * 1024) out.push(child);
    }
  };
  walk('', 0);
  return out;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The process perspective of a marketplace: how its plugins work with each other. A link is a line in one plugin's working files
// that names another plugin, or a skill, agent, command or mod only that plugin has (a hyphenated name, so a plain word such as
// "deploy" never counts): the file and the line, so Claude can say what passes. Each plugin that takes part comes with its
// description, hook events and mods, so a link a hook causes can carry its event; the plugins that link with none are one line.
export function marketProcessText(plugins: MarketPart[]): string {
  const all = byName(plugins).map(p => {
    const dir = p.dir && fs.existsSync(p.dir) ? p.dir : undefined;
    const { manifest, config } = dir ? hooksOf(dir) : { manifest: {} as Record<string, unknown>, config: undefined };
    const parts = dir ? [...namesIn(dir, 'skills', true), ...namesIn(dir, 'agents', false), ...namesIn(dir, 'commands', false)] : [];
    const mods = Array.isArray(config?.modules) ? config.modules.map(m => modName(String(m))) : [];
    return { p, dir, about: oneLine(p.description ?? manifest.description), events: Object.keys(config?.hooks ?? {}), mods, parts: [...new Set([...parts, ...mods])] };
  });
  // A part name two plugins share says nothing about which one is meant.
  const owners = new Map<string, number>();
  for (const a of all) for (const part of a.parts) owners.set(part, (owners.get(part) ?? 0) + 1);
  const token = (word: string) => `(?<![\\w-])${escape(word)}(?![\\w-])`;
  const matchers = all.map(b => ({
    name: b.p.name,
    test: (own: Set<string>) => new RegExp([b.p.name, ...b.parts.filter(part => owners.get(part) === 1 && !own.has(part) && /[-_]/.test(part) && part.length >= 6)].map(token).join('|')),
  }));
  const links = new Map<string, Map<string, string[]>>();
  for (const a of all) {
    if (!a.dir) continue;
    const own = new Set(a.parts);
    const others = matchers.filter(m => m.name !== a.p.name).map(m => ({ name: m.name, re: m.test(own) }));
    const found = new Map<string, string[]>();
    for (const rel of workingFiles(a.dir)) {
      let text = '';
      try {
        text = fs.readFileSync(path.join(a.dir, rel), 'utf8');
      } catch {
        continue;
      }
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        for (const o of others) {
          const lines = found.get(o.name) ?? [];
          if (lines.length >= LINES_PER_LINK || !o.re.test(line)) continue;
          const entry = `${rel}: ${line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}...` : line}`;
          if (!lines.includes(entry)) found.set(o.name, [...lines, entry]);
        }
      }
    }
    if (found.size) links.set(a.p.name, found);
  }
  const linked = new Set([...links.keys(), ...[...links.values()].flatMap(f => [...f.keys()])]);
  const sections = all
    .filter(a => linked.has(a.p.name))
    .map(a => {
      const hooks = [a.events.length ? `Hook events: ${a.events.join(', ')}` : '', a.mods.length ? `Mods: ${[...new Set(a.mods)].join(', ')}` : ''].filter(Boolean).join('; ');
      const out = [...(links.get(a.p.name) ?? new Map<string, string[]>())].sort(([x], [y]) => x.localeCompare(y)).flatMap(([to, lines]) => lines.map(line => `- names ${to} in ${line}`));
      return [`### ${a.p.name}`, a.about, hooks, ...out].filter(Boolean).join('\n');
    });
  const alone = all.filter(a => !linked.has(a.p.name)).map(a => a.p.name);
  return [...sections, alone.length ? `### Plugins that name no other plugin and that no plugin names\n${alone.join(', ')}` : ''].filter(Boolean).join('\n\n');
}

/** The prompt for a marketplace's process perspective: how its plugins call, feed, gate and extend each other. */
export const marketProcessPrompt = (name: string, source: string): string => processPrompt('market', name, source);

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
