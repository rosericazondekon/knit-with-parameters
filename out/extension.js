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
exports.activate = activate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const node_crypto_1 = require("node:crypto");
const core_1 = require("./core");
const executables_1 = require("./executables");
const preview_1 = require("./preview");
function activate(context) {
    const output = vscode.window.createOutputChannel('Knit with Parameters');
    context.subscriptions.push(output, vscode.commands.registerCommand('knitWithParameters.open', async () => {
        const document = vscode.window.activeTextEditor?.document;
        if (!document || document.uri.scheme !== 'file' || !(0, core_1.eligible)(document.fileName)) {
            void vscode.window.showErrorMessage('Open a saved .Rmd or .qmd document first.');
            return;
        }
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showErrorMessage('Trust this workspace before running report code.');
            return;
        }
        if (document.isDirty && !await saveDocument(document))
            return;
        const panel = vscode.window.createWebviewPanel('knitParameters', `Parameters: ${path.basename(document.fileName)}`, vscode.ViewColumn.Beside, {
            enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')], retainContextWhenHidden: true
        });
        panel.iconPath = {
            light: vscode.Uri.joinPath(context.extensionUri, 'media/light/file-icon-16x16-preview.png'),
            dark: vscode.Uri.joinPath(context.extensionUri, 'media/dark/file-icon-16x16-preview-dark.png')
        };
        let schema = [];
        let snapshot = '';
        let schemaReady = false;
        let busy = false;
        let disposed = false;
        let runner;
        const config = () => vscode.workspace.getConfiguration('knitWithParameters', document.uri);
        const findTool = async (tool) => {
            const setting = tool === 'quarto' ? 'quartoPath' : 'rscriptPath';
            const executable = await (0, executables_1.resolveExecutable)(tool, config().get(setting, ''), { appRoot: vscode.env.appRoot });
            output.appendLine(`${tool}: ${executable}`);
            return executable;
        };
        const post = (message) => { if (!disposed)
            void panel.webview.postMessage(message); };
        const status = (text) => post({ type: 'status', text, busy });
        const secrets = [];
        const redact = (text) => secrets.reduce((s, secret) => s.split(secret).join('[REDACTED]'), text);
        const log = (text) => output.append(redact(text));
        async function bridge(mode, dir, values, outputParams) {
            const request = path.join(dir, 'request.json');
            const response = path.join(dir, 'response.json');
            await fs.rm(response, { force: true });
            await fs.writeFile(request, JSON.stringify({ file: document.fileName, values, outputParams }), { mode: 0o600 });
            let failure;
            try {
                await runner.run(await findTool('Rscript'), [context.asAbsolutePath('scripts/bridge.R'), mode, request, response], path.dirname(document.fileName), mode === 'inspect' || mode === 'resolve' ? () => { } : log);
            }
            catch (error) {
                if (error instanceof core_1.Cancelled)
                    throw error;
                failure = error;
            }
            let result;
            try {
                result = JSON.parse(await fs.readFile(response, 'utf8'));
            }
            catch {
                throw failure || new Error('The R helper returned no valid response. Check that knitr and jsonlite are installed in the configured R.');
            }
            if (result.error)
                throw new Error(redact(result.error));
            if (failure)
                throw failure;
            return result;
        }
        async function currentText() {
            const open = await vscode.workspace.openTextDocument(document.uri);
            if (open.isDirty)
                throw new Error('The document has unsaved changes. Save it, then refresh parameters.');
            return fs.readFile(document.fileName, 'utf8');
        }
        async function operation(work) {
            if (busy || disposed)
                return;
            busy = true;
            runner = new core_1.ProcessRunner();
            let dir;
            let finalText = 'Ready.';
            try {
                dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knit-params-'));
                await fs.chmod(dir, 0o700);
                await work(dir);
            }
            catch (error) {
                const text = error instanceof Error ? redact(error.message) : 'Operation failed.';
                finalText = text;
                post({ type: 'error', text });
                if (!(error instanceof core_1.Cancelled))
                    void vscode.window.showErrorMessage(text);
            }
            finally {
                if (dir)
                    await fs.rm(dir, { recursive: true, force: true }).catch(() => { });
                busy = false;
                runner = undefined;
                secrets.length = 0;
                status(finalText);
            }
        }
        async function refresh() {
            await operation(async (dir) => {
                status('Reading parameter declarations…');
                schemaReady = false;
                snapshot = await currentText();
                schema = [];
                const inspection = await bridge('inspect', dir);
                if (inspection.hasExpressions) {
                    const choice = await vscode.window.showWarningMessage('This document contains executable R parameter expressions. Resolving defaults and choices can run code and access the network.', { modal: true }, 'Evaluate parameters');
                    if (choice !== 'Evaluate parameters')
                        throw new core_1.Cancelled();
                }
                if (disposed)
                    throw new core_1.Cancelled();
                const resolved = await bridge('resolve', dir);
                if (snapshot !== await currentText())
                    throw new Error('Document changed during discovery. Refresh parameters.');
                if (!Array.isArray(resolved.parameters))
                    throw new Error('Invalid parameter schema from R.');
                schema = resolved.parameters;
                schemaReady = true;
                post({ type: 'schema', file: path.basename(document.fileName), parameters: schema });
            });
        }
        let ready = false;
        const listener = panel.webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message.type !== 'string')
                return;
            if (message.type === 'cancel') {
                if (busy) {
                    runner?.cancel();
                    status('Cancelling…');
                }
                else
                    panel.dispose();
            }
            else if (message.type === 'ready' && !ready) {
                ready = true;
                await refresh();
            }
            else if (message.type === 'refresh')
                await refresh();
            else if (message.type === 'knit') {
                await operation(async (dir) => {
                    if (!vscode.workspace.isTrusted)
                        throw new Error('Workspace trust is required.');
                    if (!schemaReady || !snapshot || snapshot !== await currentText())
                        throw new Error('Document changed. Refresh parameters before knitting.');
                    const values = (0, core_1.validateValues)(message.values, schema);
                    for (const p of schema) {
                        if (p.type === 'password') {
                            const value = values[p.name].useDefault ? p.value : values[p.name].value;
                            if (typeof value === 'string' && value)
                                secrets.push(value);
                        }
                    }
                    output.show(true);
                    log(`\nRendering ${path.basename(document.fileName)}…\n`);
                    status('Rendering report…');
                    let rendered = [];
                    if (/\.rmd$/i.test(document.fileName)) {
                        const result = (await bridge('render-rmd', dir, values)).output;
                        rendered = Array.isArray(result) ? result : [result];
                    }
                    else {
                        const params = path.join(dir, 'params.yml');
                        const hasOverrides = Object.values(values).some(v => !v.useDefault);
                        if (hasOverrides)
                            await bridge('write-quarto-params', dir, values, params);
                        const args = ['render', document.fileName];
                        if (hasOverrides)
                            args.push('--execute-params', params);
                        let renderLog = '';
                        await runner.run(await findTool('quarto'), args, path.dirname(document.fileName), text => {
                            renderLog = (renderLog + text).slice(-1024 * 1024);
                            log(text);
                        });
                        rendered = (0, preview_1.quartoOutputPaths)(renderLog, path.dirname(document.fileName));
                    }
                    log('Rendering completed successfully.\n');
                    if (!disposed) {
                        const outputFile = rendered.find(file => /\.html?$/i.test(file)) ?? rendered[0];
                        if (outputFile) {
                            try {
                                await (0, preview_1.previewOutput)(outputFile);
                            }
                            catch (error) {
                                const detail = error instanceof Error ? redact(error.message) : 'Preview unavailable.';
                                log(`Report rendered, but automatic preview failed: ${detail}\n`);
                                void vscode.window.showWarningMessage(`Report rendered, but automatic preview failed: ${detail}`);
                            }
                        }
                        else {
                            void vscode.window.showWarningMessage('Report rendered successfully, but Quarto did not report an output path. Check Knit with Parameters output.');
                        }
                    }
                });
            }
        });
        const dispose = panel.onDidDispose(() => { disposed = true; runner?.cancel(); listener.dispose(); });
        context.subscriptions.push(panel, listener, dispose);
        panel.webview.html = html(panel.webview, context.extensionUri);
    }));
}
async function saveDocument(document) {
    const answer = await vscode.window.showWarningMessage('Save this document before configuring and rendering parameters?', { modal: true }, 'Save');
    return answer === 'Save' && await document.save();
}
function html(webview, uri) {
    const nonce = (0, node_crypto_1.randomBytes)(24).toString('hex');
    const js = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'media/form.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'media/form.css'));
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"><title>Knit with Parameters</title></head><body><main><h1 id="title">Knit with Parameters</h1><p id="status" role="status">Loading…</p><form id="form"><div id="fields"></div><div><button id="knit" type="submit" disabled>Knit</button><button id="cancel" type="button">Cancel</button><button id="refresh" type="button">Refresh parameters</button></div></form></main><script nonce="${nonce}" src="${js}"></script></body></html>`;
}
//# sourceMappingURL=extension.js.map