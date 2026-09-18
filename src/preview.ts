import * as vscode from 'vscode';
import { tryAcquirePositronApi } from '@posit-dev/positron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Quarto reports paths relative to the render process's working directory. */
export function quartoOutputPaths(text: string, cwd: string): string[] {
  const clean = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const paths = [...clean.matchAll(/(?:^|[\r\n])Output created:\s*([^\r\n]+)/g)].map(match => {
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return path.resolve(cwd, value);
  });
  return [...new Set(paths)];
}

export async function previewOutput(file: string): Promise<void> {
  if (!(await fs.stat(file)).isFile()) throw new Error(`Output file not found: ${file}`);
  const uri = vscode.Uri.file(file);
  if (/\.html?$/i.test(file)) {
    const positron = tryAcquirePositronApi();
    if (positron) { positron.window.previewHtml(file); return; }
    if (!await vscode.env.openExternal(uri)) throw new Error('Could not open the HTML report in a browser.');
  } else if (/\.(md|markdown)$/i.test(file)) {
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  } else {
    // PDF/Office output uses an installed editor or the OS file handler.
    await vscode.commands.executeCommand('vscode.open', uri);
  }
}
