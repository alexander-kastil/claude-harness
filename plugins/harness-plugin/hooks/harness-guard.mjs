import { registerMentions } from "./harness-command.mjs";

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const SOURCE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const RECEIPT_TOOLS = new Set(["Write", "Edit"]);
const LINE_CAP = 120;
const PRODUCT_SECTIONS = ["Project", "Where the detail lives", "Harness", "Hard Rules", "Working Method"];
const CLASS_SECTIONS = ["Layout", "Hard Rules", "Working Method"];
const CLASS_ANYWHERE = ["Harness"];
const LEAF_LINES = 275;
const LEAF_SECTIONS = 12;
const PLAYBOOK_LINES = 400;
const LEAF_PATH = /\/\.claude\/skills\/.+\/references\/.+\.md$/;
const SRC_NAME = /(^|[^/A-Za-z0-9._-])src\/([A-Za-z0-9._-]+)/gm;
const IMPORT_LINE = /^@(?![\\/~]|[A-Za-z]:)(\S+)\s*$/;
const AGENT_TABLE = /^\| *`?[a-z-]+`? *\| *(Read|Write|Edit|Bash|Glob)/m;
const MCP_LIST = /^- \*\*(chrome-devtools|playwright|angular-cli|azure-deploy|github|microsoft-learn|ssh-mcp)\*\*/im;
const DEV_COMMANDS = /(npm start|npm run e2e|ng serve|hugo server|dotnet watch run|dotnet test)/;
const SOURCE_DIR = /^(src|deploy|scripts)\//;
const GENERATED = /(^|\/)(node_modules|bin|obj|dist)\//;
const SOURCE_EXT = /\.(cs|ts|tsx|js|jsx|py|html|css|scss|sql|csproj|json|toml|conf|ya?ml|sh|ps1)$/;
const DOCKERFILE = /^dockerfile(\..+)?$/;
const REVIEWER = /(^|:)verification-reviewer$/;
const FIX = "Run the `fix-constitution` skill (harness-plugin).";

const spawned = new Map();
const touched = new Map();
const reviewerWrites = new Set();
let newest = 0;

function slash(p) {
  return String(p ?? "").replace(/\\/g, "/").replace(/^\/([a-z])\//i, "$1:/");
}

function canon(p) {
  return slash(p).replace(/\/+$/, "").toLowerCase();
}

function dirOf(p) {
  const s = slash(p);
  const cut = s.lastIndexOf("/");
  return cut < 0 ? "." : s.slice(0, cut);
}

function baseOf(p) {
  const s = slash(p);
  return s.slice(s.lastIndexOf("/") + 1);
}

function relTo(root, file) {
  const r = canon(root);
  const f = canon(file);
  return f.startsWith(r + "/") ? f.slice(r.length + 1) : "";
}

function wc(text) {
  return (text.match(/\n/g) ?? []).length;
}

function count(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

async function root($) {
  return slash(await $.session.root().catch(() => ""));
}

async function stopFile($) {
  return (await $.env.get("AGENT_STOP_FILE").catch(() => undefined)) ?? "";
}

async function steerFile($) {
  return (await $.env.get("AGENT_STEER_FILE").catch(() => undefined)) ?? "";
}

async function gateOn($) {
  return ((await $.env.get("HARNESS_VERIFICATION_GATE").catch(() => undefined)) ?? "") === "1";
}

async function srcDrift($, base, text) {
  const src = `${base}/src`;
  if (!(await $.fs.exists(src).catch(() => false))) return "";
  const entries = await $.fs.list(src).catch(() => []);
  const unlisted = entries.filter((d) => d.kind === "dir" && !text.includes(d.name)).map((d) => d.name);
  const named = [...new Set([...text.matchAll(SRC_NAME)].map((m) => m[2].replace(/\.+$/, "")).filter(Boolean))];
  const phantom = [];
  for (const name of named) {
    if (!(await $.fs.exists(`${src}/${name}`).catch(() => true))) phantom.push(name);
  }
  if (!unlisted.length && !phantom.length) return "";
  return [
    "harness-guard (src drift): CLAUDE.md is out of sync with what is actually in src/.",
    ...(unlisted.length ? [`On disk but not named in CLAUDE.md: ${unlisted.join(" ")}`] : []),
    ...(phantom.length ? [`Named in CLAUDE.md but not on disk: ${phantom.join(" ")}`] : []),
    "Fix CLAUDE.md itself: add a one-line layout row for what is real, remove what is gone.",
    "Do not update docs/ for this, and do not create or delete anything under src/.",
    "Describe what exists now in the present tense. No history, no 'used to be', no legacy framing.",
    FIX,
  ].join("\n");
}

async function sections($, base, text) {
  const isClass = (await $.fs.exists(`${base}/demos`).catch(() => false)) && (await $.fs.exists(`${base}/labs`).catch(() => false));
  const required = isClass ? CLASS_SECTIONS : PRODUCT_SECTIONS;
  const found = [...text.matchAll(/^## ([^(\n]+)/gm)].map((m) => m[1].trim());
  const anywhere = isClass ? CLASS_ANYWHERE : [];
  let at = 0;
  for (const heading of found) {
    if (at < required.length && heading === required[at]) at += 1;
  }
  const absent = anywhere.filter((h) => !found.includes(h));
  if (at === required.length && !absent.length) return "";
  return [
    `harness-guard (required sections): CLAUDE.md of this ${isClass ? "class" : "product"} repo no longer has its required sections in order.`,
    `expected, in this order: ${required.join(" | ")}${anywhere.length ? `, plus ${anywhere.join(" | ")} anywhere` : ""} (other ## sections may sit anywhere)`,
    `found:    ${found.join(" | ") || "none"}`,
    `missing or out of order: ${at < required.length ? required[at] : absent[0]}`,
    "Put new material in the file that owns it: repo facts an agent needs in .claude/rules/<area>.md, procedures in the owning skill.",
    FIX,
  ].join("\n");
}

function inventory(text) {
  const kinds = [];
  if (AGENT_TABLE.test(text)) kinds.push("an agent/tool table");
  if (MCP_LIST.test(text)) kinds.push("an MCP server list");
  if (DEV_COMMANDS.test(text)) kinds.push("dev commands");
  if (!kinds.length) return "";
  return [
    `harness-guard (inventory): CLAUDE.md is carrying an inventory again: ${kinds.join("; ")}.`,
    "Skill names, agent names, MCP servers and their tool lists are already injected into context every turn by the harness, and routing comes from the subagent-delegation plugin. Repeating them here only creates drift.",
    "Keep the RULE, drop the LIST. Commands go to the .claude/rules/ file of their area.",
    FIX,
  ].join("\n");
}

function lineCap(text) {
  const lines = wc(text);
  if (lines <= LINE_CAP) return "";
  return [
    `harness-guard (line cap): CLAUDE.md is now ${lines} lines (cap ${LINE_CAP}). It is a router, not a manual.`,
    "Move the detail you just added into the file that owns it and leave a one-line pointer:",
    "- repo facts an agent needs           -> .claude/rules/<area>.md, with paths frontmatter",
    "- anything procedural                 -> the owning skill in ~/.claude/skills/ or .claude/skills/",
    "- the global house rules              -> already loaded from ~/.claude/CLAUDE.md, never restated",
    "Keep only: repo purpose, folder layout, one-line repo rules, the Harness pointer.",
    "Global skills are read in place; never vendor one into .claude/skills/ to shorten this file.",
    FIX,
  ].join("\n");
}

function resolveUnder(base, rel) {
  const parts = [];
  for (const part of slash(rel).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? `${slash(base).replace(/\/+$/, "")}/${parts.join("/")}` : "";
}

async function expandImports($, base, text) {
  const lines = [];
  for (const line of text.split("\n")) {
    const m = line.match(IMPORT_LINE);
    const target = m ? resolveUnder(base, m[1]) : "";
    const isFile = target && (await $.fs.stat(target).then((s) => s.kind === "file", () => false));
    lines.push(isFile ? String(await $.fs.read(target)).replace(/\r/g, "").replace(/\n$/, "") : line);
  }
  return lines.join("\n");
}

async function constitution($, base, file) {
  const text = String(await $.fs.read(file)).replace(/\r/g, "");
  const full = await expandImports($, base, text);
  return (await srcDrift($, base, full)) || (await sections($, base, full)) || inventory(text) || lineCap(text);
}

function leafSize(name, skill, text) {
  const lines = wc(text);
  let headings = count(text, /^## /gm);
  let playbook = /^[ \t]*<!--[ \t]*playbook[ \t]*-->/im.test(text);
  if (!playbook && headings > 0) playbook = count(text, /^## ([Ss]tep |[Pp]hase )?[0-9]+[a-z]?[.):]/gm) * 2 > headings;
  const cap = playbook ? PLAYBOOK_LINES : LEAF_LINES;
  if (playbook) headings = 0;
  if (lines <= cap && headings <= LEAF_SECTIONS) return "";
  if (playbook) {
    return [
      `${name} is now ${lines} lines (playbook cap: ${cap}). It reads as a PLAYBOOK: one`,
      "sequential procedure whose sections are its steps.",
      "",
      "DO NOT split the numbered walk. A reader runs those steps in order and needs them in",
      "one file. Extract only the sections that are NOT part of the sequence: variants,",
      "reusable verification clusters, hygiene appendices. If every section is genuinely a",
      "step, the leaf is correct as it is and the marker <!-- playbook --> makes that explicit.",
      "",
    ].join("\n");
  }
  return [
    `${name} is now ${lines} lines / ${headings} H2 sections (caps: ${cap} lines, ${LEAF_SECTIONS} sections).`,
    "",
    "A leaf is a node in a retrieval graph, not a chapter. Every arrival pays for the whole",
    "file, so a leaf covering ten topics makes nine of them dead weight on every read.",
    "",
    "The fix is a SPLIT or a DISSOLVE, never a trim. Do not delete content to get under the cap.",
    "",
    "1. DISSOLVE FIRST. For each section ask which sibling leaf already owns that topic, and",
    "   replace the section with a one-line link to it. Splitting before dissolving multiplies",
    "   the duplicate into two files and two router rows.",
    "2. THEN SPLIT, by arrival question, never by subject. The test for a correct split: a",
    "   reader with one question opens exactly one leaf and reads all of it. A section kept",
    "   because it is 'related' is this same failure returning.",
    `3. ROUTE BOTH LAYERS. Every new leaf needs a row in ${skill}/SKILL.md`,
    "   (the edge) AND trigger phrases in its 'description:' frontmatter (the index). A leaf",
    "   with no row is unreachable; a row pointing at a moved leaf is a dead edge.",
    "",
    "Note: generalizing a leaf is a re-decision of what the node is for, not a rename. A leaf",
    "that was the concrete instance layer beside a generic sibling becomes a DUPLICATE of that",
    "sibling the moment the project specifics are stripped, with no edit to its sections.",
  ].join("\n");
}

async function leaf($, file) {
  const norm = slash(file);
  const skillDir = norm.slice(0, norm.lastIndexOf("/references/"));
  const skill = baseOf(skillDir);
  const name = baseOf(norm);
  const text = String(await $.fs.read(file)).replace(/\r/g, "");
  const size = leafSize(name, skill, text);
  if (size) return size;
  const skillMd = `${skillDir}/SKILL.md`;
  if (!(await $.fs.exists(skillMd).catch(() => false))) return "";
  const router = String(await $.fs.read(skillMd)).replace(/\r/g, "");
  if (!router.includes(`references/${name}`)) {
    return [
      `${name} has no row in ${skill}/SKILL.md, so nothing can route to it.`,
      "Add one row naming the ARRIVAL QUESTION it answers, not the subject it covers:",
      `  | <the question a reader arrives with> | [\`references/${name}\`](references/${name}) |`,
      "Then add its trigger phrases to the skill's 'description:' frontmatter.",
    ].join("\n");
  }
  const targets = [...new Set([...router.matchAll(/\]\((references\/[A-Za-z0-9._-]+\.md)\)/g)].map((m) => m[1]))];
  const missing = [];
  for (const t of targets) {
    if (!(await $.fs.exists(`${skillDir}/${t}`).catch(() => true))) missing.push(t);
  }
  if (!missing.length) return "";
  return [
    `${skill}/SKILL.md routes to leaves that do not exist: ${missing.join(" ")}`,
    "A dead edge fails silently: the router promises an answer that cannot be opened.",
    "Either restore the leaf, or fix the row to point at whichever leaf absorbed it.",
  ].join("\n");
}

async function killSwitch($, base) {
  const path = (await stopFile($)) || (base ? `${base}/AGENT_STOP` : "");
  if (!path || !(await $.fs.exists(path).catch(() => false))) return "";
  const note = String(await $.fs.read(path).catch(() => "")).replace(/\n+$/, "") || "no reason given";
  return `Kill switch engaged: AGENT_STOP exists at the project root. Every tool call is halted until a human removes it. Do not attempt to delete it yourself and do not work around it. Stop and tell the user you are halted.\n\nContents: ${note}`;
}

async function steer($, base) {
  const path = (await steerFile($)) || (base ? `${base}/STEER.md` : "");
  if (!path) return "";
  const stat = await $.fs.stat(path).catch(() => undefined);
  if (!stat || stat.kind !== "file" || !stat.size) return "";
  const note = String(await $.fs.read(path).catch(() => "")).replace(/\n+$/, "");
  if (!note) return "";
  const cleared = await $.fs.write(path, "").then(() => true, () => false);
  if (!cleared) return "";
  return `OPERATOR STEERING (from a human, higher priority than your current plan):\n\n${note}\n\nPause what you were about to do, incorporate this, then continue toward the goal. This message is delivered once and the file is now cleared.`;
}

async function track($, base, e, file) {
  if (!(await gateOn($))) return;
  if (e.agentId) {
    if (RECEIPT_TOOLS.has(e.tool) && REVIEWER.test(spawned.get(e.agentId) ?? "")) reviewerWrites.add(canon(file));
    return;
  }
  const rel = relTo(base, file);
  if (!rel || !SOURCE_DIR.test(rel) || GENERATED.test(rel)) return;
  const name = baseOf(rel);
  if (!DOCKERFILE.test(name) && !SOURCE_EXT.test(name)) return;
  const stat = await $.fs.stat(file).catch(() => undefined);
  if (!stat || stat.kind !== "file") return;
  touched.set(canon(file), slash(file));
  newest = Math.max(newest, stat.mtimeMs ?? 0);
}

async function after($, e) {
  const file = e.file_path ?? e.notebook_path;
  if (!file || !SOURCE_TOOLS.has(e.tool)) return [];
  const base = await root($);
  if (!base) return [];
  await track($, base, e, file);
  if (!EDIT_TOOLS.has(e.tool)) return [];
  const notes = [];
  const isOwnClaudeMd = baseOf(file) === "CLAUDE.md" && canon(dirOf(file)) === canon(base) && !canon(base).endsWith("/.claude");
  if (isOwnClaudeMd) notes.push(await constitution($, base, file));
  if (LEAF_PATH.test(slash(file))) notes.push(await leaf($, file));
  return notes.filter(Boolean);
}

function receiptBlock(session, wrote) {
  const changed = [...touched.values()].map((f) => `\n  ${f}`).join("");
  return [
    "This session changed source files. It cannot end on a claim that they work.",
    "",
    `Changed:${changed}`,
    "",
    ...(wrote
      ? ["The reviewer's receipt is stale or incomplete. It must be newer than the last", "source edit and carry at least one command with its output."]
      : [
          "No receipt from the verification-reviewer subagent. You cannot write one yourself:",
          "the gate reads the subagent's own writes, not the file alone.",
          "",
          "Spawn it with the Agent tool, subagent_type verification-reviewer, and give it:",
          `  session id:   ${session}`,
          `  receipt path: .claude/verification/${session}.md`,
          `  changed:${changed}`,
        ]),
    "",
    "The receipt it writes must contain, one pair per check:",
    "  $ <the exact command>",
    "  Result: pass|fail, then the output lines that prove it",
    "",
    "Rules:",
    "  - A subagent reporting 'verified' is not evidence. Paste the command and its output.",
    "  - If a check fails, say so in the receipt and fix the cause. Do not soften the wording.",
    "  - If a check genuinely cannot be run here, write why under Result: and stop to tell the user.",
    "  - Never edit a source file again after writing the receipt without re-running the check.",
  ].join("\n");
}

export function register(on) {
  registerMentions(on);

  on("session.start", async ($, e, next) => {
    spawned.clear();
    touched.clear();
    reviewerWrites.clear();
    newest = 0;
    return next(e);
  }).catch(($, e, next) => next(e));

  on("tool.call", async ($, e, next) => {
    const base = await root($);
    const halted = await killSwitch($, base).catch(() => "");
    if (halted) return { deny: halted };
    const steering = await steer($, base).catch(() => "");
    if (steering) return { deny: steering };
    const r = await next(e);
    if (!r || r.deny || r.isError) return r;
    const notes = await after($, e).catch(() => []);
    return notes.length ? { ...r, context: [...(r.context ?? []), ...notes] } : r;
  }).catch(($, e, next) => next(e));

  on("agent.spawn", async ($, e, next) => {
    const r = await next(e);
    const id = r?.agentId ?? r?.teammateId;
    if (id) spawned.set(id, String(e.subagentType ?? ""));
    return r;
  }).catch(($, e, next) => next(e));

  on("classic.Stop", async ($, e, next) => {
    if (e.stop_hook_active || touched.size === 0) return next(e);
    if (!(await gateOn($))) return next(e);
    const base = (await root($)) || slash(e.cwd);
    const session = e.session_id || (await $.session.id().catch(() => ""));
    if (!base || !session) return next(e);
    const receipt = `${base}/.claude/verification/${session}.md`;
    const wrote = reviewerWrites.has(canon(receipt));
    if (wrote) {
      const stat = await $.fs.stat(receipt).catch(() => undefined);
      const text = stat ? String(await $.fs.read(receipt).catch(() => "")) : "";
      if (stat && stat.mtimeMs >= newest && /^\$ .+/m.test(text) && /^Result: (pass|fail)/m.test(text)) return next(e);
    }
    return { block: receiptBlock(session, wrote) };
  }).catch(($, e, next) => next(e));
}
