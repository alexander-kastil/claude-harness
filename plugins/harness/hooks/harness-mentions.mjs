// @harness:<view> in a prompt: the type-ahead offers the Claude Harness views from "@h" on, and on send each one runs and its output goes to Claude as context.
// Only views that read and need no arguments.
const NAME = "harness";
const SCRIPT = "skills/cli/scripts/harness.mjs";
const RUN_MS = 120000;

const MENTION = `@${NAME}:`;
const MENTIONS = {
  inventory: { argv: ["inventory"], description: "The harness of Global: memory, rules, agents, skills, commands, hooks, MCP servers, plugins" },
  consolidate: { argv: ["consolidate"], description: "Every skill, agent, rule, command or workflow that exists in more than one place" },
  agents: { argv: ["agents", "list"], description: "The agents of Global, the plugins and the repos, with the copies that differ and the gated ones" },
  usage: { argv: ["usage", "--session", "latest"], description: "This session's tokens and cost by model and by agent" },
  delegation: { argv: ["delegation", "--session", "latest"], description: "The agents this session launched, with their decisions, slips and findings" },
  hunt: { argv: ["hunt", "catalog"], description: "The skills and agents a plugin can be made from" },
  marketplaces: { argv: ["marketplaces"], description: "Every marketplace with its plugins and their health" },
  check: { argv: ["check"], description: "The harness checks of the known repos against the harness standard" },
  repos: { argv: ["repos"], description: "One row per repo: its harness, its checks and its CLAUDE.md" },
  sync: { argv: ["sync"], description: "The repo copies of skills and agents that differ from Global" },
  sessions: { argv: ["sessions"], description: "This repo's sessions in /resume order, with their names, start, minutes and agents" },
  // Opens the session it was typed in on its page in the panel; the output is the one line saying what happened.
  "session-analyze": { argv: ["sessions", "open"], session: true, description: "Open this session on its page in the Claude Harness panel: cost, who spent it, the timeline" },
  mods: { argv: ["mods", "--session", "latest"], description: "Which mods and guards acted in this session" },
  time: { argv: ["time"], description: "This repo's time ledger by day, with the total" },
  lessons: { argv: ["lessons"], description: "The entries of this repo's tasks/lessons.md" },
  sources: { argv: ["sources"], description: "The skills installed from a source, with their source and version" },
};
const MENTION_RE = new RegExp(`(?:^|\\s)@${NAME}:([a-z-]+)(?=[\\s.,;!?)]|$)`, "g");

function harness($, argv, timeoutMs) {
  return $.process.run(["node", `${$.plugin.root}/${SCRIPT}`, ...argv], { timeoutMs });
}

// The views for a token from "@h" to "@harness:<part>", or undefined when the token is no mention; a bare "@" stays the engine's.
export function mentionRows(token) {
  const t = String(token ?? "");
  const typed = t.startsWith(MENTION) ? t.slice(MENTION.length) : t.length > 1 && MENTION.startsWith(t) ? "" : undefined;
  if (typed === undefined) return undefined;
  return Object.entries(MENTIONS)
    .filter(([name]) => name.startsWith(typed))
    .map(([name, m]) => ({ text: `${MENTION}${name}`, label: `${MENTION}${name}`, description: m.description }));
}

async function sessionId($, e) {
  return e.session_id || (await $.session.id().catch(() => "")) || "latest";
}

async function mentionBlock($, name, e = {}) {
  const m = MENTIONS[name];
  if (!m) return `${MENTION}${name} is not a harness view; the views are ${Object.keys(MENTIONS).map((n) => MENTION + n).join(", ")}.`;
  try {
    const argv = m.session ? [...m.argv, "--session", await sessionId($, e)] : m.argv;
    const r = await harness($, argv, RUN_MS);
    const out = String(r.stdout ?? "").trimEnd();
    const err = String(r.stderr ?? "").trim();
    const body = r.exitCode === 0 ? out : [out, err && `harness: ${err}`].filter(Boolean).join("\n");
    if (m.session) return `${MENTION}${name}: ${body || "(no output)"}`;
    return `${MENTION}${name} (claude-harness ${m.argv.join(" ")}):\n${body || "(no output)"}`;
  } catch (error) {
    return `${MENTION}${name}: harness: ${error?.message ?? error}`;
  }
}

export function registerMentions(on) {
  on("prompt.submit", async ($, e, next) => {
    if (e.command || e.isMeta) return next(e);
    const names = [...new Set([...String(e.text ?? "").matchAll(MENTION_RE)].map((m) => m[1]))];
    if (!names.length) return next(e);
    const blocks = await Promise.all(names.map((name) => mentionBlock($, name, e)));
    return next({ ...e, context: [...(e.context ?? []), ...blocks] });
  });

  on("prompt.autocomplete", async ($, e, next) => {
    const mentions = mentionRows(e.token);
    if (!mentions) return next(e);
    const base = await next(e);
    return { suggestions: [...(base?.suggestions ?? []), ...mentions] };
  });
}
