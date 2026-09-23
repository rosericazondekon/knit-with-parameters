const assert = require('node:assert/strict');
const vscode = require('vscode');

async function waitForPanel(label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(
      item => item.label === label && item.input instanceof vscode.TabInputWebview
    );
    if (tab) return tab;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Parameter webview did not open: ${label}`);
}

exports.run = async function run() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'An isolated test workspace is required');
  assert.ok(vscode.workspace.isTrusted, 'The test workspace must be trusted');
  const extension = vscode.extensions.getExtension('rosericazondekon.knit-with-parameters');
  assert.ok(extension, 'Development extension is installed');
  await extension.activate();
  assert.ok(extension.isActive, 'Extension activates in this host');
  assert.ok((await vscode.commands.getCommands(true)).includes('knitWithParameters.open'));

  // The launcher supplies nonexistent interpreter paths: this tests host UI APIs,
  // not parameter discovery or execution of R, Python, or Quarto.
  for (const suffix of ['Rmd', 'qmd']) {
    const file = vscode.Uri.joinPath(folder.uri, `host-smoke.${suffix}`);
    try {
      await vscode.workspace.fs.writeFile(file, Buffer.from('---\nparams:\n  count: 1\n---\n\nSmoke test\n'));
      const document = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand('knitWithParameters.open');
      await waitForPanel(`Parameters: host-smoke.${suffix}`);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.delete(file);
    }
  }
};
