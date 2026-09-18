'use strict';

const {test, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const realCore = require('../out/core');

const reportSchema = [
  {name: 'count', label: 'Count', type: 'numeric', value: 1, choices: [], multiple: false, min: 0, max: 10},
  {name: 'enabled', label: 'Enabled', type: 'checkbox', value: true, choices: [], multiple: false}
];
const temporaryPaths = [];
afterEach(async () => { await Promise.all(temporaryPaths.splice(0).map(p => fs.rm(p, {recursive: true, force: true}))); });

function disposable(fn = () => {}) { return {dispose: fn}; }
function makeUri(fileName) {
  return {
    fsPath: fileName,
    scheme: 'file',
    toString() { return `file://${this.fsPath}`; }
  };
}

function loadExtension(options = {}) {
  const state = {commands: new Map(), panels: [], errors: [], warnings: [], infos: [], output: '', runs: [], requests: [], opened: []};
  let receive;
  class FakeRunner {
    constructor() { this.cancelled = false; state.runners ??= []; state.runners.push(this); }
    cancel() { this.cancelled = true; if (this.reject) this.reject(new Cancelled()); }
    async run(command, args, cwd, log) {
      state.runs.push({command, args, cwd});
      if (command === '/detected/quarto') {
        log(`Output created: ${options.document.fileName}.html\n`);
        return;
      }
      const mode = args[1];
      const request = JSON.parse(await fs.readFile(args[2], 'utf8'));
      state.requests.push({mode, request});
      if (mode === 'render-rmd' && options.pauseRender) {
        await new Promise((resolve, reject) => { this.reject = reject; this.resolve = resolve; });
        return;
      }
      const response = mode === 'inspect' ? {hasExpressions: false}
        : mode === 'resolve' ? {parameters: reportSchema}
        : mode === 'render-rmd' ? {output: `${request.file}.html`}
        : {};
      await fs.writeFile(args[3], JSON.stringify(response));
    }
  }
  class Cancelled extends Error {}
  const vscode = {
    env: {appRoot: '/test/positron'},
    ViewColumn: {Beside: 2},
    Uri: {
      file: makeUri,
      joinPath(uri, ...parts) { return makeUri(path.join(uri.fsPath, ...parts)); }
    },
    commands: {
      registerCommand(name, callback) { state.commands.set(name, callback); return disposable(() => state.commands.delete(name)); },
      async executeCommand(...args) { state.opened.push(args); }
    },
    window: {
      activeTextEditor: options.document ? {document: options.document} : undefined,
      createOutputChannel() { return {append: text => { state.output += text; }, appendLine: text => { state.output += text + '\n'; }, show() {}, dispose() {}}; },
      createWebviewPanel(viewType, title, column, panelOptions) {
        const disposeListeners = [];
        const panel = {
          viewType, title, column, panelOptions, disposed: false,
          webview: {
            cspSource: 'vscode-webview://test', html: '', messages: [],
            asWebviewUri: uri => `webview:${uri.fsPath}`,
            postMessage: async message => { panel.webview.messages.push(message); return true; },
            onDidReceiveMessage(listener) { receive = listener; return disposable(() => { if (receive === listener) receive = undefined; }); }
          },
          onDidDispose(listener) { disposeListeners.push(listener); return disposable(); },
          dispose() { panel.disposed = true; disposeListeners.forEach(listener => listener()); }
        };
        panel.send = message => receive ? receive(message) : undefined;
        state.panels.push(panel);
        return panel;
      },
      async showErrorMessage(message) { state.errors.push(message); },
      async showWarningMessage(message) { state.warnings.push(message); return options.warningChoice; },
      async showInformationMessage(message, ...actions) { state.infos.push(message); return options.infoChoice && actions.includes(options.infoChoice) ? options.infoChoice : undefined; }
    },
    workspace: {
      isTrusted: options.trusted !== false,
      async openTextDocument() { return options.document; },
      getConfiguration() { return {get: (_key, fallback) => fallback}; }
    }
  };
  const fakeCore = {eligible: realCore.eligible, validateValues: realCore.validateValues, ProcessRunner: FakeRunner, Cancelled};
  const originalLoad = Module._load;
  const extensionPath = require.resolve('../out/extension.js');
  delete require.cache[extensionPath];
  Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    if (request === './preview' && parent?.filename === extensionPath) return {
      previewOutput: async file => { state.opened.push(['preview', file]); },
      quartoOutputPaths: text => [...text.matchAll(/Output created: (.+)/g)].map(match => match[1])
    };
    if (request === './executables' && parent?.filename === extensionPath) return {
      resolveExecutable: async (tool, configured, options) => {
        state.discovery ??= [];
        state.discovery.push({tool, configured, options});
        return `/detected/${tool}`;
      }
    };
    if (request === './core' && parent && parent.filename === extensionPath) return fakeCore;
    return originalLoad.call(this, request, parent, isMain);
  };
  try { require(extensionPath); } finally { Module._load = originalLoad; }
  const context = {extensionUri: makeUri('/extension'), asAbsolutePath: p => `/extension/${p}`, subscriptions: []};
  require(extensionPath).activate(context);
  return {state, invoke: () => state.commands.get('knitWithParameters.open')(), context};
}

async function fixture(extension = '.Rmd') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'knit-extension-test-'));
  temporaryPaths.push(dir);
  const fileName = path.join(dir, `report${extension}`);
  await fs.writeFile(fileName, '---\nparams:\n  count: 1\n---\n');
  const document = {fileName, uri: makeUri(fileName), isDirty: false, async save() { this.isDirty = false; return true; }};
  return {fileName, document};
}

async function ready(harness) {
  await harness.invoke();
  const panel = harness.state.panels.at(-1);
  await panel.send({type: 'ready'});
  return panel;
}
async function waitFor(predicate) {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('Timed out waiting for test operation.');
}

test('registers the manifest command and rejects an unrelated active file', async () => {
  const {document} = await fixture('.txt');
  const harness = loadExtension({document});
  assert.ok(harness.state.commands.has('knitWithParameters.open'));
  await harness.invoke();
  assert.equal(harness.state.panels.length, 0);
  assert.match(harness.state.errors[0], /saved .Rmd or .qmd/i);
});

test('eligible document opens a constrained webview without Shiny or browser content', async () => {
  const {document} = await fixture('.qmd');
  const harness = loadExtension({document});
  await harness.invoke();
  const panel = harness.state.panels[0];
  assert.equal(panel.viewType, 'knitParameters');
  assert.equal(panel.panelOptions.enableScripts, true);
  assert.match(panel.webview.html, /Content-Security-Policy/);
  assert.match(panel.webview.html, /default-src 'none'/);
  assert.match(panel.webview.html, /script-src 'nonce-[0-9a-f]+'/);
  assert.doesNotMatch(panel.webview.html, /shiny|https?:\/\/|browser/i);
});

test('dispatches typed Rmd knit values through the bridge fixture', async () => {
  const {document, fileName} = await fixture();
  const harness = loadExtension({document});
  const panel = await ready(harness);
  assert.deepEqual(panel.webview.messages.find(m => m.type === 'schema').parameters, reportSchema);
  await panel.send({type: 'knit', values: {
    count: {useDefault: false, value: 3.5}, enabled: {useDefault: false, value: false}
  }});
  const render = harness.state.requests.find(x => x.mode === 'render-rmd');
  assert.deepEqual(render.request.values, {count: {useDefault: false, value: 3.5}, enabled: {useDefault: false, value: false}});
  assert.equal(render.request.file, fileName);
  assert.match(harness.state.output, /Rendering completed successfully/);
  assert.deepEqual(harness.state.opened[0], ['preview', `${fileName}.html`]);
});

test('Quarto render automatically previews its reported artifact exactly once', async () => {
  const {document, fileName} = await fixture('.qmd');
  const harness = loadExtension({document});
  const panel = await ready(harness);
  await panel.send({type: 'knit', values: {count: {useDefault: false, value: 7}, enabled: {useDefault: true}}});
  assert.deepEqual(harness.state.opened, [['preview', `${fileName}.html`]]);
  assert.equal(harness.state.runs.filter(run => run.command === '/detected/quarto').length, 1);
  assert.ok(harness.state.requests.some(request => request.mode === 'write-quarto-params'));
});

test('cancel stops an in-flight render and reports ready without success', async () => {
  const {document} = await fixture();
  const harness = loadExtension({document, pauseRender: true});
  const panel = await ready(harness);
  const knitting = panel.send({type: 'knit', values: {count: {useDefault: true}, enabled: {useDefault: true}}});
  await waitFor(() => harness.state.requests.some(x => x.mode === 'render-rmd'));
  await panel.send({type: 'cancel'});
  await knitting;
  assert.ok(harness.state.runners.some(runner => runner.cancelled));
  assert.ok(panel.webview.messages.some(m => m.type === 'status' && m.text === 'Cancelling…'));
  assert.doesNotMatch(harness.state.output, /completed successfully/);
});

test('dirty and stale documents cannot be rendered', async () => {
  const first = await fixture(); first.document.isDirty = true;
  const declined = loadExtension({document: first.document});
  await declined.invoke();
  assert.equal(declined.state.panels.length, 0);
  assert.equal(declined.state.warnings.length, 1);

  const second = await fixture();
  const harness = loadExtension({document: second.document});
  const panel = await ready(harness);
  await fs.appendFile(second.fileName, 'changed');
  await panel.send({type: 'knit', values: {count: {useDefault: true}, enabled: {useDefault: true}}});
  assert.ok(harness.state.errors.some(message => /Document changed\. Refresh/i.test(message)));
  assert.ok(!harness.state.requests.some(x => x.mode === 'render-rmd'));
});
