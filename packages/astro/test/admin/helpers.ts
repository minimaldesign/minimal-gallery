import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  createAdminApi,
  type AdminApi,
  type AdminApiOptions,
} from '../../src/admin/server/index.ts';

export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const REPO_DIR = join(PACKAGE_DIR, '..', '..');

/**
 * A temporary gallery. Its `node_modules` links to this package’s, so a
 * config file that imports `@minimalgallery/pipeline/config` loads.
 */
export async function tempGallery(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mg-admin-'));
  await symlink(join(PACKAGE_DIR, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

/** A small JPEG with EXIF camera and date tags (or none). */
export async function writeJpeg(
  path: string,
  {
    color = '#c33',
    date = '2005:02:27 18:16:10' as string | null,
    exif = true,
    width = 96,
    height = 64,
  } = {}
): Promise<Buffer> {
  await mkdir(dirname(path), { recursive: true });
  let image = sharp({
    create: { width, height, channels: 3, background: color },
  });
  if (exif)
    image = image.withExif({
      IFD0: { Make: 'NIKON CORPORATION', Model: 'NIKON D70' },
      IFD2: {
        ...(date ? { DateTimeOriginal: date } : {}),
        ExposureTime: '1/60',
        FNumber: '56/10',
      },
    });
  const buf = await image.jpeg().toBuffer();
  await writeFile(path, buf);
  return buf;
}

export async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

export async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

export interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
  text: string;
}

export interface TestServer {
  api: AdminApi;
  port: number;
  token: string;
  /** A request to the API, with the token unless `headers` says otherwise. */
  call(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<Reply>;
  /** Any request to the server. */
  raw(
    method: string,
    path: string,
    headers?: Record<string, string>,
    body?: Buffer | string
  ): Promise<Reply>;
  events(): Promise<EventStream>;
  close(): Promise<void>;
}

export async function startServer(
  options: Partial<AdminApiOptions> & { galleryDir: string }
): Promise<TestServer> {
  const api = createAdminApi({ debounceMs: 50, ...options });
  const server = http.createServer(async (req, res) => {
    if (!(await api.handle(req, res))) res.writeHead(404).end('not admin');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  const streams: EventStream[] = [];

  const raw: TestServer['raw'] = (method, path, headers = {}, body) =>
    new Promise((done, fail) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: { host: `localhost:${port}`, ...headers },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown = undefined;
            try {
              parsed = text ? JSON.parse(text) : undefined;
            } catch {}
            done({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: parsed,
              text,
            });
          });
        }
      );
      req.on('error', fail);
      if (body !== undefined) req.write(body);
      req.end();
    });

  const call: TestServer['call'] = (method, path, body, headers = {}) => {
    const payload =
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body);
    return raw(
      method,
      `/_mg/admin/api${path}`,
      {
        'x-mg-admin': api.token,
        ...(payload !== undefined && !Buffer.isBuffer(body)
          ? { 'content-type': 'application/json' }
          : {}),
        ...headers,
      },
      payload
    );
  };

  return {
    api,
    port,
    token: api.token,
    call,
    raw,
    async events() {
      const s = await openEvents(port, api.token);
      streams.push(s);
      return s;
    },
    async close() {
      for (const s of streams) s.close();
      await api.close({ dispose: true });
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}

export interface AdminEvent {
  event: string;
  data: any;
}

export interface EventStream {
  events: AdminEvent[];
  /** Resolves with the first event (seen or to come) that matches. */
  waitFor(
    match: (e: AdminEvent) => boolean,
    timeoutMs?: number
  ): Promise<AdminEvent>;
  close(): void;
}

function openEvents(port: number, token: string): Promise<EventStream> {
  return new Promise((done, fail) => {
    const events: AdminEvent[] = [];
    const waiters: Array<{
      match: (e: AdminEvent) => boolean;
      resolve: (e: AdminEvent) => void;
    }> = [];
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: `/_mg/admin/api/events?token=${encodeURIComponent(token)}`,
        headers: { host: `localhost:${port}` },
      },
      (res) => {
        if (res.statusCode !== 200) {
          fail(new Error(`events: ${res.statusCode}`));
          return;
        }
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const name = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (!name || data === undefined) continue;
            const e = { event: name, data: JSON.parse(data) };
            events.push(e);
            for (const w of [...waiters])
              if (w.match(e)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve(e);
              }
          }
        });
        done({
          events,
          waitFor(match, timeoutMs = 15000) {
            const seen = events.find(match);
            if (seen) return Promise.resolve(seen);
            return new Promise((resolve, reject) => {
              const timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      `no matching event; got ${events.map((e) => e.event).join(', ')}`
                    )
                  ),
                timeoutMs
              );
              waiters.push({
                match,
                resolve: (e) => {
                  clearTimeout(timer);
                  resolve(e);
                },
              });
            });
          },
          close() {
            req.destroy();
          },
        });
      }
    );
    req.on('error', () => {});
  });
}

/** Upload a file through the chunked API. Returns the complete reply. */
export async function upload(
  s: TestServer,
  album: string,
  name: string,
  bytes: Buffer,
  {
    chunk = 1000,
    lastModified = Date.parse('2004-06-01T12:00:00Z'),
    sidecarOf = undefined as string | undefined,
  } = {}
): Promise<{ id?: string; result: any }> {
  const created = await s.call('POST', '/uploads', {
    album,
    name,
    size: bytes.length,
    lastModified,
    ...(sidecarOf ? { sidecarOf } : {}),
  });
  if (created.status === 200) return { result: created.body };
  if (created.status !== 201)
    throw new Error(`create: ${created.status} ${created.text}`);
  const id = created.body.id as string;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const r = await s.call(
      'PUT',
      `/uploads/${id}?offset=${offset}`,
      bytes.subarray(offset, offset + chunk),
      { 'content-type': 'application/octet-stream' }
    );
    if (r.status !== 200) throw new Error(`chunk: ${r.status} ${r.text}`);
  }
  const done = await s.call('POST', `/uploads/${id}/complete`);
  return { id, result: done.body };
}

/** Resolves when the gallery’s queue has no run in progress or waiting. */
export async function settled(galleryDir: string): Promise<void> {
  const { registryRoot } = await import('../../src/admin/token.ts');
  const entry = registryRoot().galleries.get(galleryDir) as
    { queue?: { settled(): Promise<void> } } | undefined;
  // Let a debounced request start first.
  await new Promise((r) => setTimeout(r, 120));
  await entry?.queue?.settled();
}
