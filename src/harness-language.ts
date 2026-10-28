import * as path from 'path';
import * as vscode from 'vscode';
import { checkScriptText } from './cli-build';
import { hoverFor, scriptCandidates } from './harness-script';

// The .harness language: completions from the command line's candidates, hovers from its HELP text, `validate` problems as diagnostics.

const SELECTOR: vscode.DocumentSelector = { language: 'harness' };
const KIND = { command: vscode.CompletionItemKind.Function, flag: vscode.CompletionItemKind.Property, value: vscode.CompletionItemKind.Value };

export function registerHarnessLanguage(context: vscode.ExtensionContext, claudeRoot: () => string): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('claudeHarness.script');
  const check = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'harness' || doc.uri.scheme !== 'file') return;
    const baseDir = path.dirname(doc.uri.fsPath);
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? baseDir;
    // a line is validated when the cursor leaves it, never while the cursor is on it
    const typing = vscode.window.visibleTextEditors.filter(e => e.document === doc).flatMap(e => e.selections.map(s => s.active.line + 1));
    const { problems } = checkScriptText(doc.getText(), baseDir, claudeRoot(), folder, typing);
    collection.set(
      doc.uri,
      problems.map(p => {
        const line = doc.lineAt(Math.max(0, Math.min(p.line - 1, doc.lineCount - 1)));
        const d = new vscode.Diagnostic(new vscode.Range(line.lineNumber, line.firstNonWhitespaceCharacterIndex, line.lineNumber, line.text.length), p.message, vscode.DiagnosticSeverity.Error);
        d.source = 'Claude Harness';
        d.code = 'script';
        return d;
      })
    );
  };
  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidSaveTextDocument(check),
    // at once, not debounced: a diagnostic on the cursor line is gone before the next paint
    vscode.workspace.onDidChangeTextDocument(e => check(e.document)),
    vscode.window.onDidChangeTextEditorSelection(e => check(e.textEditor.document)),
    vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)),
    vscode.languages.registerCompletionItemProvider(
      SELECTOR,
      {
        provideCompletionItems(doc, pos) {
          const { start, candidates } = scriptCandidates(doc.lineAt(pos.line).text.slice(0, pos.character));
          const range = new vscode.Range(pos.line, start, pos.line, pos.character);
          return candidates.map((c, i) => {
            const item = new vscode.CompletionItem(c.text, KIND[c.kind]);
            item.range = range;
            item.detail = c.description || undefined;
            item.sortText = String(i).padStart(4, '0');
            return item;
          });
        },
      },
      ' ',
      '-',
      ',',
      '='
    ),
    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(doc, pos) {
        const range = doc.getWordRangeAtPosition(pos, /[^\s"']+/);
        if (!range) return undefined;
        const entries = hoverFor(doc.lineAt(pos.line).text, doc.getText(range));
        if (!entries.length) return undefined;
        const md = new vscode.MarkdownString();
        entries.forEach((e, i) => md.appendMarkdown(`${i ? '\n\n---\n\n' : ''}\`${e.usage}\`\n\n${e.text}`));
        return new vscode.Hover(md, range);
      },
    })
  );
  vscode.workspace.textDocuments.forEach(check);
  return collection;
}
