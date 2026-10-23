/**
 * The admin API: a framework-free Node request handler. `astro dev` mounts it
 * as Vite middleware (see `../inject.ts`); tests mount it on a plain
 * `http.createServer`; a desktop shell could do the same. The API reference
 * is `../README.md`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  inspectPhoto,
  processGallery,
  readPhotoOverrides,
  bucketCredentials,
} from '@minimalgallery/pipeline';
import {
  loadConfig,
  type GalleryConfig,
} from '@minimalgallery/pipeline/config';
import type { PhotoManifest } from '@minimalgallery/pipeline/schema';
import { stripExtension } from '@minimalgallery/pipeline/slug';
import { createAlbum, orderAlbum, updateAlbum } from './albums.ts';
import { EventHub } from './events.ts';
import {
  badRequest,
  HttpError,
  notFound,
  onlyKeys,
  readBody,
  readJson,
  sendEmpty,
  sendError,
  sendJson,
} from './http.ts';
import {
  assertNoJob,
  defaultCommands,
  newJob,
  PUBLISH_METHODS,
  publishChecks as defaultPublishChecks,
  runJob,
  type CommandResolver,
  type Job,
  type PublishChecks,
  type PublishMethod,
} from './jobs.ts';
import { serveMedia } from './media.ts';
import { validateOverrides, writeOverrides } from './overrides.ts';
import { RunQueue, type ProcessFn, type QueueEvent } from './queue.ts';
import { dropGalleryEntry, galleryEntry } from './registry.ts';
import {
  checkLocal,
  checkToken,
  validAlbumId,
  validPhotoId,
} from './security.ts';
import { readSettings, writeSettings } from './settings.ts';
import {
  albumSummaries,
  bucketState,
  duplicateIndex,
  mediaBaseOf,
  orderedPhotos,
  photoSummary,
  readAdminFile,
  readManifest,
  readManifests,
  updateAdminFile,
} from './state.ts';
import {
  CHUNK_SIZE,
  completeUpload,
  createUpload,
  discardUpload,
  sweepUploads,
  writeChunk,
  type UploadContext,
} from './uploads.ts';
import { bridgeWatcher, type WatcherLike } from './watch.ts';

export type { WatcherLike } from './watch.ts';
export type { QueueSnapshot, ProcessFn } from './queue.ts';
export type { CommandResolver, PublishChecks } from './jobs.ts';

export interface AdminApiOptions {
  /** Where `photos/`, `.minimalgallery/` and the config file live. */
  galleryDir: string;
  /** Astro’s `base`. Default `/`. */
  base?: string;
  /** The token the client must send. Default: one made once per process and gallery. */
  token?: string;
  /** A chokidar-like watcher that sees `photos/` (Vite’s `server.watcher`). */
  watcher?: WatcherLike;
  /** Restarts the dev server (after `custom.css` is created). */
  restart?: () => unknown;
  /** Replaces `processGallery` (tests). */
  process?: ProcessFn;
  /** Replaces the publish and connect commands (tests). */
  commands?: CommandResolver;
  /** Replaces the git, gh and wrangler checks of `GET /publish` (tests). */
  publishChecks?: (galleryDir: string) => Promise<PublishChecks>;
  /** Quiet time before a run. Default 1500 ms. */
  debounceMs?: number;
  log?: (message: string) => void;
}

export interface AdminApi {
  token: string;
  /** The API base URL, `<base>_mg/admin/api`. */
  api: string;
  /** Handles admin and bucket-media requests; resolves false for anything else. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /**
   * Detach from the watcher and close event streams. The queue, uploads and
   * jobs stay in the registry for the next instance; `dispose` ends them too.
   */
  close(options?: { dispose?: boolean }): Promise<void>;
}

type Gallery = ReturnType<typeof galleryInfo>;

function galleryInfo(config: GalleryConfig, credentials: boolean) {
  const s = config.storage;
  return {
    name: config.name,
    description: config.description ?? null,
    author: config.author ?? null,
    site: config.site ?? null,
    storage:
      s.mode === 's3'
        ? {
            mode: 's3' as const,
            bucket: s.bucket,
            publicUrl: s.publicUrl,
            credentials,
          }
        : { mode: 'repo' as const },
    originals: config.originals,
    albumsSort: config.albums.sort,
    defaults: config.defaults,
  };
}

const UPLOAD_ID = /^[A-Za-z0-9_-]{16}$/;
const PUBLISH_CACHE_MS = 30000;

export function createAdminApi(options: AdminApiOptions): AdminApi {
  const { galleryDir } = options;
  const base = options.base ?? '/';
  const prefix = base.replace(/\/+$/, '');
  const adminPath = `${prefix}/_mg/admin`;
  const apiPath = `${adminPath}/api`;
  const mediaPath = `${prefix}/_mg/`;
  const mediaBase = mediaBaseOf(base);
  const entry = galleryEntry(galleryDir, apiPath);
  if (options.token) entry.token = options.token;
  const log = options.log ?? (() => {});
  const emit = (event: QueueEvent | BusEvent) => entry.bus.emit('event', event);
  const queue = (entry.queue ??= new RunQueue({
    galleryDir,
    process: options.process ?? processGallery,
    emit,
    debounceMs: options.debounceMs,
  }));
  const commands = options.commands ?? defaultCommands;
  const checks = options.publishChecks ?? defaultPublishChecks;
  const hub = new EventHub();
  const uploads: UploadContext = {
    galleryDir,
    entry,
    added: () => queue.schedule(),
  };
  void sweepUploads(uploads).catch(() => {});

  let config = loadConfig(galleryDir);
  config.catch(() => {});
  const gallery = async (): Promise<Gallery> =>
    galleryInfo(await config, bucketCredentials(galleryDir) !== null);

  // Manifests as last seen, for the duplicate badges of `photo` events.
  let known: Map<string, PhotoManifest> | undefined;
  const knownManifests = async () =>
    (known ??= await readManifests(galleryDir));

  const firstRun = async (photos?: number) => {
    const [c, admin] = await Promise.all([config, readAdminFile(galleryDir)]);
    const count = photos ?? (await knownManifests()).size;
    return {
      photos: count > 0,
      named: c.name !== 'Photos',
      previewed: !!admin.previewed,
      published: !!admin.published,
    };
  };

  const albumsNow = async () => {
    const manifests = await readManifests(galleryDir);
    known = manifests;
    const ordered = await orderedPhotos(galleryDir, manifests);
    return albumSummaries(galleryDir, await config, ordered);
  };

  // Events from the queue and jobs, which outlive this instance.
  const onBus = async (event: QueueEvent | BusEvent) => {
    try {
      switch (event.type) {
        case 'queue':
          return hub.send('queue', event.queue);
        case 'manifest': {
          const all = await knownManifests();
          all.set(event.manifest.id, event.manifest);
          const dupes = duplicateIndex(all.values());
          const group = dupes.get(event.manifest.sourceHash) ?? [];
          for (const id of [
            event.manifest.id,
            ...group.filter((id) => id !== event.manifest.id),
          ]) {
            const m = all.get(id);
            if (m) hub.send('photo', photoSummary(m, mediaBase, dupes));
          }
          return;
        }
        case 'photo-error':
          return hub.send('error', {
            path: event.error.path,
            message: event.error.message,
          });
        case 'run-error':
          return hub.send('error', { path: null, message: event.message });
        case 'run-done': {
          for (const id of event.summary.pruned.ids)
            hub.send('photo-removed', { id });
          if (hub.size) hub.send('albums', await albumsNow());
          else known = undefined;
          return;
        }
        case 'log':
          return hub.send('log', { job: event.job, line: event.line });
        case 'job':
          return hub.send('job', event.data);
        case 'settings':
          return hub.send('settings', event.gallery);
      }
    } catch (e) {
      log(`admin events: ${(e as Error).message}`);
    }
  };
  entry.bus.on('event', onBus);
  const unwatch = options.watcher
    ? bridgeWatcher(options.watcher, galleryDir, queue)
    : () => {};

  const jobEvent = (job: Job) =>
    emit({
      type: 'job',
      data: {
        job: job.job,
        id: job.id,
        state: job.state,
        ...(job.url !== undefined ? { url: job.url } : {}),
        ...(job.code !== undefined ? { code: job.code } : {}),
      },
    });

  const startJob = async (
    kind: Job['job'],
    method?: PublishMethod
  ): Promise<Job> => {
    assertNoJob(entry.job);
    const command = commands(kind, method, galleryDir);
    if (!command)
      throw new HttpError(
        409,
        'minimalgallery is not installed in this gallery. Run npm install, then try again.'
      );
    const job = newJob(kind, method);
    entry.job = job;
    jobEvent(job);
    const site = (await config.catch(() => null))?.site ?? null;
    const line = (text: string) => {
      job.lines.push(text);
      emit({ type: 'log', job: kind, line: text });
    };
    void (async () => {
      if (kind === 'publish') {
        if (queue.snapshot().running)
          line('Waiting for the photos in progress…');
        await queue.pause();
      }
      runJob(
        job,
        command,
        galleryDir,
        {
          log: (text) => emit({ type: 'log', job: kind, line: text }),
          end: async (done) => {
            entry.publishInfo = undefined;
            if (kind === 'publish') {
              queue.resume();
              await updateAdminFile(galleryDir, {
                ...(done.state === 'done' ? { published: true } : {}),
                lastPublish: {
                  method: method!,
                  state: done.state as 'done' | 'failed',
                  url: done.url ?? null,
                  code: done.code ?? null,
                  at: new Date().toISOString(),
                },
              }).catch(() => {});
            }
            jobEvent(done);
          },
        },
        site
      );
    })().catch((e) => {
      job.state = 'failed';
      job.code = null;
      line((e as Error).message);
      if (kind === 'publish') queue.resume();
      jobEvent(job);
    });
    return job;
  };

  type Route = (
    req: IncomingMessage,
    res: ServerResponse,
    params: string[],
    query: URLSearchParams
  ) => Promise<void>;

  const photoParam = (raw: string) => {
    const id = decodeURIComponent(raw);
    if (!validPhotoId(id)) throw badRequest(`${id} is not a photo id.`);
    return id;
  };
  const albumParam = (raw: string) => {
    const id = decodeURIComponent(raw);
    if (!validAlbumId(id)) throw badRequest(`${id} is not an album id.`);
    return id;
  };
  const uploadParam = (raw: string) => {
    if (!UPLOAD_ID.test(raw)) throw notFound(`There is no upload ${raw}.`);
    return raw;
  };
  const albumReply = async (res: ServerResponse, id: string, status = 200) => {
    const album = (await albumsNow()).find((a) => a.id === id);
    sendJson(res, status, { album: album ?? null });
  };

  const routes: Array<[string, RegExp, Route]> = [
    [
      'GET',
      /^\/state$/,
      async (_req, res) => {
        const c = await config;
        const manifests = await readManifests(galleryDir);
        known = manifests;
        const ordered = await orderedPhotos(galleryDir, manifests);
        const dupes = duplicateIndex(ordered);
        sendJson(res, 200, {
          gallery: await gallery(),
          albums: await albumSummaries(galleryDir, c, ordered),
          photos: ordered.map((m) => photoSummary(m, mediaBase, dupes)),
          firstRun: await firstRun(ordered.length),
          queue: queue.snapshot(),
          bucket: await bucketState(galleryDir, c),
        });
      },
    ],
    [
      'POST',
      /^\/first-run\/previewed$/,
      async (_req, res) => {
        await updateAdminFile(galleryDir, { previewed: true });
        sendJson(res, 200, { firstRun: await firstRun() });
      },
    ],
    [
      'POST',
      /^\/queue\/run$/,
      async (req, res) => {
        const body = await readJson(req);
        onlyKeys(body, ['prune']);
        queue.runNow({ prune: body.prune === true });
        sendJson(res, 202, { queue: queue.snapshot() });
      },
    ],
    [
      'GET',
      /^\/photos\/([^/]+)$/,
      async (_req, res, [raw]) => {
        const id = photoParam(raw);
        const m = await readManifest(galleryDir, id);
        if (!m) throw notFound(`There is no photo ${id}.`);
        let inspected;
        try {
          inspected = await inspectPhoto(galleryDir, m.source);
        } catch (e: any) {
          if (e?.code === 'ENOENT')
            throw notFound(
              `The file of ${id} is gone: ${m.original.relativePath}.`
            );
          throw e;
        }
        const all = await knownManifests();
        all.set(m.id, m);
        const variants = m.variants.map(
          ({ name, width, height, bytes, format, key }) => ({
            name,
            width,
            height,
            bytes,
            format,
            url: `${mediaBase}${key}`,
          })
        );
        const edge = (v: { width: number; height: number }) =>
          Math.max(v.width, v.height);
        const preview = [...variants].sort(
          (a, b) =>
            Math.abs(edge(a) - 1280) - Math.abs(edge(b) - 1280) ||
            Number(b.format === 'avif') - Number(a.format === 'avif')
        )[0];
        const { relativePath, bytes, width, height, icc } = m.original;
        sendJson(res, 200, {
          ...photoSummary(m, mediaBase, duplicateIndex(all.values())),
          caption: m.caption,
          ...(m.tz ? { tz: m.tz } : {}),
          camera: m.camera,
          lens: m.lens,
          exposure: m.exposure,
          gps: m.gps,
          place: m.place,
          placeLabel: m.placeLabel,
          keywords: m.keywords,
          copyright: m.copyright,
          author: m.author,
          original: { bytes, width, height, relativePath, icc },
          variants,
          preview: preview?.url ?? '',
          ...inspected,
        });
      },
    ],
    [
      'PUT',
      /^\/photos\/([^/]+)\/overrides$/,
      async (req, res, [raw]) => {
        const id = photoParam(raw);
        const patch = validateOverrides(await readJson(req));
        const m = await readManifest(galleryDir, id);
        if (!m) throw notFound(`There is no photo ${id}.`);
        const rel = m.original.relativePath;
        if (!rel.startsWith('photos/') || rel.split('/').includes('..'))
          throw badRequest(`The manifest of ${id} has a bad path.`);
        const relNoExt = stripExtension(rel);
        const absNoExt = join(galleryDir, ...relNoExt.split('/'));
        const exists = await writeOverrides(absNoExt, patch);
        queue.schedule();
        sendJson(res, 200, {
          overrides: (await readPhotoOverrides(absNoExt)) ?? {},
          overridesFile: exists ? `${relNoExt}.md` : null,
        });
      },
    ],
    [
      'POST',
      /^\/albums$/,
      async (req, res) => {
        const id = await createAlbum(galleryDir, await readJson(req));
        queue.schedule();
        await albumReply(res, id, 201);
      },
    ],
    [
      'PUT',
      /^\/albums\/([^/]+)$/,
      async (req, res, [raw]) => {
        const id = albumParam(raw);
        await updateAlbum(galleryDir, id, await readJson(req));
        queue.schedule();
        await albumReply(res, id);
      },
    ],
    [
      'PUT',
      /^\/albums\/([^/]+)\/order$/,
      async (req, res, [raw]) => {
        const id = albumParam(raw);
        await orderAlbum(galleryDir, id, await readJson(req));
        queue.schedule();
        await albumReply(res, id);
      },
    ],
    [
      'POST',
      /^\/uploads$/,
      async (req, res) => {
        const result = await createUpload(uploads, await readJson(req));
        sendJson(res, 'id' in result ? 201 : 200, result);
      },
    ],
    [
      'PUT',
      /^\/uploads\/([^/]+)$/,
      async (req, res, [raw], query) => {
        const id = uploadParam(raw);
        const offset = Number(query.get('offset') ?? '0');
        if (!Number.isInteger(offset) || offset < 0)
          throw badRequest('offset must be a whole number of bytes.');
        const bytes = await readBody(req, CHUNK_SIZE);
        sendJson(res, 200, await writeChunk(uploads, id, offset, bytes));
      },
    ],
    [
      'POST',
      /^\/uploads\/([^/]+)\/complete$/,
      async (_req, res, [raw]) => {
        sendJson(res, 200, await completeUpload(uploads, uploadParam(raw)));
      },
    ],
    [
      'DELETE',
      /^\/uploads\/([^/]+)$/,
      async (_req, res, [raw]) => {
        await discardUpload(uploads, uploadParam(raw));
        sendEmpty(res);
      },
    ],
    [
      'GET',
      /^\/events$/,
      async (req, res) => {
        hub.open(req, res, [['queue', queue.snapshot()]]);
      },
    ],
    [
      'GET',
      /^\/settings$/,
      async (_req, res) => sendJson(res, 200, await readSettings(galleryDir)),
    ],
    [
      'PUT',
      /^\/settings$/,
      async (req, res) => {
        const change = await writeSettings(galleryDir, await readJson(req));
        if (change.configChanged) {
          config = loadConfig(galleryDir);
          config.catch(() => {});
        }
        if (change.sortChanged) queue.schedule();
        emit({ type: 'settings', gallery: await gallery() });
        sendJson(res, 200, change.settings);
        // A new custom.css is linked only by a fresh start; a config edit
        // restarts the dev server by itself.
        if (change.cssCreated && !change.configChanged) options.restart?.();
      },
    ],
    [
      'GET',
      /^\/publish$/,
      async (_req, res) => {
        const now = Date.now();
        if (!entry.publishInfo || now - entry.publishInfo.at > PUBLISH_CACHE_MS)
          entry.publishInfo = { at: now, value: await checks(galleryDir) };
        const c = await config;
        const admin = await readAdminFile(galleryDir);
        const bucket = await bucketState(galleryDir, c);
        sendJson(res, 200, {
          ...(entry.publishInfo.value as PublishChecks),
          bucket: bucket
            ? {
                mode: 's3',
                credentials: bucketCredentials(galleryDir) !== null,
                pending: bucket.pending,
              }
            : null,
          site: c.site ?? null,
          last: admin.lastPublish ?? null,
          job: entry.job,
        });
      },
    ],
    [
      'POST',
      /^\/publish$/,
      async (req, res) => {
        const body = await readJson(req);
        onlyKeys(body, ['method']);
        const method = body.method as PublishMethod;
        if (!PUBLISH_METHODS.includes(method))
          throw badRequest("method must be 'git', 'deploy' or 'build'.");
        const job = await startJob('publish', method);
        sendJson(res, 202, { job: job.id });
      },
    ],
    [
      'POST',
      /^\/connect\/cloudflare$/,
      async (_req, res) => {
        const job = await startJob('connect');
        sendJson(res, 202, { job: job.id });
      },
    ],
  ];

  async function handle(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return false;
    }
    const path = url.pathname;
    if (path === adminPath || path.startsWith(`${adminPath}/`)) {
      try {
        checkLocal(req);
        if (req.method === 'OPTIONS')
          throw new HttpError(403, 'Cross-origin requests are refused.');
        if (path !== apiPath && !path.startsWith(`${apiPath}/`)) return false;
        const sub = path.slice(apiPath.length) || '/';
        checkToken(req, entry.token, url.searchParams, sub === '/events');
        const method = req.method === 'HEAD' ? 'GET' : req.method;
        let matchedPath = false;
        for (const [m, pattern, route] of routes) {
          const match = pattern.exec(sub);
          if (!match) continue;
          matchedPath = true;
          if (m !== method) continue;
          await route(req, res, match.slice(1), url.searchParams);
          return true;
        }
        throw new HttpError(
          matchedPath ? 405 : 404,
          matchedPath ? 'Method not allowed.' : `No API route ${sub}.`
        );
      } catch (e) {
        if (!(e instanceof HttpError))
          log(`admin: ${(e as Error)?.stack ?? e}`);
        sendError(res, e);
        return true;
      }
    }
    if (path.startsWith(mediaPath)) {
      const c = await config.catch(() => null);
      if (!c) return false;
      let key: string;
      try {
        key = decodeURIComponent(path.slice(mediaPath.length));
      } catch {
        return false;
      }
      return serveMedia(
        req,
        res,
        galleryDir,
        key,
        c.storage.mode === 's3' ? c.storage.publicUrl : null
      );
    }
    return false;
  }

  return {
    token: entry.token,
    api: apiPath,
    handle,
    async close({ dispose = false } = {}) {
      entry.bus.off('event', onBus);
      unwatch();
      hub.close();
      if (dispose) {
        queue.dispose();
        await queue.idle();
        dropGalleryEntry(galleryDir);
      }
    },
  };
}

/** Events that jobs and settings put on the bus, beside the queue’s. */
type BusEvent =
  | { type: 'log'; job: Job['job']; line: string }
  | { type: 'job'; data: Record<string, unknown> }
  | { type: 'settings'; gallery: Gallery };
