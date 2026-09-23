const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {runTests} = require('@vscode/test-electron');

async function main() {
  const version = process.argv[2] || '1.96.2';
  if (!['1.96.2', 'stable'].includes(version)) {
    throw new Error('Usage: npm run test:host -- [1.96.2|stable]');
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'knit-host-'));
  try {
    const workspace = path.join(temporary, 'workspace');
    const userData = path.join(temporary, 'user-data');
    const extensions = path.join(temporary, 'extensions');
    await fs.mkdir(path.join(workspace, '.vscode'), {recursive: true});
    await fs.mkdir(path.join(userData, 'User'), {recursive: true});
    await fs.mkdir(extensions);
    // Explicit missing overrides prevent discovery of any installed interpreters.
    await fs.writeFile(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
      'knitWithParameters.rscriptPath': path.join(temporary, 'disabled-tools', 'Rscript'),
      'knitWithParameters.pythonPath': path.join(temporary, 'disabled-tools', 'python'),
      'knitWithParameters.quartoPath': path.join(temporary, 'disabled-tools', 'quarto')
    }));
    await fs.writeFile(path.join(userData, 'User', 'settings.json'), JSON.stringify({
      'workbench.startupEditor': 'none',
      'window.restoreWindows': 'none',
      'files.hotExit': 'off',
      'telemetry.telemetryLevel': 'off',
      'extensions.autoCheckUpdates': false,
      'extensions.autoUpdate': false,
      'update.mode': 'none'
    }));
    // IDE-launched terminals can inherit Electron's Node-only mode.
    // The downloaded VS Code executable must launch as a desktop application.
    delete process.env.ELECTRON_RUN_AS_NODE;
    console.log(`Running extension-host smoke test: VS Code ${version}`);
    await runTests({
      version,
      cachePath: path.join(os.tmpdir(), 'knit-with-parameters-vscode-cache'),
      extensionDevelopmentPath: path.resolve(__dirname, '../..'),
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      reuseMachineInstall: false,
      launchArgs: [
        workspace,
        `--user-data-dir=${userData}`,
        `--extensions-dir=${extensions}`,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--disable-gpu',
        '--new-window',
        '--skip-welcome',
        '--skip-release-notes'
      ]
    });
  } finally {
    await fs.rm(temporary, {recursive: true, force: true, maxRetries: 3});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
