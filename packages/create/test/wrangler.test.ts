import { describe, expect, it } from 'vitest';
import type { Captured, Runner } from '../src/run.ts';
import {
  createBucket,
  errorMessage,
  parseBucketCreate,
  parseWhoami,
  whoami,
} from '../src/wrangler.ts';
import {
  BUCKET_EXISTS,
  NOT_LOGGED_IN_CREATE,
  R2_DISABLED,
  WHOAMI_LOGGED_OUT,
  WHOAMI_ONE,
  WHOAMI_TWO,
} from './fixtures.ts';

const ok = (stdout: string): Captured => ({ code: 0, stdout, stderr: '' });
const err = (stderr: string, code = 1): Captured => ({
  code,
  stdout: '',
  stderr,
});

describe('wrangler whoami', () => {
  it('reads the account from the table', () => {
    expect(parseWhoami(ok(WHOAMI_ONE))).toEqual({
      status: 'logged-in',
      accounts: [
        {
          name: "Someone@example.com's Account",
          id: '0123456789abcdef0123456789abcdef',
        },
      ],
    });
  });

  it('reads several accounts, in order', () => {
    const who = parseWhoami(ok(WHOAMI_TWO));
    expect(
      who.status === 'logged-in' && who.accounts.map((a) => a.name)
    ).toEqual(['Studio', "Someone@example.com's Account"]);
  });

  it('ignores color codes', () => {
    const colored = WHOAMI_ONE.replace(
      '0123456789abcdef0123456789abcdef',
      '\x1b[1m0123456789abcdef0123456789abcdef\x1b[22m'
    );
    const who = parseWhoami(ok(colored));
    expect(who.status === 'logged-in' && who.accounts[0].id).toBe(
      '0123456789abcdef0123456789abcdef'
    );
  });

  it('tells a missing login, a missing wrangler and other failures apart', () => {
    expect(parseWhoami(ok(WHOAMI_LOGGED_OUT))).toEqual({
      status: 'logged-out',
    });
    expect(parseWhoami(err('spawn npx ENOENT', 127))).toEqual({
      status: 'unavailable',
    });
    expect(
      parseWhoami(err('✘ [ERROR] fetch failed: getaddrinfo ENOTFOUND'))
    ).toEqual({
      status: 'failed',
      message: 'fetch failed: getaddrinfo ENOTFOUND',
    });
  });

  it('runs npx wrangler when the gallery has no wrangler of its own', async () => {
    const calls: Array<[string, string[]]> = [];
    const run: Runner = async (command, args) => {
      calls.push([command, args]);
      return ok(WHOAMI_ONE);
    };
    await whoami(run, '/nowhere');
    expect(calls).toEqual([['npx', ['--yes', 'wrangler', 'whoami']]]);
  });
});

describe('wrangler r2 bucket create', () => {
  it('reads each outcome', () => {
    expect(
      parseBucketCreate(
        ok(
          "Creating bucket 'my-gallery-media'...\n✅ Created bucket 'my-gallery-media' with default storage class of Standard."
        )
      )
    ).toEqual({ status: 'created' });
    expect(parseBucketCreate(err(R2_DISABLED))).toEqual({
      status: 'r2-disabled',
    });
    expect(parseBucketCreate(err(BUCKET_EXISTS))).toEqual({ status: 'exists' });
    expect(parseBucketCreate(err(NOT_LOGGED_IN_CREATE))).toEqual({
      status: 'logged-out',
    });
    expect(
      parseBucketCreate(
        err(
          '✘ [ERROR] A request to the Cloudflare API failed.\n\n  The specified bucket name is not valid. [code: 10005]\n'
        )
      )
    ).toEqual({
      status: 'failed',
      message: 'The specified bucket name is not valid. [code: 10005]',
    });
    expect(parseBucketCreate(err('', 127))).toEqual({ status: 'unavailable' });
  });

  it('names the account, since wrangler cannot ask which one', async () => {
    const calls: Array<[string[], Record<string, string> | undefined]> = [];
    const run: Runner = async (_command, args, options) => {
      calls.push([args, options.env]);
      return ok('');
    };
    await createBucket(run, '/nowhere', 'photos-media', 'a'.repeat(32));
    expect(calls).toEqual([
      [
        ['--yes', 'wrangler', 'r2', 'bucket', 'create', 'photos-media'],
        { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) },
      ],
    ]);
  });

  it('quotes the line with the error code', () => {
    expect(errorMessage(err(R2_DISABLED))).toBe(
      'Please enable R2 through the Cloudflare Dashboard. [code: 10042]'
    );
  });
});
