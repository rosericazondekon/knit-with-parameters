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
const filePicker_1 = require("./filePicker");
const pythonDocument_1 = require("./pythonDocument");
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
        let schemaExpressions = false;
        let busy = false;
        let disposed = false;
        let runner;
        let picking = false;
        const config = () => vscode.workspace.getConfiguration('knitWithParameters', document.uri);
        const findTool = async (tool) => {
            const setting = tool === 'quarto' ? 'quartoPath' : tool === 'python' ? 'pythonPath' : 'rscriptPath';
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
        async function bridge(mode, dir, values, outputParams, pythonValues) {
            const request = path.join(dir, 'request.json');
            const response = path.join(dir, 'response.json');
            await fs.rm(response, { force: true });
            await fs.writeFile(request, JSON.stringify({ file: document.fileName, values, outputParams, pythonValues }), { mode: 0o600 });
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
        const validPythonValue = (value) => {
            if (value === null || typeof value === 'string' || typeof value === 'boolean')
                return true;
            if (typeof value === 'number')
                return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
            return Array.isArray(value) && value.every(validPythonValue);
        };
        async function resolvePython(dir, executable, expressions) {
            const request = path.join(dir, 'python-request.json');
            const response = path.join(dir, 'python-response.json');
            await fs.rm(response, { force: true });
            await fs.writeFile(request, JSON.stringify({ expressions }), { mode: 0o600 });
            let failure;
            try {
                await runner.run(executable, [context.asAbsolutePath('scripts/bridge.py'), request, response], path.dirname(document.fileName), () => { });
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
                throw failure || new Error('The Python helper returned no valid response.');
            }
            if (typeof result?.error === 'string')
                throw new Error(redact(result.error));
            if (failure)
                throw failure;
            const values = result?.values;
            const names = Object.keys(expressions);
            if (!values || typeof values !== 'object' || Array.isArray(values) ||
                Object.keys(values).length !== names.length || !names.every(name => Object.prototype.hasOwnProperty.call(values, name)) ||
                !Object.values(values).every(validPythonValue))
                throw new Error('The Python helper returned invalid parameter values.');
            return values;
        }
        async function currentText() {
            const open = await vscode.workspace.openTextDocument(document.uri);
            if (open.isDirty)
                throw new Error('The document has unsaved changes. Save it, then refresh parameters.');
            return fs.readFile(document.fileName, 'utf8');
        }
        async function inspectQuartoOutput(quarto, source, originalStem, temporaryStem) {
            let stdout = '';
            await runner.run(quarto, ['inspect', source], path.dirname(document.fileName), text => { stdout += text; });
            let inspected;
            try {
                inspected = JSON.parse(stdout);
            }
            catch {
                throw new Error('Quarto inspect returned invalid output metadata.');
            }
            const first = inspected?.formats && typeof inspected.formats === 'object' && !Array.isArray(inspected.formats)
                ? Object.values(inspected.formats)[0] : undefined;
            const outputFile = first?.pandoc?.['output-file'];
            if (typeof outputFile !== 'string' || !outputFile)
                return undefined;
            const parsed = path.parse(outputFile);
            if (parsed.name !== temporaryStem)
                return undefined;
            return path.join(parsed.dir, `${originalStem}${parsed.ext}`);
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
                schemaExpressions = false;
                snapshot = await currentText();
                schema = [];
                const inspection = await bridge('inspect', dir);
                const expressions = inspection?.pythonExpressions;
                const pythonExpressions = Object.create(null);
                if (expressions !== undefined) {
                    if (!expressions || typeof expressions !== 'object' || Array.isArray(expressions) ||
                        !Object.entries(expressions).every(([name, expression]) => name.length > 0 && typeof expression === 'string')) {
                        throw new Error('Invalid Python expression metadata from R.');
                    }
                    Object.assign(pythonExpressions, expressions);
                }
                const hasPython = Object.keys(pythonExpressions).length > 0;
                let pythonExecutable;
                if (hasPython)
                    pythonExecutable = await findTool('python');
                if (inspection.hasExpressions || hasPython) {
                    const languages = inspection.hasRExpressions && hasPython ? 'R and Python' : hasPython ? 'Python' : 'R';
                    const interpreter = pythonExecutable ? `\n\nPython interpreter: ${pythonExecutable}` : '';
                    const choice = await vscode.window.showWarningMessage(`This document contains executable ${languages} parameter expressions. R/Python expressions can run arbitrary code with filesystem and network access and are not sandboxed.${interpreter}`, { modal: true }, 'Evaluate parameters');
                    if (choice !== 'Evaluate parameters')
                        throw new core_1.Cancelled();
                    if (disposed || !vscode.workspace.isTrusted)
                        throw new core_1.Cancelled();
                    if (snapshot !== await currentText())
                        throw new Error('Document changed during discovery. Refresh parameters.');
                }
                let pythonValues;
                if (hasPython)
                    pythonValues = await resolvePython(dir, pythonExecutable, pythonExpressions);
                if (disposed || !vscode.workspace.isTrusted)
                    throw new core_1.Cancelled();
                if (snapshot !== await currentText())
                    throw new Error('Document changed during discovery. Refresh parameters.');
                const resolved = await bridge('resolve', dir, undefined, undefined, pythonValues);
                if (snapshot !== await currentText())
                    throw new Error('Document changed during discovery. Refresh parameters.');
                if (!Array.isArray(resolved.parameters))
                    throw new Error('Invalid parameter schema from R.');
                schema = resolved.parameters;
                schemaExpressions = Boolean(inspection.hasExpressions || hasPython);
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
            else if (message.type === 'pickFile') {
                const name = message.name;
                const requestId = message.requestId;
                if (disposed || typeof name !== 'string' || !Number.isSafeInteger(requestId) || requestId <= 0 ||
                    !schema.some(parameter => parameter.name === name && parameter.type === 'file'))
                    return;
                const blocked = !vscode.workspace.isTrusted ? 'Trust this workspace before selecting a file.'
                    : busy ? 'Wait for the current operation to finish before selecting a file.'
                        : picking ? 'A file picker is already open. Complete or cancel that dialog first.'
                            : !schemaReady ? 'Refresh parameters before selecting a file.' : '';
                if (blocked) {
                    post({ type: 'filePicked', name, requestId, value: null, error: blocked });
                    return;
                }
                const selectionSchema = schema;
                picking = true;
                post({ type: 'filePickerOpened', name, requestId });
                let value = null;
                let pickerError = '';
                try {
                    const picked = await (0, filePicker_1.pickInputFile)(path.dirname(document.fileName));
                    if (picked)
                        value = path.relative(path.dirname(document.fileName), picked);
                }
                catch {
                    value = null;
                    pickerError = 'Unable to open the file picker. Enter the file path manually or reload the editor window.';
                }
                finally {
                    picking = false;
                }
                if (schema === selectionSchema && !busy && !disposed && vscode.workspace.isTrusted) {
                    post({ type: 'filePicked', name, requestId, value, ...(pickerError ? { error: pickerError } : {}) });
                }
            }
            else if (message.type === 'knit') {
                await operation(async (dir) => {
                    if (!vscode.workspace.isTrusted)
                        throw new Error('Workspace trust is required.');
                    if (!schemaReady || !snapshot || snapshot !== await currentText())
                        throw new Error('Document changed. Refresh parameters before knitting.');
                    const values = (0, core_1.validateValues)(message.values, schema);
                    for (const p of schema) {
                        if (p.type === 'password') {
                            const value = values[p.name].value;
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
                        const hasParameters = Object.keys(values).length > 0;
                        if (hasParameters)
                            await bridge('write-quarto-params', dir, values, params);
                        const quarto = await findTool('quarto');
                        const original = document.fileName;
                        const reportDir = path.dirname(original);
                        let source = original;
                        let temporary;
                        let outputFile;
                        try {
                            if (schemaExpressions) {
                                const extension = path.extname(original);
                                const temporaryStem = `.knit-params-${(0, node_crypto_1.randomBytes)(12).toString('hex')}`;
                                temporary = path.join(reportDir, temporaryStem + extension);
                                const submitted = Object.fromEntries(Object.entries(values).map(([name, selection]) => [name, selection.value]));
                                const materialized = (0, pythonDocument_1.materializeParameterExpressions)(snapshot, submitted, schema);
                                await fs.writeFile(temporary, materialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
                                source = temporary;
                                outputFile = await inspectQuartoOutput(quarto, source, path.parse(original).name, temporaryStem);
                            }
                            const args = ['render', temporary ? path.basename(source) : source];
                            if (hasParameters)
                                args.push('--execute-params', params);
                            if (outputFile)
                                args.push('--output', outputFile);
                            let renderLog = '';
                            await runner.run(quarto, args, reportDir, text => {
                                renderLog = (renderLog + text).slice(-1024 * 1024);
                                log(text);
                            });
                            rendered = (0, preview_1.quartoOutputPaths)(renderLog, reportDir);
                        }
                        finally {
                            if (temporary)
                                await fs.rm(temporary, { force: true }).catch(() => { });
                        }
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