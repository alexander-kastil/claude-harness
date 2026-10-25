import * as path from 'path';
import * as vscode from 'vscode';
import { PointerToken, Roster, closest, deadPointers, pathCandidates } from './harness';
import { Problem } from './standard';

export interface LensHost {
  problemsFor(file: string): Problem[];
  baseOf(file: string): string | undefined;
  roster(base: string): Roster;
  alsoDirs(): string[];
  changed: vscode.Event<void>;
}

const norm = (p: string) => p.split('\\').join('/');

export const isHarnessDoc = (file: string) => path.basename(file) === 'CLAUDE.md' || (/\/\.claude\/rules\//.test(norm(file)) && /\.md$/i.test(file));

const isRules = (file: string) => /\/\.claude\/rules\//.test(norm(file));

const kindLabel = (k: PointerToken['kind']) => (k === 'path' ? 'Path' : k === 'skill' ? 'Skill' : 'Agent');

export const POINTER_MESSAGE = /^(Path|Skill|Agent) `([^`]+)` not found$|^pointer not found: (\S+)$/;

export function pointerOf(d: vscode.Diagnostic): { token: string; kind: PointerToken['kind'] } | undefined {
  const m = POINTER_MESSAGE.exec(d.message);
  if (!m) return undefined;
  return m[2] ? { token: m[2], kind: m[1].toLowerCase() as PointerToken['kind'] } : { token: m[3], kind: 'path' };
}

const lineRange = (doc: vscode.TextDocument, line: number) =>
  line + 1 < doc.lineCount ? new vscode.Range(line, 0, line + 1, 0) : new vscode.Range(line, 0, line, doc.lineAt(line).text.length);

// rules files can carry another language (Instructions), so match by path as well
const selector: vscode.DocumentSelector = [
  { language: 'markdown', scheme: 'file' },
  { scheme: 'file', pattern: '**/CLAUDE.md' },
  { scheme: 'file', pattern: '**/.claude/rules/**/*.md' },
];

export function registerLenses(context: vscode.ExtensionContext, host: LensHost): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('claudeHarness.pointers');
  const own = (doc: vscode.TextDocument): PointerToken[] => {
    if (doc.uri.scheme !== 'file' || !isHarnessDoc(doc.uri.fsPath)) return [];
    const base = host.baseOf(doc.uri.fsPath);
    if (!base) return [];
    return deadPointers(doc.getText(), base, host.roster(base), isRules(doc.uri.fsPath) ? ['path', 'skill', 'agent'] : ['skill', 'agent'], host.alsoDirs());
  };
  const update = (doc: vscode.TextDocument) => {
    if (doc.uri.scheme !== 'file' || !isHarnessDoc(doc.uri.fsPath)) return;
    collection.set(
      doc.uri,
      own(doc).map(t => {
        const d = new vscode.Diagnostic(new vscode.Range(t.line, t.start, t.line, t.end), `${kindLabel(t.kind)} \`${t.token}\` not found`, vscode.DiagnosticSeverity.Warning);
        d.source = 'Claude Harness';
        d.code = 'pointer';
        return d;
      })
    );
  };
  const candidates = (file: string, token: string, kind: PointerToken['kind']): string[] => {
    const base = host.baseOf(file);
    if (!base) return [];
    if (kind === 'path') return pathCandidates(token, base);
    const roster = host.roster(base);
    return closest(token, kind === 'skill' ? roster.skills : roster.agents);
  };
  const lensChanged = new vscode.EventEmitter<void>();
  const lenses: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: lensChanged.event,
    provideCodeLenses: doc => {
      if (doc.uri.scheme !== 'file' || !isHarnessDoc(doc.uri.fsPath)) return [];
      const out: vscode.CodeLens[] = [];
      const at = (line: number) => doc.lineAt(Math.min(line, doc.lineCount - 1)).range;
      for (const p of host.problemsFor(doc.uri.fsPath)) {
        if (p.code === 'restated') {
          out.push(new vscode.CodeLens(at(p.line), { title: `${p.message.replace(/^line \d+ /, '')}: Remove line`, command: 'claudeHarness.removeLine', arguments: [doc.uri, p.line] }));
        } else if (p.code === 'boilerplate') {
          out.push(new vscode.CodeLens(at(p.line), { title: `${p.message.replace(/^line \d+ /, '')}: open the standard`, command: 'claudeHarness.openStandard', arguments: [] }));
        } else if (p.code === 'pointer' && p.token) {
          out.push(
            new vscode.CodeLens(at(p.line), { title: `Pointer not found: ${p.token}: Repoint...`, command: 'claudeHarness.repoint', arguments: [doc.uri, p.line, p.token, 'path'] }),
            new vscode.CodeLens(at(p.line), { title: 'Drop line', command: 'claudeHarness.removeLine', arguments: [doc.uri, p.line] })
          );
        }
      }
      for (const t of own(doc))
        out.push(
          new vscode.CodeLens(at(t.line), { title: `${kindLabel(t.kind)} not found: ${t.token}: Repoint...`, command: 'claudeHarness.repoint', arguments: [doc.uri, t.line, t.token, t.kind] }),
          new vscode.CodeLens(at(t.line), { title: 'Drop line', command: 'claudeHarness.removeLine', arguments: [doc.uri, t.line] })
        );
      return out;
    },
  };
  const actions: vscode.CodeActionProvider = {
    provideCodeActions: (doc, _range, ctx) => {
      const out: vscode.CodeAction[] = [];
      for (const d of ctx.diagnostics) {
        const line = d.range.start.line;
        const drop = (title: string) => {
          const a = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
          a.edit = new vscode.WorkspaceEdit();
          a.edit.delete(doc.uri, lineRange(doc, line));
          a.diagnostics = [d];
          return a;
        };
        const pointer = pointerOf(d);
        if (pointer) {
          const text = doc.lineAt(line).text;
          const col = text.indexOf(pointer.token);
          for (const c of col < 0 ? [] : candidates(doc.uri.fsPath, pointer.token, pointer.kind)) {
            const a = new vscode.CodeAction(`Repoint to ${c}`, vscode.CodeActionKind.QuickFix);
            a.edit = new vscode.WorkspaceEdit();
            a.edit.replace(doc.uri, new vscode.Range(line, col, line, col + pointer.token.length), c);
            a.diagnostics = [d];
            out.push(a);
          }
          out.push(drop('Drop line'));
        } else if (d.code === 'restated') out.push(drop('Remove line'));
      }
      return out;
    },
  };
  const removeLine = async (uri: vscode.Uri, line: number) => {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (line >= doc.lineCount) return;
    const edit = new vscode.WorkspaceEdit();
    edit.delete(uri, lineRange(doc, line));
    await vscode.workspace.applyEdit(edit);
  };
  const repoint = async (uri: vscode.Uri, line: number, token: string, kind: PointerToken['kind']) => {
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.lineAt(line).text;
    const col = text.indexOf(token);
    if (col < 0) return;
    const items: vscode.QuickPickItem[] = [...candidates(uri.fsPath, token, kind).map(label => ({ label })), { label: '$(edit) Type a value...', alwaysShow: true }];
    const pick = await vscode.window.showQuickPick(items, { title: `Repoint ${token}` });
    if (!pick) return;
    const value = pick.label.startsWith('$(edit)') ? await vscode.window.showInputBox({ prompt: `Replace ${token} with`, value: token }) : pick.label;
    if (!value || value === token) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(line, col, line, col + token.length), value);
    await vscode.workspace.applyEdit(edit);
  };
  const refreshAll = () => {
    for (const doc of vscode.workspace.textDocuments) update(doc);
    lensChanged.fire();
  };
  context.subscriptions.push(
    collection,
    lensChanged,
    vscode.languages.registerCodeLensProvider(selector, lenses),
    vscode.languages.registerCodeActionsProvider(selector, actions, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    vscode.commands.registerCommand('claudeHarness.removeLine', removeLine),
    vscode.commands.registerCommand('claudeHarness.repoint', repoint),
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidSaveTextDocument(update),
    vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)),
    host.changed(refreshAll)
  );
  refreshAll();
  return collection;
}
