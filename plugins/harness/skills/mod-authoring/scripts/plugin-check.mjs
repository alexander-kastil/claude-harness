#!/usr/bin/env node
// plugin-check.mjs: runs `claude plugin test <dir>` and `claude plugin validate <dir>` on one plugin
// folder and reduces both to a single summary line. Both commands only read the plugin; nothing is
// written, so there is no --dry-run and "applied" is always false.

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const USAGE = `Usage: node plugin-check.mjs --dir <plugin folder> [--skip-test] [--skip-validate] [--json]

Runs \`claude plugin test <dir>\` and \`claude plugin validate <dir>\` and ends with one summary line:
  tests=<N> pass=<n> fail=<n> validate=ok|errors=<N> first_error=<text>

Flags:
  --dir <path>      plugin folder (required)
  --skip-test       do not run the tests
  --skip-validate   do not run the validator
  --json            print one result object (single line) instead of text
  --help            print this help and exit 0

Read-only: nothing is written; "applied" is always false.
Exit: 0 every selected check passed, 1 a check failed or could not run, 2 bad arguments.
`;

const TEST_TIMEOUT_MS = 600000;

function badArgs(msg) {
  process.stderr.write(`plugin-check: ${msg}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { dir: null, skipTest: false, skipValidate: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (a === "--dir") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) badArgs("--dir needs a plugin folder");
      opts.dir = v;
    } else if (a === "--skip-test") opts.skipTest = true;
    else if (a === "--skip-validate") opts.skipValidate = true;
    else if (a === "--json") opts.json = true;
    else badArgs(`unknown argument ${a}`);
  }
  if (!opts.dir) badArgs("--dir is required");
  if (opts.skipTest && opts.skipValidate) badArgs("nothing to do: both checks are skipped");
  opts.dir = resolve(opts.dir);
  let isDir = false;
  try {
    isDir = statSync(opts.dir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) badArgs(`not a plugin folder: ${opts.dir}`);
  return opts;
}

// Runs the claude CLI with an argument array (no shell). Stdout and stderr are both kept.
function runClaude(args) {
  const r = spawnSync("claude", args, {
    encoding: "utf8",
    timeout: TEST_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { status: r.status, error: r.error ? r.error.message : null, out };
}

function firstMatchingLine(text, needle) {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && l.includes(needle));
  return line ?? null;
}

function checkTests(dir) {
  const r = runClaude(["plugin", "test", dir]);
  const base = { status: "error", ran: null, pass: null, fail: null, failed: [], detail: null };
  if (r.error) return { ...base, detail: `claude could not run: ${r.error}` };
  const count = (re) => {
    const m = r.out.match(re);
    return m ? Number(m[1]) : null;
  };
  const pass = count(/^\s*(\d+) pass\s*$/m);
  const fail = count(/^\s*(\d+) fail\s*$/m);
  const ran = count(/Ran (\d+) tests?\b/);
  const failed = [...r.out.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?\s*$/gm)].map((m) => m[1]);
  if (pass === null || fail === null) {
    const detail = firstMatchingLine(r.out, "claude plugin test:") ?? r.out.trim().split(/\r?\n/).pop() ?? "no output";
    return { ...base, detail: detail.slice(0, 300) };
  }
  if (r.status === 0 && fail === 0) return { status: "pass", ran: ran ?? pass, pass, fail, failed, detail: null };
  if (fail > 0) return { status: "fail", ran: ran ?? pass + fail, pass, fail, failed, detail: null };
  // Exit code non-zero with no failing assertion: the run itself went wrong.
  const detail = firstMatchingLine(r.out, "claude plugin test:") ?? `exit ${r.status}`;
  return { status: "error", ran: ran ?? pass, pass, fail, failed, detail: detail.slice(0, 300) };
}

function checkValidate(dir) {
  const r = runClaude(["plugin", "validate", dir]);
  if (r.error) {
    return { status: "errors", errors: 1, passed_with_warnings: false, first_error: `claude could not run: ${r.error}` };
  }
  const passed = /Validation passed/.test(r.out) && r.status === 0;
  if (passed) {
    return {
      status: "ok",
      errors: 0,
      passed_with_warnings: /Validation passed with warnings/.test(r.out),
      first_error: null,
    };
  }
  const found = r.out.match(/Found (\d+) errors?:/);
  const errors = found ? Number(found[1]) : 1;
  // Errors are the "❯" lines that follow the "Found N error" header; later "❯" lines are notes.
  let firstError = null;
  if (found) {
    const after = r.out.slice(found.index + found[0].length);
    const line = after.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("❯"));
    if (line) firstError = line.replace(/^❯\s*/, "");
  }
  if (!firstError) {
    firstError = r.out.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^[✔✘]/.test(l)) ?? `exit ${r.status}`;
  }
  return { status: "errors", errors, passed_with_warnings: false, first_error: firstError.slice(0, 300) };
}

function summaryLine(tests, validate, opts) {
  let testPart;
  if (opts.skipTest) testPart = "tests=skipped pass=- fail=-";
  else testPart = `tests=${tests.ran ?? "-"} pass=${tests.pass ?? "-"} fail=${tests.fail ?? "-"}`;
  let validatePart;
  if (opts.skipValidate) validatePart = "validate=skipped";
  else if (validate.status === "ok") validatePart = "validate=ok";
  else validatePart = `validate=errors=${validate.errors} first_error=${validate.first_error}`;
  // The summary's first_error follows the validator; a test problem is named only when the validator is clean.
  if (!opts.skipTest && tests.status !== "pass" && (opts.skipValidate || validate.status === "ok")) {
    const detail = tests.status === "fail" ? `test: ${tests.failed[0] ?? "failing test"}` : `test: ${tests.detail}`;
    return `${testPart} ${validatePart} first_error=${detail}`;
  }
  return `${testPart} ${validatePart}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tests = opts.skipTest
    ? { status: "skipped", ran: null, pass: null, fail: null, failed: [], detail: null }
    : checkTests(opts.dir);
  const validate = opts.skipValidate
    ? { status: "skipped", errors: 0, passed_with_warnings: false, first_error: null }
    : checkValidate(opts.dir);
  const testOk = opts.skipTest || tests.status === "pass";
  const validateOk = opts.skipValidate || validate.status === "ok";
  const ok = testOk && validateOk;
  const summary = summaryLine(tests, validate, opts);

  if (opts.json) {
    const result = {
      script: "plugin-check",
      dir: opts.dir,
      applied: false,
      ok,
      tests,
      validate,
      summary,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    for (const name of tests.failed ?? []) process.stdout.write(`FAIL ${name}\n`);
    if (!opts.skipTest && tests.status === "error") process.stdout.write(`ERROR tests: ${tests.detail}\n`);
    if (!opts.skipValidate && validate.status === "errors") process.stdout.write(`ERROR validate: ${validate.first_error}\n`);
    process.stdout.write(`${summary}\n`);
  }
  process.exit(ok ? 0 : 1);
}

main();
