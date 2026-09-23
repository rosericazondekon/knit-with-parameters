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
exports.quartoOutputPaths = quartoOutputPaths;
exports.previewOutput = previewOutput;
const vscode = __importStar(require("vscode"));
const positron_1 = require("@posit-dev/positron");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
/** Quarto reports paths relative to the render process's working directory. */
function quartoOutputPaths(text, cwd) {
    const clean = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    const paths = [...clean.matchAll(/(?:^|[\r\n])Output created:\s*([^\r\n]+)/g)].map(match => {
        let value = match[1].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
            value = value.slice(1, -1);
        return path.resolve(cwd, value);
    });
    return [...new Set(paths)];
}
async function previewOutput(file) {
    if (!(await fs.stat(file)).isFile())
        throw new Error(`Output file not found: ${file}`);
    const uri = vscode.Uri.file(file);
    if (/\.html?$/i.test(file)) {
        const positron = (0, positron_1.tryAcquirePositronApi)();
        // Early Positron builds may expose an API without the HTML preview method.
        if (typeof positron?.window?.previewHtml === 'function') {
            await positron.window.previewHtml(file);
            return;
        }
        if (!await vscode.env.openExternal(uri))
            throw new Error('Could not open the HTML report in a browser.');
    }
    else if (/\.(md|markdown)$/i.test(file)) {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
    }
    else {
        // PDF/Office output uses an installed editor or the OS file handler.
        await vscode.commands.executeCommand('vscode.open', uri);
    }
}
//# sourceMappingURL=preview.js.map