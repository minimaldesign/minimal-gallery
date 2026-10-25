/**
 * What publishing to Cloudflare needs beyond `wrangler login`, which the
 * admin does for the owner because `wrangler deploy` cannot ask without a
 * terminal: which account to deploy to when the login has several, and the
 * account’s workers.dev subdomain, which a new account does not have yet.
 * The account goes into `wrangler.jsonc` as `account_id`; the subdomain is
 * registered with Cloudflare’s API, using wrangler’s own login.
 */
import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { badRequest, HttpError } from './http.ts';
import { localBin } from './jobs.ts';

const API = 'https://api.cloudflare.com/client/v4';

export interface CloudflareAccount {
  id: string;
  name: string;
}

/** How the admin reaches Cloudflare. Replaced in tests. */
export interface CloudflareClient {
  /** The login and its accounts; `loggedIn: false` when there is none. */
  whoami(): Promise<{ loggedIn: boolean; accounts: CloudflareAccount[] }>;
  /** The login’s API token, or null. */
  token(): Promise<string | null>;
  fetch: typeof fetch;
}

export interface CloudflareStatus {
  loggedIn: boolean;
  accounts: CloudflareAccount[];
  /** The account to deploy to: `account_id` in wrangler.jsonc, else the only one. */
  accountId: string | null;
  /** Several accounts and none chosen: the owner has to pick one. */
  needsAccount: boolean;
  /** wrangler.jsonc routes the Worker to a domain of its own: no workers.dev needed. */
  customDomain: boolean;
  /** The account’s workers.dev subdomain; null when it has none or it could not be read. */
  subdomain: string | null;
  /** False when the subdomain could not be checked (offline, no token). */
  subdomainKnown: boolean;
}

function run(
  command: string,
  args: string[],
  cwd: string
): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    let out = '';
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => child.kill(), 20000);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => {
      clearTimeout(timer);
      done({ code: 127, out: '' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, out });
    });
  });
}

/** The gallery’s own wrangler, else `npx wrangler`. */
export function wranglerClient(galleryDir: string): CloudflareClient {
  const bin = localBin(galleryDir, 'wrangler');
  const wrangler = (args: string[]) =>
    bin
      ? run(bin, args, galleryDir)
      : run('npx', ['--yes', 'wrangler', ...args], galleryDir);
  return {
    async whoami() {
      const r = await wrangler(['whoami', '--json']);
      try {
        const data = JSON.parse(r.out);
        if (r.code !== 0 || !data?.loggedIn)
          return { loggedIn: false, accounts: [] };
        return {
          loggedIn: true,
          accounts: (data.accounts ?? []).map(
            (a: { id: string; name: string }) => ({ id: a.id, name: a.name })
          ),
        };
      } catch {
        return { loggedIn: false, accounts: [] };
      }
    },
    async token() {
      const r = await wrangler(['auth', 'token', '--json']);
      try {
        return r.code === 0 ? (JSON.parse(r.out)?.token ?? null) : null;
      } catch {
        return null;
      }
    },
    fetch: globalThis.fetch,
  };
}

async function readWrangler(
  galleryDir: string
): Promise<{ path: string; text: string } | null> {
  for (const file of ['wrangler.jsonc', 'wrangler.json']) {
    const path = join(galleryDir, file);
    try {
      return { path, text: await readFile(path, 'utf8') };
    } catch {}
  }
  return null;
}

const ACCOUNT_LINE = /"account_id"\s*:\s*"([^"]*)"/;

/** Where Publish stands with Cloudflare. Never throws; unknowns are reported as such. */
export async function cloudflareStatus(
  galleryDir: string,
  client: CloudflareClient
): Promise<CloudflareStatus> {
  const [who, wrangler] = await Promise.all([
    client.whoami(),
    readWrangler(galleryDir),
  ]);
  const configured = wrangler ? ACCOUNT_LINE.exec(wrangler.text)?.[1] : null;
  const accountId =
    configured ||
    (who.accounts.length === 1 ? who.accounts[0].id : null) ||
    null;
  const status: CloudflareStatus = {
    loggedIn: who.loggedIn,
    accounts: who.accounts,
    accountId,
    needsAccount: who.loggedIn && !accountId && who.accounts.length > 1,
    customDomain: !!wrangler && /"routes?"\s*:/.test(wrangler.text),
    subdomain: null,
    subdomainKnown: false,
  };
  if (!who.loggedIn || !accountId || status.customDomain) return status;
  try {
    status.subdomain = await subdomainOf(client, accountId);
    status.subdomainKnown = true;
  } catch {}
  return status;
}

async function api(
  client: CloudflareClient,
  method: string,
  path: string,
  body?: unknown
): Promise<{
  ok: boolean;
  result: any;
  errors: { code: number; message: string }[];
}> {
  const token = await client.token();
  if (!token)
    throw new HttpError(
      409,
      'Connect Cloudflare first: the login is missing or has expired.'
    );
  const res = await client.fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as any;
  return {
    ok: res.ok && data?.success !== false,
    result: data?.result ?? null,
    errors: Array.isArray(data?.errors) ? data.errors : [],
  };
}

/** The account’s workers.dev subdomain, or null when it has none (error 10007). */
export async function subdomainOf(
  client: CloudflareClient,
  accountId: string
): Promise<string | null> {
  const r = await api(
    client,
    'GET',
    `/accounts/${accountId}/workers/subdomain`
  );
  if (r.ok) return r.result?.subdomain ?? null;
  if (r.errors.some((e) => e.code === 10007)) return null;
  throw new Error(r.errors[0]?.message ?? 'Cloudflare did not answer.');
}

/** A workers.dev subdomain: lowercase letters, digits and dashes, 1 to 63. */
export const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Register the account’s workers.dev subdomain. Returns it. */
export async function registerSubdomain(
  galleryDir: string,
  client: CloudflareClient,
  name: unknown
): Promise<string> {
  if (typeof name !== 'string' || !SUBDOMAIN.test(name))
    throw badRequest(
      'Use lowercase letters, digits and dashes, up to 63, starting and ending with a letter or digit.'
    );
  const status = await cloudflareStatus(galleryDir, client);
  if (!status.loggedIn) throw new HttpError(409, 'Connect Cloudflare first.');
  if (!status.accountId)
    throw new HttpError(409, 'Choose the Cloudflare account first.');
  const r = await api(
    client,
    'PUT',
    `/accounts/${status.accountId}/workers/subdomain`,
    { subdomain: name }
  );
  if (!r.ok)
    throw new HttpError(
      409,
      r.errors[0]?.message
        ? `Cloudflare says: ${r.errors[0].message}`
        : 'Cloudflare refused the name. Try another one.'
    );
  return r.result?.subdomain ?? name;
}

async function writeAtomic(path: string, text: string) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

/** Write `account_id` into wrangler.jsonc, keeping its comments and layout. */
export async function setAccount(
  galleryDir: string,
  client: CloudflareClient,
  accountId: unknown
): Promise<void> {
  const { accounts } = await client.whoami();
  if (
    typeof accountId !== 'string' ||
    !accounts.some((a) => a.id === accountId)
  )
    throw badRequest('accountId must be one of the login’s accounts.');
  const wrangler = await readWrangler(galleryDir);
  if (!wrangler)
    throw new HttpError(409, 'There is no wrangler.jsonc in this gallery.');
  let text: string;
  if (ACCOUNT_LINE.test(wrangler.text))
    text = wrangler.text.replace(ACCOUNT_LINE, `"account_id": "${accountId}"`);
  else {
    const name = /^(\s*)"name"\s*:\s*"[^"]*"\s*,?[^\n]*\n/m.exec(wrangler.text);
    if (!name)
      throw new HttpError(
        409,
        'wrangler.jsonc has no "name" to add the account to.'
      );
    const at = name.index + name[0].length;
    text = `${wrangler.text.slice(0, at)}${name[1]}"account_id": "${accountId}",\n${wrangler.text.slice(at)}`;
  }
  await writeAtomic(wrangler.path, text);
}

/** Write `minimalgallery.publish` into package.json. */
export async function setPublishMethod(
  galleryDir: string,
  method: 'deploy' | 'build'
): Promise<void> {
  const path = join(galleryDir, 'package.json');
  let pkg: Record<string, any>;
  let indent = 2;
  try {
    const text = await readFile(path, 'utf8');
    indent = /^\{\n(\s+)"/.exec(text)?.[1].length ?? 2;
    pkg = JSON.parse(text);
  } catch {
    throw new HttpError(
      409,
      'There is no readable package.json in this gallery.'
    );
  }
  pkg.minimalgallery = { ...(pkg.minimalgallery ?? {}), publish: method };
  await writeAtomic(path, `${JSON.stringify(pkg, null, indent)}\n`);
}
