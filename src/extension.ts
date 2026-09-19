import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Cancelled, eligible, Parameter, ProcessRunner, validateValues, Values } from './core';
import { resolveExecutable, Tool } from './executables';
import { previewOutput, quartoOutputPaths } from './preview';
import { pickInputFile } from './filePicker';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Knit with Parameters');
  context.subscriptions.push(output, vscode.commands.registerCommand('knitWithParameters.open', async () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.uri.scheme !== 'file' || !eligible(document.fileName)) {
      void vscode.window.showErrorMessage('Open a saved .Rmd or .qmd document first.'); return;
    }
    if (!vscode.workspace.isTrusted) { void vscode.window.showErrorMessage('Trust this workspace before running report code.'); return; }
    if (document.isDirty && !await saveDocument(document)) return;
    const panel = vscode.window.createWebviewPanel('knitParameters', `Parameters: ${path.basename(document.fileName)}`, vscode.ViewColumn.Beside, {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')], retainContextWhenHidden: true
    });
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media/light/file-icon-16x16-preview.png'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media/dark/file-icon-16x16-preview-dark.png')
    };
    let schema: Parameter[] = [];
    let snapshot = '';
    let schemaReady = false;
    let busy = false;
    let disposed = false;
    let runner: ProcessRunner | undefined;
    let picking = false;
    const config = () => vscode.workspace.getConfiguration('knitWithParameters', document.uri);
    const findTool = async (tool: Tool) => {
      const setting = tool === 'quarto' ? 'quartoPath' : 'rscriptPath';
      const executable = await resolveExecutable(tool, config().get<string>(setting, ''), {appRoot: vscode.env.appRoot});
      output.appendLine(`${tool}: ${executable}`);
      return executable;
    };
    const post = (message: object) => { if (!disposed) void panel.webview.postMessage(message); };
    const status = (text: string) => post({type: 'status', text, busy});
    const secrets: string[] = [];
    const redact = (text: string) => secrets.reduce((s, secret) => s.split(secret).join('[REDACTED]'), text);
    const log = (text: string) => output.append(redact(text));
    async function bridge(mode: string, dir: string, values?: Values, outputParams?: string): Promise<any> {
      const request = path.join(dir, 'request.json');
      const response = path.join(dir, 'response.json');
      await fs.rm(response, {force: true});
      await fs.writeFile(request, JSON.stringify({file: document!.fileName, values, outputParams}), {mode: 0o600});
      let failure: unknown;
      try {
        await runner!.run(await findTool('Rscript'), [context.asAbsolutePath('scripts/bridge.R'), mode, request, response], path.dirname(document!.fileName), mode === 'inspect' || mode === 'resolve' ? () => {} : log);
      } catch (error) { if (error instanceof Cancelled) throw error; failure = error; }
      let result;
      try { result = JSON.parse(await fs.readFile(response, 'utf8')); }
      catch { throw failure || new Error('The R helper returned no valid response. Check that knitr and jsonlite are installed in the configured R.'); }
      if (result.error) throw new Error(redact(result.error));
      if (failure) throw failure;
      return result;
    }
    async function currentText(): Promise<string> {
      const open = await vscode.workspace.openTextDocument(document!.uri);
      if (open.isDirty) throw new Error('The document has unsaved changes. Save it, then refresh parameters.');
      return fs.readFile(document!.fileName, 'utf8');
    }
    async function operation(work: (dir: string) => Promise<void>): Promise<void> {
      if (busy || disposed) return;
      busy = true; runner = new ProcessRunner();
      let dir: string | undefined;
      let finalText = 'Ready.';
      try {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knit-params-'));
        await fs.chmod(dir, 0o700);
        await work(dir);
      } catch (error) {
        const text = error instanceof Error ? redact(error.message) : 'Operation failed.';
        finalText = text;
        post({type: 'error', text});
        if (!(error instanceof Cancelled)) void vscode.window.showErrorMessage(text);
      } finally {
        if (dir) await fs.rm(dir, {recursive: true, force: true}).catch(() => {});
        busy = false; runner = undefined; secrets.length = 0;
        status(finalText);
      }
    }
    async function refresh(): Promise<void> {
      await operation(async dir => {
        status('Reading parameter declarations…');
        schemaReady = false;
        snapshot = await currentText();
        schema = [];
        const inspection = await bridge('inspect', dir);
        if (inspection.hasExpressions) {
          const choice = await vscode.window.showWarningMessage('This document contains executable R parameter expressions. Resolving defaults and choices can run code and access the network.', {modal: true}, 'Evaluate parameters');
          if (choice !== 'Evaluate parameters') throw new Cancelled();
        }
        if (disposed) throw new Cancelled();
        const resolved = await bridge('resolve', dir);
        if (snapshot !== await currentText()) throw new Error('Document changed during discovery. Refresh parameters.');
        if (!Array.isArray(resolved.parameters)) throw new Error('Invalid parameter schema from R.');
        schema = resolved.parameters;
        schemaReady = true;
        post({type: 'schema', file: path.basename(document!.fileName), parameters: schema});
      });
    }
    let ready = false;
    const listener = panel.webview.onDidReceiveMessage(async message => {
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'cancel') {
        if (busy) { runner?.cancel(); status('Cancelling…'); } else panel.dispose();
      } else if (message.type === 'ready' && !ready) { ready = true; await refresh(); }
      else if (message.type === 'refresh') await refresh();
      else if (message.type === 'pickFile') {
        const name = message.name;
        const requestId = message.requestId;
        if (disposed || typeof name !== 'string' || !Number.isSafeInteger(requestId) || requestId <= 0 ||
          !schema.some(parameter => parameter.name === name && parameter.type === 'file')) return;
        const blocked = !vscode.workspace.isTrusted ? 'Trust this workspace before selecting a file.'
          : busy ? 'Wait for the current operation to finish before selecting a file.'
          : picking ? 'A file picker is already open. Complete or cancel that dialog first.'
          : !schemaReady ? 'Refresh parameters before selecting a file.' : '';
        if (blocked) {
          post({type: 'filePicked', name, requestId, value: null, error: blocked});
          return;
        }
        const selectionSchema = schema;
        picking = true;
        post({type: 'filePickerOpened', name, requestId});
        let value: string | null = null;
        let pickerError = '';
        try {
          const picked = await pickInputFile(path.dirname(document!.fileName));
          if (picked) value = path.relative(path.dirname(document!.fileName), picked);
        } catch {
          value = null;
          pickerError = 'Unable to open the file picker. Enter the file path manually or reload the editor window.';
        } finally {
          picking = false;
        }
        if (schema === selectionSchema && !busy && !disposed && vscode.workspace.isTrusted) {
          post({type: 'filePicked', name, requestId, value, ...(pickerError ? {error: pickerError} : {})});
        }
      } else if (message.type === 'knit') {
        await operation(async dir => {
          if (!vscode.workspace.isTrusted) throw new Error('Workspace trust is required.');
          if (!schemaReady || !snapshot || snapshot !== await currentText()) throw new Error('Document changed. Refresh parameters before knitting.');
          const values = validateValues(message.values, schema);
          for (const p of schema) {
            if (p.type === 'password') {
              const value = values[p.name].value;
              if (typeof value === 'string' && value) secrets.push(value);
            }
          }
          output.show(true);
          log(`\nRendering ${path.basename(document!.fileName)}…\n`);
          status('Rendering report…');
          let rendered: string[] = [];
          if (/\.rmd$/i.test(document!.fileName)) {
            const result = (await bridge('render-rmd', dir, values)).output;
            rendered = Array.isArray(result) ? result : [result];
          } else {
            const params = path.join(dir, 'params.yml');
            const hasParameters = Object.keys(values).length > 0;
            if (hasParameters) await bridge('write-quarto-params', dir, values, params);
            const args = ['render', document!.fileName];
            if (hasParameters) args.push('--execute-params', params);
            let renderLog = '';
            await runner!.run(await findTool('quarto'), args, path.dirname(document!.fileName), text => {
              renderLog = (renderLog + text).slice(-1024 * 1024);
              log(text);
            });
            rendered = quartoOutputPaths(renderLog, path.dirname(document!.fileName));
          }
          log('Rendering completed successfully.\n');
          if (!disposed) {
            const outputFile = rendered.find(file => /\.html?$/i.test(file)) ?? rendered[0];
            if (outputFile) {
              try { await previewOutput(outputFile); }
              catch (error) {
                const detail = error instanceof Error ? redact(error.message) : 'Preview unavailable.';
                log(`Report rendered, but automatic preview failed: ${detail}\n`);
                void vscode.window.showWarningMessage(`Report rendered, but automatic preview failed: ${detail}`);
              }
            } else {
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
async function saveDocument(document: vscode.TextDocument): Promise<boolean> {
  const answer = await vscode.window.showWarningMessage('Save this document before configuring and rendering parameters?', {modal: true}, 'Save');
  return answer === 'Save' && await document.save();
}
function html(webview: vscode.Webview, uri: vscode.Uri): string {
  const nonce = randomBytes(24).toString('hex');
  const js = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'media/form.js'));
  const css = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'media/form.css'));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"><title>Knit with Parameters</title></head><body><main><h1 id="title">Knit with Parameters</h1><p id="status" role="status">Loading…</p><form id="form"><div id="fields"></div><div><button id="knit" type="submit" disabled>Knit</button><button id="cancel" type="button">Cancel</button><button id="refresh" type="button">Refresh parameters</button></div></form></main><script nonce="${nonce}" src="${js}"></script></body></html>`;
}
