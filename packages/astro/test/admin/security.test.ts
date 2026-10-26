import { afterEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { checkLocal, hostName } from '../../src/admin/server/security.ts';
import { getAdminInfo } from '../../src/admin/token.ts';
import { startServer, tempGallery, type TestServer } from './helpers.ts';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const fakeRequest = (remoteAddress: string, headers: Record<string, string>) =>
  ({ socket: { remoteAddress }, headers }) as unknown as IncomingMessage;

describe('admin security', () => {
  it('answers only loopback addresses with a local Host', () => {
    const local = { host: 'localhost:4321' };
    expect(() => checkLocal(fakeRequest('127.0.0.1', local))).not.toThrow();
    expect(() => checkLocal(fakeRequest('::1', local))).not.toThrow();
    expect(() =>
      checkLocal(fakeRequest('::ffff:127.0.0.1', local))
    ).not.toThrow();
    for (const remote of ['192.168.1.20', '10.0.0.2', '::ffff:192.168.1.20'])
      expect(() => checkLocal(fakeRequest(remote, local))).toThrow(
        /only answers this computer/
      );
    for (const host of [
      'evil.example',
      'localhost.evil.example:4321',
      '192.168.1.20:4321',
    ])
      expect(() => checkLocal(fakeRequest('127.0.0.1', { host }))).toThrow();
    expect(hostName('[::1]:4321')).toBe('[::1]');
    expect(hostName('LOCALHOST:80')).toBe('localhost');
  });

  it('refuses bad hosts, origins, tokens and preflights with 403', async () => {
    const dir = await tempGallery();
    server = await startServer({ galleryDir: dir });
    const { call, raw, port, token } = server;

    expect((await call('GET', '/state')).status).toBe(200);
    expect(
      (await call('GET', '/state', undefined, { host: '127.0.0.1:1' })).status
    ).toBe(200);
    expect(
      (await call('GET', '/state', undefined, { host: '[::1]:1' })).status
    ).toBe(200);

    for (const host of ['evil.example', `rebind.example:${port}`])
      expect((await call('GET', '/state', undefined, { host })).status).toBe(
        403
      );
    // The page itself is checked too.
    expect((await raw('GET', '/admin/', { host: 'evil.example' })).status).toBe(
      403
    );

    expect(
      (await call('GET', '/state', undefined, { 'x-mg-admin': '' })).status
    ).toBe(403);
    expect(
      (await call('GET', '/state', undefined, { 'x-mg-admin': 'nope' })).status
    ).toBe(403);
    // ?token= is for the event stream only.
    expect((await raw('GET', `/admin/api/state?token=${token}`)).status).toBe(
      403
    );
    expect(
      (
        await call('GET', '/state', undefined, {
          origin: 'http://evil.example',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call('GET', '/state', undefined, {
          origin: `http://localhost:${port}`,
        })
      ).status
    ).toBe(200);
    const preflight = await raw('OPTIONS', '/admin/api/state', {
      origin: 'http://evil.example',
      'access-control-request-method': 'PUT',
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

    const events = await raw('GET', '/admin/api/events');
    expect(events.status).toBe(403);
  });

  it('rejects ids that could leave the gallery', async () => {
    const dir = await tempGallery();
    server = await startServer({ galleryDir: dir });
    for (const path of [
      '/photos/..%2F..%2Fetc%2Fpasswd',
      '/photos/a.b',
      '/albums/..%2Fsecret',
    ]) {
      const method = path.startsWith('/albums') ? 'PUT' : 'GET';
      expect((await server.call(method, path, {})).status).toBe(400);
    }
    const upload = await server.call('POST', '/uploads', {
      album: 'a',
      name: '../evil.jpg',
      size: 1,
      lastModified: 0,
    });
    expect(upload.status).toBe(400);
    const dot = await server.call('POST', '/uploads', {
      album: 'a/../b',
      name: 'x.jpg',
      size: 1,
      lastModified: 0,
    });
    expect(dot.status).toBe(400);
  });

  it('leaves other paths alone and gives the page its token', async () => {
    const dir = await tempGallery();
    server = await startServer({ galleryDir: dir, base: '/repo/' });
    expect((await server.raw('GET', '/repo/')).text).toBe('not admin');
    expect((await server.raw('GET', '/repo/_mg/x/y.avif')).text).toBe(
      'not admin'
    );
    // An album named admin is not the admin.
    expect((await server.raw('GET', '/repo/_mg/admin__x/a.avif')).text).toBe(
      'not admin'
    );
    const state = await server.raw('GET', '/repo/admin/api/state', {
      'x-mg-admin': server.token,
    });
    expect(state.status).toBe(200);
    expect(getAdminInfo(dir)).toEqual({
      token: server.token,
      api: '/repo/admin/api',
    });
  });
});
