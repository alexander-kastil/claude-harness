import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { digestOf, externalHost, findSessions, parsePeriod, periodInMessage, sessionsSection } from '../../src/automation-sessions';
import { run } from '../../src/cli';

const line = (o: object) => JSON.stringify(o);
const call = (name: string, input: object, text?: string) => line({ type: 'assistant', message: { role: 'assistant', content: [...(text ? [{ type: 'text', text }] : []), { type: 'tool_use', id: 't', name, input }] } });

/** A Claude root with one session that used an external page and a desktop app, one that only used localhost, and the Cowork data folder empty. */
function world(when: number) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-sessions-'));
  const root = path.join(home, '.claude');
  const project = path.join(root, 'projects', 'D--demo');
  fs.mkdirSync(path.join(project, 'sess-a', 'subagents'), { recursive: true });
  const a = path.join(project, 'sess-a.jsonl');
  fs.writeFileSync(a, [
    line({ type: 'user', cwd: 'D:/demo', message: { role: 'user', content: 'Set the DNS record of example.com at IONOS' } }),
    // A tool list names every tool and is not a call.
    line({ type: 'attachment', tools: [{ type: 'tool_use', name: 'mcp__claude-in-chrome__navigate' }] }),
    call('mcp__claude-in-chrome__navigate', { url: 'https://dcp.ionos.com/domains', tabId: 7 }, 'Opening the registrar.'),
    call('mcp__claude-in-chrome__navigate', { url: 'http://localhost:4200/home' }),
    call('mcp__claude-in-chrome__navigate', { url: 'file:///C:/x.html' }),
    call('mcp__claude-in-chrome__computer', { action: 'left_click', coordinate: [10, 20] }),
    call('mcp__computer-use__left_click', { coordinate: [1, 2], text: 'Allow' }),
    '',
  ].join('\n'));
  // The subagent's transcript counts for its parent session.
  fs.writeFileSync(path.join(project, 'sess-a', 'subagents', 'agent-1.jsonl'), `${call('mcp__chrome-devtools__navigate_page', { url: 'https://dcp.ionos.com/dns' })}\n`);
  fs.writeFileSync(path.join(project, 'sess-b.jsonl'), `${line({ type: 'user', message: { role: 'user', content: 'Test my app' } })}\n${call('mcp__playwright__browser_navigate', { url: 'http://127.0.0.1:3000/' })}\n${call('mcp__claude-in-chrome__navigate', { url: 'about:blank' })}\n`);
  for (const f of [a, path.join(project, 'sess-a', 'subagents', 'agent-1.jsonl'), path.join(project, 'sess-b.jsonl')]) fs.utimesSync(f, when / 1000, when / 1000);
  const data = path.join(home, 'LocalAppData');
  fs.mkdirSync(data);
  process.env.CLAUDE_HARNESS_LOCALAPPDATA = data;
  return { root, data };
}

test('only an assistant call to an external page or a desktop tool counts; a tool list, localhost, file: and about: do not', async () => {
  const w = world(Date.now());
  const found = await findSessions({ root: w.root, dataRoot: w.data });
  assert.equal(found.length, 1);
  const c = found[0];
  assert.equal(c.id, 'sess-a');
  assert.equal(c.source, 'code');
  assert.equal(c.title, 'Set the DNS record of example.com at IONOS');
  assert.equal(c.cwd, 'D:/demo');
  assert.equal(c.browser, 2, 'the navigate and the subagent navigate');
  assert.equal(c.desktop, 1);
  assert.deepEqual(c.hosts, [['dcp.ionos.com', 2]]);
  const digest = await digestOf(c);
  assert.match(digest, /Set the DNS record of example\.com at IONOS/);
  assert.match(digest, /Claude: Opening the registrar\./);
  assert.match(digest, /claude-in-chrome__navigate \{"url":"https:\/\/dcp\.ionos\.com\/domains"\}/);
  assert.ok(!/tabId|coordinate/.test(digest), 'tab and pointer details are left out');
  assert.match(await sessionsSection(undefined, found), /^## Sessions with browser or desktop use \(all time\)\n\n\| Date/);
});

test('externalHost: http(s) pages that are not this PC', () => {
  assert.equal(externalHost('https://Console.Cloud.Google.com/x'), 'console.cloud.google.com');
  for (const url of ['http://localhost:3000', 'http://127.0.0.1/', 'http://0.0.0.0:80', 'http://[::1]:8080/', 'file:///a', 'about:blank', 'chrome://settings', 'data:text/html,x', 'devtools://devtools/x', 'vscode://file/x', undefined, 'not a url']) assert.equal(externalHost(url), undefined, String(url));
});

test('periods: this week from Monday, last week is week 1, week N counts calendar weeks back', () => {
  // Wednesday 2026-10-28, local time.
  const now = new Date(2026, 9, 28, 12).getTime();
  const at = (m: number, d: number) => new Date(2026, m, d).getTime();
  assert.deepEqual(parsePeriod('This Week', now), { label: 'this week', from: at(9, 26), to: at(10, 2) });
  const last = parsePeriod('last week', now)!;
  assert.deepEqual(last, { label: 'last week', from: at(9, 19), to: at(9, 26) });
  assert.deepEqual({ ...parsePeriod('week 1', now)!, label: 'last week' }, last);
  assert.deepEqual(parsePeriod('week  2', now), { label: 'week 2', from: at(9, 12), to: at(9, 19) });
  assert.equal(parsePeriod('yesterday', now), undefined);
  assert.equal(parsePeriod('week x', now), undefined);
  // A chat message asks for sessions with a period phrase or "my sessions"; anything else asks for none.
  assert.equal(periodInMessage('Hunt week 2 please', now).period?.from, at(9, 12));
  assert.equal(periodInMessage('what did I do last week?', now).period?.label, 'last week');
  assert.deepEqual(periodInMessage('look at my sessions', now), { asked: true, period: undefined });
  assert.deepEqual(periodInMessage('Write the steps for IONOS', now), { asked: false, period: undefined });
});

test('the period keeps the sessions whose last activity is inside it', async () => {
  const now = Date.now();
  const last = parsePeriod('last week', now)!;
  const w = world(last.from + 3600_000);
  assert.equal((await findSessions({ root: w.root, dataRoot: w.data, period: last })).length, 1);
  assert.equal((await findSessions({ root: w.root, dataRoot: w.data, period: parsePeriod('this week', now)! })).length, 0);
  assert.equal((await findSessions({ root: w.root, dataRoot: w.data, source: 'cowork' })).length, 0);
});

test('browser-hunt sessions: the table, the JSON shape and the Stop on a period it does not know', async () => {
  const last = parsePeriod('last week')!;
  const w = world(last.from + 3600_000);
  const cli = async (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['browser-hunt', 'sessions', ...argv, '--root', w.root], { out: t => out.push(t), err: t => err.push(t) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const text = await cli(['--period', 'week 1', '--source', 'code']);
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, /^\*\*Browser and desktop sessions: 1 \(last week\)\*\*/);
  assert.match(text.out, /\| Date +\| Source +\| Session +\| +Browser \| +Desktop \| Hosts +\|/);
  assert.match(text.out, /dcp\.ionos\.com \(2\)/);
  const o = JSON.parse((await cli(['--period', 'last week', '--json', '--digest'])).out);
  assert.deepEqual(Object.keys(o).sort(), ['applied', 'candidates', 'digests', 'from', 'period', 'to']);
  assert.equal(o.period, 'last week');
  assert.equal(o.from, last.from);
  assert.equal(o.to, last.to);
  assert.deepEqual(Object.keys(o.candidates[0]).sort(), ['browser', 'cwd', 'desktop', 'hosts', 'id', 'source', 'title', 'when']);
  assert.match(o.digests[0].text, /Prompts:/);
  assert.ok(!('digests' in JSON.parse((await cli(['--json'])).out)));
  const bad = await cli(['--period', 'yesterday']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--period takes this week, last week or week N/);
});
