"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickInputFile = pickInputFile;
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
function expandHome(directory) {
    if (directory === '~')
        return os.homedir();
    if (/^~[\\/]/.test(directory))
        return path.join(os.homedir(), directory.slice(2));
    return directory;
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Lets the user browse the local filesystem and choose one input file. */
async function pickInputFile(startDirectory) {
    let currentDirectory = path.resolve(expandHome(startDirectory));
    while (true) {
        let names;
        try {
            names = await fs.readdir(currentDirectory);
        }
        catch (error) {
            await vscode.window.showErrorMessage(`Unable to read folder "${currentDirectory}": ${errorText(error)}`);
            return undefined;
        }
        const entries = await Promise.all(names.map(async (name) => {
            const filePath = path.join(currentDirectory, name);
            try {
                const status = await fs.stat(filePath);
                if (status.isDirectory())
                    return { name, filePath, action: 'folder' };
                if (status.isFile())
                    return { name, filePath, action: 'file' };
            }
            catch {
                // Entries can disappear or become inaccessible while the picker is open.
            }
            return undefined;
        }));
        const folders = entries.filter((entry) => entry?.action === 'folder')
            .sort((left, right) => left.name.localeCompare(right.name));
        const files = entries.filter((entry) => entry?.action === 'file')
            .sort((left, right) => left.name.localeCompare(right.name));
        const items = [
            ...(path.dirname(currentDirectory) !== currentDirectory
                ? [{ label: '..', description: 'Parent folder', action: 'parent' }]
                : []),
            { label: 'Enter folder path…', description: 'Open a folder by path', action: 'enterPath' },
            ...folders.map(entry => ({ label: entry.name, description: 'Folder', action: entry.action, filePath: entry.filePath })),
            ...files.map(entry => ({ label: entry.name, action: entry.action, filePath: entry.filePath }))
        ];
        const selected = await vscode.window.showQuickPick(items, {
            title: 'Select input dataset',
            placeHolder: currentDirectory,
            ignoreFocusOut: true
        });
        if (!selected)
            return undefined;
        if (selected.action === 'file')
            return selected.filePath;
        if (selected.action === 'folder') {
            currentDirectory = selected.filePath;
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
        if (enteredDirectory === undefined)
            continue;
        const requestedDirectory = path.resolve(currentDirectory, expandHome(enteredDirectory));
        try {
            const status = await fs.stat(requestedDirectory);
            if (!status.isDirectory()) {
                await vscode.window.showErrorMessage(`"${requestedDirectory}" is not a folder.`);
                continue;
            }
            currentDirectory = requestedDirectory;
        }
        catch (error) {
            await vscode.window.showErrorMessage(`Unable to open folder "${requestedDirectory}": ${errorText(error)}`);
        }
    }
}
//# sourceMappingURL=filePicker.js.map