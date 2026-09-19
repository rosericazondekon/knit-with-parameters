import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

type PickerItem = vscode.QuickPickItem & {
  action: 'file' | 'folder' | 'parent' | 'enterPath';
  filePath?: string;
};

function expandHome(directory: string): string {
  if (directory === '~') return os.homedir();
  if (/^~[\\/]/.test(directory)) return path.join(os.homedir(), directory.slice(2));
  return directory;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Lets the user browse the local filesystem and choose one input file. */
export async function pickInputFile(startDirectory: string): Promise<string | undefined> {
  let currentDirectory = path.resolve(expandHome(startDirectory));

  while (true) {
    let names: string[];
    try {
      names = await fs.readdir(currentDirectory);
    } catch (error) {
      await vscode.window.showErrorMessage(`Unable to read folder "${currentDirectory}": ${errorText(error)}`);
      return undefined;
    }

    const entries = await Promise.all(names.map(async name => {
      const filePath = path.join(currentDirectory, name);
      try {
        const status = await fs.stat(filePath);
        if (status.isDirectory()) return {name, filePath, action: 'folder' as const};
        if (status.isFile()) return {name, filePath, action: 'file' as const};
      } catch {
        // Entries can disappear or become inaccessible while the picker is open.
      }
      return undefined;
    }));

    const folders = entries.filter((entry): entry is NonNullable<typeof entry> => entry?.action === 'folder')
      .sort((left, right) => left.name.localeCompare(right.name));
    const files = entries.filter((entry): entry is NonNullable<typeof entry> => entry?.action === 'file')
      .sort((left, right) => left.name.localeCompare(right.name));
    const items: PickerItem[] = [
      ...(path.dirname(currentDirectory) !== currentDirectory
        ? [{label: '..', description: 'Parent folder', action: 'parent' as const}]
        : []),
      {label: 'Enter folder path…', description: 'Open a folder by path', action: 'enterPath'},
      ...folders.map(entry => ({label: entry.name, description: 'Folder', action: entry.action, filePath: entry.filePath})),
      ...files.map(entry => ({label: entry.name, action: entry.action, filePath: entry.filePath}))
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Select input dataset',
      placeHolder: currentDirectory,
      ignoreFocusOut: true
    });
    if (!selected) return undefined;

    if (selected.action === 'file') return selected.filePath;
    if (selected.action === 'folder') {
      currentDirectory = selected.filePath!;
      continue;
    }
    if (selected.action === 'parent') {
      currentDirectory = path.dirname(currentDirectory);
      continue;
    }

    const enteredDirectory = await vscode.window.showInputBox({
      title: 'Select input dataset',
      prompt: 'Enter a folder path',
      value: currentDirectory,
      ignoreFocusOut: true
    });
    if (enteredDirectory === undefined) continue;

    const requestedDirectory = path.resolve(currentDirectory, expandHome(enteredDirectory));
    try {
      const status = await fs.stat(requestedDirectory);
      if (!status.isDirectory()) {
        await vscode.window.showErrorMessage(`"${requestedDirectory}" is not a folder.`);
        continue;
      }
      currentDirectory = requestedDirectory;
    } catch (error) {
      await vscode.window.showErrorMessage(`Unable to open folder "${requestedDirectory}": ${errorText(error)}`);
    }
  }
}
