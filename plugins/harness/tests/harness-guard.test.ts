import { describe, expect, test } from "claude-code/testing";

// The keys of skills/align-harness/references/standard.json the guard reads, with the shipped values; a test cannot import JSON.
const STANDARD = {
  lineCap: 120,
  sections: {
    product: ["Project", "Where the detail lives", "Harness", "Hard Rules", "Working Method"],
    class: ["Layout", "Hard Rules", "Working Method"],
    classAnywhere: ["Harness"],
    classMarkers: ["demos", "labs"],
  },
  leaf: { lines: 275, sections: 12, playbookLines: 400 },
  inventory: {
    agentTable: { pattern: "^\\| *`?[a-z-]+`? *\\| *(Read|Write|Edit|Bash|Glob)", flags: "m" },
    mcpList: { pattern: "^- \\*\\*(chrome-devtools|playwright|angular-cli|azure-deploy|github|microsoft-learn|ssh-mcp)\\*\\*", flags: "im" },
    devCommands: { pattern: "(npm start|npm run e2e|ng serve|hugo server|dotnet watch run|dotnet test)", flags: "" },
  },
};

const ROOT = "D:\\work\\repo";
const R = "D:/work/repo";
const CLAUDE_MD = `${ROOT}\\CLAUDE.md`;
const SKILL = `${R}/.claude/skills/demo`;
const STANDARD_FILE = "/skills/align-harness/references/standard.json";

const norm = (p: string) => String(p).replace(/\\/g, "/").replace(/^\/([a-z])\//i, "$1:/").replace(/\/+$/, "");

type World = {
  files?: Record<string, string>;
  dirs?: Record<string, { name: string; kind: string }[]>;
  env?: Record<string, string>;
  mtimes?: Record<string, number>;
  standard?: unknown;
};

function harness(on: any, world: World = {}) {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(world.files ?? {})) files[norm(k)] = v;
  const dirs: Record<string, { name: string; kind: string }[]> = {};
  for (const [k, v] of Object.entries(world.dirs ?? {})) dirs[norm(k)] = v;
  const mtimes: Record<string, number> = {};
  for (const [k, v] of Object.entries(world.mtimes ?? {})) mtimes[norm(k)] = v;
  const env = world.env ?? {};
  const ran: string[] = [];
  on("session.start", (_: any, e: any) => ({ cwd: e.cwd }));
  on("session.root", () => ({ value: ROOT }));
  on("session.id", () => ({ value: "s1" }));
  on("env.get", (_: any, e: any) => ({ value: env[e.name] }));
  on("fs.exists", (_: any, e: any) => ({ value: norm(e.path) in files || norm(e.path) in dirs }));
  on("fs.list", (_: any, e: any) => {
    const entries = dirs[norm(e.path)];
    if (!entries) throw new Error(`ENOENT ${e.path}`);
    return { value: entries.map((d) => ({ ...d, size: 0, mtimeMs: 0, isLink: false })) };
  });
  on("fs.read", (_: any, e: any) => {
    if (norm(e.path).endsWith(STANDARD_FILE)) {
      if (world.standard === null) throw new Error(`ENOENT ${e.path}`);
      return { value: JSON.stringify(world.standard ?? STANDARD) };
    }
    const text = files[norm(e.path)];
    if (text === undefined) throw new Error(`ENOENT ${e.path}`);
    return { value: text };
  });
  on("fs.write", (_: any, e: any) => {
    files[norm(e.path)] = e.text;
    return { value: undefined };
  });
  on("fs.stat", (_: any, e: any) => {
    const p = norm(e.path);
    if (p in files) return { value: { kind: "file", size: files[p].length, mtimeMs: mtimes[p] ?? 1000, isLink: false } };
    if (p in dirs) return { value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false } };
    throw new Error(`ENOENT ${e.path}`);
  });
  on("tool.call", (_: any, e: any) => {
    ran.push(e.tool);
    if (e.file_path && e.tool === "Write") files[norm(e.file_path)] = e.content;
    return { result: { ok: true } };
  });
  on("agent.spawn", (_: any, e: any) => ({ model: "sonnet", agentId: e.subagentType === "harness:verification-reviewer" ? "r1" : "w1" }));
  on("classic.Stop", () => ({}));
  return { files, ran };
}

async function start($: any) {
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: ROOT } as any);
}

async function write($: any, file: string, content: string, agentId?: string) {
  return (await $.tool.call({ tool: "Write", file_path: file, content, ...(agentId ? { agentId } : {}) } as any)) as any;
}

async function edit($: any, file: string) {
  return (await $.tool.call({ tool: "Edit", file_path: file, old_string: "a", new_string: "b" } as any)) as any;
}

async function spawn($: any, subagentType: string) {
  return (await $.agent.spawn({ prompt: "go", description: "go", subagentType } as any)) as any;
}

async function stop($: any) {
  return (await $.classic.Stop({ session_id: "s1", stop_hook_active: false, cwd: ROOT, transcript_path: "t.jsonl" } as any)) as any;
}

const notes = (r: any) => (r?.context ?? []).join("\n");

function product(extra: string[] = []) {
  return ["# CLAUDE.md", "", "## Project", "", "The repo. src/app holds the app.", "", "## Where the detail lives", "", "## Harness", "", "## Hard Rules", "", ...extra, "## Working Method", "", "- Plan first.", ""].join("\n");
}

const SRC = { [`${R}/src`]: [{ name: "app", kind: "dir" }], [`${R}/src/app`]: [] };

describe("harness-guard: CLAUDE.md", () => {
  test("a product CLAUDE.md in the router layout passes", async ($, on) => {
    const md = product();
    harness(on, { files: { [CLAUDE_MD]: md }, dirs: SRC });
    expect(notes(await write($, CLAUDE_MD, md))).toBe("");
  });

  test("more than 120 lines is held at the line cap and points to align-harness", async ($, on) => {
    const md = product(Array.from({ length: 120 }, (_, i) => `- rule ${i}`));
    harness(on, { files: { [CLAUDE_MD]: md }, dirs: SRC });
    const n = notes(await write($, CLAUDE_MD, md));
    expect(n).toContain("line cap");
    expect(n).toContain("Run the `align-harness` skill (harness plugin).");
    expect(n).not.toContain("fix-constitution");
  });

  test("a missing required section is named", async ($, on) => {
    const md = product().replace("## Harness\n", "");
    harness(on, { files: { [CLAUDE_MD]: md }, dirs: SRC });
    const n = notes(await write($, CLAUDE_MD, md));
    expect(n).toContain("required sections");
    expect(n).toContain("missing or out of order: Harness");
    expect(n).toContain("align-harness");
  });

  test("the line cap, sections and class markers come from standard.json", async ($, on) => {
    const md = product();
    const std = { ...STANDARD, lineCap: 10, sections: { ...STANDARD.sections, product: ["Project", "Harness"], classMarkers: ["modules"] } };
    harness(on, { files: { [CLAUDE_MD]: md }, dirs: SRC, standard: std });
    expect(notes(await write($, CLAUDE_MD, md))).toContain("(cap 10)");
  });

  test("standard.json class markers decide the class layout", async ($, on) => {
    const std = { ...STANDARD, sections: { ...STANDARD.sections, classMarkers: ["modules"] } };
    harness(on, { files: { [CLAUDE_MD]: product() }, dirs: { ...SRC, [`${R}/modules`]: [] }, standard: std });
    const n = notes(await write($, CLAUDE_MD, product()));
    expect(n).toContain("class repo");
    expect(n).toContain("missing or out of order: Layout");
  });

  test("without a readable standard.json the CLAUDE.md and leaf checks add no note", async ($, on) => {
    const bad = "# CLAUDE.md\n\n## Anything\n" + "- line\n".repeat(200);
    const leaf = "# a\n" + "line\n".repeat(400);
    harness(on, { files: { [CLAUDE_MD]: bad, [`${SKILL}/SKILL.md`]: "# demo\n" }, dirs: SRC, standard: null });
    expect(notes(await write($, CLAUDE_MD, bad))).toBe("");
    expect(notes(await write($, `${SKILL}/references/a.md`, leaf))).toBe("");
  });

  test("a standard.json without a required key counts as unreadable", async ($, on) => {
    const { lineCap, ...rest } = STANDARD;
    const bad = "# CLAUDE.md\n\n## Anything\n";
    harness(on, { files: { [CLAUDE_MD]: bad }, dirs: SRC, standard: rest });
    expect(notes(await write($, CLAUDE_MD, bad))).toBe("");
  });

  test("a ## line inside a ``` fence is no heading; a name ends at the first (", async ($, on) => {
    const fenced = product().replace("## Harness\n", "```\n## Harness\n```\n");
    const named = product().replace("## Harness", "## Harness (pointer to the rules)");
    harness(on, { files: { [CLAUDE_MD]: fenced }, dirs: SRC });
    expect(notes(await write($, CLAUDE_MD, fenced))).toContain("missing or out of order: Harness");
    expect(notes(await write($, CLAUDE_MD, named))).toBe("");
  });

  test("required sections out of order are held, extra sections anywhere are not", async ($, on) => {
    const swapped = product().replace("## Hard Rules", "## TEMP").replace("## Harness", "## Hard Rules").replace("## TEMP", "## Harness");
    const extra = product().replace("## Harness", "## Commands\n\n## Harness") + "\n## Appendix\n";
    harness(on, { files: { [CLAUDE_MD]: swapped }, dirs: SRC });
    expect(notes(await write($, CLAUDE_MD, swapped))).toContain("required sections");
    expect(notes(await write($, CLAUDE_MD, extra))).toBe("");
  });

  test("a class repo needs Layout, Harness, Hard Rules, Working Method", async ($, on) => {
    const md = ["# CLAUDE.md", "", "## Layout", "", "## Brand Voice", "", "## Harness", "", "## Hard Rules", "", "## Working Method", ""].join("\n");
    harness(on, { files: { [CLAUDE_MD]: md }, dirs: { [`${R}/demos`]: [], [`${R}/labs`]: [] } });
    expect(notes(await write($, CLAUDE_MD, md))).toBe("");
    const n = notes(await write($, CLAUDE_MD, product()));
    expect(n).toContain("class repo");
    expect(n).toContain("missing or out of order: Layout");
  });

  test("src folders on disk and names in the file must agree", async ($, on) => {
    const md = product().replace("src/app holds the app.", "src/app and src/gone hold the apps.");
    harness(on, { files: { [CLAUDE_MD]: md }, dirs: { [`${R}/src`]: [{ name: "app", kind: "dir" }, { name: "worker", kind: "dir" }], [`${R}/src/app`]: [] } });
    const n = notes(await write($, CLAUDE_MD, md));
    expect(n).toContain("src drift");
    expect(n).toContain("On disk but not named in CLAUDE.md: worker");
    expect(n).toContain("Named in CLAUDE.md but not on disk: gone");
  });

  test("dev commands are an inventory", async ($, on) => {
    const md = product(["- Run `dotnet test` before done.", ""]);
    harness(on, { files: { [CLAUDE_MD]: md }, dirs: SRC });
    expect(notes(await write($, CLAUDE_MD, md))).toContain("inventory");
  });

  test("nested and global CLAUDE.md files are never checked", async ($, on) => {
    const bad = "# CLAUDE.md\n\n## Anything\n";
    harness(on, { files: { [`${ROOT}\\src\\app\\CLAUDE.md`]: bad, ["C:\\Users\\u\\.claude\\CLAUDE.md"]: bad }, dirs: SRC });
    expect(notes(await write($, `${ROOT}\\src\\app\\CLAUDE.md`, bad))).toBe("");
    expect(notes(await write($, "C:\\Users\\u\\.claude\\CLAUDE.md", bad))).toBe("");
  });

  const CLASS_DIRS = { [`${R}/demos`]: [], [`${R}/labs`]: [] };
  const agents = (extra: string[] = []) => ["# AGENTS.md", "", "## Layout", "", "## Harness", "", "## Hard Rules", "", ...extra, "## Working Method", ""].join("\n");
  const importer = "# CLAUDE.md\n\n@AGENTS.md\n";

  test("an @AGENTS.md import carries the sections of a class repo", async ($, on) => {
    harness(on, { files: { [CLAUDE_MD]: importer, [`${R}/AGENTS.md`]: agents() }, dirs: CLASS_DIRS });
    expect(notes(await write($, CLAUDE_MD, importer))).toBe("");
  });

  test("a class AGENTS.md with Harness and Working Method after the import passes; without Harness it is held", async ($, on) => {
    const portable = ["# AGENTS.md", "", "## Layout", "", "## Brand Voice", "", "## Hard Rules", ""].join("\n");
    const root = "# CLAUDE.md\n\n@AGENTS.md\n\n## Harness\n\n## Working Method\n";
    const noHarness = "# CLAUDE.md\n\n@AGENTS.md\n\n## Working Method\n";
    harness(on, { files: { [CLAUDE_MD]: root, [`${R}/AGENTS.md`]: portable }, dirs: CLASS_DIRS });
    expect(notes(await write($, CLAUDE_MD, root))).toBe("");
    expect(notes(await write($, CLAUDE_MD, noHarness))).toContain("missing or out of order: Harness");
  });

  test("a section missing from the imported file is named", async ($, on) => {
    harness(on, { files: { [CLAUDE_MD]: importer, [`${R}/AGENTS.md`]: agents().replace("## Harness\n", "") }, dirs: CLASS_DIRS });
    expect(notes(await write($, CLAUDE_MD, importer))).toContain("missing or out of order: Harness");
  });

  test("the src drift scan reads the imported file", async ($, on) => {
    const imported = agents(["src/app holds the demo host.", ""]);
    harness(on, { files: { [CLAUDE_MD]: importer, [`${R}/AGENTS.md`]: imported }, dirs: { ...CLASS_DIRS, ...SRC } });
    expect(notes(await write($, CLAUDE_MD, importer))).toBe("");
  });

  test("the line cap counts the root file only", async ($, on) => {
    const long = agents(Array.from({ length: 200 }, (_, i) => `- rule ${i}`));
    const longRoot = importer + Array.from({ length: 120 }, (_, i) => `- note ${i}`).join("\n") + "\n";
    harness(on, { files: { [CLAUDE_MD]: importer, [`${R}/AGENTS.md`]: long }, dirs: CLASS_DIRS });
    expect(notes(await write($, CLAUDE_MD, importer))).toBe("");
    expect(notes(await write($, CLAUDE_MD, longRoot))).toContain("line cap");
  });

  test("an import outside the repo root, absolute or missing is not expanded", async ($, on) => {
    const outside = "# CLAUDE.md\n\n@../shared/AGENTS.md\n";
    const absolute = "# CLAUDE.md\n\n@D:/work/repo/AGENTS.md\n";
    const missing = "# CLAUDE.md\n\n@NOPE.md\n";
    harness(on, { files: { [CLAUDE_MD]: outside, [`${R}/AGENTS.md`]: agents(), ["D:/work/shared/AGENTS.md"]: agents() }, dirs: CLASS_DIRS });
    expect(notes(await write($, CLAUDE_MD, outside))).toContain("required sections");
    expect(notes(await write($, CLAUDE_MD, absolute))).toContain("required sections");
    expect(notes(await write($, CLAUDE_MD, missing))).toContain("required sections");
  });
});

describe("harness-guard: skill leaves", () => {
  const router = "# demo\n\n| Q | [`references/a.md`](references/a.md) |\n";

  test("a leaf over 275 lines must be split or dissolved", async ($, on) => {
    const leaf = "# a\n" + "line\n".repeat(280);
    harness(on, { files: { [`${SKILL}/SKILL.md`]: router, [`${SKILL}/references/a.md`]: leaf } });
    expect(notes(await write($, `${SKILL}/references/a.md`, leaf))).toContain("SPLIT or a DISSOLVE");
  });

  test("a playbook may run to 400 lines", async ($, on) => {
    const steps = ["## Step 1. Go", "## Step 2. On", "## Step 3. Done"].join("\n");
    const ok = `# a\n${steps}\n` + "line\n".repeat(300);
    const long = `# a\n${steps}\n` + "line\n".repeat(400);
    harness(on, { files: { [`${SKILL}/SKILL.md`]: router, [`${SKILL}/references/a.md`]: ok } });
    expect(notes(await write($, `${SKILL}/references/a.md`, ok))).toBe("");
    expect(notes(await write($, `${SKILL}/references/a.md`, long))).toContain("PLAYBOOK");
  });

  test("a leaf without a router row is unreachable", async ($, on) => {
    harness(on, { files: { [`${SKILL}/SKILL.md`]: router, [`${SKILL}/references/a.md`]: "x\n", [`${SKILL}/references/b.md`]: "x\n" } });
    expect(notes(await write($, `${SKILL}/references/b.md`, "x\n"))).toContain("has no row in demo/SKILL.md");
  });

  test("a router row to a missing leaf is a dead edge", async ($, on) => {
    const dead = router + "| R | [`references/gone.md`](references/gone.md) |\n";
    harness(on, { files: { [`${SKILL}/SKILL.md`]: dead, [`${SKILL}/references/a.md`]: "x\n" } });
    expect(notes(await write($, `${SKILL}/references/a.md`, "x\n"))).toContain("routes to leaves that do not exist: references/gone.md");
  });

  test("H2 lines inside a ``` fence do not count as sections", async ($, on) => {
    const fenced = "# a\n```\n" + Array.from({ length: 20 }, (_, i) => `## Example ${i}`).join("\n") + "\n```\n";
    const real = "# a\n" + Array.from({ length: 13 }, (_, i) => `## Topic ${i}`).join("\n") + "\n";
    harness(on, { files: { [`${SKILL}/SKILL.md`]: router, [`${SKILL}/references/a.md`]: fenced } });
    expect(notes(await write($, `${SKILL}/references/a.md`, fenced))).toBe("");
    expect(notes(await write($, `${SKILL}/references/a.md`, real))).toContain("13 H2 sections");
  });

  test("the leaf caps come from standard.json", async ($, on) => {
    const std = { ...STANDARD, leaf: { lines: 5, sections: 12, playbookLines: 400 } };
    harness(on, { files: { [`${SKILL}/SKILL.md`]: router, [`${SKILL}/references/a.md`]: "x\n" }, standard: std });
    expect(notes(await write($, `${SKILL}/references/a.md`, "line\n".repeat(6)))).toContain("caps: 5 lines");
  });

  test("skill leaves of plugin sources are guarded; a skills folder elsewhere is not", async ($, on) => {
    const plugin = `${R}/plugins/p/skills/demo`;
    const other = `${R}/docs/skills/demo`;
    const leaf = "# a\n" + "line\n".repeat(280);
    harness(on, { files: { [`${plugin}/SKILL.md`]: router, [`${other}/SKILL.md`]: router } });
    expect(notes(await write($, `${plugin}/references/a.md`, leaf))).toContain("SPLIT or a DISSOLVE");
    expect(notes(await write($, `${other}/references/a.md`, leaf))).toBe("");
  });

  test("a nested leaf is routed by its path under references/", async ($, on) => {
    const nested = "# demo\n\n| Q | [`references/sub/b.md`](references/sub/b.md) |\n";
    const basename = "# demo\n\n| Q | [`references/b.md`](references/b.md) |\n";
    harness(on, { files: { [`${SKILL}/SKILL.md`]: nested, [`${SKILL}/references/b.md`]: "x\n" } });
    expect(notes(await write($, `${SKILL}/references/sub/b.md`, "x\n"))).toBe("");
    await write($, `${SKILL}/SKILL.md`, basename);
    expect(notes(await write($, `${SKILL}/references/sub/b.md`, "x\n"))).toContain("sub/b.md has no row in demo/SKILL.md");
    await write($, `${SKILL}/SKILL.md`, nested + "| R | [`references/sub/gone.md`](references/sub/gone.md) |\n");
    expect(notes(await write($, `${SKILL}/references/sub/b.md`, "x\n"))).toContain("routes to leaves that do not exist: references/sub/gone.md");
  });
});

describe("harness-guard: kill switch and steering", () => {
  test("AGENT_STOP halts every tool call with its contents", async ($, on) => {
    const { ran } = harness(on, { files: { [`${R}/AGENT_STOP`]: "deploy window\n" } });
    const r = (await $.tool.call({ tool: "Bash", command: "rm AGENT_STOP" } as any)) as any;
    expect(r.deny).toContain("Kill switch engaged");
    expect(r.deny).toContain("Contents: deploy window");
    expect(ran).toEqual([]);
  });

  test("an empty AGENT_STOP still halts, with no reason given", async ($, on) => {
    harness(on, { files: { [`${R}/AGENT_STOP`]: "" } });
    expect(((await $.tool.call({ tool: "Read", file_path: "x" } as any)) as any).deny).toContain("no reason given");
  });

  test("STEER.md is delivered once and cleared", async ($, on) => {
    const { files, ran } = harness(on, { files: { [`${R}/STEER.md`]: "switch to the API first\n" } });
    const first = (await $.tool.call({ tool: "Read", file_path: "x" } as any)) as any;
    expect(first.deny).toContain("OPERATOR STEERING");
    expect(first.deny).toContain("switch to the API first");
    expect(files[`${R}/STEER.md`]).toBe("");
    const second = (await $.tool.call({ tool: "Read", file_path: "x" } as any)) as any;
    expect(second.deny).toBeUndefined();
    expect(ran).toEqual(["Read"]);
  });

  test("a subagent's call never consumes STEER.md; the next main-thread call gets it", async ($, on) => {
    const { files, ran } = harness(on, { files: { [`${R}/STEER.md`]: "switch to the API first\n" } });
    const sub = (await $.tool.call({ tool: "Read", file_path: "x", agentId: "w1" } as any)) as any;
    expect(sub.deny).toBeUndefined();
    expect(files[`${R}/STEER.md`]).toBe("switch to the API first\n");
    const main = (await $.tool.call({ tool: "Read", file_path: "x" } as any)) as any;
    expect(main.deny).toContain("switch to the API first");
    expect(ran).toEqual(["Read"]);
  });

  test("AGENT_STOP halts a subagent's call too", async ($, on) => {
    const { ran } = harness(on, { files: { [`${R}/AGENT_STOP`]: "deploy window\n" } });
    const r = (await $.tool.call({ tool: "Read", file_path: "x", agentId: "w1" } as any)) as any;
    expect(r.deny).toContain("Kill switch engaged");
    expect(ran).toEqual([]);
  });
});

describe("harness-guard: verification gate", () => {
  const SRC_FILE = `${ROOT}\\src\\app\\Program.cs`;

  test("off by default: a source edit never holds the stop", async ($, on) => {
    harness(on, { files: { [SRC_FILE]: "x" } });
    await start($);
    await edit($, SRC_FILE);
    expect((await stop($)).block).toBeUndefined();
  });

  test("on: a source edit without a reviewer receipt holds the stop", async ($, on) => {
    harness(on, { files: { [SRC_FILE]: "x" }, env: { HARNESS_VERIFICATION_GATE: "1" } });
    await start($);
    await edit($, SRC_FILE);
    const r = await stop($);
    expect(r.block).toContain("No receipt from the verification-reviewer subagent");
    expect(r.block).toContain(".claude/verification/s1.md");
    expect(r.block).toContain("subagent_type harness:verification-reviewer");
    expect(r.block).toContain("write the receipt with the Write tool");
  });

  test("on: a subagent's source edit holds the stop too", async ($, on) => {
    harness(on, { files: { [SRC_FILE]: "x" }, env: { HARNESS_VERIFICATION_GATE: "1" } });
    await start($);
    await spawn($, "general-purpose");
    await write($, SRC_FILE, "y", "w1");
    const r = await stop($);
    expect(r.block).toContain("No receipt");
    expect(r.block).toContain("D:/work/repo/src/app/Program.cs");
  });

  test("on: the reviewer's own writes never arm the gate", async ($, on) => {
    harness(on, { files: { [SRC_FILE]: "x" }, env: { HARNESS_VERIFICATION_GATE: "1" } });
    await start($);
    await spawn($, "harness:verification-reviewer");
    await write($, SRC_FILE, "y", "r1");
    expect((await stop($)).block).toBeUndefined();
  });

  test("on: a subagent's source edit after the receipt makes it stale", async ($, on) => {
    const RECEIPT = `${R}/.claude/verification/s1.md`;
    harness(on, { files: { [SRC_FILE]: "x" }, env: { HARNESS_VERIFICATION_GATE: "1" }, mtimes: { [RECEIPT]: 2000, [SRC_FILE]: 3000 } });
    await start($);
    await spawn($, "harness:verification-reviewer");
    await write($, RECEIPT, "$ dotnet test\nResult: pass\n", "r1");
    await spawn($, "general-purpose");
    await write($, SRC_FILE, "y", "w1");
    expect((await stop($)).block).toContain("stale or incomplete");
  });

  test("on: a receipt the main thread wrote itself does not count", async ($, on) => {
    harness(on, { files: { [SRC_FILE]: "x" }, env: { HARNESS_VERIFICATION_GATE: "1" }, mtimes: { [SRC_FILE]: 1000 } });
    await start($);
    await edit($, SRC_FILE);
    await write($, `${R}/.claude/verification/s1.md`, "$ dotnet test\nResult: pass\n");
    expect((await stop($)).block).toContain("No receipt");
  });

  test("on: a fresh reviewer receipt with command and result lets it end", async ($, on) => {
    harness(on, { files: { [SRC_FILE]: "x" }, env: { HARNESS_VERIFICATION_GATE: "1" }, mtimes: { [SRC_FILE]: 1000, [`${R}/.claude/verification/s1.md`]: 2000 } });
    await start($);
    await edit($, SRC_FILE);
    await spawn($, "harness:verification-reviewer");
    await write($, `${R}/.claude/verification/s1.md`, "$ dotnet test\nResult: pass\n", "r1");
    expect((await stop($)).block).toBeUndefined();
  });

  test("on: a reviewer receipt without a result line is incomplete", async ($, on) => {
    harness(on, { files: { [SRC_FILE]: "x" }, env: { HARNESS_VERIFICATION_GATE: "1" }, mtimes: { [SRC_FILE]: 1000, [`${R}/.claude/verification/s1.md`]: 2000 } });
    await start($);
    await edit($, SRC_FILE);
    await spawn($, "harness:verification-reviewer");
    await write($, `${R}/.claude/verification/s1.md`, "$ dotnet test\n", "r1");
    expect((await stop($)).block).toContain("stale or incomplete");
  });

  test("on: docs and generated output never arm the gate", async ($, on) => {
    harness(on, { files: { [`${ROOT}\\README.md`]: "x", [`${ROOT}\\src\\app\\bin\\Debug\\x.json`]: "x" }, env: { HARNESS_VERIFICATION_GATE: "1" } });
    await start($);
    await edit($, `${ROOT}\\README.md`);
    await edit($, `${ROOT}\\src\\app\\bin\\Debug\\x.json`);
    expect((await stop($)).block).toBeUndefined();
  });
});
