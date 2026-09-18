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
exports.resolveExecutable = resolveExecutable;
const fs = __importStar(require("node:fs/promises"));
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
/** Resolve on the extension host without executing shell commands or searching the workspace. */
async function resolveExecutable(tool, configured = '', options = {}) {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const home = options.home ?? os.homedir();
    const p = platform === 'win32' ? path.win32 : path.posix;
    const executable = options.executable ?? (async (file) => {
        try {
            if (!(await fs.stat(file)).isFile())
                return false;
            await fs.access(file, platform === 'win32' ? node_fs_1.constants.F_OK : node_fs_1.constants.X_OK);
            return true;
        }
        catch (error) {
            if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code ?? ''))
                return false;
            throw error;
        }
    });
    const directories = options.directories ?? (async (directory) => {
        try {
            return (await fs.readdir(directory, { withFileTypes: true })).filter(d => d.isDirectory() || d.isSymbolicLink()).map(d => d.name);
        }
        catch (error) {
            if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code ?? ''))
                return [];
            throw error;
        }
    });
    const pathValue = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
    const pathDirs = pathValue.split(platform === 'win32' ? ';' : ':').filter(dir => p.isAbsolute(dir));
    const filename = platform === 'win32' ? `${tool}.exe` : tool;
    const expand = (value) => value.startsWith('~/') || value.startsWith('~\\') ? p.join(home, value.slice(2)) : value;
    const first = async (candidates) => {
        for (const file of [...new Set(candidates)])
            if (await executable(file))
                return file;
        return undefined;
    };
    const setting = configured.trim();
    // Historical default command names also mean automatic discovery.
    if (setting && setting.toLowerCase() !== tool.toLowerCase() && setting.toLowerCase() !== `${tool}.exe`.toLowerCase()) {
        const value = expand(setting);
        const candidates = p.isAbsolute(value) ? [value] : !/[\\/]/.test(value)
            ? pathDirs.map(dir => p.join(dir, platform === 'win32' && !p.extname(value) ? `${value}.exe` : value)) : [];
        const found = await first(candidates);
        if (found)
            return found;
        throw new Error(`Configured ${tool} executable was not found or is not executable: ${setting}. Correct Knit with Parameters settings or clear the setting for automatic detection.`);
    }
    const onPath = await first(pathDirs.map(dir => p.join(dir, filename)));
    if (onPath)
        return onPath;
    const candidates = [];
    if (tool === 'quarto' && options.appRoot)
        candidates.push(p.join(options.appRoot, 'quarto', 'bin', filename));
    if (platform === 'darwin') {
        if (tool === 'Rscript')
            candidates.push('/Library/Frameworks/R.framework/Resources/bin/Rscript');
        else
            candidates.push('/Applications/quarto/bin/quarto', p.join(home, 'Applications/quarto/bin/quarto'));
        candidates.push(`/opt/homebrew/bin/${tool}`, `/usr/local/bin/${tool}`, `/opt/local/bin/${tool}`, `/usr/bin/${tool}`);
    }
    else if (platform === 'win32') {
        const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
        if (tool === 'quarto') {
            candidates.push(p.join(programFiles, 'Quarto', 'bin', filename));
            if (env.LOCALAPPDATA)
                candidates.push(p.join(env.LOCALAPPDATA, 'Programs', 'Quarto', 'bin', filename));
        }
        else {
            const roots = [p.join(programFiles, 'R')];
            if (env.LOCALAPPDATA)
                roots.push(p.join(env.LOCALAPPDATA, 'Programs', 'R'));
            for (const root of roots) {
                const versions = (await directories(root)).filter(name => /^R-\d/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
                for (const version of versions)
                    candidates.push(p.join(root, version, 'bin', filename), p.join(root, version, 'bin', 'x64', filename));
            }
        }
    }
    else {
        candidates.push(p.join(home, '.local', 'bin', tool), `/usr/local/bin/${tool}`, `/usr/bin/${tool}`, `/opt/${tool === 'quarto' ? 'quarto' : 'R/current'}/bin/${tool}`);
        if (tool === 'Rscript') {
            const versions = (await directories('/opt/R')).filter(name => /^\d/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
            for (const version of versions)
                candidates.push(`/opt/R/${version}/bin/Rscript`);
        }
    }
    const found = await first(candidates);
    if (found)
        return found;
    throw new Error(`Could not locate ${tool}. Install it on the extension host or set Knit with Parameters: ${tool === 'quarto' ? 'Quarto' : 'Rscript'} Path to its executable. Searched PATH${options.appRoot && tool === 'quarto' ? ', the IDE bundle' : ''}, and standard installation locations.`);
}
//# sourceMappingURL=executables.js.map