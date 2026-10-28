import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { run } from '../../src/cli';

const tmp = (what: string) => fs.mkdtempSync(path.join(os.tmpdir(), `check-${what}-`));
const write = (root: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

async function cli(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: t => out.push(t), err: t => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

// The provider's check: a FAIL for a CLAUDE.md with OLD in it, a settings FAIL whenever .claude/settings.json exists, and a crash for a repo named broken.
const CHECK = `import json
import os
import sys

root = os.path.abspath(sys.argv[1])
if os.path.basename(root) == "broken":
    sys.stderr.write("the check crashed")
    sys.exit(3)
findings = [{"level": "INFO", "text": "INFO checked", "locations": []}]
claude = os.path.join(root, "CLAUDE.md")
if os.path.isfile(claude) and "OLD" in open(claude, encoding="utf-8").read():
    findings.append({"level": "FAIL", "code": "sections", "text": "FAIL sections out of order", "locations": [{"file": "CLAUDE.md", "line": 1}]})
if os.path.isfile(os.path.join(root, ".claude", "settings.json")):
    findings.append({"level": "FAIL", "code": "hooks", "text": "FAIL .claude/settings.json still wires kill-switch.sh", "locations": [{"file": ".claude/settings.json", "line": 2, "token": "kill-switch.sh"}]})
fails = sum(1 for f in findings if f["level"] == "FAIL")
print(json.dumps({"repo": os.path.basename(root), "kind": "product", "layout": "other", "metrics": {"lines": 1, "emDashes": 0}, "fail": fails, "review": 0, "findings": findings}))
`;

// The provider's fix: a dry run names the hooks it would unwire; --apply removes them from .claude/settings.json.
const FIX = `import json
import os
import sys

args = sys.argv[1:]
root = os.path.abspath(args[0])
settings = os.path.join(root, ".claude", "settings.json")
apply = "--apply" in args
log = []
if os.path.isfile(settings):
    data = json.load(open(settings, encoding="utf-8"))
    if "hooks" in data:
        log.append(".claude/settings.json: unwire hooks")
        if apply:
            del data["hooks"]
            with open(settings, "w", encoding="utf-8", newline="\\n") as f:
                json.dump(data, f, indent=2)
                f.write("\\n")
for line in log:
    print(line)
print(f"repo={os.path.basename(root)} changes={len(log)} {'applied' if apply else 'dry-run'}")
`;

const SETTINGS = JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'kill-switch.sh' }] }] }, theme: 'dark' }, null, 2);

/** A root with the harness standard installed, and three repos: alpha fails twice (one fixable), beta passes, broken has a check that crashes. */
function fixture() {
  const root = tmp('root');
  const plugin = path.join(tmp('plugin'), 'harness-plugin');
  write(plugin, '.claude-plugin/harness-standard.json', JSON.stringify({ name: 'test standard', check: 'check.py', fix: 'fix.py' }));
  write(plugin, 'check.py', CHECK);
  write(plugin, 'fix.py', FIX);
  write(root, 'plugins/installed_plugins.json', JSON.stringify({ plugins: { 'harness-plugin@claude-harness': [{ installPath: plugin, lastUpdated: '2026-10-28' }] } }));
  const repos = tmp('repos');
  const alpha = path.join(repos, 'alpha');
  const beta = path.join(repos, 'beta');
  const broken = path.join(repos, 'broken');
  write(alpha, 'CLAUDE.md', 'OLD layout\n');
  write(alpha, '.claude/settings.json', SETTINGS);
  write(beta, 'CLAUDE.md', 'Fine\n');
  write(broken, 'CLAUDE.md', 'Fine\n');
  return { root, alpha, beta, broken };
}

const repoArgs = (dirs: string[]) => dirs.flatMap(d => ['--repo', d]);

test('check lists each repo with its passed, failed and fixable counts, and exits 0 even when checks fail', async () => {
  const { root, alpha, beta, broken } = fixture();
  const r = await cli(['check', '--root', root, ...repoArgs([alpha, beta, broken]), '--json']);
  assert.equal(r.code, 0);
  const data = JSON.parse(r.out);
  assert.equal(data.applied, false);
  const [a, b, c] = data.repos;
  assert.deepEqual([a.repo, a.passed, a.failed, a.review, a.fixable, a.error], [alpha, false, 2, 0, 1, null]);
  assert.deepEqual([b.repo, b.passed, b.failed, b.fixable, b.error], [beta, true, 0, 0, null]);
  assert.equal(c.passed, false);
  assert.match(c.error, /the check crashed/);
  const fixable = data.failures.filter((f: { repo: string; fixable: boolean }) => f.repo === alpha).map((f: { check: string; fixable: boolean }) => [f.check, f.fixable]);
  assert.deepEqual(fixable, [
    ['sections', false],
    ['hooks', true],
  ]);
  assert.equal(data.failures.at(-1).check, 'check');
  assert.equal(data.failures.at(-1).fixable, false);
});

test('check in text prints a headline, the repo table and the failed-check table', async () => {
  const { root, alpha, beta } = fixture();
  const r = await cli(['check', '--root', root, ...repoArgs([alpha, beta])]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^\*\*Check · 2 repos · 2 failed checks\*\*/);
  assert.match(r.out, /\| Repo\s+\| Passed \| Failed \| Fixable \|/);
  assert.match(r.out, /\| alpha\s+\| no\s+\|\s+2 \|\s+1 \|/);
  assert.match(r.out, /\| beta\s+\| yes\s+\|\s+0 \|\s+0 \|/);
  assert.match(r.out, /\| alpha\s+\| hooks\s+\| \.claude\/settings\.json still wires kill-switch\.sh\s+\| yes\s+\|/);
});

test('check with no repos prints the (none) rows', async () => {
  const { root } = fixture();
  const userConfig = path.join(tmp('user'), '.claude.json');
  write(path.dirname(userConfig), '.claude.json', '{}');
  const r = await cli(['check', '--root', root, '--user-config', userConfig]);
  assert.equal(r.code, 0);
  assert.match(r.out, /\(none\)/);
  assert.match(r.out, /\*\*Check · 0 repos · 0 failed checks\*\*/);
});

test('check without an installed standard stops with the message that says so', async () => {
  const root = tmp('bare');
  const r = await cli(['check', '--root', root, '--repo', tmp('repo')]);
  assert.equal(r.code, 1);
  assert.match(r.err, /No harness standard provider plugin is installed/);
});

test('check fix --dry-run names each change and writes nothing', async () => {
  const { root, alpha, beta } = fixture();
  const before = read(alpha, '.claude/settings.json');
  const r = await cli(['check', 'fix', '--root', root, ...repoArgs([alpha, beta]), '--dry-run', '--json']);
  assert.equal(r.code, 0);
  const data = JSON.parse(r.out);
  assert.equal(data.applied, false);
  assert.deepEqual(data.repos.map((x: { repo: string }) => x.repo), [alpha]);
  assert.deepEqual(data.repos[0].changes, ['.claude/settings.json: unwire hooks']);
  assert.equal(data.repos[0].backup, null);
  assert.equal(read(alpha, '.claude/settings.json'), before);
  assert.equal(fs.existsSync(path.join(root, 'skill-sync-backups')), false);
  const text = (await cli(['check', 'fix', '--root', root, '--repo', alpha, '--dry-run'])).out;
  assert.match(text, /\*\*Check fix \(dry run\) · 1 repo · 1 change\*\*/);
  assert.match(text, /\[dry-run\] alpha: \.claude\/settings\.json: unwire hooks/);
});

test('check fix applies the fix after backing up the settings, and the backup keeps the old file', async () => {
  const { root, alpha, beta } = fixture();
  const r = await cli(['check', 'fix', '--root', root, ...repoArgs([alpha, beta]), '--json']);
  assert.equal(r.code, 0);
  const data = JSON.parse(r.out);
  assert.equal(data.applied, true);
  const backup = data.repos[0].backup as string;
  assert.ok(backup.startsWith(path.join(root, 'skill-sync-backups')), backup);
  assert.equal(fs.readFileSync(path.join(backup, '.claude', 'settings.json'), 'utf8'), SETTINGS);
  const after = JSON.parse(read(alpha, '.claude/settings.json'));
  assert.equal(after.hooks, undefined);
  assert.equal(after.theme, 'dark');
  assert.equal(read(beta, 'CLAUDE.md'), 'Fine\n');
});

test('check fix on a repo with nothing fixable does not touch it', async () => {
  const { root, beta } = fixture();
  const r = await cli(['check', 'fix', '--root', root, '--repo', beta, '--json']);
  assert.equal(r.code, 0);
  const data = JSON.parse(r.out);
  assert.deepEqual(data.repos, []);
  assert.equal(data.applied, false);
  assert.equal(fs.existsSync(path.join(root, 'skill-sync-backups')), false);
});

test('check with an unknown word stops with a bad-arguments code', async () => {
  const { root } = fixture();
  const r = await cli(['check', 'nope', '--root', root]);
  assert.equal(r.code, 2);
});
