import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export type Tool = 'Rscript' | 'quarto' | 'python';
export interface DiscoveryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  appRoot?: string;
  executable?: (file: string) => Promise<boolean>;
  directories?: (directory: string) => Promise<string[]>;
}

/** Resolve on the extension host without executing shell commands or searching the workspace. */
export async function resolveExecutable(tool: Tool, configured = '', options: DiscoveryOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const p = platform === 'win32' ? path.win32 : path.posix;
  const executable = options.executable ?? (async file => {
    try {
      if (!(await fs.stat(file)).isFile()) return false;
      await fs.access(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
      return true;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
      throw error;
    }
  });
  const directories = options.directories ?? (async directory => {
    try { return (await fs.readdir(directory, {withFileTypes: true})).filter(d => d.isDirectory() || d.isSymbolicLink()).map(d => d.name); }
    catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return [];
      throw error;
    }
  });
  const pathValue = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  const pathDirs = pathValue.split(platform === 'win32' ? ';' : ':').filter(dir => p.isAbsolute(dir));
  const filename = platform === 'win32' ? `${tool}.exe` : tool;
  const automaticNames = tool === 'python'
    ? (platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python'])
    : [tool, `${tool}.exe`];
  const expand = (value: string) => value.startsWith('~/') || value.startsWith('~\\') ? p.join(home, value.slice(2)) : value;
  const first = async (candidates: string[]) => {
    for (const file of [...new Set(candidates)]) if (await executable(file)) return file;
    return undefined;
  };
  const setting = configured.trim();
  // Historical R and Quarto default command names also mean automatic discovery.
  const automaticSetting = !setting || (tool !== 'python' && automaticNames.some(name => setting.toLowerCase() === name.toLowerCase()));
  if (!automaticSetting) {
    const value = expand(setting);
    const candidates = p.isAbsolute(value) ? [value] : !/[\\/]/.test(value)
      ? pathDirs.map(dir => p.join(dir, platform === 'win32' && !p.extname(value) ? `${value}.exe` : value)) : [];
    const found = await first(candidates);
    if (found) return found;
    throw new Error(`Configured ${tool} executable was not found or is not executable: ${setting}. Correct Knit with Parameters settings or clear the setting for automatic detection.`);
  }
  const onPath = await first(pathDirs.flatMap(dir => automaticNames.map(name => p.join(dir, name))));
  if (onPath) return onPath;
  const candidates: string[] = [];
  if (tool === 'python') {
    const environment = env.VIRTUAL_ENV ?? env.CONDA_PREFIX;
    if (environment) candidates.push(p.join(environment, platform === 'win32' ? 'Scripts' : 'bin', filename));
  }
  if (tool === 'quarto' && options.appRoot) candidates.push(p.join(options.appRoot, 'quarto', 'bin', filename));
  if (platform === 'darwin') {
    if (tool === 'Rscript') candidates.push('/Library/Frameworks/R.framework/Resources/bin/Rscript');
    else if (tool === 'quarto') candidates.push('/Applications/quarto/bin/quarto', p.join(home, 'Applications/quarto/bin/quarto'));
    else candidates.push(p.join(home, '.local', 'bin', 'python3'), p.join(home, '.local', 'bin', 'python'), '/Library/Frameworks/Python.framework/Versions/Current/bin/python3');
    candidates.push(...(tool === 'python' ? ['python3', 'python'] : [tool]).flatMap(name => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/opt/local/bin/${name}`, `/usr/bin/${name}`]));
  } else if (platform === 'win32') {
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    if (tool === 'quarto') {
      candidates.push(p.join(programFiles, 'Quarto', 'bin', filename));
      if (env.LOCALAPPDATA) candidates.push(p.join(env.LOCALAPPDATA, 'Programs', 'Quarto', 'bin', filename));
    } else if (tool === 'Rscript') {
      const roots = [p.join(programFiles, 'R')];
      if (env.LOCALAPPDATA) roots.push(p.join(env.LOCALAPPDATA, 'Programs', 'R'));
      for (const root of roots) {
        const versions = (await directories(root)).filter(name => /^R-\d/.test(name)).sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
        for (const version of versions) candidates.push(p.join(root, version, 'bin', filename), p.join(root, version, 'bin', 'x64', filename));
      }
    } else {
      const roots = [p.join(programFiles, 'Python')];
      if (env.LOCALAPPDATA) roots.unshift(p.join(env.LOCALAPPDATA, 'Programs', 'Python'));
      for (const root of roots) {
        const versions = (await directories(root)).sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
        for (const version of versions) candidates.push(p.join(root, version, 'python.exe'));
      }
    }
  } else if (tool === 'python') {
    candidates.push(p.join(home, '.local', 'bin', 'python3'), p.join(home, '.local', 'bin', 'python'), '/usr/local/bin/python3', '/usr/local/bin/python', '/usr/bin/python3', '/usr/bin/python', '/opt/python/bin/python3', '/opt/python/bin/python');
  } else {
    candidates.push(p.join(home, '.local', 'bin', tool), `/usr/local/bin/${tool}`, `/usr/bin/${tool}`, `/opt/${tool === 'quarto' ? 'quarto' : 'R/current'}/bin/${tool}`);
    if (tool === 'Rscript') {
      const versions = (await directories('/opt/R')).filter(name => /^\d/.test(name)).sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
      for (const version of versions) candidates.push(`/opt/R/${version}/bin/Rscript`);
    }
  }
  const found = await first(candidates);
  if (found) return found;
  throw new Error(`Could not locate ${tool}. Install it on the extension host or set Knit with Parameters: ${tool === 'quarto' ? 'Quarto' : tool === 'python' ? 'Python' : 'Rscript'} Path to its executable. Searched PATH${options.appRoot && tool === 'quarto' ? ', the IDE bundle' : ''}, and standard installation locations.`);
}
