/**
 * Publish and connect jobs: the gallery’s own `minimalgallery publish` and
 * `wrangler login`, run as child processes whose output streams to the page.
 * One job at a time; the queue is paused while a publish runs, since the
 * publish command runs the pipeline itself.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  cloudflareStatus,
  wranglerClient,
  type CloudflareClient,
  type CloudflareStatus,
} from './cloudflare.ts';
import { conflict } from './http.ts';

export type PublishMethod = 'git' | 'deploy' | 'build';
export const PUBLISH_METHODS: readonly PublishMethod[] = [
  'git',
  'deploy',
  'build',
];

export interface Job {
  id: string;
  job: 'publish' | 'connect';
  method?: PublishMethod;
  state: 'running' | 'done' | 'failed';
  lines: string[];
  url?: string | null;
  code?: number | null;
  startedAt: string;
}

/** How a job’s command is found. Injected by tests. */
export type CommandResolver = (
  job: 'publish' | 'connect',
  method: PublishMethod | undefined,
  galleryDir: string
) => { command: string; args: string[] } | null;

/** A binary from `node_modules/.bin`, looking up the tree from the gallery. */
export function localBin(root: string, name: string): string | null {
  let dir = resolve(root);
  for (;;) {
    const bin = join(dir, 'node_modules', '.bin', name);
    if (existsSync(bin)) return bin;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const defaultCommands: CommandResolver = (job, method, galleryDir) => {
  if (job === 'publish') {
    const bin = localBin(galleryDir, 'minimalgallery');
    return bin
      ? { command: bin, args: ['publish', `--${method}`, '--yes'] }
      : null;
  }
  const wrangler = localBin(galleryDir, 'wrangler');
  return wrangler
    ? { command: wrangler, args: ['login'] }
    : { command: 'npx', args: ['wrangler', 'login'] };
};

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const URL_RE = /https:\/\/[^\s'"<>`)\]]+/g;
const MAX_LINES = 2000;

/** The last https:// address in some output, without trailing punctuation. */
export function lastUrl(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const all = lines[i].match(URL_RE);
    if (all) return all[all.length - 1].replace(/[.,;:!?]+$/, '');
  }
  return null;
}

export interface JobHooks {
  log: (line: string) => void;
  /** Called with the job’s final state. */
  end: (job: Job) => void | Promise<void>;
}

/** Run a command as a job, collecting its output line by line. */
export function runJob(
  job: Job,
  command: { command: string; args: string[] },
  cwd: string,
  hooks: JobHooks,
  fallbackUrl: string | null
): void {
  // The dev server runs with NODE_ENV=development; a build must not inherit it.
  const { NODE_ENV: _devMode, ...env } = process.env;
  const child = spawn(command.command, command.args, {
    cwd,
    env: { ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const push = (line: string) => {
    const clean = line.replace(ANSI, '').replace(/\s+$/, '');
    if (!clean) return;
    job.lines.push(clean);
    if (job.lines.length > MAX_LINES) job.lines.shift();
    hooks.log(clean);
  };
  const reader = () => {
    let rest = '';
    return {
      data(chunk: Buffer) {
        const parts = (rest + chunk.toString('utf8')).split(/\r?\n|\r/);
        rest = parts.pop() ?? '';
        for (const p of parts) push(p);
      },
      flush() {
        if (rest) push(rest);
        rest = '';
      },
    };
  };
  const out = reader();
  const err = reader();
  child.stdout.on('data', out.data);
  child.stderr.on('data', err.data);
  let ended = false;
  const finish = (code: number | null, error?: Error) => {
    if (ended) return;
    ended = true;
    out.flush();
    err.flush();
    if (error) push(`${command.command}: ${error.message}`);
    job.code = code;
    job.state = code === 0 ? 'done' : 'failed';
    if (job.job === 'publish' && job.state === 'done')
      job.url = lastUrl(job.lines) ?? fallbackUrl;
    void hooks.end(job);
  };
  child.on('error', (e) => finish(127, e));
  child.on('close', (code) => finish(code ?? 1));
}

export function newJob(kind: Job['job'], method?: PublishMethod): Job {
  return {
    id: randomBytes(8).toString('base64url'),
    job: kind,
    ...(method ? { method } : {}),
    state: 'running',
    lines: [],
    startedAt: new Date().toISOString(),
  };
}

export function assertNoJob(current: Job | null): void {
  if (current?.state === 'running')
    throw conflict(`A ${current.job} job is running.`, { job: current.id });
}

// The publish page’s checks.

interface Captured {
  code: number;
  out: string;
}

function capture(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 15000
): Promise<Captured> {
  return new Promise((done) => {
    let out = '';
    let child;
    try {
      child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      done({ code: 127, out });
      return;
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', () => {
      clearTimeout(timer);
      done({ code: 127, out });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, out });
    });
  });
}

async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** The `name` in wrangler.jsonc or wrangler.json, or null. */
async function workerName(root: string): Promise<string | null> {
  for (const file of ['wrangler.jsonc', 'wrangler.json']) {
    try {
      const text = await readFile(join(root, file), 'utf8');
      const match = /^\s*"name"\s*:\s*"([^"]+)"/m.exec(text);
      if (match) return match[1];
    } catch {}
  }
  return null;
}

export interface PublishChecks {
  method: PublishMethod;
  git: {
    repo: boolean;
    remote: string | null;
    branch: string | null;
    ghInstalled: boolean;
    ghAuthed: boolean;
  };
  deploy: CloudflareStatus & {
    wranglerInstalled: boolean;
    worker: string | null;
  };
}

/** What the publish page needs to know before the first click. Spawns git, gh and wrangler. */
export async function publishChecks(
  galleryDir: string,
  cloudflare: CloudflareClient = wranglerClient(galleryDir)
): Promise<PublishChecks> {
  const git = (args: string[]) => capture('git', args, galleryDir);
  const wranglerBin = localBin(galleryDir, 'wrangler');
  const [inside, remote, branch, ghVersion, ghStatus, cf, pkg, worker] =
    await Promise.all([
      git(['rev-parse', '--is-inside-work-tree']),
      git(['remote', 'get-url', 'origin']),
      git(['branch', '--show-current']),
      capture('gh', ['--version'], galleryDir),
      capture('gh', ['auth', 'status'], galleryDir),
      cloudflareStatus(galleryDir, cloudflare),
      readJson(join(galleryDir, 'package.json')),
      workerName(galleryDir),
    ]);
  const repo = inside.code === 0 && inside.out.trim() === 'true';
  const setting = pkg?.minimalgallery?.publish;
  const hasWrangler =
    existsSync(join(galleryDir, 'wrangler.jsonc')) ||
    existsSync(join(galleryDir, 'wrangler.json'));
  const method: PublishMethod = PUBLISH_METHODS.includes(setting)
    ? setting
    : hasWrangler
      ? 'deploy'
      : repo && remote.code === 0
        ? 'git'
        : 'build';
  return {
    method,
    git: {
      repo,
      remote: repo && remote.code === 0 ? remote.out.trim() || null : null,
      branch: repo && branch.code === 0 ? branch.out.trim() || null : null,
      ghInstalled: ghVersion.code === 0,
      ghAuthed: ghStatus.code === 0,
    },
    deploy: {
      ...cf,
      wranglerInstalled: !!wranglerBin,
      worker,
    },
  };
}
