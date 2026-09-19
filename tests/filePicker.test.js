'use strict';

const {afterEach, test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const temporaryPaths = [];
afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(directory => fs.rm(directory, {recursive: true, force: true})));
});

function load(choices = [], inputValues = []) {
  const state = {quickPicks: [], inputBoxes: [], errors: []};
  const vscode = {
    window: {
      async showQuickPick(items, options) {
        state.quickPicks.push({items, options});
        const choice = choices.shift();
        if (choice === undefined || choice === null) return undefined;
        const item = items.find(candidate => candidate.label === choice);
        assert.ok(item, `No picker item named ${choice}`);
        return item;
      },
      async showInputBox(options) {
        state.inputBoxes.push(options);
        return inputValues.shift();
      },
      async showErrorMessage(message) { state.errors.push(message); }
    }
  };
  const modulePath = require.resolve('../out/filePicker');
  delete require.cache[modulePath];
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return {api: require(modulePath), state}; } finally { Module._load = originalLoad; }
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'file-picker-test-'));
  temporaryPaths.push(directory);
  return directory;
}

test('selects a file with spaces and presents folder entries before files', async () => {
  const directory = await fixture();
  await fs.mkdir(path.join(directory, 'child folder'));
  const file = path.join(directory, 'input file.csv');
  await fs.writeFile(file, 'x');
  const {api, state} = load(['input file.csv']);

  assert.equal(await api.pickInputFile(directory), file);
  const picker = state.quickPicks[0];
  assert.equal(picker.options.title, 'Select input dataset');
  assert.equal(picker.options.placeHolder, directory);
  assert.equal(picker.options.ignoreFocusOut, true);
  assert.deepEqual(picker.items.map(item => item.label), ['..', 'Enter folder path…', 'child folder', 'input file.csv']);
  assert.equal(picker.items.find(item => item.label === 'child folder').description, 'Folder');
});

test('navigates into a child folder and back to its parent', async () => {
  const directory = await fixture();
  const child = path.join(directory, 'child');
  await fs.mkdir(child);
  const file = path.join(directory, 'parent.csv');
  await fs.writeFile(file, 'x');
  const {api, state} = load(['child', '..', 'parent.csv']);

  assert.equal(await api.pickInputFile(directory), file);
  assert.deepEqual(state.quickPicks.map(picker => picker.options.placeHolder), [directory, child, directory]);
});

test('returns undefined when the picker is cancelled', async () => {
  const directory = await fixture();
  const {api, state} = load([null]);

  assert.equal(await api.pickInputFile(directory), undefined);
  assert.equal(state.quickPicks.length, 1);
});

test('opens an entered directory path', async () => {
  const directory = await fixture();
  const child = path.join(directory, 'typed folder');
  const file = path.join(child, 'data.csv');
  await fs.mkdir(child);
  await fs.writeFile(file, 'x');
  const {api, state} = load(['Enter folder path…', 'data.csv'], ['typed folder']);

  assert.equal(await api.pickInputFile(directory), file);
  assert.equal(state.inputBoxes[0].value, directory);
  assert.equal(state.inputBoxes[0].ignoreFocusOut, true);
});

test('reports a nonexistent entered folder and recovers in the current directory', async () => {
  const directory = await fixture();
  const file = path.join(directory, 'data.csv');
  await fs.writeFile(file, 'x');
  const {api, state} = load(['Enter folder path…', 'data.csv'], ['missing folder']);

  assert.equal(await api.pickInputFile(directory), file);
  assert.match(state.errors[0], /Unable to open folder/);
  assert.deepEqual(state.quickPicks.map(picker => picker.options.placeHolder), [directory, directory]);
});
