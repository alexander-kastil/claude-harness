import { describe, expect, test } from "claude-code/testing";
import { registerMentions } from "../hooks/harness-mentions.mjs";

const ROOT = "D:/git-projects/claude-harness/plugins/harness";

const script = (argv: string[]) => argv.slice(2);

function handlers() {
  const map: Record<string, any> = {};
  registerMentions((event: string, ...rest: any[]) => {
    map[event] = rest.find((x) => typeof x === "function");
    return {};
  });
  return map;
}

function fakeProcess(reply: any) {
  const calls: { argv: string[]; init: any }[] = [];
  const $ = {
    plugin: { root: ROOT },
    process: {
      run: async (argv: string[], init: any) => {
        calls.push({ argv, init });
        if (reply instanceof Error) throw reply;
        return { exitCode: reply.exitCode ?? 0, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "", isStdoutTruncated: false, isStderrTruncated: false };
      },
    },
  };
  return { $, calls };
}

const base = [{ text: "x" }];
const next = async () => ({ suggestions: base });
const ask = (text: string, cursor = text.length) => ({ text, cursor, token: text.slice(text.lastIndexOf(" ") + 1, cursor), start: text.lastIndexOf(" ") + 1 });

describe("harness-mentions: @harness mentions", () => {
  test("from @h on, the views are offered after the engine's rows; a bare @ is left alone", async () => {
    const h = handlers();
    const { $, calls } = fakeProcess({ stdout: "[]" });
    const all = await h["prompt.autocomplete"]($, ask("why @h"), next);
    expect(all.suggestions[0]).toBe(base[0]);
    expect(all.suggestions.slice(1).map((s: any) => s.text)).toEqual(["@harness:inventory", "@harness:consolidate", "@harness:agents", "@harness:usage", "@harness:delegation", "@harness:hunt", "@harness:marketplaces", "@harness:check", "@harness:repos", "@harness:sync", "@harness:sessions", "@harness:session-analyze", "@harness:mods", "@harness:time", "@harness:lessons", "@harness:sources"]);
    const some = await h["prompt.autocomplete"]($, ask("@harness:u"), next);
    expect(some.suggestions.slice(1).map((s: any) => s.text)).toEqual(["@harness:usage"]);
    const bare = await h["prompt.autocomplete"]($, ask("look at @"), next);
    expect(bare.suggestions).toBe(base);
    expect(calls.length).toBe(0);
  });

  test("a token that is no mention is left untouched", async () => {
    const h = handlers();
    const { $ } = fakeProcess({ stdout: "[]" });
    const r = await h["prompt.autocomplete"]($, ask("harness"), next);
    expect(r.suggestions).toBe(base);
  });

  test("on send each mention runs once and its output is added as context; the text stays", async () => {
    const h = handlers();
    const { $, calls } = fakeProcess({ stdout: "**Usage**\n| Model | Cost |\n" });
    let seen: any;
    await h["prompt.submit"]($, { text: "why so expensive? @harness:usage and @harness:usage.", context: ["earlier"] }, async (e: any) => ((seen = e), e));
    expect(calls.length).toBe(1);
    expect(calls[0].argv[0]).toBe("node");
    expect(calls[0].argv[1].endsWith("skills/cli/scripts/harness.mjs")).toBe(true);
    expect(script(calls[0].argv)).toEqual(["usage", "--session", "latest"]);
    expect(seen.text).toBe("why so expensive? @harness:usage and @harness:usage.");
    expect(seen.context[0]).toBe("earlier");
    expect(seen.context[1]).toBe("@harness:usage (claude-harness usage --session latest):\n**Usage**\n| Model | Cost |");
  });

  test("@harness:session-analyze opens the session it was typed in and adds one line", async () => {
    const h = handlers();
    const { $, calls } = fakeProcess({ stdout: 'Opened session "x" in the Claude Harness panel.\n' });
    let seen: any;
    await h["prompt.submit"]({ ...$, session: { id: async () => "abc-123" } }, { text: "@harness:session-analyze please" }, async (e: any) => ((seen = e), e));
    expect(script(calls[0].argv)).toEqual(["sessions", "open", "--session", "abc-123"]);
    expect(seen.context[0]).toBe('@harness:session-analyze: Opened session "x" in the Claude Harness panel.');
    const again = fakeProcess({ stdout: "" });
    await h["prompt.submit"](again.$, { text: "@harness:session-analyze", session_id: "from-event" }, async (e: any) => e);
    expect(script(again.calls[0].argv)).toEqual(["sessions", "open", "--session", "from-event"]);
  });

  test("a failed view adds stderr after stdout, prefixed", async () => {
    const h = handlers();
    const { $ } = fakeProcess({ exitCode: 1, stdout: "", stderr: "no session\n" });
    let seen: any;
    await h["prompt.submit"]($, { text: "@harness:delegation" }, async (e: any) => ((seen = e), e));
    expect(seen.context[0]).toBe("@harness:delegation (claude-harness delegation --session latest):\nharness: no session");
  });

  test("a view that cannot start is named in the context", async () => {
    const h = handlers();
    const { $ } = fakeProcess(new Error("spawn node ENOENT"));
    let seen: any;
    await h["prompt.submit"]($, { text: "@harness:inventory" }, async (e: any) => ((seen = e), e));
    expect(seen.context[0]).toBe("@harness:inventory: harness: spawn node ENOENT");
  });

  test("an unknown view is named in the context and runs nothing", async () => {
    const h = handlers();
    const { $, calls } = fakeProcess({ stdout: "" });
    let seen: any;
    await h["prompt.submit"]($, { text: "@harness:nope" }, async (e: any) => ((seen = e), e));
    expect(calls.length).toBe(0);
    expect(seen.context[0]).toContain("@harness:nope is not a harness view");
  });

  test("a prompt without a mention, a slash command or a meta prompt passes untouched", async () => {
    const h = handlers();
    const { $, calls } = fakeProcess({ stdout: "x" });
    const e1 = { text: "mail me@harness:usage" };
    const e2 = { text: "@harness:usage", command: { name: "x" } };
    const e3 = { text: "@harness:usage", isMeta: true };
    for (const e of [e1, e2, e3]) expect(await h["prompt.submit"]($, e, async (x: any) => x)).toBe(e);
    expect(calls.length).toBe(0);
  });
});
