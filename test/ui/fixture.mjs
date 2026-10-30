// Builds the scratch data the UI tests and a manual walk-through run against: a home with a global harness, four repos
// with their own assets, plugin skills and agents, a delegation mod, MCP servers, hooks, and sessions with agents and findings.
// Nothing here points at the real ~/.claude: the VS Code instance gets `<root>/home` as its home.
//
//   node test/ui/fixture.mjs <root>      builds <root>/home and <root>/repos, prints fixture=<root>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
const { projectSlug } = createRequire(import.meta.url)(path.join(repoRoot, 'out', 'src', 'repos-overview.js'));

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const json = (file, value) => write(file, JSON.stringify(value, null, 2));
const jsonl = (file, records) => write(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
const md = (file, data, body) =>
  write(file, `---\n${Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}\n`);

const SKILL_NAMES = [
  'api-design', 'azure-deploy', 'branch-hygiene', 'changelog', 'code-tour', 'commit-helper', 'db-migrate', 'dep-audit', 'docker-lint', 'e2e-playwright',
  'env-doctor', 'figma-handoff', 'git-bisect', 'hotfix', 'i18n-sync', 'incident-notes', 'jira-sync', 'k8s-debug', 'license-check', 'log-triage',
  'monorepo-graph', 'openapi-diff', 'perf-budget', 'pr-review', 'release-playbook', 'refactor-plan', 'secrets-scan', 'sql-review', 'test-matrix', 'ts-strict',
  'ui-audit', 'webhook-debug',
];

const skillBody = (name, lines = 14) =>
  `# ${name}\n\nUse this skill when the task is about ${name.replace(/-/g, ' ')}.\n\n## Steps\n\n` +
  Array.from({ length: lines }, (_, i) => `${i + 1}. Step ${i + 1} of ${name}: read the files, check the result, report what changed.`).join('\n');

const LONG_DESCRIPTION =
  'Runs the whole release from the first version bump to the published notes. Use it when someone says "ship it", "cut a release", "prepare the changelog", "tag the build", "roll back the last release", or asks which commits are still unreleased, and also when a pipeline run fails after a tag was pushed. Covers monorepos, hotfix branches and backports.';

const HOUR = 3600000;

/** One session transcript with agents. `agents`: { type, desc, status: done|failed|stopped|silent|general, bg } in launch order. */
function session({ folder, repo, id, startAgo, prompts, agents = [], branch = 'main', hookFail = 0, edits = 0, skill, command }) {
  const start = Date.now() - startAgo;
  const at = (sec) => new Date(start + sec * 1000).toISOString();
  const base = { cwd: repo, gitBranch: branch, entrypoint: 'cli', sessionId: id, version: '2.1.304' };
  const records = [];
  let t = 0;
  prompts.forEach((text, i) => {
    t += 20;
    records.push({ ...base, type: 'user', uuid: `u${i}`, timestamp: at(t), message: { role: 'user', content: text } });
  });
  if (command) records.push({ ...base, type: 'user', uuid: 'cmd', timestamp: at(t + 2), message: { role: 'user', content: `<command-message>${command}</command-message>\n<command-name>/${command}</command-name>\n<command-args></command-args>` } });
  const sub = path.join(folder, id, 'subagents');
  const usage = { input_tokens: 40, cache_creation_input_tokens: 9000, cache_read_input_tokens: 52000, output_tokens: 1800 };
  let n = 0;
  for (const a of agents) {
    n += 1;
    const tool = `toolu_${n}a`;
    const agentId = `a${String(n).padStart(3, '0')}${id.slice(0, 4)}`;
    t += 30;
    records.push({
      ...base, type: 'assistant', timestamp: at(t),
      message: { id: `m${n}`, model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id: tool, name: 'Agent', input: { subagent_type: a.status === 'general' ? 'general-purpose' : a.type, description: a.desc, prompt: `Do the job: ${a.desc}. Report in five lines.`, run_in_background: a.bg !== false } }] },
    });
    if (a.status === 'failed') {
      records.push({ ...base, type: 'user', timestamp: at(t + 1), toolUseResult: 'Error', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool, is_error: true, content: `Agent type '${a.type}' not found.` }] } });
      continue;
    }
    records.push({ ...base, type: 'user', timestamp: at(t + 1), toolUseResult: { status: 'async_launched', agentId }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool, content: 'launched' }] } });
    if (a.status === 'silent') continue;
    const dur = a.status === 'stopped' ? 40 : 160 + n * 25;
    jsonl(path.join(sub, `agent-${agentId}.jsonl`), [
      { isSidechain: true, agentId, type: 'user', timestamp: at(t + 2), message: { role: 'user', content: 'Do the job' } },
      { isSidechain: true, agentId, type: 'assistant', timestamp: at(t + 10), message: { id: `s${n}a`, model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: `t${n}`, name: 'Read', input: {} }] } },
      { isSidechain: true, agentId, type: 'assistant', timestamp: at(t + dur), message: { id: `s${n}b`, model: 'claude-haiku-5-5', usage: { input_tokens: 800, output_tokens: 600, cache_read_input_tokens: 12000 }, content: [{ type: 'text', text: 'Done: five lines of findings.' }] } },
    ]);
    write(path.join(sub, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: a.status === 'general' ? 'general-purpose' : a.type, description: a.desc, toolUseId: tool, spawnDepth: 1, requestShape: 'background', finished: a.status !== 'stopped' }));
    if (a.status === 'stopped') {
      records.push({ ...base, type: 'assistant', timestamp: at(t + 45), message: { id: `x${n}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `stop${n}`, name: 'TaskStop', input: { task_id: agentId } }] } });
    } else {
      records.push({ ...base, type: 'user', timestamp: at(t + dur), origin: { kind: 'task-notification' }, message: { role: 'user', content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${tool}</tool-use-id>\n<status>completed</status>\n<summary>${a.desc} done</summary>\n<result>All good</result>\n</task-notification>` } });
    }
    t += dur;
  }
  if (skill) records.push({ ...base, type: 'assistant', timestamp: at(t + 5), message: { id: 'sk', model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id: 'toolu_skill', name: 'Skill', input: { skill } }] } });
  for (let i = 0; i < edits; i++) records.push({ ...base, type: 'assistant', timestamp: at(t + 10 + i), message: { id: `e${i}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `edit${i}`, name: 'Edit', input: { file_path: path.join(repo, 'a.txt') } }] } });
  for (let i = 0; i < hookFail; i++) records.push({ type: 'attachment', timestamp: at(t + 20 + i), attachment: { type: 'hook_non_blocking_error', hookName: 'PreToolUse:Bash', command: 'bash ~/.claude/hooks/guard.sh', exitCode: 2, durationMs: 40 } });
  records.push({ type: 'attachment', timestamp: at(1), attachment: { type: 'hook_success', hookName: 'SessionStart', command: 'node ~/.claude/hooks/start.js', durationMs: 90, exitCode: 0 } });
  records.push({ ...base, type: 'assistant', timestamp: at(t + 60), message: { id: 'last', model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'Finished.' }] } });
  records.sort((x, y) => Date.parse(x.timestamp) - Date.parse(y.timestamp));
  jsonl(path.join(folder, `${id}.jsonl`), records);
  // The reader takes a session's end from the file's mtime, so each file carries the time of its last record.
  const touch = file => {
    if (fs.statSync(file).isDirectory()) return fs.readdirSync(file).forEach(f => touch(path.join(file, f)));
    const when = new Date(Math.min(Date.now(), Date.parse(records[records.length - 1].timestamp)));
    fs.utimesSync(file, when, when);
  };
  touch(path.join(folder, `${id}.jsonl`));
  if (fs.existsSync(path.join(folder, id))) touch(path.join(folder, id));
  return { id, start, agentCount: agents.length };
}

export function buildFixture(root, { livePid } = {}) {
  const home = path.join(root, 'home');
  const claude = path.join(home, '.claude');
  const repos = path.join(root, 'repos');
  // A running instance may hold a folder open; the files are then rewritten in place.
  for (const dir of [home, repos]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }

  // Global harness.
  write(path.join(claude, 'CLAUDE.md'), '# Global rules\n\n- Answer with the essentials.\n- Read @rules/style.md before writing prose.\n');
  const rules = { style: 'Write short sentences.', security: 'Never print a secret.', 'review-checklist': 'Check tests, naming and error handling.' };
  for (const [name, text] of Object.entries(rules)) write(path.join(claude, 'rules', `${name}.md`), `---\npaths:\n  - "src/**"\n---\n\n# ${name}\n\n${text}\n`);
  const agents = [
    ['code-reviewer', 'blue', 'Reviews a diff for correctness and naming. Use after every larger change.'],
    ['researcher', 'green', 'Reads docs and the web, reports sources with dates.'],
    ['fact-gatherer', 'cyan', 'Collects facts from files without editing anything.'],
    ['db-expert', '"#ff8800"', 'Owns SQL, migrations and indexes.'],
    ['frontend-expert', 'purple', 'Angular and CSS work.'],
    ['release-manager', 'orange', 'Prepares tags, notes and the publish run.'],
    ['doc-writer', 'pink', 'Writes README and docs in the house voice.'],
    ['an-agent-with-a-very-long-name-that-keeps-going-and-going', 'red', 'A description that is also long on purpose: ' + 'it keeps going to check how a row clips its text. '.repeat(4)],
  ];
  for (const [name, color, description] of agents) md(path.join(claude, 'agents', `${name}.md`), { name, description, model: 'inherit', color, tools: 'Read, Grep, Glob' }, `You are ${name}.\n\nWork in small steps and report briefly.`);
  for (const name of SKILL_NAMES) {
    const long = name === 'release-playbook';
    md(path.join(claude, 'skills', name, 'SKILL.md'), { name, description: long ? LONG_DESCRIPTION : `Handles ${name.replace(/-/g, ' ')} tasks. Use when the user mentions ${name}.` }, skillBody(name, long ? 700 : 14));
    if (long) {
      for (let i = 1; i <= 6; i++) write(path.join(claude, 'skills', name, 'references', `topic-${i}.md`), `# Topic ${i}\n\n${'Detail line that repeats. '.repeat(30)}\n`.repeat(8));
      write(path.join(claude, 'skills', name, 'scripts', 'bump.mjs'), 'console.log("bump");\n');
    }
  }
  md(path.join(claude, 'commands', 'review.md'), { description: 'Review the staged diff' }, 'Review the staged diff and list problems.');
  md(path.join(claude, 'commands', 'git', 'contribute-start.md'), { description: 'Start a contribution branch' }, 'Create a branch from master.');
  md(path.join(claude, 'commands', 'git', 'contribute-pr.md'), { description: 'Open the pull request' }, 'Open the PR.');
  md(path.join(claude, 'output-styles', 'terse.md'), { name: 'terse', description: 'Short answers' }, 'Answer in one paragraph.');
  md(path.join(claude, 'output-styles', 'teacher.md'), { name: 'teacher', description: 'Explains each step' }, 'Explain why.');
  write(path.join(claude, 'workflows', 'fan-out.js'), "export const meta = {\n  name: 'fan-out',\n  description: 'Run one agent per repo',\n}\n");
  write(path.join(claude, 'hooks', 'guard.sh'), '#!/bin/bash\nexit 0\n');
  write(path.join(claude, 'hooks', 'start.js'), 'console.log("start");\n');

  // Plugins: one with skills and agents, one delegation mod with an events manifest.
  const market = path.join(claude, 'plugins', 'cache', 'acme-market');
  const teamTools = path.join(market, 'team-tools', '1.2.0');
  const delegation = path.join(market, 'delegation-mod', '0.4.0');
  json(path.join(teamTools, '.claude-plugin', 'plugin.json'), { name: 'team-tools', version: '1.2.0', description: 'Shared team skills and agents' });
  for (const name of ['lint-fix', 'commit-helper', 'standup-notes', 'estimate']) md(path.join(teamTools, 'skills', name, 'SKILL.md'), { name, description: `Team ${name} skill` }, skillBody(name, 10));
  for (const name of ['team-lead', 'qa-engineer']) md(path.join(teamTools, 'agents', `${name}.md`), { name, description: `The team ${name}`, color: 'yellow' }, `You are ${name}.`);
  json(path.join(delegation, '.claude-plugin', 'plugin.json'), { name: 'delegation-mod', version: '0.4.0', description: 'Keeps the main thread delegating', hooks: './hooks/hooks.json' });
  json(path.join(delegation, 'hooks', 'hooks.json'), { modules: [{ name: 'lookup-cap' }] });
  json(path.join(delegation, '.claude-plugin', 'harness-events.json'), { label: 'Delegation', events: '{sessionDir}/delegation-events.jsonl' });
  json(path.join(claude, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'team-tools@acme-market': [{ scope: 'user', installPath: teamTools, version: '1.2.0', lastUpdated: '2026-10-01T10:00:00Z' }],
      'delegation-mod@acme-market': [{ scope: 'user', installPath: delegation, version: '0.4.0', lastUpdated: '2026-10-10T10:00:00Z' }],
      'old-helper@acme-market': [{ scope: 'user', installPath: path.join(market, 'old-helper', '0.1.0'), version: '0.1.0' }],
    },
  });
  json(path.join(claude, 'plugins', 'known_marketplaces.json'), { 'acme-market': { source: { source: 'github', repo: 'acme/market' }, installLocation: path.join(claude, 'plugins', 'marketplaces', 'acme-market') } });
  json(path.join(claude, 'plugins', 'marketplaces', 'acme-market', '.claude-plugin', 'marketplace.json'), { name: 'acme-market', plugins: [{ name: 'team-tools', description: 'Shared team skills and agents' }, { name: 'delegation-mod', description: 'Keeps the main thread delegating' }, { name: 'old-helper', description: 'Retired helper' }] });
  json(path.join(claude, 'settings.json'), {
    enabledPlugins: { 'team-tools@acme-market': true, 'delegation-mod@acme-market': true, 'old-helper@acme-market': false },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/guard.sh' }] }, { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node ~/.claude/hooks/start.js' }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: 'node ~/.claude/hooks/start.js' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'node ~/.claude/hooks/start.js' }] }],
    },
  });

  // Repos.
  const repoDirs = {};
  const mkRepo = (name, setup) => {
    const dir = path.join(repos, name);
    repoDirs[name] = dir;
    write(path.join(dir, 'CLAUDE.md'), `# ${name}\n\nBuild with npm. Tests with npm test.\n`);
    setup(dir);
    return dir;
  };
  mkRepo('shop-api', dir => {
    for (const name of ['db-expert', 'api-reviewer']) md(path.join(dir, '.claude', 'agents', `${name}.md`), { name, description: `Repo ${name}`, color: 'red' }, `You are ${name}.`);
    // Identical to the global copy, near it, and different from it: the three Consolidate states.
    md(path.join(dir, '.claude', 'skills', 'commit-helper', 'SKILL.md'), { name: 'commit-helper', description: 'Handles commit helper tasks. Use when the user mentions commit-helper.' }, skillBody('commit-helper', 14));
    md(path.join(dir, '.claude', 'skills', 'db-migrate', 'SKILL.md'), { name: 'db-migrate', description: 'Handles db migrate tasks. Use when the user mentions db-migrate.' }, skillBody('db-migrate', 14) + '\n15. Extra repo step.');
    md(path.join(dir, '.claude', 'skills', 'lint-fix', 'SKILL.md'), { name: 'lint-fix', description: 'Repo lint fix' }, 'A different lint fix, repo flavour.');
    md(path.join(dir, '.claude', 'skills', 'shop-checkout', 'SKILL.md'), { name: 'shop-checkout', description: 'Only this repo has the checkout flow.' }, skillBody('shop-checkout', 8));
    md(path.join(dir, '.claude', 'rules', 'sql.md'), {}, '# sql\n\nNo select star.');
    md(path.join(dir, '.claude', 'commands', 'seed.md'), { description: 'Seed the dev database' }, 'Seed it.');
    json(path.join(dir, '.mcp.json'), { mcpServers: { 'shop-db': { command: 'node', args: ['-e', 'setTimeout(()=>{},1000)'] } } });
    json(path.join(dir, '.claude', 'settings.json'), { hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'npm run lint' }] }] } });
  });
  mkRepo('shop-web', dir => {
    md(path.join(dir, '.claude', 'agents', 'frontend-expert.md'), { name: 'frontend-expert', description: 'Repo frontend expert', color: 'purple' }, 'You are the frontend expert.');
    md(path.join(dir, '.claude', 'skills', 'ui-audit', 'SKILL.md'), { name: 'ui-audit', description: 'Audit the UI' }, skillBody('ui-audit', 14));
    md(path.join(dir, '.claude', 'rules', 'a11y.md'), {}, '# a11y\n\nEvery control has a name.');
  });
  mkRepo('data-pipeline', dir => {
    md(path.join(dir, '.claude', 'skills', 'sql-review', 'SKILL.md'), { name: 'sql-review', description: 'Review SQL' }, skillBody('sql-review', 6));
    json(path.join(dir, '.mcp.json'), { mcpServers: { warehouse: { type: 'http', url: 'http://127.0.0.1:9/mcp' } } });
  });
  mkRepo('docs-site', dir => {
    write(path.join(dir, 'CLAUDE.md'), '# docs-site\n');
  });
  mkRepo('empty-repo-with-a-rather-long-folder-name-for-the-sidebar', dir => {
    write(path.join(dir, 'CLAUDE.md'), '# nothing here yet\n');
    // A path rule in a repo that has no session yet: its Loaded in tab must not claim "Never matched".
    write(path.join(dir, '.claude', 'rules', 'api-only.md'), '---\npaths:\n  - "src/api/**"\n---\n\n# api-only\n\nKeep handlers thin.\n');
  });

  json(path.join(home, '.claude.json'), {
    mcpServers: {
      filesystem: { command: 'node', args: ['-e', 'setTimeout(()=>{},1000)'] },
      docs: { type: 'http', url: 'http://127.0.0.1:9/mcp' },
    },
    projects: Object.fromEntries(Object.values(repoDirs).map(d => [d.replace(/\\/g, '/'), { allowedTools: [], mcpServers: d.endsWith('shop-api') ? { scratch: { command: 'node', args: ['-e', '0'] } } : {} }])),
  });

  // Sessions.
  const projects = path.join(claude, 'projects');
  const folderOf = dir => path.join(projects, projectSlug(dir));
  const sessions = [];
  const add = (repoName, o) => sessions.push(session({ folder: folderOf(repoDirs[repoName]), repo: repoDirs[repoName], ...o }));
  add('shop-api', {
    id: '11111111-0000-4000-8000-000000000001', startAgo: 2 * HOUR, branch: 'feature/checkout', edits: 14, hookFail: 3, skill: 'commit-helper', command: 'review',
    prompts: ['Add the checkout endpoint and the migration for orders', 'This is not what I asked, stop the researcher', 'ok now finish the tests'],
    agents: [
      { type: 'db-expert', desc: 'Write the orders migration', status: 'done' },
      { type: 'researcher', desc: 'Find the payment API docs', status: 'stopped' },
      { type: 'researcher', desc: 'Find the payment API docs', status: 'done' },
      { type: 'nope-agent', desc: 'Check the idempotency keys', status: 'failed' },
      { type: 'fact-gatherer', desc: 'List the order tables', status: 'silent' },
      { type: 'general-purpose', desc: 'Summarize the database schema', status: 'general' },
      { type: 'code-reviewer', desc: 'Review the checkout diff', status: 'done' },
    ],
  });
  jsonl(path.join(folderOf(repoDirs['shop-api']), '11111111-0000-4000-8000-000000000001', 'delegation-events.jsonl'), [
    { at: new Date(Date.now() - 2 * HOUR + 120000).toISOString(), hook: 'PreToolUse', text: 'delegation-mod: 4 lookups this turn, delegate the rest.', label: 'Lookup cap', tone: 'warn', detail: 'Denied Read after 4 lookups.' },
    { at: new Date(Date.now() - 2 * HOUR + 200000).toISOString(), hook: 'PostToolUse', text: 'delegation-mod: routed to db-expert.', label: 'Routing', tone: 'act' },
  ]);
  add('shop-api', { id: '11111111-0000-4000-8000-000000000002', startAgo: 26 * HOUR, branch: 'main', prompts: ['Explain the order table'], agents: [{ type: 'db-expert', desc: 'Explain orders', status: 'done' }] });
  add('shop-api', { id: '11111111-0000-4000-8000-000000000003', startAgo: 50 * HOUR, branch: 'hotfix/prices', prompts: ['Fix the rounding in prices ' + 'and also keep this title very long to test truncation in the row '.repeat(3)], skill: 'release-playbook' });
  add('shop-web', { id: '22222222-0000-4000-8000-000000000001', startAgo: 5 * HOUR, branch: 'main', edits: 3, prompts: ['Build the cart page'], agents: [{ type: 'frontend-expert', desc: 'Build the cart component', status: 'done' }, { type: 'frontend-expert', desc: 'Build the cart component', status: 'done' }] });
  add('shop-web', { id: '22222222-0000-4000-8000-000000000002', startAgo: 30 * HOUR, branch: 'main', prompts: ['Audit the header'], skill: 'ui-audit' });
  add('data-pipeline', { id: '33333333-0000-4000-8000-000000000001', startAgo: 9 * HOUR, branch: 'main', prompts: ['Why is the nightly load slow?'], agents: [{ type: 'researcher', desc: 'Profile the load', status: 'done' }] });
  add('docs-site', { id: '44444444-0000-4000-8000-000000000001', startAgo: 70 * HOUR, branch: 'main', prompts: ['Rewrite the intro'], agents: [] });
  if (livePid) {
    add('shop-web', { id: '22222222-0000-4000-8000-000000000003', startAgo: 4 * 60000, branch: 'main', prompts: ['Still working on the checkout page'] });
    json(path.join(claude, 'sessions', `${livePid}.json`), { pid: livePid, sessionId: '22222222-0000-4000-8000-000000000003', status: 'busy' });
  }
  return { root, home, claude, repos: Object.values(repoDirs), repoDirs, sessions };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) throw new Error('usage: node test/ui/fixture.mjs <root>');
  buildFixture(path.resolve(root));
  console.log(`fixture=${path.resolve(root)}`);
}
