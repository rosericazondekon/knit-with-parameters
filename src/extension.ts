import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Cancelled, eligible, Parameter, ProcessRunner, validateValues, Values } from './core';
import { resolveExecutable, Tool } from './executables';
import { previewOutput, quartoOutputPaths } from './preview';
import { pickInputFile } from './filePicker';
import { materializePythonDefaults } from './pythonDocument';

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
    let schemaPython = false;
    let busy = false;
    let disposed = false;
    let runner: ProcessRunner | undefined;
    let picking = false;
    const config = () => vscode.workspace.getConfiguration('knitWithParameters', document.uri);
    const findTool = async (tool: Tool) => {
      const setting = tool === 'quarto' ? 'quartoPath' : tool === 'python' ? 'pythonPath' : 'rscriptPath';
      const executable = await resolveExecutable(tool, config().get<string>(setting, ''), {appRoot: vscode.env.appRoot});
      output.appendLine(`${tool}: ${executable}`);
      return executable;
    };
    const post = (message: object) => { if (!disposed) void panel.webview.postMessage(message); };
    const status = (text: string) => post({type: 'status', text, busy});
    const secrets: string[] = [];
    const redact = (text: string) => secrets.reduce((s, secret) => s.split(secret).join('[REDACTED]'), text);
    const log = (text: string) => output.append(redact(text));
    async function bridge(mode: string, dir: string, values?: Values, outputParams?: string, pythonValues?: Record<string, unknown>): Promise<any> {
      const request = path.join(dir, 'request.json');
      const response = path.join(dir, 'response.json');
      await fs.rm(response, {force: true});
      await fs.writeFile(request, JSON.stringify({file: document!.fileName, values, outputParams, pythonValues}), {mode: 0o600});
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
    const validPythonValue = (value: unknown): boolean => {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
      if (typeof value === 'number') return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
      return Array.isArray(value) && value.every(validPythonValue);
    };
    async function resolvePython(dir: string, executable: string, expressions: Record<string, string>): Promise<Record<string, unknown>> {
      const request = path.join(dir, 'python-request.json');
      const response = path.join(dir, 'python-response.json');
      await fs.rm(response, {force: true});
      await fs.writeFile(request, JSON.stringify({expressions}), {mode: 0o600});
      let failure: unknown;
      try {
        await runner!.run(executable, [context.asAbsolutePath('scripts/bridge.py'), request, response], path.dirname(document!.fileName), () => {});
      } catch (error) { if (error instanceof Cancelled) throw error; failure = error; }
      let result: any;
      try { result = JSON.parse(await fs.readFile(response, 'utf8')); }
      catch { throw failure || new Error('The Python helper returned no valid response.'); }
      if (typeof result?.error === 'string') throw new Error(redact(result.error));
      if (failure) throw failure;
      const values = result?.values;
      const names = Object.keys(expressions);
      if (!values || typeof values !== 'object' || Array.isArray(values) ||
        Object.keys(values).length !== names.length || !names.every(name => Object.prototype.hasOwnProperty.call(values, name)) ||
        !Object.values(values).every(validPythonValue)) throw new Error('The Python helper returned invalid parameter values.');
      return values;
    }
    async function currentText(): Promise<string> {
      const open = await vscode.workspace.openTextDocument(document!.uri);
      if (open.isDirty) throw new Error('The document has unsaved changes. Save it, then refresh parameters.');
      return fs.readFile(document!.fileName, 'utf8');
    }
    async function inspectQuartoOutput(quarto: string, source: string, originalStem: string, temporaryStem: string): Promise<string | undefined> {
      let stdout = '';
      await runner!.run(quarto, ['inspect', source], path.dirname(document!.fileName), text => { stdout += text; });
      let inspected: any;
      try { inspected = JSON.parse(stdout); }
      catch { throw new Error('Quarto inspect returned invalid output metadata.'); }
      const first = inspected?.formats && typeof inspected.formats === 'object' && !Array.isArray(inspected.formats)
        ? Object.values(inspected.formats)[0] as any : undefined;
      const outputFile = first?.pandoc?.['output-file'];
      if (typeof outputFile !== 'string' || !outputFile) return undefined;
      const parsed = path.parse(outputFile);
      if (parsed.name !== temporaryStem) return undefined;
      return path.join(parsed.dir, `${originalStem}${parsed.ext}`);
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
        schemaPython = false;
        snapshot = await currentText();
        schema = [];
        const inspection = await bridge('inspect', dir);
        const expressions = inspection?.pythonExpressions;
        const pythonExpressions: Record<string, string> = Object.create(null);
        if (expressions !== undefined) {
          if (!expressions || typeof expressions !== 'object' || Array.isArray(expressions) ||
            !Object.entries(expressions).every(([name, expression]) => name.length > 0 && typeof expression === 'string')) {
            throw new Error('Invalid Python expression metadata from R.');
          }
          Object.assign(pythonExpressions, expressions);
        }
        const hasPython = Object.keys(pythonExpressions).length > 0;
        let pythonExecutable: string | undefined;
        if (hasPython) pythonExecutable = await findTool('python');
        if (inspection.hasExpressions || hasPython) {
          const languages = inspection.hasRExpressions && hasPython ? 'R and Python' : hasPython ? 'Python' : 'R';
          const interpreter = pythonExecutable ? `\n\nPython interpreter: ${pythonExecutable}` : '';
          const choice = await vscode.window.showWarningMessage(`This document contains executable ${languages} parameter expressions. R/Python expressions can run arbitrary code with filesystem and network access and are not sandboxed.${interpreter}`, {modal: true}, 'Evaluate parameters');
          if (choice !== 'Evaluate parameters') throw new Cancelled();
          if (disposed || !vscode.workspace.isTrusted) throw new Cancelled();
          if (snapshot !== await currentText()) throw new Error('Document changed during discovery. Refresh parameters.');
        }
        let pythonValues: Record<string, unknown> | undefined;
        if (hasPython) pythonValues = await resolvePython(dir, pythonExecutable!, pythonExpressions);
        if (disposed || !vscode.workspace.isTrusted) throw new Cancelled();
        if (snapshot !== await currentText()) throw new Error('Document changed during discovery. Refresh parameters.');
        const resolved = await bridge('resolve', dir, undefined, undefined, pythonValues);
        if (snapshot !== await currentText()) throw new Error('Document changed during discovery. Refresh parameters.');
        if (!Array.isArray(resolved.parameters)) throw new Error('Invalid parameter schema from R.');
        schema = resolved.parameters;
        schemaPython = hasPython;
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
            const quarto = await findTool('quarto');
            const original = document!.fileName;
            const reportDir = path.dirname(original);
            let source = original;
            let temporary: string | undefined;
            let outputFile: string | undefined;
            try {
              if (schemaPython) {
                const extension = path.extname(original);
                const temporaryStem = `.knit-params-${randomBytes(12).toString('hex')}`;
                temporary = path.join(reportDir, temporaryStem + extension);
                const submitted = Object.fromEntries(Object.entries(values).map(([name, selection]) => [name, selection.value]));
                const materialized = materializePythonDefaults(snapshot, submitted);
                await fs.writeFile(temporary, materialized, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
                source = temporary;
                outputFile = await inspectQuartoOutput(quarto, source, path.parse(original).name, temporaryStem);
              }
              const args = ['render', temporary ? path.basename(source) : source];
              if (hasParameters) args.push('--execute-params', params);
              if (outputFile) args.push('--output', outputFile);
              let renderLog = '';
              await runner!.run(quarto, args, reportDir, text => {
                renderLog = (renderLog + text).slice(-1024 * 1024);
                log(text);
              });
              rendered = quartoOutputPaths(renderLog, reportDir);
            } finally {
              if (temporary) await fs.rm(temporary, {force: true}).catch(() => {});
            }
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
