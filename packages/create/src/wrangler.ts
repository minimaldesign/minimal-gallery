/**
 * The few wrangler calls the scaffold makes for bucket mode: read the account
 * id, create the bucket. Each takes a `Runner`, so tests never spawn wrangler,
 * and each turns wrangler’s output into a status the next steps can explain.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Captured, Runner } from './run.ts';

/** wrangler can be slow to start, and npx may download it first. */
const TIMEOUT = 120_000;

export interface Account {
  name: string;
  id: string;
}

export type Whoami =
  | { status: 'logged-in'; accounts: Account[] }
  | { status: 'logged-out' }
  | { status: 'unavailable' }
  | { status: 'failed'; message: string };

export type BucketCreation =
  | { status: 'created' }
  | { status: 'exists' }
  | { status: 'r2-disabled' }
  | { status: 'logged-out' }
  | { status: 'unavailable' }
  | { status: 'failed'; message: string };

/** The gallery’s own wrangler after the install, else npx. */
export function wranglerCommand(dir: string): {
  command: string;
  args: string[];
} {
  const bin = join(dir, 'node_modules', '.bin', 'wrangler');
  return existsSync(bin)
    ? { command: bin, args: [] }
    : { command: 'npx', args: ['--yes', 'wrangler'] };
}

const ANSI = /\x1b\[[0-9;]*m/g;
const text = (out: Captured) =>
  `${out.stdout}\n${out.stderr}`.replace(ANSI, '');

const LOGGED_OUT =
  /not authenticated|not logged in|CLOUDFLARE_API_TOKEN environment variable|\[code: 10000\]/i;

/**
 * The line that says what went wrong: the one with Cloudflare’s error code,
 * else wrangler’s `[ERROR]` line, else the last line.
 */
export function errorMessage(out: Captured): string {
  const lines = text(out)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const coded = lines.find((l) => /\[code: \d+\]/.test(l));
  if (coded) return coded;
  const error = lines.find((l) => l.includes('[ERROR]'));
  if (error) return error.replace(/^.*?\[ERROR\]\s*/, '');
  return lines.at(-1) ?? `exit code ${out.code}`;
}

/** A row of the accounts table: `│ <name> │ <32 hex digits> │`. */
const ACCOUNT_ROW = /^[│|]\s*(.+?)\s*[│|]\s*([0-9a-f]{32})\s*[│|]$/;

/** Reads the output of `wrangler whoami`. */
export function parseWhoami(out: Captured): Whoami {
  if (out.code === 127) return { status: 'unavailable' };
  const output = text(out);
  if (LOGGED_OUT.test(output)) return { status: 'logged-out' };
  const accounts: Account[] = [];
  for (const line of output.split('\n')) {
    const row = ACCOUNT_ROW.exec(line.trim());
    if (row) accounts.push({ name: row[1], id: row[2] });
  }
  if (accounts.length || (out.code === 0 && /logged in/i.test(output)))
    return { status: 'logged-in', accounts };
  return { status: 'failed', message: errorMessage(out) };
}

/** Reads the output of `wrangler r2 bucket create`. */
export function parseBucketCreate(out: Captured): BucketCreation {
  if (out.code === 127) return { status: 'unavailable' };
  if (out.code === 0) return { status: 'created' };
  const output = text(out);
  if (/\[code: 10042\]|enable R2/i.test(output))
    return { status: 'r2-disabled' };
  if (/\[code: 10004\]|already exists/i.test(output))
    return { status: 'exists' };
  if (LOGGED_OUT.test(output)) return { status: 'logged-out' };
  return { status: 'failed', message: errorMessage(out) };
}

export async function whoami(run: Runner, dir: string): Promise<Whoami> {
  const wrangler = wranglerCommand(dir);
  return parseWhoami(
    await run(wrangler.command, [...wrangler.args, 'whoami'], {
      cwd: dir,
      timeout: TIMEOUT,
    })
  );
}

/**
 * Creates the bucket. `accountId` picks the account when the login has
 * several; wrangler cannot ask without a terminal.
 */
export async function createBucket(
  run: Runner,
  dir: string,
  bucket: string,
  accountId: string
): Promise<BucketCreation> {
  const wrangler = wranglerCommand(dir);
  return parseBucketCreate(
    await run(
      wrangler.command,
      [...wrangler.args, 'r2', 'bucket', 'create', bucket],
      {
        cwd: dir,
        timeout: TIMEOUT,
        env: accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined,
      }
    )
  );
}
