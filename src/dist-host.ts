// The skill distributor commands: add a skill from a skills.sh or GitHub address into ~/.claude/skills, connect a skill you already
// have to its source, check whether the distributor has a newer version, update in place, and link a global skill into a repo.
// The network and disk work is in distributor.ts. Questions are cards in the panel and results are a line in the panel (the palette
// gets a quick input, a quick pick and notifications instead, when the panel is not the one asking).
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Cancelled, Latest, Resolved, Staged, diffFolders, discard, explainSource, install, latest, linkState, linkToRepo, parseSource, resolve, resolveOrigin, stage, sweepStaged } from './distributor';
import { backupStamp } from './harness';
import type { Asset } from './harness';
import { HarnessPanel, PanelAnswer } from './panel';
import type { DistCheck, DistNote, PanelAsk } from './shared/messages';

export interface DistDeps {
  /** The Claude folder, `~/.claude`. */
  root: () => string;
  /** The skills of the global scope that sit in `~/.claude/skills`. */
  skills: () => Asset[];
  /** The repos the harness knows, for linking a global skill into one. */
  repos: () => { label: string; path: string }[];
  /** The skill a command argument names: an id, a panel command's `{ id }` or a tree node. */
  find: (arg: unknown) => Asset | undefined;
  refresh: () => void;
  backupRoot: () => string;
}

type Card = Omit<PanelAsk, 'kind' | 'token' | 'facts'> & { facts?: string[]; validate?: (v: string) => string | undefined };

const fromPanel = (arg: unknown) => !!arg && typeof arg === 'object' && 'fromPanel' in arg;

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

const versions = (a: Asset, to?: string) => (a.version && to && to !== a.version ? ` (v${a.version} to v${to})` : to ? ` (v${to})` : a.version ? ` (v${a.version})` : '');

/** A path as the owner knows it: `~/.claude/skills/x`, not the absolute one. */
const tilde = (p: string) => {
  const home = os.homedir();
  const norm = (s: string) => s.replace(/\\/g, '/');
  return norm(p).toLowerCase().startsWith(norm(home).toLowerCase()) ? `~${norm(p).slice(norm(home).length)}` : norm(p);
};

const names = (files: string[]) => `${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}`;

/** What replacing a folder with the downloaded one does to the files in it, in the owner's terms. */
const changesText = (d: { changed: string[]; added: string[]; removed: string[] }): string =>
  [
    d.changed.length ? `overwrites your ${names(d.changed)}` : '',
    d.added.length ? `adds ${plural(d.added.length, 'file')}` : '',
    d.removed.length ? `deletes ${names(d.removed)}, which the download does not have (kept in the backup)` : '',
  ]
    .filter(Boolean)
    .join('; ') || 'the files are the same, only the recorded version moves';

export function registerDistributor(deps: DistDeps): vscode.Disposable[] {
  const checks = new Map<string, DistCheck>();
  let running = false;
  sweepStaged();

  const tracked = () => deps.skills().filter(a => a.origin);

  /** A line in the panel; a notification when the panel is not open. */
  const say = (tone: DistNote['tone'], text: string, more: Partial<DistNote> = {}) => {
    if (HarnessPanel.isOpen()) return HarnessPanel.post({ type: 'distNote', note: { tone, text, ...more } });
    void (tone === 'bad' ? vscode.window.showErrorMessage(text) : vscode.window.showInformationMessage(text));
  };

  const clearNote = () => HarnessPanel.post({ type: 'distNote' });

  /** Work with a line in the panel while it runs, or a progress notification. */
  const busy = <T>(text: string, work: () => Promise<T>): Thenable<T> => {
    if (!HarnessPanel.isOpen()) return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: text }, work);
    say('busy', text);
    return work();
  };

  /** A card in the panel under the button that asked; a quick input, pick or dialog from the palette. */
  const prompt = async (arg: unknown, card: Card): Promise<PanelAnswer> => {
    const { validate, ...spec } = card;
    const inPanel = fromPanel(arg) ? HarnessPanel.askFull({ glyph: 'cloud-download', facts: [], ...spec }) : undefined;
    if (inPanel) return inPanel;
    if (spec.input) {
      const text = await vscode.window.showInputBox({ title: spec.title, prompt: [spec.input.label, spec.input.error].filter(Boolean).join(' '), value: spec.input.value, placeHolder: spec.input.placeholder, ignoreFocusOut: true, validateInput: validate });
      return text ? { choice: 'ok', text } : { choice: 'cancel' };
    }
    if (spec.choices) {
      const items = spec.choices.filter(c => !c.disabled).map(c => ({ label: c.label, description: c.note, id: c.id }));
      const picked = await vscode.window.showQuickPick(items, { canPickMany: !!spec.multi, title: spec.title, placeHolder: spec.sub, matchOnDescription: true });
      const list = (Array.isArray(picked) ? picked : picked ? [picked] : []).map(p => p.id);
      return list.length ? { choice: 'ok', picked: list } : { choice: 'cancel' };
    }
    return { choice: (await vscode.window.showInformationMessage(spec.title, { modal: true, detail: (card.facts ?? []).join('\n') }, spec.action)) === spec.action ? 'ok' : 'cancel' };
  };

  const runCheck = async (list: Asset[]): Promise<Record<string, Latest>> => {
    running = true;
    HarnessPanel.post({ type: 'distChecks', checks: {}, running: true });
    try {
      const answers = await latest(list.map(a => ({ name: a.name, origin: a.origin! })));
      const at = Date.now();
      const changed: Record<string, DistCheck> = {};
      for (const a of list) {
        const r = answers[a.name];
        if (!r) continue;
        changed[a.id] = { ...r, at };
        checks.set(a.id, changed[a.id]);
      }
      running = false;
      HarnessPanel.post({ type: 'distChecks', checks: changed, running: false });
      return answers;
    } finally {
      if (running) {
        running = false;
        HarnessPanel.post({ type: 'distChecks', checks: {}, running: false });
      }
    }
  };

  const check = async (arg?: unknown) => {
    if (running) return;
    const one = deps.find(arg);
    const list = one ? [one] : tracked();
    if (one && !one.origin) return say('info', `${one.name} is not installed from a distributor. Connect it to its source first.`);
    if (!list.length) return say('info', 'No skill is installed from a distributor yet. Add one from a skills.sh or GitHub address.');
    try {
      say('busy', list.length === 1 ? `Checking ${list[0].name} at ${list[0].origin!.source}...` : `Checking ${plural(list.length, 'skill')}...`);
      const answers = await runCheck(list);
      const failed = list.filter(a => answers[a.name]?.state === 'error');
      const newer = list.filter(a => answers[a.name]?.state === 'newer');
      const gone = list.filter(a => answers[a.name]?.state === 'gone');
      if (failed.length === list.length) return say('bad', `Could not check for updates, so nothing is known about ${list.length === 1 ? list[0].name : 'these skills'} yet: ${answers[failed[0].name].error}`);
      const text = [
        newer.length
          ? newer.length === 1
            ? `A newer version of ${newer[0].name}${versions(newer[0], answers[newer[0].name].version)} is at ${newer[0].origin!.source}.`
            : `${newer.length} skills have a newer version: ${newer.map(a => `${a.name}${versions(a, answers[a.name].version)}`).join(', ')}.`
          : `${list.length === 1 ? `${list[0].name} is` : `All ${list.length} skills are`} up to date.`,
        gone.length ? `No longer in their repository: ${gone.map(a => a.name).join(', ')}.` : '',
        failed.length ? `Could not check ${failed.map(a => a.name).join(', ')}: ${answers[failed[0].name].error}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      if (HarnessPanel.isOpen()) return say(newer.length ? 'info' : 'ok', text);
      if (newer.length && (await vscode.window.showInformationMessage(text, 'Update')) === 'Update') await vscode.commands.executeCommand('claudeHarness.updateSkill', newer.length === 1 ? newer[0].id : undefined);
      else if (!newer.length) void vscode.window.showInformationMessage(text);
    } catch (e) {
      say('bad', `Could not check for updates: ${(e as Error).message}`);
    }
  };

  const updateSkill = async (arg?: unknown) => {
    clearNote();
    const one = deps.find(arg);
    let list = one ? [one] : tracked().filter(a => checks.get(a.id)?.state === 'newer');
    if (one && !one.origin) return say('info', `${one.name} is not installed from a distributor. Connect it to its source first.`);
    if (!one && !list.length) {
      if (!tracked().length) return say('info', 'No skill is installed from a distributor yet. Add one from a skills.sh or GitHub address.');
      const answers = await runCheck(tracked());
      list = tracked().filter(a => answers[a.name]?.state === 'newer');
      if (!list.length) return say('ok', `All ${tracked().length} skills are up to date.`);
    }
    const staged = new Map<string, Staged>();
    try {
      await busy(`Downloading ${list.length === 1 ? list[0].name : plural(list.length, 'skill')}...`, async () => {
        for (const a of list) {
          const s = await stage(await resolveOrigin(a.origin!));
          s.name = a.name;
          staged.set(a.id, s);
        }
      });
      clearNote();
      const root = deps.root();
      const backups = path.join(deps.backupRoot(), backupStamp(), 'skills');
      const facts = list.map(a => {
        const s = staged.get(a.id)!;
        const link = a.link ? ` Its link into ${tilde(a.link)} is replaced by the files themselves.` : '';
        return `${a.name}${versions(a, s.version)}: ${changesText(diffFolders(a.dir!, s.dir))}.${link}`;
      });
      const answer = await prompt(arg, {
        key: (arg as { anchor?: string } | undefined)?.anchor ?? (one ? 'update' : 'update-all'),
        title: list.length === 1 ? `Update ${list[0].name}` : `Update ${plural(list.length, 'skill')}`,
        sub: list.length === 1 ? `from ${list[0].origin!.source}` : 'from their distributors',
        facts: [...facts.slice(0, 7), ...(facts.length > 7 ? [`and ${facts.length - 7} more skills`] : []), `The old files are backed up first, in ${tilde(deps.backupRoot())}. Repos that link a skill pick up the update.`],
        action: 'Update',
      });
      if (answer.choice !== 'ok') return clearNote();
      const done: string[] = [];
      const failed: string[] = [];
      for (const a of list) {
        try {
          install(root, staged.get(a.id)!, backups);
          done.push(a.name);
        } catch (e) {
          failed.push(`${a.name}: ${(e as Error).message}`);
        }
      }
      deps.refresh();
      const now: Record<string, DistCheck> = {};
      for (const a of list) if (done.includes(a.name)) checks.set(a.id, (now[a.id] = { state: 'current', at: Date.now() }));
      HarnessPanel.post({ type: 'distChecks', checks: now, running: false });
      if (failed.length) say('bad', `Could not update ${failed.join('; ')}`);
      else say('ok', `Updated ${done.join(', ')}. The old files are in ${tilde(backups)}.`, { focus: list.length === 1 ? list[0].id : undefined });
    } catch (e) {
      if (e instanceof Cancelled) return clearNote();
      say('bad', `Could not update: ${(e as Error).message}`);
    } finally {
      staged.forEach(discard);
    }
  };

  /** Sync, from a row's right-click menu: checks the one skill at its source, then runs the Update flow when there is a newer version. */
  const sync = async (arg?: unknown) => {
    const given = arg && typeof arg === 'object' && 'assetId' in arg ? { fromPanel: true, id: String((arg as { assetId: unknown }).assetId) } : arg;
    const one = deps.find(given);
    if (!one) return;
    if (!one.origin) return say('info', `${one.name} is not installed from a distributor. Connect it to its source first.`);
    if (running) return;
    try {
      // The page is not redrawn before the card, so the card still has the row to point at.
      const r = (await latest([{ name: one.name, origin: one.origin }]))[one.name];
      if (r?.state === 'newer') return await updateSkill({ ...(given as object), anchor: 'click' });
      if (r?.state === 'error') return say('bad', `Could not check for updates, so nothing is known about ${one.name} yet: ${r.error}`);
      if (r?.state === 'gone') return say('info', `No longer in their repository: ${one.name}.`);
      say('ok', `${one.name} is up to date.`);
    } catch (e) {
      say('bad', `Could not check for updates: ${(e as Error).message}`);
    }
  };

  /** Downloads a skill and, once the owner agrees, writes it into ~/.claude/skills. A skill of that name already there is replaced and backed up. */
  const add = async (arg: unknown, find: () => Promise<Resolved>, existing?: Asset) => {
    let s: Staged | undefined;
    try {
      s = await busy('Looking up the skill...', async () => stage(await find()));
      clearNote();
      if (existing) s.name = existing.name;
      const root = deps.root();
      const target = path.join(root, 'skills', s.name);
      const state = linkState(target, target);
      const had = deps.skills().find(a => a.name === s!.name);
      if (!existing && had?.origin) return say('info', `${s.name} is already installed from ${had.origin.source}.`, { action: { label: 'Check for updates', command: 'checkSkillUpdates', id: had.id } });
      const backups = path.join(deps.backupRoot(), backupStamp(), 'skills');
      const d = state === 'copy' ? diffFolders(target, s.dir) : undefined;
      const verb = existing ? 'Connect' : 'Install';
      const facts = [
        s.description ? `Its description, which Claude reads in every session: "${s.description.length > 220 ? `${s.description.slice(0, 217)}...` : s.description}"` : 'It has no description, so Claude will not know when to use it.',
        `${plural(s.files.length, 'file')}: ${names(s.files)}.`,
        'This is third-party text. Claude follows it when the skill runs, so read it before you trust it.',
        state === 'none'
          ? `Installs into ${tilde(target)}.`
          : state === 'copy'
            ? `Replaces your copy in ${tilde(target)}${had?.version ? ` (v${had.version})` : ''}: ${changesText(d!)}.`
            : `Replaces the link ${tilde(target)} with the files themselves; what it points to is not touched.`,
        state === 'none' ? '' : `The current files are backed up first, in ${tilde(deps.backupRoot())}.`,
        `Remembers where it came from, so Check updates and Update work for it.`,
      ].filter(Boolean);
      const answer = await prompt(arg, { key: existing ? 'link' : 'add', title: `${verb} ${s.name}${s.version ? ` v${s.version}` : ''}`, sub: `from ${s.source}`, facts, action: verb });
      if (answer.choice !== 'ok') return clearNote();
      const done = install(root, s, backups);
      deps.refresh();
      const id = deps.skills().find(a => a.name === s!.name)?.id;
      if (id) {
        checks.set(id, { state: 'current', at: Date.now() });
        HarnessPanel.post({ type: 'distChecks', checks: { [id]: checks.get(id)! }, running: false });
      }
      say('ok', `${s.name}${s.version ? ` v${s.version}` : ''} is installed from ${s.source} in ${tilde(done.folder)}.${done.backup ? ` Your previous files are in ${tilde(backups)}.` : ''}`, { focus: id });
    } catch (e) {
      if (e instanceof Cancelled) return clearNote();
      say('bad', `Could not install the skill: ${(e as Error).message}`);
    } finally {
      if (s) discard(s);
    }
  };

  /** The skill a repo with several skills means: a list sorted by name, and the reason when the name asked for was not in it. */
  const pickDir = (arg: unknown) => async (dirs: string[], why?: string): Promise<string | undefined> => {
    const label = (d: string) => (d ? path.posix.basename(d) : '(repository root)');
    const choices = dirs.map(d => ({ id: d || '/', label: label(d), note: d && !['.', 'skills'].includes(path.posix.dirname(d)) ? path.posix.dirname(d) : undefined })).sort((a, b) => a.label.localeCompare(b.label));
    const answer = await prompt(arg, { key: 'add', title: why ? 'Pick one of its skills' : 'Which skill?', sub: why ?? `${plural(dirs.length, 'skill')} in this repository`, choices, action: 'Continue' });
    const id = answer.picked?.[0];
    return answer.choice === 'ok' && id ? (id === '/' ? '' : id) : undefined;
  };

  /** Asks for an address until it is one this extension can read, or the owner gives up. */
  const askAddress = async (arg: unknown, title: string, sub: string, label: string): Promise<ReturnType<typeof parseSource>> => {
    let error: string | undefined;
    let value: string | undefined;
    for (;;) {
      const answer = await prompt(arg, { key: title.startsWith('Connect') ? 'link' : 'add', title, sub, action: 'Find', input: { label, placeholder: 'https://www.skills.sh/owner/repo/skill', value, error }, validate: v => (v.trim() ? explainSource(v) : undefined) });
      if (answer.choice !== 'ok' || !answer.text) return undefined;
      const src = parseSource(answer.text);
      if (src) return src;
      error = explainSource(answer.text);
      value = answer.text;
    }
  };

  return [
    { dispose: () => sweepStaged(true) },

    vscode.commands.registerCommand('claudeHarness.addSkillFromUrl', async (arg?: unknown) => {
      clearNote();
      const src = await askAddress(arg, 'Add a skill', 'from skills.sh or GitHub', 'Address of the skill, or owner/repo/skill');
      if (!src) return clearNote();
      const same = src.skill ? tracked().find(a => a.name.toLowerCase() === src.skill!.toLowerCase() && a.origin!.source.toLowerCase() === `${src.owner}/${src.repo}`.toLowerCase()) : undefined;
      if (same) return say('info', `${same.name} is already installed from ${same.origin!.source}.`, { action: { label: 'Check for updates', command: 'checkSkillUpdates', id: same.id } });
      await add(arg, () => resolve(src, pickDir(arg)), deps.skills().find(a => a.name === src.skill && !a.origin));
    }),

    vscode.commands.registerCommand('claudeHarness.connectSkillSource', async (arg?: unknown) => {
      clearNote();
      let asset = deps.find(arg);
      if (!asset) {
        const plain = deps.skills().filter(a => !a.origin);
        asset = (await vscode.window.showQuickPick(plain.map(a => ({ label: a.name, description: a.version ? `v${a.version}` : '', a })), { title: 'Connect which skill to its source?', matchOnDescription: true }))?.a;
      }
      if (!asset) return;
      const found = asset;
      if (found.origin) return say('info', `${found.name} is already connected to ${found.origin.source}.`);
      const src = await askAddress(arg, `Connect ${found.name}`, 'to the address it comes from', 'skills.sh or GitHub address, or owner/repo');
      if (!src) return clearNote();
      await add(arg, () => resolve({ ...src, skill: src.skill ?? found.name }, pickDir(arg)), found);
    }),

    vscode.commands.registerCommand('claudeHarness.linkSkillToRepo', async (arg?: unknown) => {
      clearNote();
      let asset = deps.find(arg);
      if (!asset) asset = (await vscode.window.showQuickPick(deps.skills().map(a => ({ label: a.name, description: a.version ? `v${a.version}` : '', a })), { title: 'Link which global skill into a repo?', matchOnDescription: true }))?.a;
      if (!asset) return;
      const found = asset;
      const globalDir = path.join(deps.root(), 'skills', found.name);
      const choices = deps.repos().map(r => {
        const state = linkState(path.join(r.path, '.claude', 'skills', found.name), globalDir);
        return { id: r.path, label: r.label, note: state === 'linked' ? 'already linked' : state === 'copy' ? 'has its own folder of that name' : state === 'elsewhere' ? 'links somewhere else' : `.../${path.basename(path.dirname(r.path))}`, disabled: state !== 'none' };
      });
      if (!choices.some(c => !c.disabled)) return say('info', choices.length ? `Every repo already has a ${found.name} folder or link.` : 'No repo is open in the harness yet.');
      const answer = await prompt(arg, {
        key: 'link-repo',
        title: `Link ${found.name} into repos`,
        sub: 'a soft link to the global skill',
        facts: [`Each repo you pick gets .claude/skills/${found.name} as a link to ${tilde(globalDir)}, so updating the global skill updates it there too.`],
        choices,
        multi: true,
        action: 'Link',
      });
      if (answer.choice !== 'ok' || !answer.picked?.length) return clearNote();
      const done: string[] = [];
      const failed: string[] = [];
      for (const dir of answer.picked) {
        try {
          linkToRepo(deps.root(), dir, found.name);
          done.push(choices.find(c => c.id === dir)?.label ?? dir);
        } catch (e) {
          failed.push((e as Error).message);
        }
      }
      deps.refresh();
      if (failed.length) say('bad', failed.join(' '));
      else say('ok', `${found.name} is linked into ${done.join(', ')}.`);
    }),

    vscode.commands.registerCommand('claudeHarness.checkSkillUpdates', check),
    vscode.commands.registerCommand('claudeHarness.updateSkill', updateSkill),
    vscode.commands.registerCommand('claudeHarness.syncSkill', sync),
  ];
}
