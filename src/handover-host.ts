import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { chatById, loadChat } from './cowork-chats';
import { HANDOVER_SYSTEM, applyHandover, draftPrompt, listDownloads, parseDraft, planHandover, seedFromChat, seedFromCloud, seedFromDownload, seedFromLink } from './cowork-handover';
import type { HandoverCard, HandoverRepo, HandoverSeed } from './cowork-handover';
import { runUrl } from './cowork-scheduled';
import type { HandoverHost } from './panel';
import { draftStyle } from './style';

export interface HandoverDeps {
  state: vscode.Memento;
  repos: () => HandoverRepo[];
  /** The repository the current editor is in. */
  cwd: () => string;
  /** Opens a terminal in the folder with Claude started on the prompt. */
  terminal: (name: string, cwd: string, prompt: string) => void;
}

const REMEMBERED = 'handoverDraftRemembered';

const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** A Claude failure in the owner's words, not the raw error line. */
const friendly = (error: string): string => `Claude could not draft the card: ${error.split('\n')[0].slice(0, 160)} Fill the fields in yourself, or try again.`;

export function handoverHost(d: HandoverDeps): HandoverHost {
  // Only files this page listed (a chat's, a Downloads file) or the owner located are ever copied.
  const issued = new Set<string>();
  const issue = (file: string) => issued.add(path.resolve(file).toLowerCase());
  const fileOk = (file: string) => issued.has(path.resolve(file).toLowerCase());
  const repoOk = (repo: string) => d.repos().some(r => same(r.base, repo)) || same(d.cwd(), repo);
  let busy = false;
  let pendingDraft: HandoverCard | undefined;
  let pendingRun: HandoverCard | undefined;

  const seen = (seed: HandoverSeed): HandoverSeed => {
    for (const f of seed.files) {
      issue(f.file);
      f.missing = !fs.existsSync(f.file);
    }
    return seed;
  };

  return {
    inbox: () => {
      const downloads = listDownloads();
      downloads.forEach(x => issue(x.file));
      return { downloads, repos: d.repos(), cwd: d.cwd() };
    },
    seed: async m => {
      if (m.source === 'chat') {
        const chat = m.id ? chatById(m.id) : undefined;
        return chat ? { type: 'handoverSeed', seed: seen(seedFromChat(chat, loadChat(chat))) } : { type: 'handoverSeed', error: 'The chat is no longer on this PC.' };
      }
      if (m.source === 'download') {
        const found = listDownloads().find(x => m.id && same(x.file, m.id));
        return found ? { type: 'handoverSeed', seed: seen(seedFromDownload(found)) } : { type: 'handoverSeed', error: 'That file is no longer in Downloads.' };
      }
      if (m.source === 'cloud') {
        return m.id && /^[\w-]+$/.test(m.id) ? { type: 'handoverSeed', seed: seedFromCloud(m.title || 'Cowork session', runUrl(m.id)) } : { type: 'handoverSeed', error: 'That session has no readable id.' };
      }
      const link = (m.link ?? '').trim();
      return /^https?:\/\/\S+$/.test(link) ? { type: 'handoverSeed', seed: seedFromLink(link) } : { type: 'handoverSeed', error: 'That is not a link. Paste the address of the artifact, starting with https://.' };
    },
    locate: async () => {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Use this file' });
      if (!picked?.[0]) return undefined;
      issue(picked[0].fsPath);
      return picked[0].fsPath;
    },
    draft: async (card, answer, ask, post) => {
      if (card) pendingDraft = card;
      const use = pendingDraft;
      if (!use) return;
      if (card && !answer.confirmed && !d.state.get<boolean>(REMEMBERED)) return ask({ kind: 'handoverDraft', key: 'draft', files: use.files.filter(f => f.include).length, chars: use.snapshot.length });
      if (answer.remember) await d.state.update(REMEMBERED, true);
      if (busy) return;
      busy = true;
      post({ type: 'handoverDraft', state: 'running' });
      try {
        const result = await draftStyle(draftPrompt(use), 'sonnet', os.tmpdir(), 300000, HANDOVER_SYSTEM);
        if ('error' in result) post({ type: 'handoverDraft', state: 'error', error: friendly(result.error) });
        else post({ type: 'handoverDraft', state: 'done', draft: parseDraft(result.text) });
      } catch (e) {
        post({ type: 'handoverDraft', state: 'error', error: friendly((e as Error).message) });
      } finally {
        busy = false;
      }
    },
    run: async (card, answer, ask, post) => {
      const say = (state: 'running' | 'done' | 'error', text?: string) => post({ type: 'handover', id: 'card', state, text });
      const use = card ?? pendingRun;
      if (!use) return;
      const plan = planHandover(use, repoOk, fileOk);
      if (plan.problems.length) return say('error', plan.problems.join(' '));
      if (card && !answer.confirmed) {
        pendingRun = card;
        return ask({ kind: 'handover', id: 'card', key: 'card', title: use.title, cwd: use.repo, folder: plan.folder, files: plan.copy.map(c => ({ name: c.name, missing: c.missing })), prompt: plan.prompt });
      }
      say('running');
      try {
        const missing = applyHandover(plan);
        d.terminal(`Handover: ${use.title.slice(0, 40)}`, use.repo, plan.prompt);
        say('done', `Claude Code is open in ${use.repo} with the handover in ${path.relative(use.repo, plan.folder).replace(/\\/g, '/')}${missing.length ? `. ${missing.length} ${missing.length === 1 ? 'file was' : 'files were'} missing and not copied.` : '.'}`);
      } catch (e) {
        say('error', `Nothing was handed over: ${(e as Error).message}`);
      }
    },
  };
}
