import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

/** img_<yyyyMMdd_HHmmss>.png from the local time of `d`. */
export function imageFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `img_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

/** Where pasted clipboard images are saved. */
export function imageFolder(): string {
  return path.join(os.tmpdir(), 'claude-harness-images');
}

/** The text typed into the terminal for a saved image: the quoted path and a trailing space, no Enter. */
export function pathText(file: string): string {
  return `"${file}" `;
}

const SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
  '$i = [System.Windows.Forms.Clipboard]::GetImage()',
  'if ($i) { $i.Save($env:CH_IMG_OUT, [System.Drawing.Imaging.ImageFormat]::Png); $i.Dispose(); Write-Output saved }',
].join('; ');

/** Saves the clipboard image as PNG without blocking the host. Resolves the file path, or undefined when the clipboard holds no image. */
export function saveClipboardImage(now = new Date()): Promise<string | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined);
  const dir = imageFolder();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, imageFileName(now));
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', SCRIPT],
      { env: { ...process.env, CH_IMG_OUT: file }, windowsHide: true, timeout: 15000 },
      (err, stdout) => resolve(!err && stdout.includes('saved') && fs.existsSync(file) ? file : undefined));
  });
}

/** The text typed into the terminal for selected explorer items: one Claude `@` mention each, quoted when the path holds a space, ending in a space, no Enter. */
export function mentionText(files: string[]): string {
  return files.map(f => (/\s/.test(f) ? `@"${f}"` : `@${f}`)).join(' ') + ' ';
}
