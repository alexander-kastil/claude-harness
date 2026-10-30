import * as os from 'os';
import type * as vscode from 'vscode';
import type { DesignList, DesignSystem } from './cowork-design';
import { READ_ENV, READ_MODEL, READ_REMEMBERED, READ_SYSTEM, READ_TOOL, READS_KEY, designReadPrompt, parseDesignRead } from './cowork-design-read';
import type { DesignReads } from './cowork-design-read';
import type { Confirm, ToWebview } from './shared/messages';
import { draftStyle } from './style';

export interface DesignReadDeps {
  state: vscode.Memento;
  /** The design system the panel last listed, by id. */
  find: (id: string) => DesignSystem | undefined;
}

/** The list with what was read of each design system before, from the extension's storage. */
export const withReads = (list: DesignList, state: vscode.Memento): DesignList => ({ ...list, reads: state.get<DesignReads>(READS_KEY, {}) });

const friendly = (error: string): string => `Claude could not read the design system: ${error.split('\n')[0].slice(0, 160)}`;

/** The press on "Read with Claude": asks first, then one headless run on the Artifact tool, cached per artifact and version. */
export function designReader(d: DesignReadDeps) {
  let busy = false;
  return async (id: string, answer: { confirmed?: boolean; remember?: boolean }, ask: (c: Confirm) => void, post: (m: ToWebview) => void): Promise<void> => {
    const system = d.find(id);
    if (!system || system.standalone) return void post({ type: 'designRead', id, state: 'error', error: 'That design system is not in the list.' });
    if (!answer.confirmed && !d.state.get<boolean>(READ_REMEMBERED)) return ask({ kind: 'designRead', key: 'read', id, name: system.name });
    if (answer.remember) await d.state.update(READ_REMEMBERED, true);
    if (busy) return;
    busy = true;
    post({ type: 'designRead', id, state: 'running' });
    try {
      const result = await draftStyle(designReadPrompt(system.url, system.name), READ_MODEL, os.tmpdir(), 600000, READ_SYSTEM, { tool: READ_TOOL, env: READ_ENV });
      if ('error' in result) return void post({ type: 'designRead', id, state: 'error', error: friendly(result.error) });
      const read = parseDesignRead(result.text, system.version, Date.now(), result.cost);
      if ('error' in read) return void post({ type: 'designRead', id, state: 'error', error: friendly(read.error) });
      await d.state.update(READS_KEY, { ...d.state.get<DesignReads>(READS_KEY, {}), [id]: read });
      post({ type: 'designRead', id, state: 'done', read });
    } catch (e) {
      post({ type: 'designRead', id, state: 'error', error: friendly((e as Error).message) });
    } finally {
      busy = false;
    }
  };
}
