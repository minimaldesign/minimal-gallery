import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CloudflareClient } from '../../src/admin/server/cloudflare.ts';
import { startServer, tempGallery, type TestServer } from './helpers.ts';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const PERSONAL = 'a'.repeat(32);
const STUDIO = 'b'.repeat(32);

const WRANGLER = `// Cloudflare Workers (static assets) for this gallery.
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-gallery",
  "compatibility_date": "2026-10-01",
  "assets": { "directory": "./dist", "not_found_handling": "404-page" },
}
`;

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: unknown;
}

/**
 * Cloudflare as the admin sees it: a login with two accounts, and the
 * workers.dev subdomain API. Nothing reaches the network.
 */
function fakeCloudflare(options: { taken?: string[] } = {}) {
  const calls: Call[] = [];
  const subdomains = new Map<string, string>();
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const client: CloudflareClient = {
    whoami: async () => ({
      loggedIn: true,
      accounts: [
        { id: PERSONAL, name: 'Personal' },
        { id: STUDIO, name: 'Studio' },
      ],
    }),
    token: async () => 'test-token',
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = new Headers(init?.headers);
      calls.push({
        method: init?.method ?? 'GET',
        url,
        auth: headers.get('authorization'),
        body,
      });
      const account = /accounts\/([^/]+)\/workers\/subdomain$/.exec(url)?.[1];
      if (!account) return json(404, { success: false, errors: [] });
      if ((init?.method ?? 'GET') === 'GET')
        return subdomains.has(account)
          ? json(200, {
              success: true,
              result: { subdomain: subdomains.get(account) },
            })
          : json(404, {
              success: false,
              errors: [{ code: 10007, message: 'no subdomain' }],
            });
      const name = (body as { subdomain: string }).subdomain;
      if (options.taken?.includes(name))
        return json(409, {
          success: false,
          errors: [{ code: 10032, message: 'This subdomain is unavailable.' }],
        });
      subdomains.set(account, name);
      return json(200, { success: true, result: { subdomain: name } });
    }) as typeof fetch,
  };
  return { client, calls };
}

async function cloudflareGallery() {
  const dir = await tempGallery();
  await writeFile(join(dir, 'wrangler.jsonc'), WRANGLER);
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'my-gallery', minimalgallery: { publish: 'deploy' } }, null, 2)}\n`
  );
  return dir;
}

describe('connecting Cloudflare', () => {
  it('asks for the account, then the workers.dev name, before the first deploy', async () => {
    const dir = await cloudflareGallery();
    const cf = fakeCloudflare({ taken: ['photos'] });
    server = await startServer({ galleryDir: dir, cloudflare: cf.client });

    let info = (await server.call('GET', '/publish')).body;
    expect(info.method).toBe('deploy');
    expect(info.deploy).toMatchObject({
      loggedIn: true,
      needsAccount: true,
      accountId: null,
      customDomain: false,
      subdomain: null,
    });
    // No account chosen: the subdomain is not asked for yet.
    expect(cf.calls).toEqual([]);

    expect(
      (await server.call('PUT', '/publish/settings', { accountId: 'nope' }))
        .status
    ).toBe(400);
    expect(
      (await server.call('PUT', '/publish/settings', { accountId: STUDIO }))
        .status
    ).toBe(200);
    const wrangler = await readFile(join(dir, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain(
      `  "name": "my-gallery",\n  "account_id": "${STUDIO}",\n`
    );
    expect(wrangler).toContain('// Cloudflare Workers (static assets)');

    info = (await server.call('GET', '/publish')).body;
    expect(info.deploy).toMatchObject({
      needsAccount: false,
      accountId: STUDIO,
      subdomain: null,
      subdomainKnown: true,
    });
    expect(cf.calls.at(-1)).toMatchObject({
      method: 'GET',
      url: `https://api.cloudflare.com/client/v4/accounts/${STUDIO}/workers/subdomain`,
      auth: 'Bearer test-token',
    });

    expect(
      (await server.call('POST', '/publish/subdomain', { name: 'My Photos' }))
        .status
    ).toBe(400);
    const taken = await server.call('POST', '/publish/subdomain', {
      name: 'photos',
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toContain('This subdomain is unavailable.');
    const made = await server.call('POST', '/publish/subdomain', {
      name: 'yann-photos',
    });
    expect(made.body).toEqual({ subdomain: 'yann-photos' });
    expect(cf.calls.at(-1)).toMatchObject({
      method: 'PUT',
      body: { subdomain: 'yann-photos' },
      auth: 'Bearer test-token',
    });
    info = (await server.call('GET', '/publish')).body;
    expect(info.deploy.subdomain).toBe('yann-photos');

    // Choosing the account again replaces the line rather than adding one.
    await server.call('PUT', '/publish/settings', { accountId: PERSONAL });
    const again = await readFile(join(dir, 'wrangler.jsonc'), 'utf8');
    expect(again.match(/account_id/g)).toHaveLength(1);
    expect(again).toContain(`"account_id": "${PERSONAL}"`);
  });

  it('keeps the publish method as a setting in package.json', async () => {
    const dir = await cloudflareGallery();
    server = await startServer({
      galleryDir: dir,
      cloudflare: fakeCloudflare().client,
    });
    await server.call('PUT', '/publish/settings', { method: 'git' });
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    expect(pkg).toEqual({
      name: 'my-gallery',
      minimalgallery: { publish: 'git' },
    });
    expect((await server.call('GET', '/publish')).body.method).toBe('git');
    expect(
      (await server.call('PUT', '/publish/settings', { method: 'ftp' })).status
    ).toBe(400);
  });

  it('needs no workers.dev name for a Worker on its own domain', async () => {
    const dir = await cloudflareGallery();
    await writeFile(
      join(dir, 'wrangler.jsonc'),
      WRANGLER.replace(
        '"assets"',
        `"account_id": "${PERSONAL}",\n  "routes": [{ "pattern": "photos.example.com", "custom_domain": true }],\n  "assets"`
      )
    );
    const cf = fakeCloudflare();
    server = await startServer({ galleryDir: dir, cloudflare: cf.client });
    const info = (await server.call('GET', '/publish')).body;
    expect(info.deploy).toMatchObject({
      accountId: PERSONAL,
      customDomain: true,
      needsAccount: false,
    });
    expect(cf.calls).toEqual([]);
  });
});
