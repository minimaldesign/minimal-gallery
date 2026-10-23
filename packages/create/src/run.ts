import { spawn } from 'node:child_process';

export interface Captured {
  /** Exit code; 127 when the command could not be started (not installed). */
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd: string;
  /** Added to the environment of the command. */
  env?: Record<string, string>;
  /** Milliseconds before the command is stopped. Default: no limit. */
  timeout?: number;
}

/**
 * Runs an external command and collects its output. Every command the
 * scaffold runs (the package install, wrangler, git) goes through one of
 * these, so tests can pass a fake one and nothing is spawned.
 */
export type Runner = (
  command: string,
  args: string[],
  options: RunOptions
) => Promise<Captured>;

export const spawnRunner: Runner = (command, args, options) =>
  new Promise((done) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) =>
      done({ code: 127, stdout, stderr: stderr + e.message })
    );
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }));
  });
