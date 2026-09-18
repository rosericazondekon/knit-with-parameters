const {test} = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../package.json');
const fs = require('node:fs');
const path = require('node:path');

test('extension logo and command artwork point to existing bundled assets', () => {
  assert.equal(manifest.icon, 'media/extension-logo.png');
  const command = manifest.contributes.commands.find(c => c.command === 'knitWithParameters.open');
  assert.deepEqual(command.icon, {
    light: 'media/light/file-icon-knit.png',
    dark: 'media/dark/file-icon-knit-dark.png'
  });
  for (const asset of [manifest.icon, command.icon.light, command.icon.dark]) {
    assert.ok(fs.statSync(path.join(__dirname, '..', asset)).isFile());
  }
});

test('parameter panel icons point to existing light and dark artwork', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/extension.ts'), 'utf8');
  const match = source.match(/panel\.iconPath = \{([^}]+)\}/);
  assert.ok(match, 'Missing theme-specific parameter panel icons');
  const icons = Object.fromEntries(
    [...match[1].matchAll(/(light|dark): vscode\.Uri\.joinPath\(context\.extensionUri, '([^']+)'\)/g)]
      .map(([, theme, asset]) => [theme, asset])
  );
  assert.deepEqual(icons, {
    light: 'media/light/file-icon-16x16-preview.png',
    dark: 'media/dark/file-icon-16x16-preview-dark.png'
  });
  for (const asset of Object.values(icons)) {
    assert.ok(fs.statSync(path.join(__dirname, '..', asset)).isFile());
  }
});

test('contributes to Positron action bar as well as VS Code editor title', () => {
  for (const location of ['editor/actions/left', 'editor/title']) {
    const entry = manifest.contributes.menus[location].find(x => x.command === 'knitWithParameters.open');
    assert.ok(entry, `Missing contribution: ${location}`);
    const regex = entry.when.match(/=~ (\/.*\/i)/)[1];
    const pattern = new RegExp(regex.slice(1, -2), 'i');
    for (const ext of ['.Rmd', '.rmd', '.qmd', '.QMD']) assert.ok(pattern.test(ext));
    for (const ext of ['.R', '.md', '.html']) assert.ok(!pattern.test(ext));
  }
});

test('command palette fallback is available regardless of editor context', () => {
  const entry = manifest.contributes.menus.commandPalette.find(x => x.command === 'knitWithParameters.open');
  assert.ok(entry);
  assert.equal(entry.when, undefined);
});
