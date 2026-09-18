import { spawn, ChildProcess } from 'node:child_process';

export interface Parameter {
  name: string; label: string; type: string; value: unknown;
  choices: {label: string; value: unknown}[]; multiple: boolean;
  min?: number | null; max?: number | null; step?: number | null;
}
export type Values = Record<string, {useDefault: boolean; value?: unknown}>;
export const eligible = (file: string): boolean => /\.(rmd|qmd)$/i.test(file);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function validateValues(input: unknown, schema: Parameter[]): Values {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid parameter submission.');
  const entries = Object.entries(input);
  if (entries.length !== schema.length) throw new Error('Parameter definitions changed; refresh the form.');
  const result: Values = Object.create(null);
  for (const [name, selection] of entries) {
    const p = schema.find(x => x.name === name);
    if (!p || !selection || typeof selection !== 'object' || typeof selection.useDefault !== 'boolean') throw new Error('Invalid parameter selection.');
    if (selection.useDefault) { result[name] = {useDefault: true}; continue; }
    const v = selection.value;
    if (v === undefined) throw new Error(`Missing value for ${name}.`);
    if (v !== null) {
      if (p.type === 'select') {
        const choices = p.multiple ? v : [v];
        if (!Array.isArray(choices) || !choices.every(x => p.choices.some(c => same(c.value, x)))) throw new Error(`Invalid choice for ${name}.`);
      } else if (p.type === 'numeric' || p.type === 'slider') {
        if (typeof v !== 'number' || !Number.isFinite(v) || (p.min != null && v < p.min) || (p.max != null && v > p.max)) throw new Error(`Invalid number for ${name}.`);
      } else if (p.type === 'checkbox') {
        if (typeof v !== 'boolean') throw new Error(`Invalid boolean for ${name}.`);
      } else {
        if (typeof v !== 'string') throw new Error(`Invalid text for ${name}.`);
        if (p.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) throw new Error(`Invalid date for ${name}.`);
      }
    }
    result[name] = {useDefault: false, value: v};
  }
  return result;
}

export class Cancelled extends Error { constructor() { super('Operation cancelled.'); } }
export class ProcessRunner {
  private child?: ChildProcess;
  private cancelled = false;
  private escalation?: NodeJS.Timeout;
  cancel(): void {
    this.cancelled = true;
    const pid = this.child?.pid;
    if (!pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {shell: false, windowsHide: true});
      killer.on('error', () => this.child?.kill());
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch { /* Already stopped. */ }
      this.escalation = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* Already stopped. */ } }, 1500);
    }
  }
  async run(command: string, args: string[], cwd: string, log: (text: string) => void): Promise<void> {
    if (this.cancelled) throw new Cancelled();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
      this.child = child;
      child.stdout?.on('data', chunk => log(chunk.toString()));
      child.stderr?.on('data', chunk => log(chunk.toString()));
      child.once('error', () => reject(new Error(`Could not start ${command}. Check the executable path in Knit with Parameters settings.`)));
      child.once('close', code => {
        this.child = undefined;
        if (this.escalation) clearTimeout(this.escalation);
        if (this.cancelled) reject(new Cancelled());
        else if (code === 0) resolve();
        else reject(new Error(`Process exited with status ${code ?? 'unknown'}. See Knit with Parameters output.`));
      });
    });
  }
}
